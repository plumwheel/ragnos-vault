/**
 * RAGnos Vault Plugin ABI (Application Binary Interface)
 * 
 * Defines the contract between RAGnos Vault and SDK plugins via JSON-RPC over stdio.
 * Security-first design with capability-based access control.
 */

/**
 * Plugin ABI Specification v1.0
 * 
 * Communication: JSON-RPC 2.0 over stdio
 * Runtime: Node.js (minimum version defined in manifest)
 * Security: Subprocess sandbox with explicit capabilities
 */

// JSON-RPC Message Types
const RPC_METHODS = {
  // Lifecycle
  INITIALIZE: 'plugin.initialize',
  SHUTDOWN: 'plugin.shutdown',
  HEALTH_CHECK: 'plugin.healthCheck',
  
  // Provider Operations
  VALIDATE_CREDENTIALS: 'provider.validateCredentials',
  GET_CAPABILITIES: 'provider.getCapabilities',
  GET_METADATA: 'provider.getMetadata',
  
  // Capability Requests (require policy approval)
  REQUEST_NETWORK: 'capability.requestNetwork',
  REQUEST_FILESYSTEM: 'capability.requestFilesystem',
  REQUEST_ENVIRONMENT: 'capability.requestEnvironment'
};

// Standard Error Codes
const ERROR_CODES = {
  // Plugin errors
  PLUGIN_NOT_INITIALIZED: -32001,
  PLUGIN_INITIALIZATION_FAILED: -32002,
  PLUGIN_SHUTDOWN_FAILED: -32003,
  ERR_PLUGIN_NOT_INITIALIZED: -32001, // GPT-5 specified alias
  
  // Capability errors
  CAPABILITY_DENIED: -32010,
  CAPABILITY_NOT_REQUESTED: -32011,
  CAPABILITY_LIMIT_EXCEEDED: -32012,
  
  // Provider errors
  INVALID_CREDENTIALS: -32020,
  PROVIDER_UNAVAILABLE: -32021,
  RATE_LIMIT_EXCEEDED: -32022,
  
  // Security errors
  SANDBOX_VIOLATION: -32030,
  POLICY_VIOLATION: -32031,
  RESOURCE_LIMIT_EXCEEDED: -32032
};

// Capability Types
const CAPABILITIES = {
  NETWORK: {
    type: 'network',
    permissions: ['connect', 'resolve'],
    constraints: ['allowlist', 'rate_limit', 'timeout']
  },
  FILESYSTEM: {
    type: 'filesystem', 
    permissions: ['read', 'write', 'create'],
    constraints: ['paths', 'size_limit', 'readonly']
  },
  ENVIRONMENT: {
    type: 'environment',
    permissions: ['read'],
    constraints: ['allowlist', 'masked_secrets']
  },
  SECRETS: {
    type: 'secrets',
    permissions: ['receive'],
    constraints: ['one_time_use', 'auto_zeroize']
  }
};

/**
 * Plugin Base Class
 * All SDK plugins must extend this class or implement equivalent interface
 */
class RagVaultPlugin {
  constructor() {
    this.initialized = false;
    this.capabilities = new Set();
    this.rpc = new JsonRpcChannel();
  }

  /**
   * Plugin initialization
   * Called once when plugin is loaded
   */
  async initialize(config = {}) {
    throw new Error('Plugin must implement initialize() method');
  }

  /**
   * Validate API credentials
   * Required method for all provider plugins
   */
  async validateCredentials(credentials) {
    throw new Error('Plugin must implement validateCredentials() method');
  }

  /**
   * Get provider capabilities
   * Returns list of supported operations
   */
  async getCapabilities() {
    return {
      operations: ['validate'],
      features: [],
      version: '1.0.0'
    };
  }

  /**
   * Get provider metadata
   * Returns plugin information
   */
  async getMetadata() {
    return {
      id: this.constructor.name.toLowerCase(),
      version: '1.0.0',
      runtime: 'nodejs',
      capabilities: Array.from(this.capabilities)
    };
  }

  /**
   * Request network capability
   * Must be called before making network requests
   */
  async requestNetworkCapability(domains = []) {
    const granted = await this.rpc.request(RPC_METHODS.REQUEST_NETWORK, {
      domains,
      justification: 'API communication required'
    });
    
    if (granted) {
      this.capabilities.add('network');
    }
    
    return granted;
  }

  /**
   * Request filesystem capability
   * Must be called before accessing filesystem
   */
  async requestFilesystemCapability(paths = [], permissions = ['read']) {
    const granted = await this.rpc.request(RPC_METHODS.REQUEST_FILESYSTEM, {
      paths,
      permissions,
      justification: 'Configuration file access'
    });
    
    if (granted) {
      this.capabilities.add('filesystem');
    }
    
    return granted;
  }

  /**
   * Health check
   * Called periodically to verify plugin status
   */
  async healthCheck() {
    return {
      status: 'healthy',
      timestamp: Date.now(),
      capabilities: Array.from(this.capabilities)
    };
  }

  /**
   * Capability grant notification
   * Called when capabilities have been granted by the runtime
   */
  async onCapabilitiesGranted(params) {
    const { granted = [] } = params;
    
    // Update internal capability set
    for (const capability of granted) {
      this.capabilities.add(capability);
    }
    
    // Enable network access flag for bootstrap security wrapper
    if (granted.includes('network') || granted.includes('api.generic')) {
      global.networkCapabilityGranted = true;
    }
    
    return {
      acknowledged: true,
      capabilities: Array.from(this.capabilities)
    };
  }

  /**
   * Plugin shutdown
   * Called when plugin is being unloaded
   */
  async shutdown() {
    this.initialized = false;
    this.capabilities.clear();
  }
}

/**
 * JSON-RPC Communication Channel
 * Handles message serialization and error handling
 */
class JsonRpcChannel {
  constructor() {
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.setupIOHandlers();
  }

  setupIOHandlers() {
    // Setup stdin/stdout for JSON-RPC communication
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (data) => {
      try {
        const lines = data.trim().split('\n');
        lines.forEach(line => {
          if (line.trim()) {
            this.handleMessage(JSON.parse(line));
          }
        });
      } catch (error) {
        this.sendError(null, ERROR_CODES.PARSE_ERROR, 'Invalid JSON');
      }
    });

    // Handle process signals
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  async request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const message = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });
      this.sendMessage(message);

      // Timeout handling
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000); // 30 second timeout
    });
  }

  handleMessage(message) {
    if (message.id && this.pendingRequests.has(message.id)) {
      // Response to our request
      const { resolve, reject } = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(`RPC Error ${message.error.code}: ${message.error.message}`));
      } else {
        resolve(message.result);
      }
    } else if (message.method) {
      // Incoming method call from host
      this.handleMethodCall(message);
    }
  }

  async handleMethodCall(message) {
    try {
      let result;
      
      switch (message.method) {
        case RPC_METHODS.INITIALIZE:
          result = await global.pluginInstance.initialize(message.params);
          break;
        case RPC_METHODS.VALIDATE_CREDENTIALS:
          result = await global.pluginInstance.validateCredentials(message.params);
          break;
        case RPC_METHODS.GET_CAPABILITIES:
          result = await global.pluginInstance.getCapabilities();
          break;
        case RPC_METHODS.GET_METADATA:
          result = await global.pluginInstance.getMetadata();
          break;
        case RPC_METHODS.HEALTH_CHECK:
          result = await global.pluginInstance.healthCheck();
          break;
        case RPC_METHODS.SHUTDOWN:
          result = await global.pluginInstance.shutdown();
          break;
        case 'plugin.capabilitiesGranted':
          result = await global.pluginInstance.onCapabilitiesGranted(message.params);
          break;
        default:
          throw new Error(`Unknown method: ${message.method}`);
      }

      if (message.id) {
        this.sendResponse(message.id, result);
      }
    } catch (error) {
      if (message.id) {
        this.sendError(message.id, ERROR_CODES.INTERNAL_ERROR, error.message);
      }
    }
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

  sendMessage(message) {
    process.stdout.write(JSON.stringify(message) + '\n');
  }

  shutdown() {
    // Clean shutdown
    if (global.pluginInstance) {
      global.pluginInstance.shutdown().catch(() => {});
    }
    process.exit(0);
  }
}

/**
 * Plugin Runner
 * Bootstraps plugin execution in sandbox environment
 */
class PluginRunner {
  static async run(PluginClass, config = {}) {
    try {
      // Create plugin instance
      global.pluginInstance = new PluginClass();
      
      // Use the plugin's RPC channel as the global one
      global.rpcChannel = global.pluginInstance.rpc;
      
      // Signal ready
      global.rpcChannel.sendMessage({
        jsonrpc: '2.0',
        method: 'plugin.ready',
        params: {
          abi_version: '1.0',
          timestamp: Date.now()
        }
      });
      
      // Keep process alive
      process.stdin.resume();
      
    } catch (error) {
      console.error('Plugin startup failed:', error);
      process.exit(1);
    }
  }
}

module.exports = {
  RagVaultPlugin,
  JsonRpcChannel, 
  PluginRunner,
  RPC_METHODS,
  ERROR_CODES,
  CAPABILITIES
};