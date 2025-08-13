#!/usr/bin/env node
/**
 * RAGnos Vault Local TUF Repository CLI
 * 
 * Command-line interface for managing local TUF repositories
 * Production-ready tool for enterprise plugin distribution
 */

const { LocalTUFRepository } = require('./src/local-tuf-repository');
const fs = require('fs');
const path = require('path');

class LocalTUFCLI {
  constructor() {
    this.repository = null;
  }

  async run() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command) {
      this.showHelp();
      return;
    }

    try {
      switch (command) {
        case 'init':
          await this.handleInit(args.slice(1));
          break;
        case 'publish':
          await this.handlePublish(args.slice(1));
          break;
        case 'serve':
          await this.handleServe(args.slice(1));
          break;
        case 'refresh':
          await this.handleRefresh(args.slice(1));
          break;
        case 'status':
          await this.handleStatus(args.slice(1));
          break;
        case 'list':
          await this.handleList(args.slice(1));
          break;
        case 'help':
          this.showHelp();
          break;
        default:
          console.error(`❌ Unknown command: ${command}`);
          this.showHelp();
          process.exit(1);
      }
    } catch (error) {
      console.error(`❌ Command failed: ${error.message}`);
      console.error(error.stack);
      process.exit(1);
    }
  }

  /**
   * Initialize a new local TUF repository
   */
  async handleInit(args) {
    const options = this.parseInitOptions(args);
    
    console.log('🚀 Initializing Local TUF Repository');
    console.log('=' .repeat(50));
    
    this.repository = new LocalTUFRepository(options);
    await this.repository.initialize();
    
    console.log('\n✅ Repository initialized successfully!');
    console.log(`📁 Repository: ${this.repository.repoDir}`);
    console.log('📋 Next steps:');
    console.log('  1. Start server: local-tuf-cli serve');
    console.log('  2. Publish plugins: local-tuf-cli publish <plugin-path> <manifest-path>');
    console.log('  3. Check status: local-tuf-cli status');
  }

  /**
   * Publish a plugin to the repository
   */
  async handlePublish(args) {
    if (args.length < 2) {
      console.error('❌ Usage: local-tuf-cli publish <plugin-path> <manifest-path>');
      process.exit(1);
    }

    const [pluginPath, manifestPath] = args;
    const options = this.parsePublishOptions(args.slice(2));

    // Load repository and initialize if needed
    this.repository = new LocalTUFRepository(options);
    
    // Check if repository exists, if not suggest initialization
    if (!fs.existsSync(this.repository.keysDir)) {
      throw new Error(`Repository not found at ${this.repository.repoDir}. Run 'local-tuf-cli init' first.`);
    }
    
    // Load existing keys and metadata
    await this.repository.generateOrLoadKeys();
    
    // Load existing metadata if it exists
    const metadataFiles = ['root', 'targets', 'snapshot', 'timestamp'];
    for (const role of metadataFiles) {
      const metadataFile = path.join(this.repository.metadataDir, `${role}.json`);
      if (fs.existsSync(metadataFile)) {
        this.repository.metadata[role] = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
      }
    }
    
    // Load manifest
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Manifest file not found: ${manifestPath}`);
    }
    
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    
    console.log(`📦 Publishing plugin: ${manifest.id}`);
    
    const result = await this.repository.publishPlugin(pluginPath, manifest);
    
    console.log('✅ Plugin published successfully!');
    console.log(`🎯 Target path: ${result.targetPath}`);
    console.log(`🔍 SHA256: ${result.hash}`);
    console.log(`📏 Size: ${result.size} bytes`);
  }

  /**
   * Start the repository HTTP server
   */
  async handleServe(args) {
    const options = this.parseServeOptions(args);
    
    this.repository = new LocalTUFRepository(options);
    
    console.log('🌐 Starting Local TUF Repository Server...');
    
    const baseUrl = await this.repository.startServer();
    
    console.log('✅ Server started successfully!');
    console.log('\n📋 Repository URLs:');
    console.log(`  Base: ${baseUrl}`);
    console.log(`  Metadata: ${baseUrl}/metadata/`);
    console.log(`  Targets: ${baseUrl}/targets/`);
    
    console.log('\n🔧 Test commands:');
    console.log(`  curl ${baseUrl}/`);
    console.log(`  curl ${baseUrl}/metadata/root.json`);
    console.log(`  curl ${baseUrl}/metadata/timestamp.json`);
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down server...');
      await this.repository.stopServer();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n🛑 Shutting down server...');
      await this.repository.stopServer();
      process.exit(0);
    });

    // Keep server running
    console.log('\n🎯 Server running - Press Ctrl+C to stop');
  }

  /**
   * Refresh repository metadata
   */
  async handleRefresh(args) {
    const options = this.parseRefreshOptions(args);
    
    this.repository = new LocalTUFRepository(options);
    
    console.log('🔄 Refreshing repository metadata...');
    
    await this.repository.refreshMetadata();
    
    console.log('✅ Metadata refreshed successfully!');
  }

  /**
   * Show repository status
   */
  async handleStatus(args) {
    const options = this.parseStatusOptions(args);
    
    this.repository = new LocalTUFRepository(options);
    
    const status = this.repository.getStatus();
    
    console.log('📊 Local TUF Repository Status');
    console.log('=' .repeat(40));
    console.log(`📁 Repository: ${status.repository_path}`);
    console.log(`🌐 Server: ${status.server_running ? '🟢 Running' : '🔴 Stopped'}`);
    if (status.server_url) {
      console.log(`🔗 URL: ${status.server_url}`);
    }
    
    console.log('\n📋 Metadata Versions:');
    Object.entries(status.metadata_versions).forEach(([role, version]) => {
      console.log(`  ${role}: v${version}`);
    });
    
    console.log('\n🔑 Keys:');
    Object.entries(status.key_info).forEach(([role, info]) => {
      console.log(`  ${role}: ${info.keyid.substring(0, 8)}... (${info.keytype})`);
    });
  }

  /**
   * List plugins in repository
   */
  async handleList(args) {
    const options = this.parseListOptions(args);
    
    this.repository = new LocalTUFRepository(options);
    
    // Load targets metadata
    const targetsFile = path.join(this.repository.metadataDir, 'targets.json');
    if (!fs.existsSync(targetsFile)) {
      console.log('📭 No plugins found (empty repository)');
      return;
    }

    const targetsData = JSON.parse(fs.readFileSync(targetsFile, 'utf8'));
    const targets = targetsData.signed.targets;
    
    if (Object.keys(targets).length === 0) {
      console.log('📭 No plugins found');
      return;
    }

    console.log('📦 Published Plugins');
    console.log('=' .repeat(40));
    
    Object.entries(targets).forEach(([path, info]) => {
      const manifest = info.custom?.manifest;
      const published = info.custom?.published;
      
      console.log(`\n🔸 ${path}`);
      if (manifest) {
        console.log(`  ID: ${manifest.id}`);
        console.log(`  Name: ${manifest.displayName || 'N/A'}`);
        console.log(`  Vendor: ${manifest.vendor || 'N/A'}`);
      }
      console.log(`  Size: ${info.length} bytes`);
      console.log(`  SHA256: ${info.hashes.sha256.substring(0, 16)}...`);
      if (published) {
        console.log(`  Published: ${published}`);
      }
    });
  }

  /**
   * Parse initialization options
   */
  parseInitOptions(args) {
    const options = {};
    
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i];
      const value = args[i + 1];
      
      switch (flag) {
        case '--repo-dir':
          options.repoDir = value;
          break;
        case '--key-bits':
          options.keyBits = parseInt(value);
          break;
        case '--no-consistent-snapshot':
          options.consistentSnapshot = false;
          i--; // No value for this flag
          break;
      }
    }
    
    return options;
  }

  /**
   * Parse publish options  
   */
  parsePublishOptions(args) {
    const options = {};
    
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i];
      const value = args[i + 1];
      
      switch (flag) {
        case '--repo-dir':
          options.repoDir = value;
          break;
      }
    }
    
    return options;
  }

  /**
   * Parse serve options
   */
  parseServeOptions(args) {
    const options = {};
    
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i];
      const value = args[i + 1];
      
      switch (flag) {
        case '--repo-dir':
          options.repoDir = value;
          break;
        case '--port':
          options.serverPort = parseInt(value);
          break;
        case '--host':
          options.serverHost = value;
          break;
        case '--no-cors':
          options.enableCORS = false;
          i--; // No value for this flag
          break;
      }
    }
    
    return options;
  }

  /**
   * Parse refresh options
   */
  parseRefreshOptions(args) {
    const options = {};
    
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i];
      const value = args[i + 1];
      
      switch (flag) {
        case '--repo-dir':
          options.repoDir = value;
          break;
      }
    }
    
    return options;
  }

  /**
   * Parse status options
   */
  parseStatusOptions(args) {
    const options = {};
    
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i];
      const value = args[i + 1];
      
      switch (flag) {
        case '--repo-dir':
          options.repoDir = value;
          break;
      }
    }
    
    return options;
  }

  /**
   * Parse list options
   */
  parseListOptions(args) {
    const options = {};
    
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i];
      const value = args[i + 1];
      
      switch (flag) {
        case '--repo-dir':
          options.repoDir = value;
          break;
      }
    }
    
    return options;
  }

  /**
   * Show help message
   */
  showHelp() {
    console.log(`
🚀 RAGnos Vault Local TUF Repository CLI

USAGE:
  local-tuf-cli <command> [options]

COMMANDS:
  init                      Initialize a new TUF repository
  publish <plugin> <manifest>  Publish a plugin to the repository  
  serve                     Start HTTP server for repository
  refresh                   Refresh metadata (timestamp/snapshot)
  status                    Show repository status
  list                      List published plugins
  help                      Show this help message

INIT OPTIONS:
  --repo-dir <path>         Repository directory (default: tuf-local)
  --key-bits <bits>         RSA key size (default: 2048)
  --no-consistent-snapshot  Disable consistent snapshot

SERVE OPTIONS:
  --repo-dir <path>         Repository directory (default: tuf-local)
  --port <port>             Server port (default: 8080)
  --host <host>             Server host (default: localhost)
  --no-cors                 Disable CORS headers

EXAMPLES:
  # Initialize new repository
  local-tuf-cli init --repo-dir ./my-repo --key-bits 3072

  # Publish a plugin
  local-tuf-cli publish ./plugin.tar.gz ./manifest.json

  # Start server on custom port
  local-tuf-cli serve --port 9000 --host 0.0.0.0

  # Check repository status
  local-tuf-cli status --repo-dir ./my-repo

  # List all plugins
  local-tuf-cli list

SECURITY:
  - Keys are stored locally in <repo>/keys/
  - RSA-PSS-SHA256 signatures for production security
  - Proper TUF metadata chain validation
  - Consistent snapshot support for rollback protection

For more information: https://docs.ragnos.io/local-tuf
`);
  }
}

if (require.main === module) {
  const cli = new LocalTUFCLI();
  cli.run().catch(error => {
    console.error('❌ CLI Error:', error.message);
    process.exit(1);
  });
}

module.exports = { LocalTUFCLI };