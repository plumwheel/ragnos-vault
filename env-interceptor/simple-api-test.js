// Simple test to demonstrate API key interception
console.log('🧪 Simple API Key Interception Test');
console.log('===================================');

// Simulate various API key access patterns that MCP servers use
console.log('Setting test API keys...');
process.env.GEMINI_API_KEY = 'AIzaSy_test_gemini_key_12345';
process.env.OPENAI_API_KEY = 'sk-test_openai_key_67890';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test_anthropic_key_abcde';

console.log('\n🔍 Testing API key access patterns:');

// Pattern 1: Direct access (most common)
console.log('1. Direct access:');
console.log(`   GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'FOUND' : 'MISSING'}`);
console.log(`   OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'FOUND' : 'MISSING'}`);
console.log(`   ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'FOUND' : 'MISSING'}`);

// Pattern 2: Destructuring (common in modern Node.js)
console.log('\n2. Destructuring access:');
const { GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY } = process.env;
console.log(`   Destructured GEMINI: ${GEMINI_API_KEY ? 'SUCCESS' : 'FAIL'}`);
console.log(`   Destructured OPENAI: ${OPENAI_API_KEY ? 'SUCCESS' : 'FAIL'}`);
console.log(`   Destructured ANTHROPIC: ${ANTHROPIC_API_KEY ? 'SUCCESS' : 'FAIL'}`);

// Pattern 3: Configuration object (typical MCP pattern)
console.log('\n3. Configuration object pattern:');
const config = {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-pro'
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4'
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-3-sonnet'
  }
};

console.log(`   Config gemini.apiKey: ${config.gemini.apiKey ? 'LOADED' : 'EMPTY'}`);
console.log(`   Config openai.apiKey: ${config.openai.apiKey ? 'LOADED' : 'EMPTY'}`);
console.log(`   Config anthropic.apiKey: ${config.anthropic.apiKey ? 'LOADED' : 'EMPTY'}`);

// Pattern 4: Conditional access with fallbacks
console.log('\n4. Conditional access with fallbacks:');
const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || 'fallback';
const openaiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_TOKEN || 'fallback';
const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || 'fallback';

console.log(`   Gemini fallback chain: ${geminiKey !== 'fallback' ? 'FOUND' : 'FALLBACK'}`);
console.log(`   OpenAI fallback chain: ${openaiKey !== 'fallback' ? 'FOUND' : 'FALLBACK'}`);
console.log(`   Anthropic fallback chain: ${anthropicKey !== 'fallback' ? 'FOUND' : 'FALLBACK'}`);

// Pattern 5: Dynamic key access (sometimes used for multiple providers)
console.log('\n5. Dynamic key access:');
const providers = ['GEMINI', 'OPENAI', 'ANTHROPIC'];
providers.forEach(provider => {
  const keyName = `${provider}_API_KEY`;
  const keyValue = process.env[keyName];
  console.log(`   Dynamic ${provider}: ${keyValue ? 'AVAILABLE' : 'MISSING'}`);
});

console.log('\n✅ API key access pattern test complete!');
console.log('   All access patterns should be logged by vault interceptor if running under RAGnos Vault');
console.log('   This simulates how real MCP servers access their API keys');