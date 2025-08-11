#!/usr/bin/env tsx

/**
 * RAGnos Vault Demo Script
 * Demonstrates the complete Provider SDK + Infisical CE integration
 */

import { SimpleSecretProvider } from './packages/sdk/src/simple/simple-provider';
import { createInfisicalProvider } from './packages/provider-infisical/src';
import { createMockProvider } from './packages/sdk/src/providers/mock';

async function main() {
  console.log('🚀 RAGnos Vault Demo - Provider SDK + Infisical CE Integration\n');

  // Demo 1: Mock Provider (in-memory testing)
  console.log('📋 Demo 1: Mock Provider (In-Memory Testing)');
  console.log('='.repeat(50));
  
  const mockProvider = createMockProvider({
    deterministic: true,
    latency: 100 // 100ms simulated latency
  });

  const mockContext = {
    tenantId: 'demo-tenant',
    logger: console,
    tracer: { startSpan: () => ({ end: () => {}, setAttributes: () => {}, recordException: () => {}, setStatus: () => {} }) },
    metrics: { counter: () => {}, histogram: () => {}, gauge: () => {} },
    clock: { now: () => new Date() },
    config: {},
    requestId: 'demo-request-1'
  } as any;

  await mockProvider.init(mockContext);
  
  const simpleMock = new SimpleSecretProvider(mockProvider, mockContext, {
    cache: { defaultTtl: 300 } // 5 minutes cache
  });

  try {
    // Test basic operations
    console.log('→ Setting secret: database-password');
    const secret = await simpleMock.set('database-password', 'super-secret-password', {
      metadata: { 
        environment: 'demo',
        team: 'backend',
        type: 'database'
      }
    });
    console.log('✅ Secret created:', {
      version: secret.version,
      createdAt: secret.createdAt
    });

    console.log('\n→ Getting secret: database-password');
    const retrieved = await simpleMock.get('database-password');
    console.log('✅ Secret retrieved:', {
      value: retrieved.value.substring(0, 8) + '...',
      version: retrieved.version,
      metadata: retrieved.metadata
    });

    console.log('\n→ Listing secrets');
    const secretNames = await simpleMock.list();
    console.log('✅ Found secrets:', secretNames);

    console.log('\n→ Testing cache (second retrieval should be instant)');
    const start = Date.now();
    await simpleMock.get('database-password');
    const cacheTime = Date.now() - start;
    console.log(`✅ Cache hit in ${cacheTime}ms`);

    console.log('\n→ Checking provider health');
    const health = await simpleMock.health();
    console.log('✅ Provider health:', health);

  } catch (error) {
    console.error('❌ Mock provider demo failed:', error);
  }

  // Demo 2: Infisical CE Provider (if configured)
  console.log('\n\n📡 Demo 2: Infisical CE Provider Integration');
  console.log('='.repeat(50));

  const infisicalConfig = {
    baseUrl: process.env.INFISICAL_BASE_URL || 'http://localhost:8080',
    serviceToken: process.env.INFISICAL_SERVICE_TOKEN || 'demo-token',
    environment: process.env.INFISICAL_ENVIRONMENT || 'dev'
  };

  if (infisicalConfig.serviceToken === 'demo-token') {
    console.log('⚠️  Infisical CE demo skipped - no INFISICAL_SERVICE_TOKEN provided');
    console.log('   To test Infisical integration:');
    console.log('   1. Start Infisical CE: docker-compose -f docker-compose.infisical.yml up -d');
    console.log('   2. Create a service token in the Infisical UI');
    console.log('   3. Set INFISICAL_SERVICE_TOKEN=<your-token>');
    console.log('   4. Run this demo again');
  } else {
    try {
      console.log('→ Connecting to Infisical CE:', infisicalConfig.baseUrl);
      
      const infisicalProvider = createInfisicalProvider(infisicalConfig);
      await infisicalProvider.init(mockContext);

      const simpleInfisical = new SimpleSecretProvider(infisicalProvider, mockContext);

      console.log('→ Testing Infisical provider health');
      const infisicalHealth = await simpleInfisical.health();
      console.log('✅ Infisical health:', infisicalHealth);

      console.log('\n→ Setting secret in Infisical: api-key');
      await simpleInfisical.set('demo-api-key', 'abc123xyz789', {
        metadata: { source: 'ragnos-demo' }
      });
      console.log('✅ Secret stored in Infisical');

      console.log('\n→ Reading secret from Infisical');
      const infisicalSecret = await simpleInfisical.get('demo-api-key');
      console.log('✅ Secret retrieved from Infisical:', {
        value: infisicalSecret.value.substring(0, 6) + '...',
        version: infisicalSecret.version
      });

      console.log('\n→ Listing secrets in Infisical');
      const infisicalSecrets = await simpleInfisical.list('demo-');
      console.log('✅ Demo secrets in Infisical:', infisicalSecrets);

    } catch (error) {
      console.error('❌ Infisical CE demo failed:', error);
      console.log('   This is likely due to:');
      console.log('   - Infisical CE not running');
      console.log('   - Invalid service token');
      console.log('   - Network connectivity issues');
    }
  }

  // Demo 3: Provider Abstraction
  console.log('\n\n🔄 Demo 3: Provider Abstraction Benefits');
  console.log('='.repeat(50));

  console.log('→ Demonstrating universal interface');
  console.log('  Both Mock and Infisical providers implement the same SimpleSecretProvider interface');
  console.log('  Your application code is identical regardless of backend!');
  
  console.log('\n→ Advanced SDK access');
  console.log('  When you need provider-specific features, use sdkHandle():');
  const mockSdkHandle = simpleMock.sdkHandle();
  console.log('  Mock capabilities:', mockSdkHandle.capabilities());
  
  console.log('\n→ Error handling standardization');
  try {
    await simpleMock.get('nonexistent-secret');
  } catch (error) {
    console.log('  Standardized error:', error.constructor.name, error.code);
  }

  // Demo 4: Architecture Benefits
  console.log('\n\n🏗️  Demo 4: RAGnos Vault Architecture Benefits');
  console.log('='.repeat(50));

  console.log('✅ Provider Abstraction:');
  console.log('  - Switch from Infisical → AWS → HashiCorp Vault with zero code changes');
  console.log('  - Test locally with MockProvider, deploy with production providers');
  console.log('  - Multi-provider support for failover and migration');

  console.log('\n✅ Enterprise Features (Coming Soon):');
  console.log('  - Policy-as-code with approval workflows');
  console.log('  - Audit lake with SIEM integration');  
  console.log('  - Zero-downtime migration between providers');
  console.log('  - RAGnos Control Plane for multi-tenant management');

  console.log('\n✅ Developer Experience:');
  console.log('  - Simple facade API for 80% of use cases');
  console.log('  - Full SDK access for advanced scenarios');
  console.log('  - Built-in caching and observability');
  console.log('  - Type-safe configuration and error handling');

  console.log('\n🎉 Demo completed successfully!');
  console.log('Next steps:');
  console.log('- Explore the Control Plane API: npm run dev:control-plane');
  console.log('- Review the OpenAPI docs: http://localhost:3000/docs');
  console.log('- Add more providers: AWS Secrets Manager, HashiCorp Vault');
}

// Run the demo
main().catch(console.error);