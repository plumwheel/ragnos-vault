#!/usr/bin/env node
/**
 * Simple TUF Client Test - Direct tuf-js usage
 * 
 * Tests the tuf-js library directly with our local repository
 * to understand the correct initialization pattern.
 */

const { Updater } = require('tuf-js');
const fs = require('fs');
const path = require('path');

async function testTUFDirect() {
  console.log('🔧 Testing tuf-js library directly...');
  
  try {
    // Load root metadata from our minimal repository
    const rootPath = path.join(__dirname, 'tuf-minimal', 'metadata', 'root.json');
    const rootMetadata = JSON.parse(fs.readFileSync(rootPath, 'utf8'));
    
    console.log('✓ Root metadata loaded');
    
    // Create metadata and cache directories
    const metadataDir = './tuf-test-metadata';
    const cacheDir = './tuf-test-cache';
    
    if (!fs.existsSync(metadataDir)) {
      fs.mkdirSync(metadataDir, { recursive: true });
    }
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    
    console.log('✓ Directories created');
    
    // Save root metadata to the metadata directory first
    fs.writeFileSync(path.join(metadataDir, 'root.json'), JSON.stringify(rootMetadata, null, 2));
    console.log('✓ Root metadata saved to metadata directory');
    
    // Initialize Updater
    const updater = new Updater({
      metadataUrl: 'http://localhost:8082/metadata',
      targetUrl: 'http://localhost:8082/targets',
      metadataDir: metadataDir,
      cacheDir: cacheDir
    });
    
    console.log('✓ Updater created');
    
    // Try to refresh metadata
    await updater.refresh();
    console.log('✓ Metadata refreshed');
    
    // Try to get target info
    const targetPath = 'plugins/ragnos-labs/sample-test-plugin/index.js';
    const targetInfo = await updater.getTargetInfo(targetPath);
    
    if (targetInfo) {
      console.log(`✓ Target found: ${targetInfo.length} bytes`);
      console.log(`  Hashes: ${Object.keys(targetInfo.hashes).join(', ')}`);
    } else {
      console.log('❌ Target not found');
    }
    
    // Cleanup
    fs.rmSync(metadataDir, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
    
    console.log('✅ Direct tuf-js test successful!');
    
  } catch (error) {
    console.error('❌ Direct tuf-js test failed:', error.message);
    console.error(error.stack);
  }
}

if (require.main === module) {
  testTUFDirect();
}