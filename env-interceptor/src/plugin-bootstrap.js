#!/usr/bin/env node

/**
 * RAGnos Vault Plugin Bootstrap
 * 
 * Securely loads and initializes SDK plugins in the sandbox environment.
 * This script runs inside the subprocess and sets up the plugin runtime.
 */

const fs = require('fs');
const path = require('path');
// Use local path to find plugin-abi since it's copied to the same directory
const { PluginRunner, RagVaultPlugin } = require('./plugin-abi');

// Security: Disable dangerous Node.js features
process.removeAllListeners('warning');
process.on('warning', () => {}); // Suppress warnings

// Disable eval and similar dangerous functions
global.eval = () => { throw new Error('eval() disabled in sandbox'); };
global.Function = class extends Function {
  constructor() {
    throw new Error('Function constructor disabled in sandbox');
  }
};

// Override require to restrict module loading
const originalRequire = require;
const moduleWhitelist = new Set([
  'fs', 'path', 'crypto', 'util', 'events', 'stream',
  'url', 'querystring', 'buffer', 'string_decoder',
  'timers', 'assert', 'os' // Safe core modules
]);

global.require = function secureRequire(moduleName) {
  // Allow relative requires within plugin directory
  if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
    return originalRequire(moduleName);
  }
  
  // Check whitelist for core modules
  if (moduleWhitelist.has(moduleName)) {
    return originalRequire(moduleName);
  }
  
  // Allow plugin's own dependencies (within node_modules)
  if (moduleName.includes('node_modules') || !moduleName.startsWith('/')) {
    try {
      return originalRequire(moduleName);
    } catch (error) {
      throw new Error(`Module '${moduleName}' not found or not allowed in sandbox`);
    }
  }
  
  throw new Error(`Module '${moduleName}' not allowed in sandbox`);
};

// Security: Restrict filesystem access
const originalExistsSync = fs.existsSync;
const originalReadFileSync = fs.readFileSync;
const originalWriteFileSync = fs.writeFileSync;

const allowedPaths = [
  process.env.RAGVAULT_WORKSPACE || '',
  process.env.RAGVAULT_PLUGIN_DIR || '',
  process.cwd(),
  __dirname
];

function isPathAllowed(filePath) {
  const resolvedPath = path.resolve(filePath);
  return allowedPaths.some(allowed => 
    resolvedPath.startsWith(path.resolve(allowed))
  );
}

fs.existsSync = function(filePath) {
  if (!isPathAllowed(filePath)) {
    return false;
  }
  return originalExistsSync(filePath);
};

fs.readFileSync = function(filePath, options) {
  if (!isPathAllowed(filePath)) {
    throw new Error(`Filesystem access denied: ${filePath}`);
  }
  return originalReadFileSync(filePath, options);
};

fs.writeFileSync = function(filePath, data, options) {
  if (!isPathAllowed(filePath)) {
    throw new Error(`Filesystem write denied: ${filePath}`);
  }
  return originalWriteFileSync(filePath, data, options);
};

// Security: Restrict network access (basic)
const originalRequest = require('http').request;
const originalHttpsRequest = require('https').request;

function createNetworkWrapper(originalFn, protocol) {
  return function(options, callback) {
    // Check if network capability has been granted
    if (!global.networkCapabilityGranted) {
      const error = new Error(`Network access denied: ${protocol} requests require capability grant`);
      if (callback) {
        callback(error);
        return;
      }
      throw error;
    }
    
    return originalFn(options, callback);
  };
}

require('http').request = createNetworkWrapper(originalRequest, 'HTTP');
require('https').request = createNetworkWrapper(originalHttpsRequest, 'HTTPS');

/**
 * Main bootstrap function
 */
async function bootstrap() {
  try {
    // Get plugin path from command line args
    const pluginPath = process.argv[2];
    if (!pluginPath) {
      throw new Error('Plugin path required');
    }


    // Verify plugin file exists
    if (!fs.existsSync(pluginPath)) {
      throw new Error(`Plugin file not found: ${pluginPath}`);
    }

    // Load plugin manifest to get entry point
    const pluginDir = path.dirname(pluginPath);
    const packageJsonPath = path.join(pluginDir, 'package.json');
    
    let entryPoint = pluginPath;
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (packageJson.main) {
        entryPoint = path.resolve(pluginDir, packageJson.main);
      }
    }

    // Security check: Verify entry point is within plugin directory
    if (!entryPoint.startsWith(path.resolve(pluginDir))) {
      throw new Error('Plugin entry point outside plugin directory');
    }

    // Load the plugin class
    const PluginClass = require(entryPoint);
    
    // Validate plugin class
    if (typeof PluginClass !== 'function') {
      throw new Error('Plugin must export a class constructor');
    }

    // Check if plugin extends RagVaultPlugin
    const pluginInstance = new PluginClass();
    if (!(pluginInstance instanceof RagVaultPlugin)) {
      console.warn('Plugin does not extend RagVaultPlugin - compatibility not guaranteed');
    }

    // Start plugin runtime
    await PluginRunner.run(PluginClass, {
      workspace: process.env.RAGVAULT_WORKSPACE,
      pluginId: process.env.RAGVAULT_PLUGIN_ID,
      abiVersion: process.env.RAGVAULT_ABI_VERSION
    });

  } catch (error) {
    console.error('Plugin bootstrap failed:', error.message);
    process.exit(1);
  }
}

// Handle process signals gracefully
process.on('SIGTERM', () => {
  console.log('Plugin received SIGTERM, shutting down...');
  if (global.pluginInstance) {
    global.pluginInstance.shutdown().then(() => {
      process.exit(0);
    }).catch(() => {
      process.exit(1);
    });
  } else {
    process.exit(0);
  }
});

process.on('SIGINT', () => {
  console.log('Plugin received SIGINT, shutting down...');
  process.exit(0);
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in plugin:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection in plugin:', reason);
  console.error('Promise:', promise);
  process.exit(1);
});

// Start bootstrap
if (require.main === module) {
  bootstrap();
}

module.exports = { bootstrap };