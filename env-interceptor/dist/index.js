// RAGnos Vault Environment Interceptor - Main Export
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
