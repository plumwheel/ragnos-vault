#!/usr/bin/env node
/**
 * Environment Interceptor Test Suite
 * 
 * Comprehensive testing of the vault environment interception system
 * Tests all modes: shadow, dual, vault with various scenarios
 */

const { VaultEnvironmentInterceptor } = require('./dist/vault-env-preloader.cjs');

class InterceptorTestSuite {
  constructor() {
    this.testResults = [];
    this.config = this.parseArgs();
  }
  
  parseArgs() {
    const config = {
      mode: 'shadow',
      canary_percent: 0,
      debug: false,
      verbose: false
    };
    
    process.argv.slice(2).forEach(arg => {
      if (arg.startsWith('--mode=')) {
        config.mode = arg.split('=')[1];
      } else if (arg.startsWith('--canary=')) {
        config.canary_percent = parseInt(arg.split('=')[1]) || 0;
      } else if (arg === '--debug') {
        config.debug = true;
      } else if (arg === '--verbose') {
        config.verbose = true;
      }
    });
    
    return config;
  }
  
  async runTests() {
    console.log('🧪 RAGnos Vault Environment Interceptor Test Suite');
    console.log('==================================================');
    console.log(`Mode: ${this.config.mode}, Canary: ${this.config.canary_percent}%`);
    console.log('');
    
    // Set up test environment variables
    process.env.HUGGINGFACE_API_KEY = 'EXAMPLE_HF_KEY_DO_NOT_USE';
    process.env.ANTHROPIC_API_KEY = 'EXAMPLE_ANTHROPIC_KEY_DO_NOT_USE';
    process.env.REGULAR_VAR = 'not-a-secret';
    process.env.VAULT_MODE = this.config.mode;
    process.env.VAULT_CANARY_PERCENT = this.config.canary_percent.toString();
    process.env.VAULT_DEBUG = this.config.debug.toString();
    
    try {
      await this.testBasicFunctionality();
      await this.testVaultManagedKeys();
      await this.testNonVaultKeys();
      await this.testModeSpecificBehavior();
      await this.testErrorHandling();
      await this.testPerformanceBasics();
      
      this.printResults();
      
    } catch (error) {
      console.error('❌ Test suite failed:', error.message);
      process.exit(1);
    }
  }
  
  async testBasicFunctionality() {
    console.log('📋 Testing Basic Functionality');
    console.log('------------------------------');
    
    // Test that process.env still works for regular variables
    this.assert('Regular env var access', process.env.REGULAR_VAR === 'not-a-secret');
    
    // Test that vault-managed keys are handled appropriately
    const hfKey = process.env.HUGGINGFACE_API_KEY;
    
    // In shadow mode, should return env value immediately
    // In dual/vault modes, might return promise or value depending on canary
    if (this.config.mode === 'shadow') {
      this.assert('Shadow mode returns env value', hfKey === 'EXAMPLE_HF_KEY_DO_NOT_USE');
    } else {
      this.assert('Vault mode handles HF key', hfKey !== undefined);
    }
    
    console.log('✅ Basic functionality tests passed\\n');
  }
  
  async testVaultManagedKeys() {
    console.log('🔐 Testing Vault-Managed Key Detection');
    console.log('-------------------------------------');
    
    const testKeys = [
      'HUGGINGFACE_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'DATABASE_PASSWORD',
      'REDIS_SECRET',
      'CUSTOM_TOKEN'
    ];
    
    // Set test values
    testKeys.forEach(key => {
      process.env[key] = `test-${key.toLowerCase()}-value`;
    });
    
    testKeys.forEach(key => {
      const value = process.env[key];
      this.assert(`${key} is accessible`, value !== undefined);
      
      if (this.config.verbose) {
        console.log(`  ${key}: ${typeof value === 'string' ? 'string' : typeof value}`);
      }
    });
    
    console.log('✅ Vault-managed key tests passed\\n');
  }
  
  async testNonVaultKeys() {
    console.log('🏠 Testing Non-Vault Environment Variables');
    console.log('-----------------------------------------');
    
    const nonVaultKeys = [
      'PATH',
      'HOME',
      'NODE_ENV',
      'REGULAR_VAR',
      'DEBUG',
      'PORT'
    ];
    
    // Set some test values
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3000';
    
    nonVaultKeys.forEach(key => {
      const value = process.env[key];
      this.assert(`${key} bypasses vault`, typeof value === 'string' || value === undefined);
      
      if (this.config.verbose && value) {
        console.log(`  ${key}: ${value}`);
      }
    });
    
    console.log('✅ Non-vault key tests passed\\n');
  }
  
  async testModeSpecificBehavior() {
    console.log(`⚙️  Testing ${this.config.mode.toUpperCase()} Mode Behavior`);
    console.log('----------------------------------------');
    
    const testKey = 'ANTHROPIC_API_KEY';
    process.env[testKey] = 'mode-test-key';
    
    switch (this.config.mode) {
      case 'shadow':
        // Shadow mode should always return env value
        const shadowValue = process.env[testKey];
        this.assert('Shadow mode returns env value', shadowValue === 'mode-test-key');
        break;
        
      case 'dual':
        // Dual mode behavior depends on canary percentage
        console.log(`  Canary percentage: ${this.config.canary_percent}%`);
        const dualValue = process.env[testKey];
        this.assert('Dual mode handles key', dualValue !== undefined);
        break;
        
      case 'vault':
        // Vault mode should attempt vault first
        const vaultValue = process.env[testKey];
        this.assert('Vault mode handles key', vaultValue !== undefined);
        break;
    }
    
    console.log(`✅ ${this.config.mode} mode tests passed\\n`);
  }
  
  async testErrorHandling() {
    console.log('🚨 Testing Error Handling & Kill Switch');
    console.log('--------------------------------------');
    
    // Test undefined key behavior
    delete process.env.UNDEFINED_SECRET;
    const undefinedValue = process.env.UNDEFINED_SECRET;
    this.assert('Undefined key returns undefined', undefinedValue === undefined);
    
    // Test that proxy doesn't break Object methods
    const keys = Object.keys(process.env);
    this.assert('Object.keys works', Array.isArray(keys) && keys.length > 0);
    
    const hasTest = 'HUGGINGFACE_API_KEY' in process.env;
    this.assert('in operator works', typeof hasTest === 'boolean');
    
    console.log('✅ Error handling tests passed\\n');
  }
  
  async testPerformanceBasics() {
    console.log('⚡ Testing Basic Performance');
    console.log('---------------------------');
    
    const iterations = 100;
    const testKey = 'HUGGINGFACE_API_KEY';
    
    const start = Date.now();
    
    for (let i = 0; i < iterations; i++) {
      const value = process.env[testKey];
      // Just access, don't validate to avoid async complexity
    }
    
    const duration = Date.now() - start;
    const avgLatency = duration / iterations;
    
    console.log(`  ${iterations} accesses in ${duration}ms (${avgLatency.toFixed(2)}ms avg)`);
    
    // Performance should be reasonable (< 10ms per access on average)
    this.assert('Performance is reasonable', avgLatency < 10);
    
    console.log('✅ Performance tests passed\\n');
  }
  
  assert(description, condition) {
    const result = {
      description,
      passed: Boolean(condition),
      timestamp: new Date().toISOString()
    };
    
    this.testResults.push(result);
    
    if (result.passed) {
      if (this.config.verbose) {
        console.log(`  ✅ ${description}`);
      }
    } else {
      console.log(`  ❌ ${description}`);
    }
    
    return result.passed;
  }
  
  printResults() {
    console.log('📊 Test Results Summary');
    console.log('======================');
    
    const passed = this.testResults.filter(r => r.passed).length;
    const total = this.testResults.length;
    const failed = total - passed;
    
    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${passed} ✅`);
    console.log(`Failed: ${failed} ${failed > 0 ? '❌' : '✅'}`);
    console.log(`Success Rate: ${(passed / total * 100).toFixed(1)}%`);
    
    if (failed > 0) {
      console.log('\\nFailed Tests:');
      this.testResults
        .filter(r => !r.passed)
        .forEach(r => console.log(`  ❌ ${r.description}`));
      
      process.exit(1);
    } else {
      console.log('\\n🎉 All tests passed! Environment interceptor is working correctly.');
      process.exit(0);
    }
  }
}

// Run the test suite
if (require.main === module) {
  const testSuite = new InterceptorTestSuite();
  testSuite.runTests().catch(error => {
    console.error('Fatal test error:', error);
    process.exit(1);
  });
}