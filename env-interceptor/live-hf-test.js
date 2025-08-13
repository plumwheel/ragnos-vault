const { spawn } = require('child_process');
const path = require('path');

console.log('🧪 RAGnos Vault + HuggingFace MCP Live Integration Test');
console.log('==================================================');

// Set up environment with test HF token
process.env.HF_TOKEN = 'hf_test_live_integration_key_12345';

const vaultConfig = {
  mode: 'dual',
  canary_percent: 50,
  debug: true
};

console.log(`🔧 Configuration:`);
console.log(`   Mode: ${vaultConfig.mode}`);
console.log(`   Canary: ${vaultConfig.canary_percent}%`);
console.log(`   HF_TOKEN set: ${process.env.HF_TOKEN ? 'YES' : 'NO'}`);
console.log('');

// Launch HuggingFace MCP with vault interception
const hfPath = '/Users/huntercanning/mouse-ops-o3/integrations/mcp-servers/huggingface-mcp-server';
const cmd = [
  'node', 'dist/ragnos-vault-exec.cjs',
  '--mode=dual', '--canary=50', '--debug',
  '--', 'uv', 'run', '--directory', hfPath, 'huggingface'
];

console.log(`🚀 Launching: ${cmd.join(' ')}`);
console.log('⏱️  Running for 15 seconds...');
console.log('');

const proc = spawn(cmd[0], cmd.slice(1), {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env }
});

let interceptCount = 0;
let vaultHits = 0;
let envFallbacks = 0;

proc.stdout.on('data', (data) => {
  const output = data.toString();
  console.log(`[MCP] ${output.trim()}`);
  
  // Count vault operations
  if (output.includes('Vault hit') || output.includes('vault access')) {
    vaultHits++;
    interceptCount++;
  }
  if (output.includes('Environment fallback') || output.includes('env access')) {
    envFallbacks++;
    interceptCount++;
  }
});

proc.stderr.on('data', (data) => {
  const output = data.toString();
  console.log(`[MCP-ERR] ${output.trim()}`);
});

// Stop after 15 seconds
setTimeout(() => {
  console.log('');
  console.log('🛑 Stopping test...');
  proc.kill('SIGTERM');
  
  setTimeout(() => {
    console.log('');
    console.log('📊 Live Test Results:');
    console.log(`   Total intercepts: ${interceptCount}`);
    console.log(`   Vault hits: ${vaultHits}`);
    console.log(`   Env fallbacks: ${envFallbacks}`);
    console.log(`   Vault hit rate: ${interceptCount > 0 ? (vaultHits/interceptCount*100).toFixed(1) : 0}%`);
    console.log('');
    console.log('✅ RAGnos Vault + HuggingFace MCP integration test complete!');
    process.exit(0);
  }, 1000);
}, 15000);

proc.on('error', (err) => {
  console.error('❌ Process error:', err.message);
});

proc.on('exit', (code, signal) => {
  if (signal !== 'SIGTERM') {
    console.log(`⚠️  Process exited with code: ${code}, signal: ${signal}`);
  }
});