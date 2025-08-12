#!/usr/bin/env node
/**
 * Secret scanning script to detect potential secret leakage
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 RAGnos Vault - Secret Scanning');
console.log('='.repeat(35));

const secretPatterns = [
  { name: 'API Keys', pattern: /[a-zA-Z0-9_-]*api[_-]?key[a-zA-Z0-9_-]*\s*[:=]\s*["'][^"']{20,}["']/gi, allowTest: true },
  { name: 'Tokens', pattern: /[a-zA-Z0-9_-]*token[a-zA-Z0-9_-]*\s*[:=]\s*["'][^"']{20,}["']/gi, allowTest: true },
  { name: 'Passwords', pattern: /[a-zA-Z0-9_-]*password[a-zA-Z0-9_-]*\s*[:=]\s*["'][^"']{8,}["']/gi, allowTest: true },
  { name: 'JWT Tokens', pattern: /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g },
  { name: 'AWS Keys', pattern: /AKIA[0-9A-Z]{16}/g },
  { name: 'GitHub Tokens', pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g }
];

const filesToScan = [
  'vault-env-preloader.js',
  'ragnos-vault-exec.js',
  'test-interceptor.js',
  'final-integration-test.js',
  'README.md',
  'package.json'
];

let totalIssues = 0;

filesToScan.forEach(filename => {
  if (!fs.existsSync(filename)) {
    console.log(`⚠️  File not found: ${filename}`);
    return;
  }

  const content = fs.readFileSync(filename, 'utf8');
  let fileIssues = 0;

  secretPatterns.forEach(({ name, pattern, allowTest }) => {
    const matches = content.match(pattern);
    if (matches) {
      // Filter out test values if allowTest is true
      const filteredMatches = allowTest ? 
        matches.filter(match => !/test|mock|fake|demo|example|integration|hf_test|sk-ant-test/i.test(match)) :
        matches;
      
      if (filteredMatches.length > 0) {
        if (fileIssues === 0) {
          console.log(`\n📄 ${filename}:`);
        }
        console.log(`  ❌ ${name}: ${filteredMatches.length} potential matches found`);
        filteredMatches.forEach(match => {
          const truncated = match.length > 50 ? match.substring(0, 50) + '...' : match;
          console.log(`     ${truncated}`);
        });
        fileIssues += filteredMatches.length;
      } else if (matches.length > 0) {
        // Report test values as informational
        console.log(`  ℹ️  ${name}: ${matches.length} test values (allowed)`);
      }
    }
  });

  if (fileIssues === 0) {
    console.log(`✅ ${filename}: Clean`);
  }

  totalIssues += fileIssues;
});

console.log('\n' + '='.repeat(35));
console.log('📊 Secret Scan Results');
console.log('='.repeat(35));

if (totalIssues === 0) {
  console.log('✅ No potential secrets detected');
  console.log('🔒 Repository is clean for commit');
  process.exit(0);
} else {
  console.log(`❌ Found ${totalIssues} potential secret(s)`);
  console.log('🚨 Review and remove secrets before committing');
  process.exit(1);
}