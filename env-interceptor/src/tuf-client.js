/**
 * RAGnos Vault TUF Client Integration Spike
 * 
 * Evaluates tuf-js JavaScript implementation for client-side verification.
 * This spike tests compatibility with our security requirements and
 * performance benchmarks.
 */

const { Updater } = require('tuf-js');
const fs = require('fs');
const path = require('path');
const { recordPerformanceMetric, recordSecurityEvent, createSpan } = require('./telemetry-shim');

class TUFClient {
  constructor(options = {}) {
    this.options = {
      repositoryUrl: options.repositoryUrl || 'https://plugins.ragnos.io',
      metadataDir: options.metadataDir || './tuf-metadata',
      cacheDir: options.cacheDir || './tuf-cache',
      maxMetadataAge: options.maxMetadataAge || 24 * 60 * 60 * 1000, // 24 hours
      ...options
    };
    
    this.updater = null;
    this.initialized = false;
    this.rootMetadata = null;
  }

  /**
   * Initialize TUF client with root metadata
   */
  async initialize(rootMetadata = null) {
    const span = createSpan('tuf.initialize');
    const startTime = Date.now();
    
    try {
      // Ensure directories exist
      this.ensureDirectories();
      
      // Load or set root metadata
      if (rootMetadata) {
        this.rootMetadata = rootMetadata;
      } else {
        this.rootMetadata = await this.loadRootMetadata();
      }
      
      if (!this.rootMetadata) {
        throw new Error('Root metadata required for TUF client initialization');
      }
      
      // Initialize tuf-js Updater
      this.updater = new Updater({
        metadataUrl: this.options.repositoryUrl,
        targetUrl: this.options.repositoryUrl,
        rootMetadata: this.rootMetadata,
        metadataDir: this.options.metadataDir,
        cacheDir: this.options.cacheDir
      });
      
      this.initialized = true;
      const initTime = Date.now() - startTime;
      
      recordPerformanceMetric('tuf_initialization', initTime);
      recordSecurityEvent('tuf_initialized', 'info', {
        repository_url: this.options.repositoryUrl,
        cache_dir: this.options.cacheDir,
        init_time_ms: initTime
      });
      
      span.setAttributes({ success: true, init_time_ms: initTime });
      span.end();
      
      return true;
      
    } catch (error) {
      const initTime = Date.now() - startTime;
      recordSecurityEvent('tuf_initialization_failed', 'error', {
        error_message: error.message,
        init_time_ms: initTime
      });
      
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw new Error(`TUF client initialization failed: ${error.message}`);
    }
  }

  /**
   * Verify and download a plugin from TUF repository
   */
  async downloadPlugin(pluginPath, expectedHash = null) {
    if (!this.initialized) {
      throw new Error('TUF client not initialized');
    }
    
    const span = createSpan('tuf.download_plugin', { plugin_path: pluginPath });
    const startTime = Date.now();
    
    try {
      // Refresh metadata first
      await this.refreshMetadata();
      
      // Download and verify the plugin
      const targetInfo = await this.updater.getTargetInfo(pluginPath);
      if (!targetInfo) {
        throw new Error(`Plugin not found in TUF repository: ${pluginPath}`);
      }
      
      // Verify expected hash if provided
      if (expectedHash && !targetInfo.hashes[expectedHash.algorithm]) {
        throw new Error(`Expected hash algorithm ${expectedHash.algorithm} not found in TUF metadata`);
      }
      
      if (expectedHash && targetInfo.hashes[expectedHash.algorithm] !== expectedHash.value) {
        recordSecurityEvent('hash_mismatch', 'violation', {
          plugin_path: pluginPath,
          expected: expectedHash.value,
          actual: targetInfo.hashes[expectedHash.algorithm]
        });
        throw new Error('Plugin hash mismatch - potential tampering detected');
      }
      
      // Download the verified target
      const pluginData = await this.updater.downloadTarget(targetInfo);
      
      const downloadTime = Date.now() - startTime;
      recordPerformanceMetric('tuf_plugin_download', downloadTime, {
        plugin_path: pluginPath,
        plugin_size_bytes: targetInfo.length
      });
      
      recordSecurityEvent('plugin_verified_download', 'info', {
        plugin_path: pluginPath,
        size_bytes: targetInfo.length,
        hash_algorithm: Object.keys(targetInfo.hashes)[0],
        download_time_ms: downloadTime
      });
      
      span.setAttributes({
        success: true,
        size_bytes: targetInfo.length,
        download_time_ms: downloadTime
      });
      span.end();
      
      return {
        data: pluginData,
        metadata: targetInfo,
        verified: true
      };
      
    } catch (error) {
      const downloadTime = Date.now() - startTime;
      recordSecurityEvent('plugin_download_failed', 'error', {
        plugin_path: pluginPath,
        error_message: error.message,
        download_time_ms: downloadTime
      });
      
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw error;
    }
  }

  /**
   * Get plugin metadata without downloading
   */
  async getPluginMetadata(pluginPath) {
    if (!this.initialized) {
      throw new Error('TUF client not initialized');
    }
    
    const span = createSpan('tuf.get_metadata', { plugin_path: pluginPath });
    
    try {
      await this.refreshMetadata();
      
      const targetInfo = await this.updater.getTargetInfo(pluginPath);
      if (!targetInfo) {
        return null;
      }
      
      span.setAttributes({ success: true, found: true });
      span.end();
      
      return {
        path: pluginPath,
        length: targetInfo.length,
        hashes: targetInfo.hashes,
        custom: targetInfo.custom || {}
      };
      
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw error;
    }
  }

  /**
   * Refresh TUF metadata from repository
   */
  async refreshMetadata() {
    if (!this.initialized || !this.updater) {
      throw new Error('TUF client not initialized');
    }
    
    const span = createSpan('tuf.refresh_metadata');
    const startTime = Date.now();
    
    try {
      await this.updater.refresh();
      
      const refreshTime = Date.now() - startTime;
      recordPerformanceMetric('tuf_metadata_refresh', refreshTime);
      
      span.setAttributes({ success: true, refresh_time_ms: refreshTime });
      span.end();
      
    } catch (error) {
      const refreshTime = Date.now() - startTime;
      recordSecurityEvent('metadata_refresh_failed', 'warning', {
        error_message: error.message,
        refresh_time_ms: refreshTime
      });
      
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw new Error(`Failed to refresh TUF metadata: ${error.message}`);
    }
  }

  /**
   * Verify repository freshness (anti-freeze attack)
   */
  async verifyFreshness() {
    if (!this.initialized || !this.updater) {
      throw new Error('TUF client not initialized');
    }
    
    const span = createSpan('tuf.verify_freshness');
    
    try {
      const timestampMetadata = await this.updater.getTimestampMetadata();
      const timestampAge = Date.now() - new Date(timestampMetadata.signed.expires).getTime();
      
      if (timestampAge > this.options.maxMetadataAge) {
        recordSecurityEvent('stale_metadata_detected', 'violation', {
          timestamp_age_ms: timestampAge,
          max_age_ms: this.options.maxMetadataAge,
          expires: timestampMetadata.signed.expires
        });
        throw new Error('TUF metadata is stale - potential freeze attack');
      }
      
      recordSecurityEvent('metadata_freshness_verified', 'info', {
        timestamp_age_ms: timestampAge,
        expires: timestampMetadata.signed.expires
      });
      
      span.setAttributes({ success: true, timestamp_age_ms: timestampAge });
      span.end();
      
      return true;
      
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw error;
    }
  }

  /**
   * Load root metadata from local storage or configuration
   */
  async loadRootMetadata() {
    const rootPath = path.join(this.options.metadataDir, 'root.json');
    
    try {
      if (fs.existsSync(rootPath)) {
        const rootContent = fs.readFileSync(rootPath, 'utf8');
        return JSON.parse(rootContent);
      }
    } catch (error) {
      console.warn('Failed to load local root metadata:', error.message);
    }
    
    return null;
  }

  /**
   * Save root metadata to local storage
   */
  async saveRootMetadata(rootMetadata) {
    const rootPath = path.join(this.options.metadataDir, 'root.json');
    
    try {
      // Ensure directory exists before saving
      this.ensureDirectories();
      fs.writeFileSync(rootPath, JSON.stringify(rootMetadata, null, 2));
      recordSecurityEvent('root_metadata_saved', 'info', {
        path: rootPath
      });
    } catch (error) {
      recordSecurityEvent('root_metadata_save_failed', 'warning', {
        error_message: error.message,
        path: rootPath
      });
      throw error;
    }
  }

  /**
   * Ensure required directories exist
   */
  ensureDirectories() {
    [this.options.metadataDir, this.options.cacheDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Get TUF client statistics
   */
  getStats() {
    return {
      initialized: this.initialized,
      repository_url: this.options.repositoryUrl,
      metadata_dir: this.options.metadataDir,
      cache_dir: this.options.cacheDir,
      max_metadata_age_ms: this.options.maxMetadataAge,
      implementation: 'tuf-js',
      version: require('tuf-js/package.json').version
    };
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown() {
    // tuf-js doesn't require explicit cleanup, but we track the event
    recordSecurityEvent('tuf_client_shutdown', 'info');
    this.initialized = false;
  }
}

module.exports = { TUFClient };