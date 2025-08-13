/**
 * RAGnos Vault TUF Integration Layer
 * 
 * Bridges the TUF client with local repository and provides unified
 * verification interface for plugin loading. Supports both local-first
 * and remote repository scenarios with graceful fallback.
 */

const { TUFClient } = require('./tuf-client');
const { LocalTUFRepository } = require('./local-tuf-repository');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { recordSecurityEvent, recordPluginEvent, createSpan } = require('./telemetry-shim');

class TUFIntegration {
  constructor(options = {}) {
    this.options = {
      // Local repository options
      localRepoDir: options.localRepoDir || 'tuf-local',
      enableLocalRepo: options.enableLocalRepo !== false,
      
      // Remote repository options
      remoteRepoUrl: options.remoteRepoUrl || 'https://plugins.ragnos.io',
      enableRemoteRepo: options.enableRemoteRepo !== false,
      
      // Client options
      metadataDir: options.metadataDir || './tuf-metadata',
      cacheDir: options.cacheDir || './tuf-cache',
      
      // Security options
      maxMetadataAge: options.maxMetadataAge || 24 * 60 * 60 * 1000, // 24 hours
      requireVerification: options.requireVerification !== false,
      allowFallback: options.allowFallback !== false,
      
      ...options
    };

    this.localRepository = null;
    this.localClient = null;
    this.remoteClient = null;
    this.initialized = false;
    this.activeRepository = null;
  }

  /**
   * Initialize TUF integration with repository discovery
   */
  async initialize() {
    const span = createSpan('tuf_integration.initialize');
    
    try {
      console.log('🔐 Initializing TUF Integration...');
      
      // Initialize local repository if enabled
      if (this.options.enableLocalRepo) {
        await this.initializeLocalRepository();
      }
      
      // Initialize remote client if enabled
      if (this.options.enableRemoteRepo) {
        await this.initializeRemoteClient();
      }
      
      // Determine active repository
      this.activeRepository = this.determineActiveRepository();
      
      this.initialized = true;
      
      recordSecurityEvent('tuf_integration_initialized', 'info', {
        local_repo_enabled: !!this.localRepository,
        remote_client_enabled: !!this.remoteClient,
        active_repository: this.activeRepository
      });
      
      console.log(`✅ TUF Integration initialized (active: ${this.activeRepository})`);
      
      span.setAttributes({ 
        success: true, 
        active_repository: this.activeRepository 
      });
      span.end();
      
      return true;
      
    } catch (error) {
      recordSecurityEvent('tuf_integration_init_failed', 'error', {
        error_message: error.message
      });
      
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw new Error(`TUF Integration initialization failed: ${error.message}`);
    }
  }

  /**
   * Initialize local TUF repository
   */
  async initializeLocalRepository() {
    try {
      console.log('📁 Checking local TUF repository...');
      
      this.localRepository = new LocalTUFRepository({
        repoDir: this.options.localRepoDir
      });

      // Check if local repository exists and is valid
      const repoExists = fs.existsSync(this.options.localRepoDir);
      const metadataExists = fs.existsSync(path.join(this.options.localRepoDir, 'metadata', 'root.json'));
      
      if (repoExists && metadataExists) {
        // Load existing keys and metadata
        await this.localRepository.generateOrLoadKeys();
        
        // Ensure metadata directories exist
        const localMetadataDir = path.join(this.options.metadataDir, 'local');
        const localCacheDir = path.join(this.options.cacheDir, 'local');
        
        [localMetadataDir, localCacheDir].forEach(dir => {
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
        });
        
        // Copy root metadata to local client cache
        const rootMetadata = JSON.parse(
          fs.readFileSync(path.join(this.options.localRepoDir, 'metadata', 'root.json'), 'utf8')
        );
        
        fs.writeFileSync(
          path.join(localMetadataDir, 'root.json'),
          JSON.stringify(rootMetadata, null, 2)
        );
        
        // Initialize local TUF client
        this.localClient = new TUFClient({
          repositoryUrl: `http://localhost:${this.localRepository.options.serverPort}`,
          metadataDir: localMetadataDir,
          cacheDir: localCacheDir,
          maxMetadataAge: this.options.maxMetadataAge
        });
        
        await this.localClient.initialize(rootMetadata);
        
        console.log('  ✓ Local TUF repository initialized');
        
      } else {
        console.log('  ⚠️  Local TUF repository not found (use local-tuf-cli init)');
        this.localRepository = null;
      }
      
    } catch (error) {
      console.warn(`  ⚠️  Local TUF repository initialization failed: ${error.message}`);
      this.localRepository = null;
      this.localClient = null;
    }
  }

  /**
   * Initialize remote TUF client
   */
  async initializeRemoteClient() {
    try {
      console.log('🌐 Checking remote TUF repository...');
      
      this.remoteClient = new TUFClient({
        repositoryUrl: this.options.remoteRepoUrl,
        metadataDir: path.join(this.options.metadataDir, 'remote'),
        cacheDir: path.join(this.options.cacheDir, 'remote'),
        maxMetadataAge: this.options.maxMetadataAge
      });
      
      // Try to initialize (will require pinned root metadata in production)
      // For now, we'll mark as available but not initialize until needed
      console.log('  ✓ Remote TUF client configured');
      
    } catch (error) {
      console.warn(`  ⚠️  Remote TUF client configuration failed: ${error.message}`);
      this.remoteClient = null;
    }
  }

  /**
   * Determine which repository to use as primary
   */
  determineActiveRepository() {
    if (this.localClient && this.localRepository) {
      return 'local';
    } else if (this.remoteClient) {
      return 'remote';
    } else {
      return 'none';
    }
  }

  /**
   * Verify and download a plugin with TUF verification
   */
  async verifyAndDownloadPlugin(pluginIdentifier, options = {}) {
    if (!this.initialized) {
      throw new Error('TUF Integration not initialized');
    }

    const span = createSpan('tuf_integration.verify_download', { 
      plugin_id: pluginIdentifier 
    });
    
    try {
      console.log(`🔍 Verifying plugin: ${pluginIdentifier}`);
      
      const result = await this.attemptVerificationWithFallback(pluginIdentifier, options);
      
      if (!result.verified && this.options.requireVerification) {
        throw new Error('Plugin verification required but failed');
      }
      
      recordPluginEvent(pluginIdentifier, 'plugin_verified', {
        verification_method: result.method,
        verified: result.verified,
        size_bytes: result.data?.length || 0
      });
      
      console.log(`  ✅ Plugin verified via ${result.method}`);
      
      span.setAttributes({
        success: true,
        verified: result.verified,
        method: result.method
      });
      span.end();
      
      return result;
      
    } catch (error) {
      recordSecurityEvent('plugin_verification_failed', 'error', {
        plugin_id: pluginIdentifier,
        error_message: error.message
      });
      
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw error;
    }
  }

  /**
   * Attempt verification with fallback strategy
   */
  async attemptVerificationWithFallback(pluginIdentifier, options) {
    const attempts = [];
    
    // Try local repository first if available
    if (this.localClient) {
      attempts.push({
        method: 'local',
        client: this.localClient,
        repository: this.localRepository
      });
    }
    
    // Try remote repository as fallback
    if (this.remoteClient && this.options.allowFallback) {
      attempts.push({
        method: 'remote',
        client: this.remoteClient,
        repository: null
      });
    }
    
    let lastError = null;
    
    for (const attempt of attempts) {
      try {
        console.log(`  🔄 Attempting ${attempt.method} verification...`);
        
        const result = await this.verifyWithClient(
          attempt.client, 
          pluginIdentifier, 
          options,
          attempt.repository
        );
        
        return {
          ...result,
          method: attempt.method,
          verified: true
        };
        
      } catch (error) {
        console.warn(`  ⚠️  ${attempt.method} verification failed: ${error.message}`);
        lastError = error;
        continue;
      }
    }
    
    // If all attempts failed but fallback is allowed, try unverified download
    if (this.options.allowFallback && !this.options.requireVerification) {
      console.warn('  ⚠️  Falling back to unverified download');
      
      const result = await this.downloadUnverified(pluginIdentifier, options);
      return {
        ...result,
        method: 'unverified',
        verified: false
      };
    }
    
    throw lastError || new Error('No verification methods available');
  }

  /**
   * Verify plugin with specific TUF client
   */
  async verifyWithClient(client, pluginIdentifier, options, repository) {
    // Ensure client is ready
    if (!client.initialized) {
      // For local client, try to start repository server if needed
      if (repository && !repository.server) {
        await repository.startServer();
      }
      
      // Initialize client if not already done
      if (!client.initialized) {
        await client.initialize();
      }
    }
    
    // Verify freshness first (anti-freeze attack)
    await client.verifyFreshness();
    
    // Get plugin metadata
    const metadata = await client.getPluginMetadata(pluginIdentifier);
    if (!metadata) {
      throw new Error(`Plugin not found: ${pluginIdentifier}`);
    }
    
    // Download and verify
    const result = await client.downloadPlugin(pluginIdentifier, options.expectedHash);
    
    return {
      data: result.data,
      metadata: result.metadata,
      custom: metadata.custom || {}
    };
  }

  /**
   * Download plugin without TUF verification (fallback mode)
   */
  async downloadUnverified(pluginIdentifier, options) {
    recordSecurityEvent('unverified_plugin_download', 'warning', {
      plugin_id: pluginIdentifier,
      reason: 'verification_unavailable'
    });
    
    // This would implement a basic HTTP download as fallback
    // For security, this should be heavily restricted in production
    throw new Error('Unverified downloads not implemented - security policy violation');
  }

  /**
   * Get plugin metadata without downloading
   */
  async getPluginMetadata(pluginIdentifier) {
    if (!this.initialized) {
      throw new Error('TUF Integration not initialized');
    }

    const span = createSpan('tuf_integration.get_metadata', { 
      plugin_id: pluginIdentifier 
    });
    
    try {
      let metadata = null;
      
      // Try local repository first
      if (this.localClient) {
        try {
          metadata = await this.localClient.getPluginMetadata(pluginIdentifier);
          if (metadata) {
            span.setAttributes({ success: true, source: 'local' });
            span.end();
            return { ...metadata, source: 'local' };
          }
        } catch (error) {
          console.warn(`Local metadata lookup failed: ${error.message}`);
        }
      }
      
      // Try remote repository as fallback
      if (this.remoteClient && this.options.allowFallback) {
        try {
          metadata = await this.remoteClient.getPluginMetadata(pluginIdentifier);
          if (metadata) {
            span.setAttributes({ success: true, source: 'remote' });
            span.end();
            return { ...metadata, source: 'remote' };
          }
        } catch (error) {
          console.warn(`Remote metadata lookup failed: ${error.message}`);
        }
      }
      
      span.setAttributes({ success: false, found: false });
      span.end();
      
      return null;
      
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw error;
    }
  }

  /**
   * Refresh all repository metadata
   */
  async refreshMetadata() {
    if (!this.initialized) {
      throw new Error('TUF Integration not initialized');
    }

    const results = [];
    
    // Refresh local repository
    if (this.localClient) {
      try {
        await this.localClient.refreshMetadata();
        results.push({ repository: 'local', success: true });
      } catch (error) {
        results.push({ repository: 'local', success: false, error: error.message });
      }
    }
    
    // Refresh remote repository
    if (this.remoteClient) {
      try {
        await this.remoteClient.refreshMetadata();
        results.push({ repository: 'remote', success: true });
      } catch (error) {
        results.push({ repository: 'remote', success: false, error: error.message });
      }
    }
    
    recordSecurityEvent('metadata_refresh_completed', 'info', {
      results: results
    });
    
    return results;
  }

  /**
   * Get integration status and statistics
   */
  getStatus() {
    return {
      initialized: this.initialized,
      active_repository: this.activeRepository,
      local_repository: {
        enabled: this.options.enableLocalRepo,
        available: !!this.localRepository,
        client_ready: !!this.localClient?.initialized
      },
      remote_repository: {
        enabled: this.options.enableRemoteRepo,
        available: !!this.remoteClient,
        client_ready: !!this.remoteClient?.initialized,
        url: this.options.remoteRepoUrl
      },
      security_settings: {
        require_verification: this.options.requireVerification,
        allow_fallback: this.options.allowFallback,
        max_metadata_age_ms: this.options.maxMetadataAge
      }
    };
  }

  /**
   * Shutdown integration and cleanup resources
   */
  async shutdown() {
    const span = createSpan('tuf_integration.shutdown');
    
    try {
      // Shutdown clients
      if (this.localClient) {
        await this.localClient.shutdown();
      }
      
      if (this.remoteClient) {
        await this.remoteClient.shutdown();
      }
      
      // Stop local repository server if running
      if (this.localRepository) {
        await this.localRepository.stopServer();
      }
      
      this.initialized = false;
      
      recordSecurityEvent('tuf_integration_shutdown', 'info');
      
      span.setAttributes({ success: true });
      span.end();
      
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw error;
    }
  }
}

module.exports = { TUFIntegration };