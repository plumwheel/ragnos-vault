/**
 * RAGnos Vault Runtime Loader
 * 
 * Orchestrates secure loading and execution of SDK plugins with:
 * - Manifest validation and policy enforcement
 * - Subprocess sandbox management
 * - JSON-RPC communication handling
 * - Capability-based access control
 */

const { EventEmitter } = require('events');
const path = require('path');
const { SandboxManager } = require('./sandbox-manager');
const { ManifestValidator } = require('./manifest-validator');
const { PolicyEngine } = require('./policy-engine');
const { RPC_METHODS, ERROR_CODES } = require('./plugin-abi');
const { recordPluginEvent, recordSecurityEvent, recordPerformanceMetric, createSpan } = require('./telemetry-shim');
const { TUFClient } = require('./tuf-client');
const { CapabilityNormalizer } = require('./capability-normalizer');

class RuntimeLoader extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      maxConcurrentPlugins: 10,
      defaultTimeout: 30000,
      policyPath: null,
      ...options
    };
    
    // Core components
    this.manifestValidator = new ManifestValidator();
    this.policyEngine = new PolicyEngine(this.options.policyPath);
    this.sandboxManager = new SandboxManager(this.policyEngine, this.options);
    this.capabilityNormalizer = new CapabilityNormalizer();
    
    // TUF client for secure plugin distribution
    this.tufClient = new TUFClient({
      repositoryUrl: this.options.tufRepositoryUrl || 'https://plugins.ragnos.io',
      metadataDir: this.options.tufMetadataDir || './tuf-metadata',
      cacheDir: this.options.tufCacheDir || './tuf-cache'
    });
    
    // Runtime state
    this.loadedPlugins = new Map();
    this.requestId = 0;
    this.tufInitialized = false;
  }

  /**
   * Initialize TUF client with root metadata
   */
  async initializeTUF(rootMetadata = null) {
    try {
      await this.tufClient.initialize(rootMetadata);
      this.tufInitialized = true;
      
      recordSecurityEvent('tuf_runtime_initialized', 'info', {
        repository_url: this.tufClient.options.repositoryUrl
      });
      
      return true;
    } catch (error) {
      recordSecurityEvent('tuf_runtime_initialization_failed', 'warning', {
        error_message: error.message
      });
      
      // TUF initialization failure is non-fatal for backward compatibility
      console.warn('TUF initialization failed, continuing without TUF verification:', error.message);
      return false;
    }
  }

  /**
   * Verify plugin via TUF before loading
   */
  async verifyPluginWithTUF(manifest, pluginPath) {
    if (!this.tufInitialized) {
      // No TUF verification available, log and continue
      recordSecurityEvent('tuf_verification_skipped', 'info', {
        plugin_id: manifest.id,
        reason: 'tuf_not_initialized'
      });
      return null;
    }

    const span = createSpan('runtime.tuf_verification', { plugin_id: manifest.id });
    
    try {
      // Get expected plugin path from manifest
      const tufPath = this.getPluginTUFPath(manifest);
      
      // Get plugin metadata from TUF
      const tufMetadata = await this.tufClient.getPluginMetadata(tufPath);
      
      if (!tufMetadata) {
        recordSecurityEvent('plugin_not_in_tuf', 'warning', {
          plugin_id: manifest.id,
          tuf_path: tufPath
        });
        return null; // Plugin not in TUF repository
      }
      
      // Verify hash if available
      if (manifest.hash) {
        const algorithm = Object.keys(tufMetadata.hashes)[0];
        const expectedHash = tufMetadata.hashes[algorithm];
        
        if (manifest.hash !== expectedHash) {
          recordSecurityEvent('tuf_hash_mismatch', 'violation', {
            plugin_id: manifest.id,
            expected: expectedHash,
            actual: manifest.hash
          });
          throw new Error('Plugin hash mismatch detected via TUF verification');
        }
      }
      
      recordSecurityEvent('tuf_verification_success', 'info', {
        plugin_id: manifest.id,
        tuf_path: tufPath
      });
      
      span.setAttributes({ success: true, verified: true });
      span.end();
      
      return tufMetadata;
      
    } catch (error) {
      recordSecurityEvent('tuf_verification_failed', 'error', {
        plugin_id: manifest.id,
        error_message: error.message
      });
      
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw error;
    }
  }

  /**
   * Get TUF repository path for plugin
   */
  getPluginTUFPath(manifest) {
    const vendor = manifest.vendor || 'community';
    const pluginId = manifest.id;
    const version = manifest.version || 'latest';
    
    return `plugins/${vendor}/${pluginId}.${version}.tar.gz`;
  }

  /**
   * Load and initialize a plugin from manifest
   */
  async loadPlugin(manifest, pluginPath, options = {}) {
    const span = createSpan('plugin.load', { plugin_id: manifest.id });
    const startTime = Date.now();
    
    try {
      recordPluginEvent(manifest.id, 'load_started', {
        transport: manifest.transport,
        vendor: manifest.vendor
      });
      
      // 1. Validate manifest
      const manifestResult = await this.manifestValidator.validateManifest(manifest);
      if (!manifestResult.valid) {
        throw new Error(`Manifest validation failed: ${manifestResult.errors.map(e => e.message).join(', ')}`);
      }

      // 2. TUF verification (if enabled)
      const tufMetadata = await this.verifyPluginWithTUF(manifest, pluginPath);

      // 3. Check policy compliance
      const policyResult = await this.policyEngine.checkProvider(manifest, options.context || {});
      if (!policyResult.allowed) {
        recordSecurityEvent('policy_violation', 'violation', {
          plugin_id: manifest.id,
          violations: policyResult.violations.length,
          enforcement_level: policyResult.enforcement.level
        });
        throw new Error(`Policy violation: ${policyResult.violations.map(v => v.message).join(', ')}`);
      }

      // 4. Create sandbox
      const sandbox = await this.sandboxManager.createSandbox(manifest, pluginPath, options);

      // 5. Create plugin runtime
      const pluginRuntime = new PluginRuntime(manifest, sandbox, this);

      // 6. Start plugin in sandbox
      await pluginRuntime.initialize(pluginPath);

      // 7. Register plugin
      this.loadedPlugins.set(manifest.id, pluginRuntime);

      // 8. Emit loaded event
      this.emit('plugin:loaded', {
        id: manifest.id,
        manifest,
        runtime: pluginRuntime
      });

      const loadTime = Date.now() - startTime;
      recordPerformanceMetric('plugin_load', loadTime, {
        plugin_id: manifest.id,
        transport: manifest.transport
      });
      recordPluginEvent(manifest.id, 'loaded', { load_time_ms: loadTime });
      span.setAttributes({ success: true, load_time_ms: loadTime });
      span.end();

      return pluginRuntime;

    } catch (error) {
      const loadTime = Date.now() - startTime;
      recordPluginEvent(manifest.id, 'error', {
        phase: 'loading',
        error_type: error.constructor.name,
        load_time_ms: loadTime
      });
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message }); // ERROR status
      span.end();
      
      this.emit('plugin:error', {
        id: manifest.id,
        error: error.message,
        phase: 'loading'
      });
      throw error;
    }
  }

  /**
   * Unload a plugin and cleanup resources
   */
  async unloadPlugin(pluginId) {
    const pluginRuntime = this.loadedPlugins.get(pluginId);
    if (!pluginRuntime) {
      throw new Error(`Plugin ${pluginId} not loaded`);
    }

    try {
      await pluginRuntime.shutdown();
      this.loadedPlugins.delete(pluginId);

      this.emit('plugin:unloaded', { id: pluginId });

    } catch (error) {
      this.emit('plugin:error', {
        id: pluginId,
        error: error.message,
        phase: 'unloading'
      });
      throw error;
    }
  }

  /**
   * Get loaded plugin by ID
   */
  getPlugin(pluginId) {
    return this.loadedPlugins.get(pluginId);
  }

  /**
   * List all loaded plugins
   */
  listPlugins() {
    return Array.from(this.loadedPlugins.keys());
  }

  /**
   * Get runtime statistics
   */
  getStats() {
    return {
      loadedPlugins: this.loadedPlugins.size,
      maxConcurrent: this.options.maxConcurrentPlugins,
      sandbox: this.sandboxManager.getStats(),
      policy: this.policyEngine.getPolicy().enforcement,
      tuf: {
        initialized: this.tufInitialized,
        ...this.tufClient.getStats()
      }
    };
  }

  /**
   * Shutdown runtime loader and cleanup all plugins
   */
  async shutdown() {
    const shutdownPromises = Array.from(this.loadedPlugins.values()).map(
      runtime => runtime.shutdown().catch(error => 
        console.error(`Plugin shutdown error: ${error.message}`)
      )
    );

    await Promise.all(shutdownPromises);
    this.loadedPlugins.clear();
    
    // Shutdown TUF client
    if (this.tufInitialized) {
      await this.tufClient.shutdown();
      this.tufInitialized = false;
    }
    
    this.emit('runtime:shutdown');
  }
}

/**
 * Individual Plugin Runtime Instance
 */
class PluginRuntime extends EventEmitter {
  constructor(manifest, sandbox, loader) {
    super();
    
    this.manifest = manifest;
    this.sandbox = sandbox;
    this.loader = loader;
    this.state = 'loaded';
    this.capabilities = new Set();
    this.pendingRequests = new Map();
    this.requestId = 0;
    
    // Create ready promise for lifecycle management
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.readyResolved = false;
  }

  /**
   * Initialize plugin in sandbox with deterministic lifecycle
   */
  async initialize(pluginPath) {
    try {
      // LOADED → INITING
      this.setState('initing');

      // Start sandbox process with relative plugin path within sandbox
      const sandboxPluginPath = this.sandbox.sandboxPluginPath;
      const workspacePath = this.sandbox.config.workspace.work;
      
      // Calculate relative path from work directory to plugin file
      const relativePath = sandboxPluginPath ? path.relative(workspacePath, sandboxPluginPath) : pluginPath;
      
      // Use the copied bootstrap script within sandbox  
      const bootstrapPath = path.relative(workspacePath, this.sandbox.sandboxBootstrapPath);
      
      await this.sandbox.start(bootstrapPath, [relativePath]);
      recordPluginEvent(this.manifest.id, 'sandbox_started', {
        pid: this.sandbox.process?.pid,
        memory_limit: this.sandbox.config.memory,
        timeout: this.sandbox.config.timeout
      });

      // Setup JSON-RPC communication
      this.setupCommunication();

      // Wait for plugin ready signal
      await this.waitForReady();

      // Initialize plugin - INITING → INITED
      await this.callPlugin(RPC_METHODS.INITIALIZE, {
        manifest: this.manifest,
        workspace: this.sandbox.config.workspace.work
      });
      this.setState('inited');

      // Capability negotiation - INITED → CAP_NEGOTIATING
      await this.negotiateCapabilities();

      // Mark as ready - CAP_GRANTED → READY
      this.setState('ready');
      this.readyResolved = true;
      this.resolveReady();
      this.emit('initialized');

    } catch (error) {
      this.setState('error');
      this.rejectReady(error);
      throw new Error(`Plugin initialization failed: ${error.message}`);
    }
  }

  /**
   * Set plugin state with logging
   */
  setState(newState) {
    const oldState = this.state;
    this.state = newState;
    recordPluginEvent(this.manifest.id, 'state_transition', {
      from: oldState,
      to: newState,
      timestamp: Date.now()
    });
  }

  /**
   * Negotiate capabilities with deterministic ordering
   */
  async negotiateCapabilities() {
    this.setState('cap_negotiating');

    try {
      // Normalize capabilities to canonical format
      const canonicalCapabilities = this.loader.capabilityNormalizer.normalizeCapabilities(this.manifest);
      
      if (canonicalCapabilities.length === 0) {
        this.setState('cap_granted');
        return;
      }

      // Process each canonical capability request
      for (const capability of canonicalCapabilities) {
        let granted = false;
        
        // Check capability type and route to appropriate handler  
        const { CapabilityNormalizer } = require('./capability-normalizer');
        if (CapabilityNormalizer.requiresNetwork(capability)) {
          granted = await this.handleNetworkCapabilityRequest(capability.params);
        } else if (CapabilityNormalizer.requiresFilesystem(capability)) {
          granted = await this.handleFilesystemCapabilityRequest(capability.params);
        } else if (CapabilityNormalizer.requiresEnvironment(capability)) {
          granted = await this.handleEnvironmentCapabilityRequest(capability.params);
        } else {
          // Auto-grant legacy capabilities for backward compatibility
          if (capability.source === 'legacy') {
            granted = true;
            recordPluginEvent(this.manifest.id, 'capability_legacy_auto_granted', {
              type: capability.type,
              justification: capability.justification
            });
          } else {
            recordPluginEvent(this.manifest.id, 'capability_unknown', {
              type: capability.type,
              source: capability.source
            });
          }
        }

        if (granted) {
          this.capabilities.add(capability.type);
        }
      }

      // Emit capabilities granted event AFTER updating store
      this.emit('capability:granted', {
        plugin_id: this.manifest.id,
        capabilities: Array.from(this.capabilities)
      });

      // Notify plugin of granted capabilities
      await this.callPlugin('plugin.capabilitiesGranted', {
        granted: Array.from(this.capabilities)
      });

      this.setState('cap_granted');

    } catch (error) {
      recordPluginEvent(this.manifest.id, 'capability_negotiation_failed', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Require plugin to be ready before operations
   */
  async requireReady() {
    if (!this.readyResolved) {
      await this.readyPromise;
    }
  }

  createPluginBootstrap() {
    // Return path to bootstrap script that loads the actual plugin
    return path.join(__dirname, 'plugin-bootstrap.js');
  }

  setupCommunication() {
    if (!this.sandbox.process) {
      throw new Error('Sandbox process not available');
    }

    // Handle stdout (JSON-RPC messages)
    this.sandbox.process.stdout.on('data', (data) => {
      try {
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
          if (line.trim()) {
            this.handleMessage(JSON.parse(line));
          }
        });
      } catch (error) {
        this.emit('communication:error', error);
      }
    });

    // Handle stderr (error logs)
    this.sandbox.process.stderr.on('data', (data) => {
      const message = data.toString().trim();
      console.error(`Plugin ${this.manifest.id} stderr:`, message);
      this.emit('plugin:log', {
        level: 'error',
        message,
        timestamp: Date.now()
      });
    });

    // Handle process exit
    this.sandbox.process.on('exit', (code, signal) => {
      this.state = 'exited';
      this.emit('exited', { code, signal });
    });
  }

  async waitForReady() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Plugin ready timeout'));
      }, 10000); // 10 second timeout

      const readyHandler = (message) => {
        if (message.method === 'plugin.ready') {
          clearTimeout(timeout);
          this.off('message:method', readyHandler);
          resolve();
        }
      };

      this.on('message:method', readyHandler);
    });
  }

  handleMessage(message) {
    this.sandbox.stats.messagesReceived++;

    if (message.id && this.pendingRequests.has(message.id)) {
      // Response to our request
      this.handleResponse(message);
    } else if (message.method) {
      // Method call from plugin
      this.handleMethodCall(message);
    } else {
      this.emit('message:unknown', message);
    }
  }

  handleResponse(message) {
    const { resolve, reject } = this.pendingRequests.get(message.id);
    this.pendingRequests.delete(message.id);

    if (message.error) {
      reject(new Error(`Plugin error ${message.error.code}: ${message.error.message}`));
    } else {
      resolve(message.result);
    }
  }

  async handleMethodCall(message) {
    try {
      let result = null;

      switch (message.method) {
        case RPC_METHODS.REQUEST_NETWORK:
          result = await this.handleNetworkCapabilityRequest(message.params);
          break;

        case RPC_METHODS.REQUEST_FILESYSTEM:
          result = await this.handleFilesystemCapabilityRequest(message.params);
          break;

        case RPC_METHODS.REQUEST_ENVIRONMENT:
          result = await this.handleEnvironmentCapabilityRequest(message.params);
          break;

        case 'plugin.ready':
          this.emit('message:method', message);
          return; // No response needed

        default:
          throw new Error(`Unknown method: ${message.method}`);
      }

      // Send response
      if (message.id) {
        this.sendResponse(message.id, result);
      }

    } catch (error) {
      if (message.id) {
        this.sendError(message.id, ERROR_CODES.INTERNAL_ERROR, error.message);
      }
      this.emit('method:error', { method: message.method, error });
    }
  }

  async handleNetworkCapabilityRequest(params) {
    const { domains = [], justification = '' } = params;

    // Check policy
    const networkPolicy = this.loader.policyEngine.policy.network;
    
    if (!networkPolicy.allowEgress) {
      this.emit('capability:denied', {
        type: 'network',
        reason: 'Network egress disabled by policy'
      });
      return false;
    }

    // Check against manifest allowlist
    const manifestAllowlist = this.manifest.security?.networkAllowlist || [];
    const unauthorizedDomains = domains.filter(domain => 
      !manifestAllowlist.some(allowed => this.matchesDomain(domain, allowed))
    );

    if (unauthorizedDomains.length > 0) {
      this.emit('capability:denied', {
        type: 'network',
        reason: `Unauthorized domains: ${unauthorizedDomains.join(', ')}`
      });
      return false;
    }

    // Grant capability
    this.capabilities.add('network');
    this.emit('capability:granted', {
      type: 'network',
      domains,
      justification
    });

    return true;
  }

  async handleFilesystemCapabilityRequest(params) {
    const { paths = [], permissions = ['read'], justification = '' } = params;

    // Check policy
    if (!this.loader.policyEngine.policy.sandbox.allowFileSystem) {
      this.emit('capability:denied', {
        type: 'filesystem',
        reason: 'Filesystem access disabled by policy'
      });
      return false;
    }

    // Validate paths are within allowed areas
    const allowedPaths = this.sandbox.config.allowedPaths;
    const unauthorizedPaths = paths.filter(path => 
      !allowedPaths.some(allowed => path.startsWith(allowed))
    );

    if (unauthorizedPaths.length > 0) {
      this.emit('capability:denied', {
        type: 'filesystem',
        reason: `Unauthorized paths: ${unauthorizedPaths.join(', ')}`
      });
      return false;
    }

    // Grant capability
    this.capabilities.add('filesystem');
    this.emit('capability:granted', {
      type: 'filesystem',
      paths,
      permissions,
      justification
    });

    return true;
  }

  async handleEnvironmentCapabilityRequest(params) {
    const { allowlist = [], justification = '' } = params;

    // Check policy
    if (!this.loader.policyEngine.policy.sandbox.allowEnvironmentAccess) {
      this.emit('capability:denied', {
        type: 'environment',
        reason: 'Environment access disabled by policy'
      });
      return false;
    }

    // Grant capability
    this.capabilities.add('environment');
    this.emit('capability:granted', {
      type: 'environment',
      allowlist,
      justification
    });

    return true;
  }

  matchesDomain(domain, pattern) {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(domain);
    }
    return domain === pattern;
  }

  /**
   * Call a method on the plugin
   */
  async callPlugin(method, params = {}) {
    const callStartTime = Date.now();
    recordPluginEvent(this.manifest.id, 'rpc_call', { method });
    
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const message = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { 
        resolve: (result) => {
          const callDuration = Date.now() - callStartTime;
          recordPerformanceMetric('rpc_call', callDuration, {
            plugin_id: this.manifest.id,
            method,
            success: true
          });
          resolve(result);
        },
        reject: (error) => {
          const callDuration = Date.now() - callStartTime;
          recordPerformanceMetric('rpc_call', callDuration, {
            plugin_id: this.manifest.id,
            method,
            success: false,
            error_type: error.constructor.name
          });
          reject(error);
        }
      });
      this.sendMessage(message);

      // Timeout handling
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          const callDuration = Date.now() - callStartTime;
          recordPerformanceMetric('rpc_call', callDuration, {
            plugin_id: this.manifest.id,
            method,
            success: false,
            error_type: 'timeout'
          });
          reject(new Error('Plugin call timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Validate credentials using the plugin
   */
  async validateCredentials(credentials) {
    // Ensure plugin is ready before validation
    await this.requireReady();

    try {
      const result = await this.callPlugin(RPC_METHODS.VALIDATE_CREDENTIALS, credentials);
      
      this.emit('validation:completed', {
        provider: this.manifest.id,
        success: result.valid,
        duration: result.responseTime
      });

      return result;

    } catch (error) {
      this.emit('validation:error', {
        provider: this.manifest.id,
        error: error.message
      });
      throw error;
    }
  }

  sendMessage(message) {
    this.sandbox.sendMessage(message);
  }

  sendResponse(id, result) {
    this.sendMessage({
      jsonrpc: '2.0',
      id,
      result
    });
  }

  sendError(id, code, message, data = null) {
    this.sendMessage({
      jsonrpc: '2.0',
      id,
      error: { code, message, data }
    });
  }

  /**
   * Get plugin information
   */
  getInfo() {
    return {
      id: this.manifest.id,
      state: this.state,
      capabilities: Array.from(this.capabilities),
      sandbox: this.sandbox.getStats(),
      manifest: {
        displayName: this.manifest.displayName,
        vendor: this.manifest.vendor,
        version: this.manifest.sdk?.version,
        transport: this.manifest.transport
      }
    };
  }

  /**
   * Shutdown plugin runtime
   */
  async shutdown() {
    if (this.state === 'exited') {
      return;
    }

    try {
      // Call plugin shutdown if ready
      if (this.state === 'ready') {
        await this.callPlugin(RPC_METHODS.SHUTDOWN);
      }
    } catch (error) {
      // Log but don't throw - cleanup should continue
      console.warn(`Plugin shutdown warning: ${error.message}`);
    } finally {
      // Cleanup sandbox
      await this.sandbox.cleanup();
      this.state = 'shutdown';
      this.emit('shutdown');
    }
  }
}

module.exports = { RuntimeLoader, PluginRuntime };