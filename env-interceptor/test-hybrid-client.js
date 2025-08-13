#!/usr/bin/env node
/**
 * RAGnos Vault Hybrid TUF Client Test
 * Verify the hybrid client system works with auto-fallback
 */

const { HybridTUFClient } = require('./src/hybrid-tuf-client');
const fs = require('fs');

async function testHybridClient() {
  console.log('🧪 Testing Hybrid TUF Client');
  console.log('=' .repeat(40));
  
  try {
    // Load root metadata
    const rootMetadata = JSON.parse(fs.readFileSync('test-tuf-metadata/root.json', 'utf8'));
    
    // Test 1: Auto mode (should try JS first, then Python on failure)
    console.log('\n🔄 Testing auto mode...');
    const autoClient = new HybridTUFClient({
      clientMode: 'auto',
      jsClientOptions: {
        repositoryUrl: 'http://localhost:8081',
        metadataDir: './test-tuf-metadata',
        cacheDir: './test-tuf-cache'
      }
    });
    
    const autoResult = await autoClient.initialize();
    console.log('  ✅ Auto client initialized:', autoResult);
    console.log('  📊 Status:', autoClient.getStatus());
    
    // Test 2: Python-only mode
    console.log('\n🐍 Testing Python-only mode...');
    const pythonClient = new HybridTUFClient({
      clientMode: 'python',
      pythonClientOptions: {}
    });
    
    try {
      const pythonResult = await pythonClient.initialize();
      console.log('  ✅ Python client initialized:', pythonResult);
      console.log('  📊 Status:', pythonClient.getStatus());
    } catch (error) {
      console.log('  ⚠️  Python client failed (expected if python-tuf not installed):', error.message);
    }
    
    // Test 3: Off mode
    console.log('\n🚫 Testing off mode...');
    const offClient = new HybridTUFClient({
      clientMode: 'off'
    });
    
    const offResult = await offClient.initialize();
    console.log('  ✅ Off client initialized:', offResult);
    console.log('  📊 Status:', offClient.getStatus());
    
    console.log('\n✅ Hybrid client tests completed successfully!');
    return true;
    
  } catch (error) {
    console.error('❌ Hybrid client test failed:', error.message);
    return false;
  }
}

if (require.main === module) {
  testHybridClient().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { testHybridClient };