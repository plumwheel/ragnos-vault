/**
 * RAGnos Vault Hybrid TUF Client
 * Production-ready TUF verification with automatic fallback from TUF-js to Python-TUF
 * Implements GPT-5 recommended hybrid architecture with feature flags and circuit breaker
 */

const { TUFClient } = require('./tuf-client');
const { PythonTUFWrapper } = require('./python-tuf-wrapper');
const { createSpan, recordSecurityEvent } = require('./telemetry-shim');
const fs = require('fs');
const path = require('path');

class HybridTUFClient {
  constructor(options = {}) {
    this.options = {
      // Client mode: auto (default), js, python, off
      clientMode: options.clientMode || process.env.RAGNOS_TUF_CLIENT || 'auto',
      
      // Circuit breaker settings
      maxConsecutiveJsFailures: options.maxConsecutiveJsFailures || 2,
      
      // Client configurations
      jsClientOptions: options.jsClientOptions || {},
      pythonClientOptions: options.pythonClientOptions || {},
      
      ...options
    };
    
    // Client instances
    this.jsClient = null;
    this.pythonClient = null;
    
    // Circuit breaker state
    this.jsFailureCount = 0;
    this.jsHealthy = true;
    this.clientDecision = null; // Cache decision for process lifetime
    this.initialized = false;
  }

  /**
   * Initialize hybrid TUF client with automatic client selection
   */
  async initialize() {
    const span = createSpan('hybrid_tuf.initialize');
    
    try {
      console.log(`🔐 Initializing Hybrid TUF Client (mode: ${this.options.clientMode})`);
      
      // Initialize clients based on mode
      if (this.options.clientMode === 'python') {
        await this.initializePythonOnly();
      } else if (this.options.clientMode === 'js') {
        await this.initializeJsOnly();
      } else if (this.options.clientMode === 'auto') {
        await this.initializeAuto();
      } else if (this.options.clientMode === 'off') {
        console.log('⚠️  TUF verification disabled (mode: off)');
        this.initialized = true;
        return { initialized: true, mode: 'off', verification: false };
      } else {
        throw new Error(`Invalid TUF client mode: ${this.options.clientMode}`);
      }
      
      this.initialized = true;
      
      recordSecurityEvent('hybrid_tuf_initialized', 'info', {
        mode: this.options.clientMode,
        selected_client: this.clientDecision,
        js_healthy: this.jsHealthy
      });
      
      span.setAttributes({ 
        success: true, 
        mode: this.options.clientMode,
        selected_client: this.clientDecision
      });
      span.end();
      
      console.log(`✅ Hybrid TUF Client ready (using: ${this.clientDecision || 'none'})`);
      
      return {
        initialized: true,
        mode: this.options.clientMode,
        selectedClient: this.clientDecision,
        verification: this.clientDecision !== null
      };
      
    } catch (error) {
      recordSecurityEvent('hybrid_tuf_init_failed', 'error', {
        error_message: error.message,
        mode: this.options.clientMode
      });
      
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw error;
    }
  }

  /**
   * Initialize Python-only mode
   */
  async initializePythonOnly() {
    this.pythonClient = new PythonTUFWrapper(this.options.pythonClientOptions);
    
    // Check Python availability
    const availability = await this.pythonClient.checkAvailability();
    if (!availability.available) {
      throw new Error(`Python TUF not available: ${availability.error}. ${availability.suggestion}`);
    }
    
    this.clientDecision = 'python';
    console.log(`  ✅ Python TUF client ready (${availability.version})`);
  }

  /**
   * Initialize JavaScript-only mode
   */
  async initializeJsOnly() {
    this.jsClient = new TUFClient(this.options.jsClientOptions);
    await this.jsClient.initialize();
    this.clientDecision = 'js';
    console.log(`  ✅ JavaScript TUF client ready`);
  }

  /**
   * Initialize auto mode with client probing and fallback
   */
  async initializeAuto() {
    // First, probe JavaScript client
    try {
      console.log('  🔍 Probing JavaScript TUF client...');
      this.jsClient = new TUFClient(this.options.jsClientOptions);
      
      // Lightweight probe - just initialization
      await this.jsClient.initialize();
      
      this.jsHealthy = true;
      this.clientDecision = 'js';
      console.log('  ✅ JavaScript TUF client healthy, using as primary');
      
    } catch (jsError) {
      console.log(`  ⚠️  JavaScript TUF client failed: ${jsError.message}`);
      
      if (this.shouldFallbackFromError(jsError)) {
        console.log('  🔄 Falling back to Python TUF client...');
        this.jsHealthy = false;
        
        try {
          this.pythonClient = new PythonTUFWrapper(this.options.pythonClientOptions);
          
          const availability = await this.pythonClient.checkAvailability();
          if (!availability.available) {
            throw new Error(`Python TUF not available: ${availability.error}`);
          }
          
          this.clientDecision = 'python';
          console.log(`  ✅ Python TUF client ready as fallback (${availability.version})`);
          
        } catch (pythonError) {
          throw new Error(`Both TUF clients failed. JS: ${jsError.message}, Python: ${pythonError.message}`);
        }
      } else {
        // Not a fallback-worthy error, just propagate
        throw jsError;
      }
    }
    
    recordSecurityEvent('tuf_client_selected', 'info', {
      selected: this.clientDecision,
      js_healthy: this.jsHealthy,
      mode: 'auto'
    });
  }

  /**
   * Determine if error should trigger fallback to Python client
   */
  shouldFallbackFromError(error) {
    const errorMessage = String(error.message || '').toLowerCase();
    const errorCode = String(error.code || '');
    
    // Known TUF-js signature issues
    const signatureIssues = [
      'sig must be a string',
      'signature must be a string',
      'invalid signature format',
      'signature validation failed'
    ];
    
    const hasSignatureIssue = signatureIssues.some(issue => errorMessage.includes(issue));
    const isVerificationError = errorCode === 'TUF_VERIFY_ERROR' || errorMessage.includes('verification');
    
    return hasSignatureIssue || isVerificationError;
  }

  /**
   * Verify and download plugin with hybrid client selection
   */
  async verifyAndDownloadPlugin(pluginIdentifier, options = {}) {
    if (!this.initialized) {
      throw new Error('Hybrid TUF client not initialized');
    }
    
    if (this.options.clientMode === 'off') {
      throw new Error('TUF verification disabled (mode: off)');
    }
    
    const span = createSpan('hybrid_tuf.verify_download', { 
      plugin_id: pluginIdentifier,
      client: this.clientDecision
    });
    
    try {
      let result;
      
      if (this.clientDecision === 'js') {
        result = await this.verifyWithJsClient(pluginIdentifier, options, span);
      } else if (this.clientDecision === 'python') {
        result = await this.verifyWithPythonClient(pluginIdentifier, options, span);
      } else {
        throw new Error('No TUF client available for verification');
      }
      
      span.setAttributes({
        success: true,
        verified: result.verified,
        method: result.method || this.clientDecision
      });
      span.end();
      
      return result;
      
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw error;
    }
  }

  /**
   * Verify with JavaScript client (with circuit breaker fallback)
   */
  async verifyWithJsClient(pluginIdentifier, options, parentSpan) {
    try {
      const result = await this.jsClient.downloadPlugin(pluginIdentifier, options.expectedHash);
      
      // Reset failure count on success
      this.jsFailureCount = 0;
      
      return {
        data: result.data,
        metadata: result.metadata,
        verified: result.verified,
        method: 'tuf-js'
      };
      
    } catch (jsError) {
      this.jsFailureCount++;
      
      recordSecurityEvent('tuf_js_verification_failed', 'warning', {
        plugin_id: pluginIdentifier,
        error_message: jsError.message,
        failure_count: this.jsFailureCount
      });
      
      // Circuit breaker: fallback to Python if consecutive failures
      if (this.shouldFallbackFromError(jsError) && 
          this.jsFailureCount >= this.options.maxConsecutiveJsFailures &&
          this.options.clientMode === 'auto') {
        
        console.log(`🔄 Circuit breaker: falling back to Python client (${this.jsFailureCount} JS failures)`);
        
        try {
          if (!this.pythonClient) {
            this.pythonClient = new PythonTUFWrapper(this.options.pythonClientOptions);
          }
          
          const result = await this.verifyWithPythonClient(pluginIdentifier, options, parentSpan);
          
          recordSecurityEvent('tuf_circuit_breaker_fallback_success', 'info', {
            plugin_id: pluginIdentifier,
            js_failures: this.jsFailureCount
          });
          
          return result;
          
        } catch (pythonError) {
          recordSecurityEvent('tuf_circuit_breaker_fallback_failed', 'error', {
            plugin_id: pluginIdentifier,
            js_error: jsError.message,
            python_error: pythonError.message
          });
          
          // Both clients failed
          throw new Error(`TUF verification failed with both clients. JS: ${jsError.message}, Python: ${pythonError.message}`);
        }
      } else {
        // No fallback, propagate JS error
        throw jsError;
      }
    }
  }

  /**
   * Verify with Python client
   */
  async verifyWithPythonClient(pluginIdentifier, options, parentSpan) {
    if (!this.pythonClient) {
      this.pythonClient = new PythonTUFWrapper(this.options.pythonClientOptions);
    }
    
    // For Python client, we need to construct the TUF repository URLs
    const repoUrl = this.options.jsClientOptions.repositoryUrl || 'http://localhost:8090';
    const metadataDir = this.options.jsClientOptions.metadataDir || './tuf-metadata';
    const targetsDir = this.options.jsClientOptions.cacheDir || './tuf-cache';
    const trustedRoot = path.join(metadataDir, 'root.json');
    
    // Ensure trusted root exists (copy from JS client if needed)
    if (!fs.existsSync(trustedRoot) && this.jsClient) {
      const rootMetadata = this.jsClient.rootMetadata;
      if (rootMetadata) {
        fs.mkdirSync(path.dirname(trustedRoot), { recursive: true });
        fs.writeFileSync(trustedRoot, JSON.stringify(rootMetadata, null, 2));
      }
    }
    
    try {
      const result = await this.pythonClient.downloadTarget(
        pluginIdentifier,
        repoUrl,
        metadataDir,
        targetsDir,
        trustedRoot,
        options.expectedHash
      );
      
      return {
        data: Buffer.from(result.content_hex || '', 'hex'),
        metadata: {
          length: result.length,
          hashes: result.hashes
        },
        verified: result.verified,
        method: 'python-tuf'
      };
      
    } catch (error) {
      recordSecurityEvent('python_tuf_verification_failed', 'error', {
        plugin_id: pluginIdentifier,
        error_message: error.message,
        error_code: error.code
      });
      
      throw error;
    }
  }

  /**
   * Get client status information
   */
  getStatus() {
    return {
      initialized: this.initialized,
      mode: this.options.clientMode,
      selectedClient: this.clientDecision,
      jsHealthy: this.jsHealthy,
      jsFailureCount: this.jsFailureCount,
      availableClients: {
        js: !!this.jsClient,
        python: !!this.pythonClient
      }
    };
  }

  /**
   * Shutdown hybrid client
   */
  async shutdown() {
    try {
      if (this.jsClient) {
        await this.jsClient.shutdown();
      }
      
      // Python client doesn't need explicit shutdown
      
      recordSecurityEvent('hybrid_tuf_shutdown', 'info', {
        mode: this.options.clientMode,
        selected_client: this.clientDecision
      });
      
    } catch (error) {
      console.warn(`Hybrid TUF client shutdown warning: ${error.message}`);
    }
  }
}

module.exports = { HybridTUFClient };