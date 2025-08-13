/**
 * RAGnos Vault TUF Basic Integration Test
 * 
 * Simplified test to validate core TUF functionality and integration
 */

const { LocalTUFRepository } = require('../src/local-tuf-repository');
const fs = require('fs');
const path = require('path');
const http = require('http');

class TUFBasicTest {
  constructor() {
    this.testDir = path.join(__dirname, 'temp-tuf-basic');
    this.repoDir = path.join(this.testDir, 'repo');
    this.repository = null;
  }

  async runTest() {
    console.log('🔍 TUF Basic Integration Test');
    console.log('=' .repeat(40));
    
    try {
      await this.setup();
      
      const tests = [
        this.testRepositoryCreation.bind(this),
        this.testPluginPublication.bind(this),
        this.testHTTPServer.bind(this),
        this.testMetadataChain.bind(this),
        this.testBasicVerification.bind(this)
      ];
      
      let passed = 0;
      for (const test of tests) {
        try {
          await test();
          passed++;
        } catch (error) {
          console.log(`  ❌ Test failed: ${error.message}`);
        }
      }
      
      await this.cleanup();
      
      console.log(`\n📊 Basic Tests: ${passed}/${tests.length} passed`);
      return passed === tests.length;
      
    } catch (error) {
      console.error('Test suite failed:', error);
      await this.cleanup();
      return false;
    }
  }

  async setup() {
    if (fs.existsSync(this.testDir)) {
      fs.rmSync(this.testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.testDir, { recursive: true });
    
    this.repository = new LocalTUFRepository({
      repoDir: this.repoDir,
      serverPort: 8092
    });
  }

  async testRepositoryCreation() {
    console.log('🧪 Testing repository creation...');
    
    await this.repository.initialize();
    
    // Check directory structure
    const dirs = ['metadata', 'targets', 'keys'];
    for (const dir of dirs) {
      const dirPath = path.join(this.repoDir, dir);
      if (!fs.existsSync(dirPath)) {
        throw new Error(`Directory ${dir} not created`);
      }
    }
    
    // Check metadata files
    const metadataFiles = ['root.json', 'targets.json', 'snapshot.json', 'timestamp.json'];
    for (const file of metadataFiles) {
      const filePath = path.join(this.repoDir, 'metadata', file);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Metadata file ${file} not created`);
      }
    }
    
    console.log('  ✅ Repository structure created');
  }

  async testPluginPublication() {
    console.log('🧪 Testing plugin publication...');
    
    // Create test plugin
    const pluginContent = Buffer.from('console.log("Basic test plugin");');
    const pluginPath = path.join(this.testDir, 'test-plugin.js');
    fs.writeFileSync(pluginPath, pluginContent);
    
    const manifest = {
      id: 'basic-test-plugin',
      displayName: 'Basic Test Plugin',
      vendor: 'test-vendor',
      version: '1.0.0'
    };
    
    const result = await this.repository.publishPlugin(pluginPath, manifest);
    
    if (!result.targetPath || !result.hash || !result.size) {
      throw new Error('Plugin publication incomplete');
    }
    
    // Check target file exists
    const targetFile = path.join(this.repoDir, 'targets', result.targetPath);
    if (!fs.existsSync(targetFile)) {
      throw new Error('Target file not created');
    }
    
    console.log(`  ✅ Plugin published: ${result.targetPath} (${result.size} bytes)`);
  }

  async testHTTPServer() {
    console.log('🧪 Testing HTTP server...');
    
    const baseUrl = await this.repository.startServer();
    
    // Test repository info endpoint
    const response = await this.httpGet(`${baseUrl}/`);
    const info = JSON.parse(response);
    
    if (!info.name || !info.metadata_url) {
      throw new Error('Repository info incomplete');
    }
    
    // Test metadata endpoint
    const rootResponse = await this.httpGet(`${baseUrl}/metadata/root.json`);
    const rootData = JSON.parse(rootResponse);
    
    if (!rootData.signed || !rootData.signatures) {
      throw new Error('Root metadata invalid');
    }
    
    console.log(`  ✅ HTTP server running at ${baseUrl}`);
  }

  async testMetadataChain() {
    console.log('🧪 Testing metadata chain...');
    
    const metadataDir = path.join(this.repoDir, 'metadata');
    
    // Load and validate metadata chain
    const root = JSON.parse(fs.readFileSync(path.join(metadataDir, 'root.json'), 'utf8'));
    const targets = JSON.parse(fs.readFileSync(path.join(metadataDir, 'targets.json'), 'utf8'));
    const snapshot = JSON.parse(fs.readFileSync(path.join(metadataDir, 'snapshot.json'), 'utf8'));
    const timestamp = JSON.parse(fs.readFileSync(path.join(metadataDir, 'timestamp.json'), 'utf8'));
    
    // Check structure
    const requiredFields = ['signed', 'signatures'];
    for (const metadata of [root, targets, snapshot, timestamp]) {
      for (const field of requiredFields) {
        if (!metadata[field]) {
          throw new Error(`Missing ${field} in metadata`);
        }
      }
    }
    
    // Check version progression
    if (root.signed.version !== 1) {
      throw new Error('Root version should be 1');
    }
    
    console.log('  ✅ Metadata chain valid');
  }

  async testBasicVerification() {
    console.log('🧪 Testing basic verification...');
    
    // Load targets metadata
    const targetsPath = path.join(this.repoDir, 'metadata', 'targets.json');
    const targetsData = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
    
    const targets = targetsData.signed.targets;
    const targetKeys = Object.keys(targets);
    
    if (targetKeys.length === 0) {
      throw new Error('No targets found');
    }
    
    // Verify target file hash
    const targetKey = targetKeys[0];
    const targetInfo = targets[targetKey];
    const targetFile = path.join(this.repoDir, 'targets', targetKey);
    
    if (!fs.existsSync(targetFile)) {
      throw new Error('Target file missing');
    }
    
    const fileContent = fs.readFileSync(targetFile);
    const crypto = require('crypto');
    const actualHash = crypto.createHash('sha256').update(fileContent).digest('hex');
    
    if (actualHash !== targetInfo.hashes.sha256) {
      throw new Error('Hash mismatch');
    }
    
    if (fileContent.length !== targetInfo.length) {
      throw new Error('Size mismatch');
    }
    
    console.log(`  ✅ File verification passed (${actualHash.substring(0, 8)}...)`);
  }

  async httpGet(url) {
    return new Promise((resolve, reject) => {
      http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      }).on('error', reject);
    });
  }

  async cleanup() {
    try {
      if (this.repository) {
        await this.repository.stopServer();
      }
      
      if (fs.existsSync(this.testDir)) {
        fs.rmSync(this.testDir, { recursive: true, force: true });
      }
      
      console.log('🧹 Cleanup complete');
    } catch (error) {
      console.warn(`Cleanup warning: ${error.message}`);
    }
  }
}

if (require.main === module) {
  const test = new TUFBasicTest();
  test.runTest()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}

module.exports = { TUFBasicTest };