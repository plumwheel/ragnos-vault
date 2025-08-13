// Test script to validate HF_TOKEN access with vault interception
console.log('🧪 Testing HF_TOKEN access with RAGnos Vault');
console.log('===========================================');

// This should be intercepted by the vault system
console.log('1. Setting up environment...');
process.env.HF_TOKEN = 'hf_env_baseline_test_key';

console.log('2. Testing direct environment access:');
console.log(`   HF_TOKEN: ${process.env.HF_TOKEN ? 'PRESENT' : 'MISSING'}`);
console.log(`   Length: ${process.env.HF_TOKEN ? process.env.HF_TOKEN.length : 0} chars`);

console.log('3. Testing multiple access patterns:');
// Simulate how the HuggingFace MCP server accesses tokens
const methods = [
  () => process.env.HF_TOKEN,
  () => process.env['HF_TOKEN'],
  () => Object.assign({}, process.env).HF_TOKEN,
  () => ({ ...process.env }).HF_TOKEN
];

methods.forEach((method, i) => {
  try {
    const result = method();
    console.log(`   Method ${i+1}: ${result ? 'SUCCESS' : 'FAIL'} (${result ? result.substring(0,8) + '...' : 'null'})`);
  } catch (e) {
    console.log(`   Method ${i+1}: ERROR - ${e.message}`);
  }
});

console.log('4. Simulating HuggingFace Hub authentication...');
try {
  // This is how huggingface_hub typically accesses the token
  const token = process.env.HF_TOKEN || process.env.HUGGINGFACE_HUB_TOKEN;
  console.log(`   Auth token: ${token ? 'FOUND' : 'NOT_FOUND'}`);
  if (token) {
    console.log(`   Token prefix: ${token.substring(0, 3)}...`);
    console.log(`   Token suffix: ...${token.substring(token.length - 3)}`);
  }
} catch (e) {
  console.error(`   Auth error: ${e.message}`);
}

console.log('');
console.log('✅ HF_TOKEN access test complete!');
console.log('   All accesses should be logged by vault interceptor if running under RAGnos Vault');