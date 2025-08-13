#!/usr/bin/env node
/**
 * RAGnos Vault Local-First TUF Repository
 * 
 * Production-ready local TUF repository builder and manager for enterprise deployments.
 * Provides secure plugin distribution without cloud dependencies.
 * 
 * Features:
 * - Local key management with secure storage
 * - Proper cryptographic signing (RSA-PSS-SHA256)
 * - Plugin publication pipeline
 * - Metadata refresh and rotation
 * - HTTP server for distribution
 * - Enterprise security controls
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const url = require('url');
const { recordSecurityEvent, recordPluginEvent } = require('./telemetry-shim');

class LocalTUFRepository {
  constructor(options = {}) {
    this.options = {
      repoDir: options.repoDir || 'tuf-local',
      serverPort: options.serverPort || 8080,
      serverHost: options.serverHost || 'localhost',
      keyBits: options.keyBits || 2048,
      consistentSnapshot: options.consistentSnapshot !== false,
      enableCORS: options.enableCORS !== false,
      ...options
    };

    // Directory structure
    this.repoDir = this.options.repoDir;
    this.metadataDir = path.join(this.repoDir, 'metadata');
    this.targetsDir = path.join(this.repoDir, 'targets');
    this.keysDir = path.join(this.repoDir, 'keys');
    this.stagingDir = path.join(this.repoDir, 'staging');

    // Production security settings
    this.expiryConfig = {
      root: 365 * 24 * 60 * 60 * 1000,      // 1 year
      targets: 90 * 24 * 60 * 60 * 1000,    // 90 days  
      snapshot: 7 * 24 * 60 * 60 * 1000,    // 7 days
      timestamp: 2 * 60 * 60 * 1000          // 2 hours
    };

    this.keys = {};
    this.server = null;
    this.metadata = {};
  }

  /**
   * Initialize repository structure and generate keys
   */
  async initialize() {
    console.log('🏗️  Initializing Local TUF Repository...');
    
    try {
      await this.createDirectoryStructure();
      await this.generateOrLoadKeys();
      await this.createInitialMetadata();
      
      recordSecurityEvent('tuf_repository_initialized', 'info', {
        repository_path: this.repoDir,
        consistent_snapshot: this.options.consistentSnapshot,
        key_count: Object.keys(this.keys).length
      });

      console.log('✅ Local TUF Repository initialized successfully');
      return true;
    } catch (error) {
      recordSecurityEvent('tuf_repository_initialization_failed', 'error', {
        error_message: error.message
      });
      throw error;
    }
  }

  /**
   * Create repository directory structure
   */
  async createDirectoryStructure() {
    const dirs = [
      this.repoDir,
      this.metadataDir, 
      this.targetsDir,
      this.keysDir,
      this.stagingDir,
      path.join(this.targetsDir, 'plugins')
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
      }
    }

    console.log(`  ✓ Created directory structure at ${this.repoDir}`);
  }

  /**
   * Generate or load existing keys with secure storage
   */
  async generateOrLoadKeys() {
    const roles = ['root', 'targets', 'snapshot', 'timestamp'];
    
    for (const role of roles) {
      const keyFile = path.join(this.keysDir, `${role}_key.json`);
      
      if (fs.existsSync(keyFile)) {
        // Load existing key
        const keyData = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
        this.keys[role] = keyData;
        console.log(`  ↻ Loaded existing ${role} key: ${keyData.keyid.substring(0, 8)}...`);
      } else {
        // Generate new key
        await this.generateRoleKey(role);
        console.log(`  ✓ Generated new ${role} key: ${this.keys[role].keyid.substring(0, 8)}...`);
      }
    }

    recordSecurityEvent('tuf_keys_loaded', 'info', {
      total_keys: Object.keys(this.keys).length,
      key_type: 'rsa',
      key_bits: this.options.keyBits
    });
  }

  /**
   * Generate a role key with proper RSA-PSS-SHA256 setup
   */
  async generateRoleKey(role) {
    const keyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: this.options.keyBits,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });

    // Create canonical key ID
    const keyId = crypto.createHash('sha256')
      .update(keyPair.publicKey)
      .digest('hex');

    const keyData = {
      keyid: keyId,
      keytype: 'rsa',
      scheme: 'rsassa-pss-sha256',  // TUF-js compatible scheme name
      keyval: {
        public: keyPair.publicKey.replace(/-----BEGIN PUBLIC KEY-----\n|-----END PUBLIC KEY-----\n|\n/g, '')
      },
      privateKey: keyPair.privateKey,
      created: new Date().toISOString(),
      role: role
    };

    this.keys[role] = keyData;

    // Save key securely (production should use HSM/Vault)
    const keyFile = path.join(this.keysDir, `${role}_key.json`);
    fs.writeFileSync(keyFile, JSON.stringify(keyData, null, 2), { mode: 0o600 });

    recordSecurityEvent('tuf_key_generated', 'info', {
      role: role,
      keyid: keyId,
      key_type: 'rsa',
      key_bits: this.options.keyBits
    });
  }

  /**
   * Create proper cryptographic signature using RSA-PSS-SHA256
   */
  createSignature(data, privateKey, keyId) {
    const canonicalData = JSON.stringify(data);
    
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(canonicalData);
    sign.end();
    
    const signature = sign.sign({
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
    }, 'base64');  // Changed from 'hex' to 'base64' for TUF-js compatibility

    return {
      keyid: keyId,
      signature: signature
    };
  }

  /**
   * Create initial metadata files
   */
  async createInitialMetadata() {
    console.log('📋 Creating initial metadata...');

    // Create root metadata first
    const rootMetadata = this.createRootMetadata();
    this.metadata.root = rootMetadata;

    // Create empty targets initially
    const targetsMetadata = this.createTargetsMetadata({});
    this.metadata.targets = targetsMetadata;

    // Create snapshot and timestamp
    const snapshotMetadata = this.createSnapshotMetadata();
    this.metadata.snapshot = snapshotMetadata;

    const timestampMetadata = this.createTimestampMetadata();
    this.metadata.timestamp = timestampMetadata;

    console.log('  ✓ Initial metadata created');
  }

  /**
   * Create root metadata with proper signatures
   */
  createRootMetadata() {
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
        schemes: [key.scheme],  // TUF-js expects schemes as array
        keyval: key.keyval
      };
    });

    const rootSigned = {
      _type: 'root',
      spec_version: '1.0.0', 
      version: 1,
      expires: expires.toISOString(),
      keys,
      roles,
      consistent_snapshot: this.options.consistentSnapshot
    };

    // Create proper signature
    const signature = this.createSignature(rootSigned, this.keys.root.privateKey, this.keys.root.keyid);

    const rootMetadata = {
      signed: rootSigned,
      signatures: [signature]
    };

    // Save metadata
    this.saveMetadata('root', rootMetadata);
    
    recordSecurityEvent('tuf_root_metadata_created', 'info', {
      version: rootSigned.version,
      expires: expires.toISOString(),
      key_count: Object.keys(keys).length
    });

    return rootMetadata;
  }

  /**
   * Create targets metadata
   */
  createTargetsMetadata(targets = {}) {
    const now = new Date();
    const expires = new Date(now.getTime() + this.expiryConfig.targets);

    const targetsSigned = {
      _type: 'targets',
      spec_version: '1.0.0',
      version: this.getNextVersion('targets'),
      expires: expires.toISOString(),
      targets
    };

    const signature = this.createSignature(targetsSigned, this.keys.targets.privateKey, this.keys.targets.keyid);

    const targetsMetadata = {
      signed: targetsSigned,
      signatures: [signature]
    };

    this.saveMetadata('targets', targetsMetadata);
    return targetsMetadata;
  }

  /**
   * Create snapshot metadata
   */
  createSnapshotMetadata() {
    const now = new Date();
    const expires = new Date(now.getTime() + this.expiryConfig.snapshot);

    // Calculate metadata hashes
    const meta = {};
    const targetsJson = JSON.stringify(this.metadata.targets);
    meta['targets.json'] = {
      version: this.metadata.targets.signed.version,
      length: Buffer.byteLength(targetsJson, 'utf8'),
      hashes: {
        sha256: crypto.createHash('sha256').update(targetsJson).digest('hex')
      }
    };

    const snapshotSigned = {
      _type: 'snapshot',
      spec_version: '1.0.0',
      version: this.getNextVersion('snapshot'),
      expires: expires.toISOString(),
      meta
    };

    const signature = this.createSignature(snapshotSigned, this.keys.snapshot.privateKey, this.keys.snapshot.keyid);

    const snapshotMetadata = {
      signed: snapshotSigned,
      signatures: [signature]
    };

    this.saveMetadata('snapshot', snapshotMetadata);
    return snapshotMetadata;
  }

  /**
   * Create timestamp metadata
   */
  createTimestampMetadata() {
    const now = new Date();
    const expires = new Date(now.getTime() + this.expiryConfig.timestamp);

    const snapshotJson = JSON.stringify(this.metadata.snapshot);
    const meta = {
      'snapshot.json': {
        version: this.metadata.snapshot.signed.version,
        length: Buffer.byteLength(snapshotJson, 'utf8'),
        hashes: {
          sha256: crypto.createHash('sha256').update(snapshotJson).digest('hex')
        }
      }
    };

    const timestampSigned = {
      _type: 'timestamp',
      spec_version: '1.0.0',
      version: this.getNextVersion('timestamp'),
      expires: expires.toISOString(),
      meta
    };

    const signature = this.createSignature(timestampSigned, this.keys.timestamp.privateKey, this.keys.timestamp.keyid);

    const timestampMetadata = {
      signed: timestampSigned,
      signatures: [signature]
    };

    this.saveMetadata('timestamp', timestampMetadata);
    return timestampMetadata;
  }

  /**
   * Save metadata with versioning support
   */
  saveMetadata(role, metadata) {
    const version = metadata.signed.version;
    
    // Save current version
    fs.writeFileSync(
      path.join(this.metadataDir, `${role}.json`),
      JSON.stringify(metadata, null, 2)
    );

    // Save versioned copy for consistent snapshot
    if (this.options.consistentSnapshot) {
      fs.writeFileSync(
        path.join(this.metadataDir, `${version}.${role}.json`),
        JSON.stringify(metadata, null, 2)
      );
    }
  }

  /**
   * Get next version number for metadata
   */
  getNextVersion(role) {
    if (!this.metadata[role]) {
      return 1;
    }
    return this.metadata[role].signed.version + 1;
  }

  /**
   * Publish a plugin to the repository
   */
  async publishPlugin(pluginPath, manifest) {
    console.log(`📦 Publishing plugin: ${manifest.id}`);

    try {
      // Validate plugin
      if (!fs.existsSync(pluginPath)) {
        throw new Error(`Plugin file not found: ${pluginPath}`);
      }

      // Calculate plugin hash and size
      const pluginBuffer = fs.readFileSync(pluginPath);
      const pluginHash = crypto.createHash('sha256').update(pluginBuffer).digest('hex');
      const pluginSize = pluginBuffer.length;

      // Create target path
      const vendor = manifest.vendor || 'community';
      const targetPath = `plugins/${vendor}/${manifest.id}.tar.gz`;
      const targetFile = path.join(this.targetsDir, targetPath);

      // Ensure target directory exists
      const targetDir = path.dirname(targetFile);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Copy plugin to targets directory
      fs.copyFileSync(pluginPath, targetFile);

      // Update targets metadata
      const currentTargets = this.metadata.targets?.signed.targets || {};
      currentTargets[targetPath] = {
        length: pluginSize,
        hashes: {
          sha256: pluginHash
        },
        custom: {
          manifest: manifest,
          published: new Date().toISOString()
        }
      };

      // Regenerate metadata chain
      this.metadata.targets = this.createTargetsMetadata(currentTargets);
      this.metadata.snapshot = this.createSnapshotMetadata();
      this.metadata.timestamp = this.createTimestampMetadata();

      recordPluginEvent(manifest.id, 'plugin_published', {
        target_path: targetPath,
        file_size: pluginSize,
        sha256_hash: pluginHash,
        vendor: vendor
      });

      console.log(`  ✓ Plugin published: ${targetPath}`);
      console.log(`    Size: ${pluginSize} bytes, SHA256: ${pluginHash.substring(0, 16)}...`);
      
      return {
        targetPath,
        hash: pluginHash,
        size: pluginSize
      };

    } catch (error) {
      recordPluginEvent(manifest.id, 'plugin_publish_failed', {
        error_message: error.message
      });
      throw error;
    }
  }

  /**
   * Refresh metadata (update timestamp and potentially snapshot)
   */
  async refreshMetadata() {
    console.log('🔄 Refreshing metadata...');
    
    try {
      // Always update timestamp
      this.metadata.timestamp = this.createTimestampMetadata();
      
      // Check if snapshot needs updating (if targets changed)
      const snapshotAge = Date.now() - new Date(this.metadata.snapshot.signed.expires).getTime();
      if (snapshotAge > this.expiryConfig.snapshot * 0.5) {
        this.metadata.snapshot = this.createSnapshotMetadata();
      }

      recordSecurityEvent('tuf_metadata_refreshed', 'info', {
        timestamp_version: this.metadata.timestamp.signed.version,
        snapshot_version: this.metadata.snapshot.signed.version
      });

      console.log('  ✓ Metadata refreshed');
    } catch (error) {
      recordSecurityEvent('tuf_metadata_refresh_failed', 'error', {
        error_message: error.message
      });
      throw error;
    }
  }

  /**
   * Start HTTP server for repository distribution
   */
  async startServer() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (error) => {
        recordSecurityEvent('tuf_server_error', 'error', {
          error_message: error.message,
          port: this.options.serverPort
        });
        reject(error);
      });

      this.server.listen(this.options.serverPort, this.options.serverHost, () => {
        const baseUrl = `http://${this.options.serverHost}:${this.options.serverPort}`;
        
        recordSecurityEvent('tuf_server_started', 'info', {
          base_url: baseUrl,
          repository_path: this.repoDir
        });

        console.log(`🌐 TUF Repository Server started: ${baseUrl}`);
        console.log(`📁 Serving: ${this.repoDir}`);
        console.log(`🔗 Metadata: ${baseUrl}/metadata/`);
        console.log(`🎯 Targets: ${baseUrl}/targets/`);
        
        resolve(baseUrl);
      });
    });
  }

  /**
   * Handle HTTP requests
   */
  handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // Enable CORS if configured
    if (this.options.enableCORS) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Only allow GET and HEAD
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    try {
      // Route requests
      if (pathname.startsWith('/metadata/')) {
        this.serveMetadata(pathname, res);
      } else if (pathname.startsWith('/targets/')) {
        this.serveTarget(pathname, res);
      } else if (pathname === '/') {
        this.serveRepositoryInfo(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    } catch (error) {
      console.error('Server error:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }

  /**
   * Serve metadata files
   */
  serveMetadata(pathname, res) {
    const metadataFile = pathname.replace('/metadata/', '');
    const metadataPath = path.join(this.metadataDir, metadataFile);

    if (!this.isValidPath(metadataPath, this.metadataDir)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid path');
      return;
    }

    if (fs.existsSync(metadataPath)) {
      const content = fs.readFileSync(metadataPath);
      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Content-Length': content.length
      });
      res.end(content);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Metadata not found');
    }
  }

  /**
   * Serve target files
   */
  serveTarget(pathname, res) {
    const targetFile = pathname.replace('/targets/', '');
    const targetPath = path.join(this.targetsDir, targetFile);

    if (!this.isValidPath(targetPath, this.targetsDir)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid path');
      return;
    }

    if (fs.existsSync(targetPath)) {
      const stats = fs.statSync(targetPath);
      const content = fs.readFileSync(targetPath);
      
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stats.size
      });
      res.end(content);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Target not found');
    }
  }

  /**
   * Serve repository information
   */
  serveRepositoryInfo(res) {
    const info = {
      name: 'RAGnos Vault Local TUF Repository',
      type: 'local',
      consistent_snapshot: this.options.consistentSnapshot,
      base_url: `http://${this.options.serverHost}:${this.options.serverPort}`,
      metadata_url: `http://${this.options.serverHost}:${this.options.serverPort}/metadata`,
      targets_url: `http://${this.options.serverHost}:${this.options.serverPort}/targets`,
      created: fs.statSync(this.repoDir).birthtime.toISOString(),
      last_updated: new Date().toISOString()
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(info, null, 2));
  }

  /**
   * Validate file paths to prevent directory traversal
   */
  isValidPath(requestedPath, baseDir) {
    const resolvedPath = path.resolve(requestedPath);
    const resolvedBase = path.resolve(baseDir);
    return resolvedPath.startsWith(resolvedBase);
  }

  /**
   * Stop the HTTP server
   */
  async stopServer() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          console.log('🛑 TUF Repository Server stopped');
          resolve();
        });
      });
    }
  }

  /**
   * Get repository status
   */
  getStatus() {
    return {
      repository_path: this.repoDir,
      server_running: !!this.server,
      server_url: this.server ? `http://${this.options.serverHost}:${this.options.serverPort}` : null,
      metadata_versions: {
        root: this.metadata.root?.signed.version || 0,
        targets: this.metadata.targets?.signed.version || 0,
        snapshot: this.metadata.snapshot?.signed.version || 0,
        timestamp: this.metadata.timestamp?.signed.version || 0
      },
      key_info: Object.fromEntries(
        Object.entries(this.keys).map(([role, key]) => [
          role, 
          { keyid: key.keyid, keytype: key.keytype }
        ])
      )
    };
  }
}

module.exports = { LocalTUFRepository };