#!/usr/bin/env tsx

/**
 * Test script for conformance validation
 * Runs L0 tests against memory provider
 */

import { createMemoryProvider } from './packages/provider-memory';
import { runConformanceTests } from './packages/conformance/src/suite-runner';
import { ProviderFactory } from './packages/conformance/src/types';

async function main() {
  console.log('🚀 RAGnos Vault Conformance Tests');
  console.log('Testing Memory Provider Implementation\n');
  
  const memoryFactory: ProviderFactory = {
    name: 'memory',
    create: (config) => createMemoryProvider(config)
  };
  
  const config = {
    eventualWindowMs: 0, // No eventual consistency for initial tests
    maxObjectSize: 10 * 1024 * 1024, // 10MB
    maxSecretSize: 1024 * 1024, // 1MB
    chaos: {
      enabled: false // Disable chaos for L0 tests
    }
  };
  
  const options = {
    testLevels: ['L0'] as const,
    namespace: `conformance-${Date.now()}`,
    cleanupOnFailure: true
  };
  
  try {
    const result = await runConformanceTests(memoryFactory, config, options);
    
    if (result.success) {
      console.log('\n🎉 All conformance tests passed!');
      console.log('✅ Memory provider is ready for AWS validation');
      process.exit(0);
    } else {
      console.log('\n💥 Some conformance tests failed!');
      console.log('❌ Fix issues before proceeding to AWS provider');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n🔥 Conformance test suite failed to run:', error);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

main();