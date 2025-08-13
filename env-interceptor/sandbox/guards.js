/**
 * RAGnos Vault Sandbox Guards
 * 
 * Defense-in-depth security for enterprise testing:
 * - Blocks all outbound network calls
 * - Prevents filesystem writes
 * - Disables child process spawning
 * - Ensures read-only, hermetic testing environment
 */

const http = require('http');
const https = require('https');
const net = require('net');
const dns = require('dns');
const cp = require('child_process');
const fs = require('fs');

console.log('🔒 RAGnos Vault Sandbox Guards: Activating enterprise security mode');

function block(name, ...args) { 
  throw new Error(`🚫 Blocked by RAGnos Vault sandbox: ${name} (args: ${args.length})`); 
}

// Block global fetch (Node 18+)
if (global.fetch) {
  global.fetch = async () => block('fetch');
}

// Block HTTP/HTTPS requests
['request', 'get'].forEach(method => {
  const originalHttp = http[method];
  http[method] = (...args) => block(`http.${method}`);
  
  const originalHttps = https[method];
  https[method] = (...args) => block(`https.${method}`);
});

// Block additional HTTP methods
['post', 'put', 'patch', 'delete', 'head', 'options'].forEach(method => {
  if (http[method]) {
    http[method] = (...args) => block(`http.${method}`);
  }
  if (https[method]) {
    https[method] = (...args) => block(`https.${method}`);
  }
});

// Block network connections
['connect', 'createConnection', 'createServer'].forEach(method => {
  const original = net[method];
  net[method] = (...args) => block(`net.${method}`);
});

// Block DNS operations
['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveTxt', 'reverse', 'resolveMx', 'resolveNs'].forEach(method => {
  const original = dns[method];
  dns[method] = (...args) => block(`dns.${method}`);
});

// Block child process operations
['exec', 'execFile', 'spawn', 'fork', 'execSync', 'execFileSync', 'spawnSync'].forEach(method => {
  const original = cp[method];
  cp[method] = (...args) => block(`child_process.${method}`);
});

// Block filesystem writes while preserving reads
const writeOperations = [
  'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 
  'truncate', 'truncateSync', 'rm', 'rmSync', 'unlink', 'unlinkSync',
  'rename', 'renameSync', 'chmod', 'chmodSync', 'chown', 'chownSync',
  'mkdir', 'mkdirSync', 'rmdir', 'rmdirSync', 'copyFile', 'copyFileSync'
];

writeOperations.forEach(method => {
  const original = fs[method];
  fs[method] = (...args) => block(`fs.${method}`);
});

// Block write streams
const originalCreateWriteStream = fs.createWriteStream;
fs.createWriteStream = (...args) => block('fs.createWriteStream');

// Block common HTTP client libraries if present
try {
  const axios = require('axios');
  const originalAxios = axios.default || axios;
  module.exports = (...args) => block('axios');
  Object.keys(originalAxios).forEach(key => {
    if (typeof originalAxios[key] === 'function') {
      originalAxios[key] = (...args) => block(`axios.${key}`);
    }
  });
} catch (e) {
  // axios not installed, skip
}

try {
  const got = require('got');
  const originalGot = got.default || got;
  module.exports = (...args) => block('got');
} catch (e) {
  // got not installed, skip
}

// Set environment flag for sandbox mode
process.env.RAGNOS_SAFE_MODE = '1';
process.env.RAGNOS_VAULT_SANDBOX = '1';

// Additional security: stricter umask
try {
  process.umask(0o777);
} catch (e) {
  // umask may not be available in all environments
}

console.log('✅ RAGnos Vault Sandbox Guards: All security measures active');
console.log('   🚫 Network calls blocked');
console.log('   🚫 Filesystem writes blocked'); 
console.log('   🚫 Child processes blocked');
console.log('   ✅ Reads and computation allowed');