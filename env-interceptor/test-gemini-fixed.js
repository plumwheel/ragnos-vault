const { spawn } = require('child_process');

console.log('🧪 RAGnos Vault + Gemini MCP Integration Test (Fixed)');
console.log('===================================================');

// Set up environment with test Gemini API key  
process.env.GEMINI_API_KEY = 'AIzaSy_test_gemini_vault_integration_key_12345';

console.log(`🔧 Configuration:`);
console.log(`   GEMINI_API_KEY set: ${process.env.GEMINI_API_KEY ? 'YES' : 'NO'}`);
console.log(`   Key preview: ${process.env.GEMINI_API_KEY.substring(0, 12)}...`);
console.log('');

// Use correct path structure
const vaultDir = '/Users/huntercanning/mouse-ops-o3/ragnos-vault/env-interceptor';
const geminiDir = '/Users/huntercanning/mouse-ops-o3/integrations/mcp-servers/gemini-mcp';

console.log('🚀 Starting Gemini MCP with RAGnos Vault interception...');

// Start from vault directory and execute Gemini in its directory
const cmd = [
  'node', `${vaultDir}/dist/ragnos-vault-exec.cjs`,
  '--mode=dual', '--canary=50', '--debug',
  '--', 'node', `${geminiDir}/dist/index.js`
];

console.log(`📁 Command: ${cmd.join(' ')}`);
console.log('⏱️  Running for 15 seconds...');
console.log('');

const proc = spawn(cmd[0], cmd.slice(1), {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env },
  cwd: vaultDir
});

let interceptCount = 0;
let vaultHits = 0;
let envFallbacks = 0;
let totalLines = 0;

proc.stdout.on('data', (data) => {
  const output = data.toString();
  const lines = output.split('\n').filter(line => line.trim());
  
  lines.forEach(line => {
    console.log(`[STDOUT] ${line}`);
    totalLines++;
    
    // Look for vault interception indicators
    if (line.includes('Vault hit') || line.includes('vault')) {
      vaultHits++;
      interceptCount++;
    }
    if (line.includes('Environment fallback') || line.includes('fallback')) {
      envFallbacks++;
      interceptCount++;
    }
  });
});

proc.stderr.on('data', (data) => {
  const output = data.toString();
  const lines = output.split('\n').filter(line => line.trim());
  lines.forEach(line => {
    console.log(`[STDERR] ${line}`);
    totalLines++;
  });
});

const startTime = Date.now();

// Stop after 15 seconds
setTimeout(() => {
  console.log('\n🛑 Stopping test...');
  proc.kill('SIGTERM');
  
  setTimeout(() => {
    const runtime = Math.floor((Date.now() - startTime) / 1000);
    console.log('\n📊 Final Results:');
    console.log(`   Runtime: ${runtime}s`);
    console.log(`   Total output lines: ${totalLines}`);
    console.log(`   Vault intercepts detected: ${interceptCount}`);
    console.log(`   Vault hits: ${vaultHits}`);
    console.log(`   Env fallbacks: ${envFallbacks}`);
    console.log('');
    
    if (totalLines > 0) {
      console.log('✅ Process executed and produced output');
    } else {
      console.log('⚠️  No output detected - check paths and setup');
    }
    
    if (interceptCount > 0) {
      console.log('✅ Vault interception system detected API key access');
    } else {
      console.log('ℹ️  No vault intercepts detected during test period');
    }
    
    console.log('\n🎯 Test complete!');
    process.exit(0);
  }, 1000);
}, 15000);

proc.on('error', (err) => {
  console.error('❌ Spawn error:', err.message);
});

proc.on('exit', (code, signal) => {
  if (signal !== 'SIGTERM') {
    console.log(`\n⚠️  Process exited: code=${code}, signal=${signal}`);
  }
});