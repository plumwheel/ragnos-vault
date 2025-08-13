#!/usr/bin/env node
/**
 * RAGnos Vault TUF Repository Initialization (JavaScript)
 * 
 * Creates a minimal viable TUF repository structure for staging using Node.js.
 * This approach avoids Python dependencies and creates the basic structure
 * that our tuf-js client can consume.
 * 
 * Phase A implementation per GPT-5 strategic guidance.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class TUFRepositoryInitializer {
  constructor(repoDir = 'tuf-staging') {
    this.repoDir = repoDir;
    this.metadataDir = path.join(repoDir, 'metadata');
    this.targetsDir = path.join(repoDir, 'targets');
    this.keysDir = path.join(repoDir, 'keys');
    
    // Staging configuration - short expiries for testing
    this.expiryConfig = {
      root: 90 * 24 * 60 * 60 * 1000,      // 90 days
      targets: 30 * 24 * 60 * 60 * 1000,   // 30 days
      snapshot: 14 * 24 * 60 * 60 * 1000,  // 14 days
      timestamp: 24 * 60 * 60 * 1000       // 24 hours
    };
    
    this.keys = {};
  }
  
  initializeRepository() {
    console.log('🏗️  Initializing TUF repository structure...');
    
    // Create directories
    [this.repoDir, this.metadataDir, this.targetsDir, this.keysDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    // Create plugins directory structure
    const pluginsDir = path.join(this.targetsDir, 'plugins');
    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true });
    }
    
    console.log(`  ✓ Created repository at ${this.repoDir}`);
  }
  
  generateKeys() {
    console.log('🔑 Generating staging keys...');
    
    const roles = ['root', 'targets', 'snapshot', 'timestamp'];
    
    roles.forEach(role => {
      console.log(`  Generating ${role} key...`);
      
      // Generate simple RSA key pair for staging (Ed25519 would require additional deps)
      const keyPair = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      });
      
      // Create key ID (simple hash of public key)
      const keyId = crypto.createHash('sha256')
        .update(keyPair.publicKey)
        .digest('hex')
        .substring(0, 64);
      
      this.keys[role] = {
        keyid: keyId,
        keytype: 'rsa',
        scheme: 'rsa-pss-sha256',
        keyval: {
          public: keyPair.publicKey.replace(/-----BEGIN PUBLIC KEY-----\n|-----END PUBLIC KEY-----\n|\n/g, '')
        },
        privateKey: keyPair.privateKey
      };
      
      // Save private key (staging only!)
      const keyFile = path.join(this.keysDir, `${role}_key.json`);
      fs.writeFileSync(keyFile, JSON.stringify({
        keyid: keyId,
        keytype: 'rsa',
        scheme: 'rsa-pss-sha256',
        privateKey: keyPair.privateKey
      }, null, 2));
      
      console.log(`    ✓ ${role} key: ${keyId.substring(0, 8)}...`);
    });
    
    console.log(`  ✓ Generated ${roles.length} keys`);
  }
  
  createRootMetadata() {
    console.log('📋 Creating root metadata...');
    
    const now = new Date();
    const expires = new Date(now.getTime() + this.expiryConfig.root);
    
    // Create roles
    const roles = {};
    ['root', 'targets', 'snapshot', 'timestamp'].forEach(roleName => {
      roles[roleName] = {
        keyids: [this.keys[roleName].keyid],
        threshold: 1
      };
    });
    
    // Create keys object
    const keys = {};
    ['root', 'targets', 'snapshot', 'timestamp'].forEach(roleName => {
      const key = this.keys[roleName];
      keys[key.keyid] = {
        keytype: key.keytype,
        scheme: key.scheme,
        keyval: key.keyval
      };
    });
    
    const rootMetadata = {
      signed: {
        _type: 'root',
        spec_version: '1.0.0',
        version: 1,
        expires: expires.toISOString(),
        keys,
        roles,
        consistent_snapshot: true
      },
      signatures: []
    };
    
    // For staging, we'll create a placeholder signature
    // In production, this would be properly signed
    rootMetadata.signatures.push({
      keyid: this.keys.root.keyid,
      signature: crypto.createHash('sha256').update(JSON.stringify(rootMetadata.signed)).digest('hex')
    });
    
    // Save root metadata
    fs.writeFileSync(
      path.join(this.metadataDir, 'root.json'),
      JSON.stringify(rootMetadata, null, 2)
    );
    
    // Save versioned copy
    fs.writeFileSync(
      path.join(this.metadataDir, '1.root.json'),
      JSON.stringify(rootMetadata, null, 2)
    );
    
    console.log(`  ✓ Root metadata created: ${Object.keys(keys).length} keys, consistent_snapshot=true`);
    return rootMetadata;
  }
  
  createSamplePlugin() {
    console.log('🧪 Creating sample test plugin...');
    
    const pluginContent = `#!/usr/bin/env node
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
        const lines = data.toString().trim().split('\\n');
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
          throw new Error(\`Unknown method: \${message.method}\`);
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
`;
    
    // Create plugin directory structure
    const pluginDir = path.join(this.targetsDir, 'plugins', 'ragnos-labs', 'sample-test-plugin');
    if (!fs.existsSync(pluginDir)) {
      fs.mkdirSync(pluginDir, { recursive: true });
    }
    
    // Save plugin file
    const pluginFile = path.join(pluginDir, 'index.js');
    fs.writeFileSync(pluginFile, pluginContent);
    
    // Calculate file info
    const stats = fs.statSync(pluginFile);
    const fileBuffer = fs.readFileSync(pluginFile);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    
    const pluginInfo = {
      path: path.relative(this.targetsDir, pluginFile),
      size: stats.size,
      sha256: fileHash
    };
    
    console.log(`  ✓ Created test plugin: ${pluginInfo.path}`);
    console.log(`    Size: ${pluginInfo.size} bytes, SHA256: ${fileHash.substring(0, 16)}...`);
    
    return pluginInfo;
  }
  
  createTargetsMetadata(pluginInfo) {
    console.log('🎯 Creating targets metadata...');
    
    const now = new Date();
    const expires = new Date(now.getTime() + this.expiryConfig.targets);
    
    const targets = {};
    targets[pluginInfo.path] = {
      length: pluginInfo.size,
      hashes: {
        sha256: pluginInfo.sha256
      }
    };
    
    const targetsMetadata = {
      signed: {
        _type: 'targets',
        spec_version: '1.0.0',
        version: 1,
        expires: expires.toISOString(),
        targets
      },
      signatures: []
    };
    
    // Placeholder signature for staging
    targetsMetadata.signatures.push({
      keyid: this.keys.targets.keyid,
      signature: crypto.createHash('sha256').update(JSON.stringify(targetsMetadata.signed)).digest('hex')
    });
    
    // Save targets metadata
    fs.writeFileSync(
      path.join(this.metadataDir, 'targets.json'),
      JSON.stringify(targetsMetadata, null, 2)
    );
    
    // Save versioned copy
    fs.writeFileSync(
      path.join(this.metadataDir, '1.targets.json'),
      JSON.stringify(targetsMetadata, null, 2)
    );
    
    console.log(`  ✓ Targets metadata created: ${Object.keys(targets).length} targets`);
    return targetsMetadata;
  }
  
  createSnapshotMetadata(targetsMetadata) {
    console.log('📸 Creating snapshot metadata...');
    
    const now = new Date();
    const expires = new Date(now.getTime() + this.expiryConfig.snapshot);
    
    const targetsJson = JSON.stringify(targetsMetadata);
    const targetsLength = Buffer.byteLength(targetsJson, 'utf8');
    const targetsHash = crypto.createHash('sha256').update(targetsJson).digest('hex');
    
    const snapshotMetadata = {
      signed: {
        _type: 'snapshot',
        spec_version: '1.0.0',
        version: 1,
        expires: expires.toISOString(),
        meta: {
          'targets.json': {
            version: targetsMetadata.signed.version,
            length: targetsLength,
            hashes: {
              sha256: targetsHash
            }
          }
        }
      },
      signatures: []
    };
    
    // Placeholder signature
    snapshotMetadata.signatures.push({
      keyid: this.keys.snapshot.keyid,
      signature: crypto.createHash('sha256').update(JSON.stringify(snapshotMetadata.signed)).digest('hex')
    });
    
    // Save snapshot metadata
    fs.writeFileSync(
      path.join(this.metadataDir, 'snapshot.json'),
      JSON.stringify(snapshotMetadata, null, 2)
    );
    
    // Save versioned copy
    fs.writeFileSync(
      path.join(this.metadataDir, '1.snapshot.json'),
      JSON.stringify(snapshotMetadata, null, 2)
    );
    
    console.log('  ✓ Snapshot metadata created');
    return snapshotMetadata;
  }
  
  createTimestampMetadata(snapshotMetadata) {
    console.log('⏰ Creating timestamp metadata...');
    
    const now = new Date();
    const expires = new Date(now.getTime() + this.expiryConfig.timestamp);
    
    const snapshotJson = JSON.stringify(snapshotMetadata);
    const snapshotLength = Buffer.byteLength(snapshotJson, 'utf8');
    const snapshotHash = crypto.createHash('sha256').update(snapshotJson).digest('hex');
    
    const timestampMetadata = {
      signed: {
        _type: 'timestamp',
        spec_version: '1.0.0',
        version: 1,
        expires: expires.toISOString(),
        meta: {
          'snapshot.json': {
            version: snapshotMetadata.signed.version,
            length: snapshotLength,
            hashes: {
              sha256: snapshotHash
            }
          }
        }
      },
      signatures: []
    };
    
    // Placeholder signature
    timestampMetadata.signatures.push({
      keyid: this.keys.timestamp.keyid,
      signature: crypto.createHash('sha256').update(JSON.stringify(timestampMetadata.signed)).digest('hex')
    });
    
    // Save timestamp metadata
    fs.writeFileSync(
      path.join(this.metadataDir, 'timestamp.json'),
      JSON.stringify(timestampMetadata, null, 2)
    );
    
    // Save versioned copy
    fs.writeFileSync(
      path.join(this.metadataDir, '1.timestamp.json'),
      JSON.stringify(timestampMetadata, null, 2)
    );
    
    console.log('  ✓ Timestamp metadata created');
    return timestampMetadata;
  }
  
  createRepositoryInfo() {
    console.log('📄 Creating repository information...');
    
    const info = {
      repository_type: 'staging',
      created: new Date().toISOString(),
      base_url: 'http://localhost:8080',
      metadata_url: 'http://localhost:8080/metadata',
      targets_url: 'http://localhost:8080/targets',
      consistent_snapshot: true,
      expiry_config: {
        root_days: Math.floor(this.expiryConfig.root / (24 * 60 * 60 * 1000)),
        targets_days: Math.floor(this.expiryConfig.targets / (24 * 60 * 60 * 1000)),
        snapshot_days: Math.floor(this.expiryConfig.snapshot / (24 * 60 * 60 * 1000)),
        timestamp_hours: Math.floor(this.expiryConfig.timestamp / (60 * 60 * 1000))
      },
      key_info: {}
    };
    
    ['root', 'targets', 'snapshot', 'timestamp'].forEach(role => {
      info.key_info[role] = {
        keyid: this.keys[role].keyid,
        keytype: this.keys[role].keytype
      };
    });
    
    fs.writeFileSync(
      path.join(this.repoDir, 'repository-info.json'),
      JSON.stringify(info, null, 2)
    );
    
    console.log(`  ✓ Repository info saved`);
  }
  
  run() {
    console.log('🚀 RAGnos Vault TUF Repository Initialization');
    console.log('=' * 50);
    
    try {
      // Initialize repository structure
      this.initializeRepository();
      
      // Generate keys
      this.generateKeys();
      
      // Create sample plugin
      const pluginInfo = this.createSamplePlugin();
      
      // Create metadata in dependency order
      const rootMetadata = this.createRootMetadata();
      const targetsMetadata = this.createTargetsMetadata(pluginInfo);
      const snapshotMetadata = this.createSnapshotMetadata(targetsMetadata);
      const timestampMetadata = this.createTimestampMetadata(snapshotMetadata);
      
      // Create repository info
      this.createRepositoryInfo();
      
      console.log('\\n✅ TUF Repository Initialization Complete!');
      console.log(`📁 Repository: ${this.repoDir}`);
      console.log('🌐 Serve with: http-server tuf-staging -p 8080 --cors');
      console.log('🔗 Metadata URL: http://localhost:8080/metadata');
      console.log(`🎯 Test plugin: ${pluginInfo.path}`);
      
      console.log('\\n📋 Next Steps:');
      console.log('1. Start HTTP server: http-server tuf-staging -p 8080 --cors');
      console.log('2. Update runtime loader with repository URL');
      console.log('3. Run end-to-end verification tests');
      console.log('4. Test negative scenarios (tampering, expiry)');
      
      console.log('\\n⚠️  Note: This is a staging repository with placeholder signatures');
      console.log('Production deployment will require proper cryptographic signing');
      
    } catch (error) {
      console.error(`\\n❌ Repository initialization failed: ${error.message}`);
      console.error(error.stack);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  const initializer = new TUFRepositoryInitializer();
  initializer.run();
}

module.exports = TUFRepositoryInitializer;