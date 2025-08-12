#!/usr/bin/env node
/**
 * Build script for RAGnos Vault Environment Interceptor
 * Copies source files to dist/ with proper extensions and shebangs
 */

const fs = require('fs');
const path = require('path');

console.log('🏗️  Building RAGnos Vault Environment Interceptor...');

// Ensure dist directory exists
if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist', { recursive: true });
}

// Build vault-env-preloader.cjs
console.log('📦 Building vault-env-preloader.cjs');
const preloaderContent = fs.readFileSync('vault-env-preloader.js', 'utf8');
fs.writeFileSync('dist/vault-env-preloader.cjs', preloaderContent);

// Build ragnos-vault-exec.cjs with shebang
console.log('📦 Building ragnos-vault-exec.cjs');
const cliContent = fs.readFileSync('ragnos-vault-exec.js', 'utf8');
const cliWithShebang = cliContent.startsWith('#!') ? cliContent : '#!/usr/bin/env node\n' + cliContent;
fs.writeFileSync('dist/ragnos-vault-exec.cjs', cliWithShebang);

// Make CLI executable
fs.chmodSync('dist/ragnos-vault-exec.cjs', 0o755);

// Build main index.js export
console.log('📦 Building index.js');
const indexContent = `// RAGnos Vault Environment Interceptor - Main Export
const { VaultEnvPreloader } = require('./vault-env-preloader.cjs');
const path = require('path');

/**
 * Get preloader flags for use with Node.js
 * @returns {string[]} Array of flags to pass to node
 */
function getPreloadFlags() {
  const preloaderPath = path.resolve(__dirname, 'vault-env-preloader.cjs');
  return ['-r', preloaderPath];
}

/**
 * Get CLI path for spawning processes
 * @returns {string} Path to ragnos-vault CLI
 */
function getCLIPath() {
  return path.resolve(__dirname, 'ragnos-vault-exec.cjs');
}

module.exports = {
  getPreloadFlags,
  getCLIPath,
  VaultEnvPreloader
};
`;
fs.writeFileSync('dist/index.js', indexContent);

console.log('✅ Build complete!');
console.log('📁 Generated files:');
console.log('  - dist/vault-env-preloader.cjs');
console.log('  - dist/ragnos-vault-exec.cjs');
console.log('  - dist/index.js');