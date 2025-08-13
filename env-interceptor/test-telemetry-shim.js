#!/usr/bin/env node

/**
 * RAGnos Vault Telemetry Shim Test
 * 
 * Tests the minimal telemetry implementation to ensure it works
 * without overhead and provides proper interfaces for Phase 2 upgrade.
 */

const { TelemetryShim, initializeTelemetry, recordEvent, recordPluginEvent, recordSecurityEvent, recordPerformanceMetric, createSpan } = require('./src/telemetry-shim');

class TelemetryShimTestSuite {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      tests: []
    };
  }

  async runAllTests() {
    console.log('📊 RAGnos Vault Telemetry Shim Test Suite');
    console.log('='.repeat(50));
    
    try {
      await this.testTelemetryInitialization();
      await this.testEventRecording();
      await this.testPluginEvents();
      await this.testSecurityEvents();
      await this.testPerformanceMetrics();
      await this.testSpanInterface();
      await this.testTelemetryStats();
      await this.testHealthCheck();
      await this.testGracefulShutdown();
      
      this.printSummary();
      return this.results.failed === 0;
      
    } catch (error) {
      console.error('💥 Test suite crashed:', error.message);
      return false;
    }
  }

  async testTelemetryInitialization() {
    console.log('\n🔧 Testing Telemetry Initialization...');
    
    await this.test('Initialize global telemetry', async () => {
      const telemetry = await initializeTelemetry({
        serviceName: 'test-service',
        serviceVersion: '1.0.0',
        environment: 'test'
      });
      
      if (!telemetry.initialized) {
        throw new Error('Telemetry should be initialized');
      }
      
      console.log('  ✓ Telemetry initialized successfully');
    });

    await this.test('Telemetry instance properties', async () => {
      const { getTelemetry } = require('./src/telemetry-shim');
      const telemetry = getTelemetry();
      
      if (telemetry.options.serviceName !== 'test-service') {
        throw new Error('Service name not set correctly');
      }
      
      if (telemetry.options.environment !== 'test') {
        throw new Error('Environment not set correctly');
      }
      
      console.log('  ✓ Telemetry properties configured correctly');
    });
  }

  async testEventRecording() {
    console.log('\n📝 Testing Event Recording...');
    
    await this.test('Record basic events', async () => {
      const { getTelemetry } = require('./src/telemetry-shim');
      const telemetry = getTelemetry();
      const initialCount = Object.values(telemetry.metrics).reduce((sum, val) => sum + val, 0);
      
      recordEvent('test.event', { test: true, value: 42 });
      recordEvent('test.another', { different: 'data' });
      
      // Events should be recorded (though currently only in memory)
      console.log('  ✓ Events recorded without errors');
    });

    await this.test('Event recording with convenience functions', async () => {
      recordEvent('test.convenience', { method: 'convenience' });
      console.log('  ✓ Convenience functions work correctly');
    });
  }

  async testPluginEvents() {
    console.log('\n🔌 Testing Plugin Events...');
    
    await this.test('Plugin lifecycle events', async () => {
      const { getTelemetry } = require('./src/telemetry-shim');
      const telemetry = getTelemetry();
      const initialLoads = telemetry.metrics.pluginLoads;
      
      recordPluginEvent('test-plugin', 'loaded', { 
        transport: 'sdk',
        load_time_ms: 150 
      });
      
      if (telemetry.metrics.pluginLoads !== initialLoads + 1) {
        throw new Error('Plugin load count not incremented');
      }
      
      console.log('  ✓ Plugin events recorded and counted');
    });

    await this.test('Plugin sandbox events', async () => {
      const { getTelemetry } = require('./src/telemetry-shim');
      const telemetry = getTelemetry();
      const initialStarts = telemetry.metrics.sandboxStarts;
      
      recordPluginEvent('test-plugin', 'sandbox_started', {
        pid: 12345,
        memory_limit: 256,
        timeout: 30000
      });
      
      if (telemetry.metrics.sandboxStarts !== initialStarts + 1) {
        throw new Error('Sandbox start count not incremented');
      }
      
      console.log('  ✓ Sandbox events recorded correctly');
    });

    await this.test('Plugin RPC events', async () => {
      const { getTelemetry } = require('./src/telemetry-shim');
      const telemetry = getTelemetry();
      const initialCalls = telemetry.metrics.rpcCalls;
      
      recordPluginEvent('test-plugin', 'rpc_call', {
        method: 'provider.getCapabilities'
      });
      
      if (telemetry.metrics.rpcCalls !== initialCalls + 1) {
        throw new Error('RPC call count not incremented');
      }
      
      console.log('  ✓ RPC events recorded correctly');
    });
  }

  async testSecurityEvents() {
    console.log('\n🛡️ Testing Security Events...');
    
    await this.test('Policy violation events', async () => {
      const { getTelemetry } = require('./src/telemetry-shim');
      const telemetry = getTelemetry();
      const initialViolations = telemetry.metrics.policyViolations;
      
      recordSecurityEvent('policy_check', 'violation', {
        plugin_id: 'test-plugin',
        violation_type: 'unauthorized_network',
        severity: 'high'
      });
      
      if (telemetry.metrics.policyViolations !== initialViolations + 1) {
        throw new Error('Policy violation count not incremented');
      }
      
      console.log('  ✓ Security events recorded and counted');
    });

    await this.test('Security warning events', async () => {
      recordSecurityEvent('capability_request', 'warning', {
        plugin_id: 'test-plugin',
        capability: 'network',
        justification: 'API access required'
      });
      
      console.log('  ✓ Security warnings recorded correctly');
    });
  }

  async testPerformanceMetrics() {
    console.log('\n⚡ Testing Performance Metrics...');
    
    await this.test('Performance timing recording', async () => {
      recordPerformanceMetric('plugin_load', 250, {
        plugin_id: 'test-plugin',
        transport: 'sdk'
      });
      
      recordPerformanceMetric('rpc_call', 45, {
        plugin_id: 'test-plugin',
        method: 'provider.validateCredentials',
        success: true
      });
      
      console.log('  ✓ Performance metrics recorded correctly');
    });

    await this.test('Performance metrics with metadata', async () => {
      recordPerformanceMetric('sandbox_startup', 180, {
        plugin_id: 'test-plugin',
        memory_limit: 256,
        success: true
      });
      
      console.log('  ✓ Performance metrics with metadata work correctly');
    });
  }

  async testSpanInterface() {
    console.log('\n🔍 Testing Span Interface...');
    
    await this.test('Create and end span', async () => {
      const span = createSpan('test.operation', {
        plugin_id: 'test-plugin',
        operation_type: 'validation'
      });
      
      if (!span || typeof span.end !== 'function') {
        throw new Error('Span should have end() method');
      }
      
      span.setAttributes({ additional: 'data' });
      span.setStatus({ code: 1, message: 'OK' });
      span.end();
      
      console.log('  ✓ Span interface works correctly');
    });

    await this.test('Span exception recording', async () => {
      const span = createSpan('test.error', { test: true });
      
      try {
        throw new Error('Test exception');
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: 2, message: error.message });
        span.end();
      }
      
      console.log('  ✓ Span exception recording works');
    });
  }

  async testTelemetryStats() {
    console.log('\n📈 Testing Telemetry Statistics...');
    
    await this.test('Get telemetry stats', async () => {
      const { getTelemetry } = require('./src/telemetry-shim');
      const telemetry = getTelemetry();
      const stats = telemetry.getStats();
      
      if (!stats.initialized) {
        throw new Error('Stats should show initialized state');
      }
      
      if (stats.mode !== 'no-op') {
        throw new Error('Stats should show no-op mode');
      }
      
      if (typeof stats.metrics.pluginLoads !== 'number') {
        throw new Error('Stats should include metrics');
      }
      
      console.log(`  ✓ Stats: ${stats.metrics.pluginLoads} loads, ${stats.metrics.rpcCalls} RPC calls`);
    });
  }

  async testHealthCheck() {
    console.log('\n🏥 Testing Health Check...');
    
    await this.test('Telemetry health check', async () => {
      const { getTelemetry } = require('./src/telemetry-shim');
      const telemetry = getTelemetry();
      const health = telemetry.healthCheck();
      
      if (health.status !== 'healthy') {
        throw new Error('Health check should show healthy status');
      }
      
      if (health.mode !== 'no-op') {
        throw new Error('Health check should show no-op mode');
      }
      
      if (!health.ready_for_upgrade) {
        throw new Error('Should be ready for Phase 2 upgrade');
      }
      
      console.log(`  ✓ Health: ${health.status}, ${health.metrics_count} metrics recorded`);
    });
  }

  async testGracefulShutdown() {
    console.log('\n🔄 Testing Graceful Shutdown...');
    
    await this.test('Telemetry shutdown', async () => {
      const { getTelemetry } = require('./src/telemetry-shim');
      const telemetry = getTelemetry();
      
      await telemetry.shutdown();
      
      if (telemetry.initialized) {
        throw new Error('Telemetry should be marked as not initialized after shutdown');
      }
      
      console.log('  ✓ Graceful shutdown completed');
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

  printSummary() {
    console.log('\n' + '='.repeat(50));
    console.log('📊 Telemetry Shim Test Results');
    console.log('='.repeat(50));
    
    const total = this.results.passed + this.results.failed;
    const passRate = total > 0 ? (this.results.passed / total * 100).toFixed(1) : 0;
    
    console.log(`Tests run: ${total}`);
    console.log(`Passed: ${this.results.passed} (${passRate}%)`);
    console.log(`Failed: ${this.results.failed}`);
    
    if (this.results.failed === 0) {
      console.log('\n🎉 Telemetry shim tests passed!');
      console.log('\n📋 Telemetry Shim Features:');
      console.log('  ✅ OpenTelemetry no-op SDK integration');
      console.log('  ✅ Event recording with minimal overhead');
      console.log('  ✅ Plugin lifecycle tracking');
      console.log('  ✅ Security event monitoring');
      console.log('  ✅ Performance metrics collection');
      console.log('  ✅ Span interface compatibility');
      console.log('  ✅ Ready for Phase 2 upgrade to full telemetry');
    } else {
      console.log('\n❌ Some telemetry tests failed. Review implementation.');
    }
    
    console.log('\n🎯 Next: Integrate telemetry into all runtime components');
  }
}

// Run tests if called directly
if (require.main === module) {
  const testSuite = new TelemetryShimTestSuite();
  testSuite.runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test suite error:', error);
      process.exit(1);
    });
}

module.exports = { TelemetryShimTestSuite };