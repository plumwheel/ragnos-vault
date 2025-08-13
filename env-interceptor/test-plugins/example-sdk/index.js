/**
 * Example SDK Plugin for RAGnos Vault
 * 
 * Demonstrates the plugin ABI and capability system
 */

const { RagVaultPlugin } = require('./plugin-abi');

class ExampleSdkPlugin extends RagVaultPlugin {
  constructor() {
    super();
    this.providerId = 'example-sdk';
    this.initialized = false;
  }

  async initialize(config = {}) {
    console.log('Example SDK Plugin initializing...');
    
    // Initialize without requiring network access for basic operations
    // Network capability will be granted separately based on manifest
    this.initialized = true;
    console.log('Example SDK Plugin initialized successfully');
    
    return {
      status: 'initialized',
      capabilities: Array.from(this.capabilities),
      timestamp: Date.now()
    };
  }

  async validateCredentials(credentials) {
    if (!this.initialized) {
      throw new Error('Plugin not initialized');
    }

    const { apiKey } = credentials;
    if (!apiKey) {
      return {
        valid: false,
        error: 'API key required',
        provider: this.providerId
      };
    }

    // Simulate API validation
    const isValid = apiKey.startsWith('test_') && apiKey.length > 10;
    
    // Simulate response time
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return {
      valid: isValid,
      provider: this.providerId,
      responseTime: 100,
      details: isValid ? 'Valid test API key' : 'Invalid API key format'
    };
  }

  async getCapabilities() {
    return {
      operations: ['validate', 'test'],
      features: ['credentials_validation', 'network_access'],
      version: '1.0.0',
      transport: 'sdk'
    };
  }

  async getMetadata() {
    return {
      id: this.providerId,
      displayName: 'Example SDK Provider',
      vendor: 'RAGnos Labs',
      version: '1.0.0',
      runtime: 'nodejs',
      capabilities: Array.from(this.capabilities),
      initialized: this.initialized
    };
  }

  async healthCheck() {
    return {
      status: this.initialized ? 'healthy' : 'not_initialized',
      timestamp: Date.now(),
      capabilities: Array.from(this.capabilities),
      uptime: process.uptime() * 1000
    };
  }

  async shutdown() {
    console.log('Example SDK Plugin shutting down...');
    this.initialized = false;
    this.capabilities.clear();
    
    return {
      status: 'shutdown',
      timestamp: Date.now()
    };
  }
}

module.exports = ExampleSdkPlugin;