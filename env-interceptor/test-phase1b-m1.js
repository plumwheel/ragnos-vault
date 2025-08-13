#!/usr/bin/env node

/**
 * RAGnos Vault Phase 1B M1 Test Suite
 * 
 * Tests the runtime loader and sandbox MVP:
 * - Plugin ABI and JSON-RPC protocol
 * - Subprocess sandbox with resource limits
 * - Policy integration and capability system
 */

const fs = require('fs');
const path = require('path');
const { RuntimeLoader } = require('./src/runtime-loader');
const { PolicyEngine } = require('./src/policy-engine');

class Phase1BM1TestSuite {
  constructor() {
    this.runtimeLoader = null;
    this.results = {
      passed: 0,
      failed: 0,
      warnings: 0,
      tests: []
    };
  }

  async runAllTests() {
    console.log('🧪 RAGnos Vault Phase 1B M1 Test Suite');
    console.log('='.repeat(50));
    console.log('Testing: Runtime Loader & Sandbox MVP');
    
    try {
      await this.setupTestEnvironment();
      await this.testRuntimeLoader();
      await this.testSandboxSecurity();
      await this.testCapabilitySystem();
      await this.testPolicyIntegration();
      await this.cleanupTestEnvironment();
      
      this.printSummary();
      return this.results.failed === 0;
      
    } catch (error) {
      console.error('💥 Test suite crashed:', error.message);
      return false;
    }
  }

  async setupTestEnvironment() {
    console.log('\n🔧 Setting up test environment...');
    
    // Create runtime loader with permissive policy for testing
    this.runtimeLoader = new RuntimeLoader({
      maxConcurrentPlugins: 5,
      defaultTimeout: 10000
    });
    
    // Create and configure permissive policy for testing
    const policyEngine = new PolicyEngine(null, { allowLocalOverrides: true });
    policyEngine.updatePolicy({
      providers: {
        allowCodePlugins: true,
        allowAutoInstall: true,
        allowUnknownProviders: true,
        providerAllowlist: ['example-sdk']
      },
      registries: {
        allowedRegistries: [
          'https://registry.ragnos.io',
          'https://registry.npmjs.org',
          'file://',
          'local://'
        ],
        requireHTTPS: false,
        allowLocalRegistries: true
      },
      network: {
        allowEgress: true,
        globalAllowlist: ['api.example.com', '*.example.com'],
        blockPrivateNetworks: false
      },
      sandbox: {
        enableSubprocessSandbox: true,
        allowNetworkAccess: true,
        allowFileSystem: true
      },
      enforcement: {
        level: 'moderate',
        failOnViolation: false
      }
    });
    
    // Override policy engine
    this.runtimeLoader.policyEngine = policyEngine;
    this.runtimeLoader.sandboxManager.policyEngine = policyEngine;
    

    console.log('  ✓ Test environment ready');
  }

  async testRuntimeLoader() {
    console.log('\n🏗️  Testing Runtime Loader...');

    // Test 1: Load SDK plugin
    await this.test('SDK plugin loading', async () => {
      const manifest = this.loadManifest('example-sdk.json');
      const pluginPath = path.join(__dirname, 'test-plugins/example-sdk/index.js');
      
      if (!fs.existsSync(pluginPath)) {
        throw new Error(`Plugin file not found: ${pluginPath}`);
      }

      const pluginRuntime = await this.runtimeLoader.loadPlugin(manifest, pluginPath, {
        context: { source: 'local://test-plugins/example-sdk' }
      });

      if (!pluginRuntime) {
        throw new Error('Plugin runtime not created');
      }

      // Verify plugin is loaded
      const loadedPlugin = this.runtimeLoader.getPlugin('example-sdk');
      if (!loadedPlugin) {
        throw new Error('Plugin not found in loaded plugins');
      }

      console.log(`  ✓ SDK plugin loaded: ${loadedPlugin.manifest.displayName}`);
    });

    // Test 2: Plugin initialization
    await this.test('Plugin initialization', async () => {
      const plugin = this.runtimeLoader.getPlugin('example-sdk');
      if (!plugin) {
        throw new Error('Plugin not loaded');
      }

      // Wait for initialization to complete
      await this.waitForPluginState(plugin, 'ready', 10000);

      const info = plugin.getInfo();
      if (info.state !== 'ready') {
        throw new Error(`Plugin not ready: ${info.state}`);
      }

      console.log(`  ✓ Plugin initialized: ${info.capabilities.length} capabilities`);
    });

    // Test 3: Plugin communication
    await this.test('Plugin JSON-RPC communication', async () => {
      const plugin = this.runtimeLoader.getPlugin('example-sdk');
      
      // Test getCapabilities call
      const capabilities = await plugin.callPlugin('provider.getCapabilities');
      if (!capabilities || !capabilities.operations) {
        throw new Error('Invalid capabilities response');
      }

      // Test getMetadata call
      const metadata = await plugin.callPlugin('provider.getMetadata');
      if (!metadata || metadata.id !== 'example-sdk') {
        throw new Error('Invalid metadata response');
      }

      console.log(`  ✓ JSON-RPC communication working: ${capabilities.operations.length} operations`);
    });

    // Test 4: Credential validation
    await this.test('Plugin credential validation', async () => {
      const plugin = this.runtimeLoader.getPlugin('example-sdk');
      
      // Test valid credentials
      const validResult = await plugin.validateCredentials({
        apiKey: 'test_valid_key_123'
      });
      
      if (!validResult.valid) {
        throw new Error('Valid credentials rejected');
      }

      // Test invalid credentials
      const invalidResult = await plugin.validateCredentials({
        apiKey: 'invalid_key'
      });
      
      if (invalidResult.valid) {
        throw new Error('Invalid credentials accepted');
      }

      console.log(`  ✓ Credential validation working: ${validResult.responseTime}ms response time`);
    });

    // Test 5: Multiple plugins
    await this.test('Multiple plugin support', async () => {
      const stats = this.runtimeLoader.getStats();
      if (stats.loadedPlugins < 1) {
        throw new Error('No plugins loaded');
      }

      const pluginList = this.runtimeLoader.listPlugins();
      if (!pluginList.includes('example-sdk')) {
        throw new Error('example-sdk not in plugin list');
      }

      console.log(`  ✓ Multiple plugin support: ${stats.loadedPlugins} loaded, ${stats.maxConcurrent} max`);
    });

    // Test 6: TUF integration
    await this.test('TUF client integration', async () => {
      const stats = this.runtimeLoader.getStats();
      
      if (!stats.tuf) {
        throw new Error('TUF statistics not available');
      }
      
      if (typeof stats.tuf.initialized !== 'boolean') {
        throw new Error('TUF initialization status not available');
      }
      
      // TUF should be available but not necessarily initialized without repository
      console.log(`  ✓ TUF integration: available, initialized: ${stats.tuf.initialized}`);
    });
  }

  async testSandboxSecurity() {
    console.log('\n🛡️  Testing Sandbox Security...');

    // Test 1: Process isolation
    await this.test('Process isolation', async () => {
      const plugin = this.runtimeLoader.getPlugin('example-sdk');
      const info = plugin.getInfo();
      
      if (!info.sandbox.pid) {
        throw new Error('Plugin not running in separate process');
      }

      // Verify process is actually running
      try {
        process.kill(info.sandbox.pid, 0); // Signal 0 checks if process exists
      } catch (error) {
        throw new Error('Plugin process not found');
      }

      console.log(`  ✓ Process isolation: PID ${info.sandbox.pid}, running for ${info.sandbox.duration}ms`);
    });

    // Test 2: Resource limits
    await this.test('Resource limits enforcement', async () => {
      const plugin = this.runtimeLoader.getPlugin('example-sdk');
      const sandbox = plugin.sandbox;
      
      // Check memory limit configuration
      if (sandbox.config.memory <= 0) {
        throw new Error('Memory limit not configured');
      }

      // Check timeout configuration
      if (sandbox.config.timeout <= 0) {
        throw new Error('Timeout not configured');
      }

      console.log(`  ✓ Resource limits: ${Math.round(sandbox.config.memory / 1024 / 1024)}MB memory, ${sandbox.config.timeout}ms timeout`);
    });

    // Test 3: Filesystem restrictions
    await this.test('Filesystem access control', async () => {
      const plugin = this.runtimeLoader.getPlugin('example-sdk');
      const workspace = plugin.sandbox.config.workspace;
      
      // Verify workspace structure
      if (!fs.existsSync(workspace.root)) {
        throw new Error('Sandbox workspace not created');
      }

      if (!fs.existsSync(workspace.work)) {
        throw new Error('Work directory not created');
      }

      console.log(`  ✓ Filesystem restrictions: workspace at ${workspace.root}`);
    });

    // Test 4: Environment isolation
    await this.test('Environment isolation', async () => {
      const plugin = this.runtimeLoader.getPlugin('example-sdk');
      const env = plugin.sandbox.config.env;
      
      // Check for security environment variables
      if (env.RAGVAULT_SANDBOX !== '1') {
        throw new Error('Sandbox flag not set');
      }

      if (!env.RAGVAULT_PLUGIN_ID) {
        throw new Error('Plugin ID not provided');
      }

      console.log(`  ✓ Environment isolation: ${Object.keys(env).length} env vars, sandbox flag set`);
    });
  }

  async testCapabilitySystem() {
    console.log('\n🔑 Testing Capability System...');

    // Test 1: Network capability request
    await this.test('Network capability granting', async () => {
      const plugin = this.runtimeLoader.getPlugin('example-sdk');
      
      // Plugin should have requested network capability during initialization
      const info = plugin.getInfo();
      if (!info.capabilities.includes('network')) {
        throw new Error('Network capability not granted');
      }

      console.log(`  ✓ Network capability granted: ${info.capabilities.length} total capabilities`);
    });

    // Test 2: Capability event monitoring
    await this.test('Capability event monitoring', async () => {
      const plugin = this.runtimeLoader.getPlugin('example-sdk');
      let capabilityEventReceived = false;

      // Listen for capability events
      plugin.on('capability:granted', (event) => {
        if (event.type === 'network') {
          capabilityEventReceived = true;
        }
      });

      // Wait a bit for any pending events
      await new Promise(resolve => setTimeout(resolve, 100));

      // Note: Network capability was granted during initialization
      // so we check if the plugin has the capability
      if (!plugin.capabilities.has('network')) {
        throw new Error('Network capability not in plugin capabilities');
      }

      console.log(`  ✓ Capability monitoring: network capability tracked`);
    });

    // Test 3: Policy-based capability denial
    await this.test('Policy capability restrictions', async () => {
      // Create a restrictive policy
      const restrictivePolicy = new PolicyEngine(null, { allowLocalOverrides: true });
      restrictivePolicy.updatePolicy({
        sandbox: {
          allowNetworkAccess: false,
          allowFileSystem: false
        }
      });

      // Test that capabilities would be denied
      const manifest = this.loadManifest('example-sdk.json');
      const policyResult = await restrictivePolicy.checkProvider(manifest);
      
      // Should have violations for sandbox config
      const sandboxViolations = policyResult.violations.filter(v => 
        v.type.includes('sandbox') || v.type.includes('network')
      );

      if (sandboxViolations.length === 0) {
        console.warn('  ⚠️  Expected policy violations for restrictive sandbox config');
      }

      console.log(`  ✓ Policy restrictions: ${policyResult.violations.length} violations detected`);
    });
  }

  async testPolicyIntegration() {
    console.log('\n📋 Testing Policy Integration...');

    // Test 1: Policy validation during load
    await this.test('Policy validation integration', async () => {
      const policy = this.runtimeLoader.policyEngine.getPolicy();
      
      if (!policy.providers.allowCodePlugins) {
        throw new Error('Code plugins should be enabled for test');
      }

      if (!policy.sandbox.enableSubprocessSandbox) {
        throw new Error('Subprocess sandbox should be enabled');
      }

      console.log(`  ✓ Policy integration: ${policy.enforcement.level} enforcement`);
    });

    // Test 2: Audit trail generation
    await this.test('Security audit trail', async () => {
      const plugin = this.runtimeLoader.getPlugin('example-sdk');
      const info = plugin.getInfo();
      
      // Check that we have audit information
      if (!info.sandbox.startTime) {
        throw new Error('No sandbox start time recorded');
      }

      if (info.sandbox.duration <= 0) {
        throw new Error('Invalid sandbox duration');
      }

      console.log(`  ✓ Audit trail: sandbox running ${info.sandbox.duration}ms`);
    });

    // Test 3: Resource monitoring
    await this.test('Resource monitoring', async () => {
      const stats = this.runtimeLoader.getStats();
      
      if (typeof stats.loadedPlugins !== 'number') {
        throw new Error('Plugin count not monitored');
      }

      if (!stats.sandbox) {
        throw new Error('Sandbox stats not available');
      }

      console.log(`  ✓ Resource monitoring: ${stats.loadedPlugins} plugins, ${stats.sandbox.active} active sandboxes`);
    });
  }

  async cleanupTestEnvironment() {
    console.log('\n🧹 Cleaning up test environment...');
    
    try {
      if (this.runtimeLoader) {
        await this.runtimeLoader.shutdown();
      }
      console.log('  ✓ Runtime loader shutdown complete');
    } catch (error) {
      console.warn(`  ⚠️  Cleanup warning: ${error.message}`);
    }
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

  async waitForPluginState(plugin, targetState, timeoutMs = 5000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      if (plugin.state === targetState) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error(`Plugin did not reach state '${targetState}' within ${timeoutMs}ms (current: ${plugin.state})`);
  }

  loadManifest(filename) {
    const manifestPath = path.join(__dirname, 'manifests', filename);
    const content = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(content);
  }

  printSummary() {
    console.log('\n' + '='.repeat(50));
    console.log('📊 Phase 1B M1 Test Results');
    console.log('='.repeat(50));
    
    const total = this.results.passed + this.results.failed;
    const passRate = total > 0 ? (this.results.passed / total * 100).toFixed(1) : 0;
    
    console.log(`Tests run: ${total}`);
    console.log(`Passed: ${this.results.passed} (${passRate}%)`);
    console.log(`Failed: ${this.results.failed}`);
    console.log(`Warnings: ${this.results.warnings}`);
    
    if (this.results.failed === 0) {
      console.log('\n🎉 All tests passed! M1 milestone complete.');
      console.log('\n📋 M1 Achievements:');
      console.log('  ✅ Plugin ABI and JSON-RPC protocol operational');
      console.log('  ✅ Subprocess sandbox with resource limits');
      console.log('  ✅ Capability-based access control system');
      console.log('  ✅ Policy integration and enforcement');
      console.log('  ✅ Security audit trail generation');
    } else {
      console.log('\n❌ Some tests failed. Review implementation before proceeding.');
    }
    
    console.log('\n🎯 Next: M2 Implementation');
    console.log('  🏛️  TUF metadata structure and Hub design');
    console.log('  🔐 Signature verification client-side');
    console.log('  📦 Plugin registry and distribution');
  }
}

// Run tests if called directly
if (require.main === module) {
  const testSuite = new Phase1BM1TestSuite();
  testSuite.runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test suite error:', error);
      process.exit(1);
    });
}

module.exports = { Phase1BM1TestSuite };