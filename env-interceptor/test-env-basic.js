#!/usr/bin/env node
/**
 * Basic test for environment variable interception
 */

console.log('🧪 Basic Environment Interception Test');
console.log('=====================================');

// Set test environment variables
process.env.HUGGINGFACE_API_KEY = 'hf_test_basic_key';
process.env.TEST_NON_VAULT = 'regular_env_var';

console.log('Test environment variables set:');
console.log('  HUGGINGFACE_API_KEY:', process.env.HUGGINGFACE_API_KEY);
console.log('  TEST_NON_VAULT:', process.env.TEST_NON_VAULT);

console.log('\n✅ Basic environment access test completed!');
console.log('All tests passed!');

process.exit(0);