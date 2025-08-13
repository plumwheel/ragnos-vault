#!/usr/bin/env node
/**
 * Sample Test Plugin for TUF Verification
 * This plugin is used to test the TUF client integration
 */

// Simple plugin-abi implementation for testing
class SimplePluginABI {
  constructor(id) {
    this.id = id;
    this.rpc = {
      requests: new Map(),
      requestId: 0
    };
    
    process.stdin.on('data', (data) => {
      try {
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
          if (line.trim()) {
            this.handleMessage(JSON.parse(line));
          }
        });
      } catch (error) {
        this.sendError(null, -32700, 'Parse error');
      }
    });
  }
  
  handleMessage(message) {
    if (message.method) {
      this.handleMethodCall(message);
    }
  }
  
  async handleMethodCall(message) {
    try {
      let result = null;
      
      switch (message.method) {
        case 'provider.initialize':
          result = await this.initialize(message.params);
          break;
        case 'provider.getCapabilities':
          result = await this.getCapabilities();
          break;
        case 'provider.getMetadata':
          result = await this.getMetadata();
          break;
        case 'provider.validateCredentials':
          result = await this.validateCredentials(message.params);
          break;
        default:
          throw new Error(`Unknown method: ${message.method}`);
      }
      
      if (message.id) {
        this.sendResponse(message.id, result);
      }
    } catch (error) {
      if (message.id) {
        this.sendError(message.id, -32000, error.message);
      }
    }
  }
  
  sendMessage(message) {
    console.log(JSON.stringify(message));
  }
  
  sendResponse(id, result) {
    this.sendMessage({
      jsonrpc: '2.0',
      id,
      result
    });
  }
  
  sendError(id, code, message) {
    this.sendMessage({
      jsonrpc: '2.0',
      id,
      error: { code, message }
    });
  }
  
  sendReady() {
    this.sendMessage({
      jsonrpc: '2.0',
      method: 'plugin.ready'
    });
  }
}

class SampleTestPlugin extends SimplePluginABI {
  constructor() {
    super('sample-test-plugin');
  }
  
  async initialize(config) {
    // Request network capability for testing
    this.sendMessage({
      jsonrpc: '2.0',
      method: 'plugin.requestNetworkCapability',
      params: {
        domains: ['api.example.com'],
        justification: 'Sample plugin testing'
      }
    });
    
    this.sendReady();
    return { initialized: true };
  }
  
  async getCapabilities() {
    return {
      operations: ['test.verify', 'test.echo'],
      version: '1.0.0',
      description: 'Sample test plugin for TUF verification'
    };
  }
  
  async getMetadata() {
    return {
      id: 'sample-test-plugin',
      name: 'Sample Test Plugin',
      version: '1.0.0',
      vendor: 'RAGnos Labs'
    };
  }
  
  async validateCredentials(credentials) {
    // Simple test validation
    if (credentials.apiKey && credentials.apiKey.startsWith('test_valid_key')) {
      return {
        valid: true,
        responseTime: 50,
        message: 'Valid test credentials'
      };
    }
    
    return {
      valid: false,
      responseTime: 25,
      message: 'Invalid test credentials'
    };
  }
}

if (require.main === module) {
  const plugin = new SampleTestPlugin();
  // Plugin is ready to receive messages
}

module.exports = SampleTestPlugin;
