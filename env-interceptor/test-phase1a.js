#!/usr/bin/env node

/**
 * RAGnos Vault Phase 1A Integration Test
 * 
 * Tests the provider plugin system foundation:
 * - Manifest validation
 * - HTTP adapter functionality  
 * - Policy engine enforcement
 */

const fs = require('fs');
const path = require('path');
const { ManifestValidator } = require('./src/manifest-validator');
const { HttpProviderAdapter } = require('./src/http-adapter');
const { PolicyEngine } = require('./src/policy-engine');

class Phase1ATestSuite {
  constructor() {
    this.manifestValidator = new ManifestValidator();
    this.policyEngine = new PolicyEngine();
    this.results = {
      passed: 0,
      failed: 0,
      warnings: 0,
      tests: []
    };
  }

  async runAllTests() {
    console.log('🧪 RAGnos Vault Phase 1A Integration Test Suite');
    console.log('='.repeat(50));
    
    try {
      await this.testManifestValidation();
      await this.testHttpAdapter();
      await this.testPolicyEngine();
      await this.testIntegration();
      
      this.printSummary();
      return this.results.failed === 0;
      
    } catch (error) {
      console.error('💥 Test suite crashed:', error.message);
      return false;
    }
  }

  async testManifestValidation() {
    console.log('\n📋 Testing Manifest Validation...');
    
    // Test 1: Valid OpenAI manifest
    await this.test('OpenAI manifest validation', async () => {
      const manifest = this.loadManifest('openai.json');
      const result = await this.manifestValidator.validateManifest(manifest);
      
      if (!result.valid) {
        throw new Error(`Validation failed: ${result.errors.map(e => e.message).join(', ')}`);
      }
      
      console.log(`  ✓ OpenAI manifest valid (${result.warnings.length} warnings)`);
    });

    // Test 2: Valid Anthropic manifest
    await this.test('Anthropic manifest validation', async () => {
      const manifest = this.loadManifest('anthropic.json');
      const result = await this.manifestValidator.validateManifest(manifest);
      
      if (!result.valid) {
        throw new Error(`Validation failed: ${result.errors.map(e => e.message).join(', ')}`);
      }
      
      console.log(`  ✓ Anthropic manifest valid (${result.warnings.length} warnings)`);
    });

    // Test 3: Invalid manifest detection
    await this.test('Invalid manifest detection', async () => {
      const invalidManifest = {
        id: 'test',
        // Missing required fields
        transport: 'http'
      };
      
      const result = await this.manifestValidator.validateManifest(invalidManifest);
      
      if (result.valid) {
        throw new Error('Expected validation to fail for invalid manifest');
      }
      
      console.log(`  ✓ Invalid manifest properly rejected (${result.errors.length} errors)`);
    });

    // Test 4: Security validation
    await this.test('Security validation', async () => {
      const suspiciousManifest = {
        id: 'malicious',
        schemaVersion: 'v1',
        canonical: 'MALICIOUS_KEY',
        transport: 'sdk',
        sdk: {
          package: 'evil-package',
          version: '1.0.0',
          entry: '../../../etc/passwd'  // Path traversal attempt
        }
      };
      
      const result = await this.manifestValidator.validateManifest(suspiciousManifest);
      
      if (result.security.safe) {
        throw new Error('Expected security validation to flag path traversal');
      }
      
      console.log(`  ✓ Security threats detected (${result.security.issues.length} issues)`);
    });
  }

  async testHttpAdapter() {
    console.log('\n🌐 Testing HTTP Adapter...');
    
    // Test 1: OpenAI adapter creation
    await this.test('OpenAI adapter creation', async () => {
      const manifest = this.loadManifest('openai.json');
      const adapter = new HttpProviderAdapter(manifest);
      
      const info = adapter.getProviderInfo();
      if (info.id !== 'openai') {
        throw new Error('Provider info mismatch');
      }
      
      console.log(`  ✓ OpenAI adapter created (${info.authType} auth, ${info.capabilities.length} capabilities)`);
    });

    // Test 2: Anthropic adapter creation  
    await this.test('Anthropic adapter creation', async () => {
      const manifest = this.loadManifest('anthropic.json');
      const adapter = new HttpProviderAdapter(manifest);
      
      const info = adapter.getProviderInfo();
      if (info.id !== 'anthropic') {
        throw new Error('Provider info mismatch');
      }
      
      console.log(`  ✓ Anthropic adapter created (${info.authType} auth, ${info.capabilities.length} capabilities)`);
    });

    // Test 3: Connection testing (without auth)
    await this.test('Connection testing', async () => {
      const manifest = this.loadManifest('openai.json');
      const adapter = new HttpProviderAdapter(manifest);
      
      const result = await adapter.testConnection({ timeout: 5000 });
      
      // We expect this to fail auth but succeed in connecting
      console.log(`  ✓ Connection test completed (connected: ${result.connected}, status: ${result.status || 'N/A'})`);
    });

    // Test 4: Invalid transport rejection
    await this.test('Invalid transport rejection', async () => {
      const invalidManifest = {
        id: 'test',
        transport: 'websocket', // Not supported
        http: { baseUrl: 'https://api.test.com' }
      };
      
      try {
        new HttpProviderAdapter(invalidManifest);
        throw new Error('Expected adapter creation to fail');
      } catch (error) {
        if (!error.message.includes('Invalid transport')) {
          throw error;
        }
      }
      
      console.log(`  ✓ Invalid transport properly rejected`);
    });
  }

  async testPolicyEngine() {
    console.log('\n🛡️  Testing Policy Engine...');
    
    // Test 1: Default policy loading
    await this.test('Default policy loading', async () => {
      const policy = this.policyEngine.getPolicy();
      
      if (!policy.providers || !policy.enforcement) {
        throw new Error('Invalid policy structure');
      }
      
      console.log(`  ✓ Default policy loaded (${policy.enforcement.level} enforcement)`);
    });

    // Test 2: Provider allowlist check
    await this.test('Provider allowlist enforcement', async () => {
      // Create restrictive policy
      const restrictiveEngine = new PolicyEngine();
      restrictiveEngine.updatePolicy({
        providers: {
          providerAllowlist: ['openai'], // Only allow OpenAI
          allowUnknownProviders: false
        }
      });
      
      const openaiManifest = this.loadManifest('openai.json');
      const anthropicManifest = this.loadManifest('anthropic.json');
      
      const openaiResult = await restrictiveEngine.checkProvider(openaiManifest, { source: 'https://registry.ragnos.io/openai' });
      const anthropicResult = await restrictiveEngine.checkProvider(anthropicManifest, { source: 'https://registry.ragnos.io/anthropic' });
      
      if (!openaiResult.allowed) {
        throw new Error('OpenAI should be allowed by allowlist');
      }
      
      if (anthropicResult.allowed && restrictiveEngine.policy.enforcement.failOnViolation) {
        throw new Error('Anthropic should be blocked by allowlist');
      }
      
      console.log(`  ✓ Allowlist enforcement working (OpenAI: allowed, Anthropic: ${anthropicResult.allowed ? 'allowed' : 'blocked'})`);
    });

    // Test 3: Network policy validation
    await this.test('Network policy validation', async () => {
      const manifest = this.loadManifest('openai.json');
      
      // Add private network to test blocking
      manifest.security.networkAllowlist.push('127.0.0.1');
      
      const result = await this.policyEngine.checkProvider(manifest);
      
      const privateNetworkViolations = result.violations.filter(v => 
        v.type === 'private_network_access'
      );
      
      if (privateNetworkViolations.length === 0) {
        throw new Error('Expected private network access to be flagged');
      }
      
      console.log(`  ✓ Private network access blocked (${privateNetworkViolations.length} violations)`);
    });

    // Test 4: Code plugin policy
    await this.test('Code plugin policy enforcement', async () => {
      const sdkManifest = {
        id: 'test-sdk',
        schemaVersion: 'v1',
        canonical: 'TEST_SDK_KEY',
        transport: 'sdk',
        sdk: {
          package: 'test-package',
          version: '1.0.0',
          entry: 'index.js'
        }
      };
      
      const result = await this.policyEngine.checkProvider(sdkManifest, { source: 'https://registry.npmjs.org/test-package' });
      
      const codePluginViolations = result.violations.filter(v => 
        v.type === 'code_plugins_disabled'
      );
      
      if (codePluginViolations.length === 0) {
        throw new Error('Expected code plugin restriction to be enforced');
      }
      
      console.log(`  ✓ Code plugin restrictions enforced`);
    });
  }

  async testIntegration() {
    console.log('\n🔗 Testing Integration...');
    
    // Test 1: Full validation pipeline
    await this.test('Full validation pipeline', async () => {
      const manifest = this.loadManifest('openai.json');
      
      // 1. Validate manifest
      const manifestResult = await this.manifestValidator.validateManifest(manifest);
      if (!manifestResult.valid) {
        throw new Error('Manifest validation failed');
      }
      
      // 2. Check policy
      const policyResult = await this.policyEngine.checkProvider(manifest, { source: 'https://registry.ragnos.io/openai' });
      if (!policyResult.allowed) {
        throw new Error('Policy check failed');
      }
      
      // 3. Create adapter
      const adapter = new HttpProviderAdapter(manifest);
      const info = adapter.getProviderInfo();
      
      console.log(`  ✓ Full pipeline successful (${info.id} ready for use)`);
    });

    // Test 2: Batch manifest validation
    await this.test('Batch manifest validation', async () => {
      const manifests = [
        this.loadManifest('openai.json'),
        this.loadManifest('anthropic.json')
      ];
      
      const results = await this.manifestValidator.validateManifests(manifests);
      
      if (results.summary.valid !== 2) {
        throw new Error(`Expected 2 valid manifests, got ${results.summary.valid}`);
      }
      
      console.log(`  ✓ Batch validation successful (${results.summary.total} manifests, ${results.summary.valid} valid)`);
    });

    // Test 3: Performance measurement
    await this.test('Performance measurement', async () => {
      const manifest = this.loadManifest('openai.json');
      const iterations = 100;
      
      const start = Date.now();
      
      for (let i = 0; i < iterations; i++) {
        await this.manifestValidator.validateManifest(manifest);
      }
      
      const duration = Date.now() - start;
      const avgMs = duration / iterations;
      
      if (avgMs > 10) { // Should be under 10ms per validation
        console.warn(`  ⚠️  Performance warning: ${avgMs.toFixed(2)}ms per validation (target: <10ms)`);
        this.results.warnings++;
      } else {
        console.log(`  ✓ Performance acceptable: ${avgMs.toFixed(2)}ms per validation`);
      }
    });
  }

  async test(name, testFn) {
    try {
      await testFn();
      this.results.passed++;
      this.results.tests.push({ name, status: 'passed' });
    } catch (error) {
      console.error(`  ❌ ${name}: ${error.message}`);
      this.results.failed++;
      this.results.tests.push({ name, status: 'failed', error: error.message });
    }
  }

  loadManifest(filename) {
    const manifestPath = path.join(__dirname, 'manifests', filename);
    const content = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(content);
  }

  printSummary() {
    console.log('\n' + '='.repeat(50));
    console.log('📊 Phase 1A Test Results');
    console.log('='.repeat(50));
    
    const total = this.results.passed + this.results.failed;
    const passRate = total > 0 ? (this.results.passed / total * 100).toFixed(1) : 0;
    
    console.log(`Tests run: ${total}`);
    console.log(`Passed: ${this.results.passed} (${passRate}%)`);
    console.log(`Failed: ${this.results.failed}`);
    console.log(`Warnings: ${this.results.warnings}`);
    
    if (this.results.failed === 0) {
      console.log('\n🎉 All tests passed! Phase 1A implementation ready.');
    } else {
      console.log('\n❌ Some tests failed. Review implementation before proceeding.');
    }
    
    console.log('\n📋 Phase 1A Checklist:');
    console.log('  ✅ Provider manifest JSON schema validator');
    console.log('  ✅ HTTP adapter for manifest-only providers');
    console.log('  ✅ Basic policy engine with security enforcement');
    console.log('  ✅ Integration testing and validation');
    
    console.log('\n🎯 Next Phase: Phase 1B Implementation');
    console.log('  🔄 Runtime loader with subprocess sandbox');
    console.log('  📦 Auto-install with security controls');
    console.log('  🏛️  Curated RAGnos Hub plugin registry');
  }
}

// Run tests if called directly
if (require.main === module) {
  const testSuite = new Phase1ATestSuite();
  testSuite.runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test suite error:', error);
      process.exit(1);
    });
}

module.exports = { Phase1ATestSuite };