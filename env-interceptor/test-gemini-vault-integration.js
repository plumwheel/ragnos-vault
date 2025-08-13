const { spawn } = require('child_process');
const path = require('path');

console.log('🧪 RAGnos Vault + Gemini MCP Live Integration Test');
console.log('=================================================');

// Set up environment with test Gemini API key  
process.env.GEMINI_API_KEY = 'AIzaSy_test_gemini_vault_integration_key_12345';

const vaultConfig = {
  mode: 'dual',
  canary_percent: 50,
  debug: true
};

console.log(`🔧 Configuration:`);
console.log(`   Mode: ${vaultConfig.mode}`);
console.log(`   Canary: ${vaultConfig.canary_percent}%`);
console.log(`   GEMINI_API_KEY set: ${process.env.GEMINI_API_KEY ? 'YES' : 'NO'}`);
console.log(`   Key preview: ${process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 12) + '...' : 'N/A'}`);
console.log('');

// Launch Gemini MCP with vault interception
const geminiPath = '/Users/huntercanning/mouse-ops-o3/integrations/mcp-servers/gemini-mcp';
const cmd = [
  'node', 'dist/ragnos-vault-exec.cjs',
  '--mode=dual', '--canary=50', '--debug',
  '--', 'node', 'dist/index.js'
];

console.log(`🚀 Launching: ${cmd.join(' ')}`);
console.log(`📁 Working directory: ${geminiPath}`);
console.log('⏱️  Running for 20 seconds...');
console.log('');

const proc = spawn(cmd[0], cmd.slice(1), {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env },
  cwd: geminiPath
});

let interceptCount = 0;
let vaultHits = 0;
let envFallbacks = 0;
let mcopLines = 0;

proc.stdout.on('data', (data) => {
  const output = data.toString();
  const lines = output.split('\n').filter(line => line.trim());
  
  lines.forEach(line => {
    console.log(`[MCP] ${line}`);
    mcopLines++;
    
    // Count vault operations from debug output
    if (line.includes('Vault hit') || line.includes('vault access')) {
      vaultHits++;
      interceptCount++;
    }
    if (line.includes('Environment fallback') || line.includes('env access')) {
      envFallbacks++;
      interceptCount++;
    }
    
    // Look for MCP protocol messages
    if (line.includes('initialized') || line.includes('MCP') || line.includes('tools')) {
      console.log(`   📡 MCP Protocol: ${line}`);
    }
  });
});

proc.stderr.on('data', (data) => {
  const output = data.toString();
  const lines = output.split('\n').filter(line => line.trim());
  lines.forEach(line => {
    console.log(`[MCP-ERR] ${line}`);
  });
});

// Monitor live stats every 5 seconds
const statsInterval = setInterval(() => {
  const runtime = Math.floor((Date.now() - startTime) / 1000);
  console.log(`\n📊 Live Stats (${runtime}s runtime):`);
  console.log(`   MCP Output Lines: ${mcopLines}`);
  console.log(`   Vault Intercepts: ${interceptCount}`);
  console.log(`   Vault Hits: ${vaultHits}`);
  console.log(`   Env Fallbacks: ${envFallbacks}`);
  console.log(`   Hit Rate: ${interceptCount > 0 ? (vaultHits/interceptCount*100).toFixed(1) : 0}%`);
  console.log(`   Target Canary: 50%\n`);
}, 5000);

const startTime = Date.now();

// Stop after 20 seconds
setTimeout(() => {
  clearInterval(statsInterval);
  console.log('');
  console.log('🛑 Stopping test...');
  proc.kill('SIGTERM');
  
  setTimeout(() => {
    const totalRuntime = Math.floor((Date.now() - startTime) / 1000);
    console.log('');
    console.log('📊 Final Test Results:');
    console.log(`   Runtime: ${totalRuntime}s`);
    console.log(`   MCP Output Lines: ${mcopLines}`);
    console.log(`   Total intercepts: ${interceptCount}`);
    console.log(`   Vault hits: ${vaultHits}`);
    console.log(`   Env fallbacks: ${envFallbacks}`);
    console.log(`   Vault hit rate: ${interceptCount > 0 ? (vaultHits/interceptCount*100).toFixed(1) : 0}%`);
    console.log(`   Target: 50% canary`);
    console.log('');
    
    // Assessment
    if (mcopLines > 0) {
      console.log('✅ Gemini MCP server started successfully');
    } else {
      console.log('⚠️  Gemini MCP server may not have started properly');
    }
    
    if (interceptCount > 0) {
      console.log('✅ Vault interception system detected API key access');
      if (Math.abs((vaultHits/interceptCount*100) - 50) < 20) {
        console.log('✅ Canary percentage within acceptable range');
      } else {
        console.log('⚠️  Canary percentage outside target range');
      }
    } else {
      console.log('⚠️  No vault interceptions detected (may indicate no API key access during test)');
    }
    
    console.log('');
    console.log('🎯 RAGnos Vault + Gemini MCP integration test complete!');
    process.exit(0);
  }, 1000);
}, 20000);

proc.on('error', (err) => {
  console.error('❌ Process error:', err.message);
});

proc.on('exit', (code, signal) => {
  if (signal !== 'SIGTERM') {
    console.log(`⚠️  Process exited with code: ${code}, signal: ${signal}`);
  }
});