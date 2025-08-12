#!/usr/bin/env node
/**
 * Performance Benchmarking Test Suite
 * 
 * Tests performance impact of vault interception system
 * Validates that overhead is minimal and within budget constraints
 */

const { spawn } = require('child_process');
const fs = require('fs');

class PerformanceBenchmarkSuite {
  constructor() {
    this.results = [];
    this.performanceBudgets = {
      // Performance budgets (maximum acceptable overhead)
      single_access_ms: 5,      // Max 5ms overhead per access
      batch_access_ms: 100,     // Max 100ms for 100 accesses  
      memory_overhead_mb: 10,   // Max 10MB additional memory
      startup_overhead_ms: 200  // Max 200ms additional startup time
    };
  }

  async runTest(name, testFn) {
    console.log(`\n⚡ ${name}`);
    console.log('='.repeat(name.length + 3));
    
    try {
      const result = await testFn();
      console.log(`✅ ${name} PASSED`);
      this.results.push({ name, status: 'passed', result });
      return result;
    } catch (error) {
      console.log(`❌ ${name} FAILED: ${error.message}`);
      this.results.push({ name, status: 'failed', error: error.message });
      return null;
    }
  }

  async testSingleAccessPerformance() {
    return await this.runTest(
      'Single Access Performance',
      async () => {
        const result = await this.runCommand(process.execPath, [
          '-r', './dist/vault-env-preloader.cjs',
          '-e', `
            const startTime = process.hrtime.bigint();
            
            // Single access test
            const key = process.env.HUGGINGFACE_API_KEY;
            
            const endTime = process.hrtime.bigint();
            const durationNs = endTime - startTime;
            const durationMs = Number(durationNs) / 1000000;
            
            console.log('PERF_SINGLE_ACCESS_MS:' + durationMs.toFixed(4));
            process.exit(0);
          `
        ], { env: { HUGGINGFACE_API_KEY: 'hf_perf_test_key' } });
        
        const perfMatch = result.stdout.match(/PERF_SINGLE_ACCESS_MS:([0-9.]+)/);
        if (!perfMatch) {
          throw new Error('Performance metrics not captured');
        }
        
        const accessTimeMs = parseFloat(perfMatch[1]);
        console.log(`  Single access time: ${accessTimeMs}ms`);
        
        if (accessTimeMs > this.performanceBudgets.single_access_ms) {
          throw new Error(`Single access too slow: ${accessTimeMs}ms > ${this.performanceBudgets.single_access_ms}ms budget`);
        }
        
        return { access_time_ms: accessTimeMs, within_budget: true };
      }
    );
  }

  async testBatchAccessPerformance() {
    return await this.runTest(
      'Batch Access Performance',
      async () => {
        const result = await this.runCommand(process.execPath, [
          '-r', './dist/vault-env-preloader.cjs',
          '-e', `
            const startTime = process.hrtime.bigint();
            
            // Batch access test (100 accesses)
            for (let i = 0; i < 100; i++) {
              const key1 = process.env.HUGGINGFACE_API_KEY;
              const key2 = process.env.ANTHROPIC_API_KEY;
              const key3 = process.env.OPENAI_API_KEY;
            }
            
            const endTime = process.hrtime.bigint();
            const durationNs = endTime - startTime;
            const durationMs = Number(durationNs) / 1000000;
            
            console.log('PERF_BATCH_ACCESS_MS:' + durationMs.toFixed(4));
            console.log('PERF_AVG_ACCESS_MS:' + (durationMs / 300).toFixed(4)); // 300 total accesses
            process.exit(0);
          `
        ], { 
          env: { 
            HUGGINGFACE_API_KEY: 'hf_perf_batch_key',
            ANTHROPIC_API_KEY: 'sk-ant-batch-key',
            OPENAI_API_KEY: 'sk-proj-batch-key'
          } 
        });
        
        const batchMatch = result.stdout.match(/PERF_BATCH_ACCESS_MS:([0-9.]+)/);
        const avgMatch = result.stdout.match(/PERF_AVG_ACCESS_MS:([0-9.]+)/);
        
        if (!batchMatch || !avgMatch) {
          throw new Error('Batch performance metrics not captured');
        }
        
        const batchTimeMs = parseFloat(batchMatch[1]);
        const avgTimeMs = parseFloat(avgMatch[1]);
        
        console.log(`  Batch time (300 accesses): ${batchTimeMs}ms`);
        console.log(`  Average per access: ${avgTimeMs}ms`);
        
        if (batchTimeMs > this.performanceBudgets.batch_access_ms) {
          throw new Error(`Batch access too slow: ${batchTimeMs}ms > ${this.performanceBudgets.batch_access_ms}ms budget`);
        }
        
        return { 
          batch_time_ms: batchTimeMs, 
          avg_access_ms: avgTimeMs,
          within_budget: true
        };
      }
    );
  }

  async testMemoryOverhead() {
    return await this.runTest(
      'Memory Overhead Analysis',
      async () => {
        // Test memory usage without vault
        const baselineResult = await this.runCommand(process.execPath, [
          '-e', `
            // Baseline memory usage
            const baseline = process.memoryUsage();
            console.log('BASELINE_RSS_MB:' + (baseline.rss / 1024 / 1024).toFixed(2));
            process.exit(0);
          `
        ]);
        
        // Test memory usage with vault
        const vaultResult = await this.runCommand(process.execPath, [
          '-r', './dist/vault-env-preloader.cjs',
          '-e', `
            // Vault interceptor memory usage
            const vaultMem = process.memoryUsage();
            console.log('VAULT_RSS_MB:' + (vaultMem.rss / 1024 / 1024).toFixed(2));
            process.exit(0);
          `
        ], { env: { HUGGINGFACE_API_KEY: 'hf_memory_test_key' } });
        
        const baselineMatch = baselineResult.stdout.match(/BASELINE_RSS_MB:([0-9.]+)/);
        const vaultMatch = vaultResult.stdout.match(/VAULT_RSS_MB:([0-9.]+)/);
        
        if (!baselineMatch || !vaultMatch) {
          throw new Error('Memory metrics not captured');
        }
        
        const baselineMB = parseFloat(baselineMatch[1]);
        const vaultMB = parseFloat(vaultMatch[1]);
        const overheadMB = vaultMB - baselineMB;
        
        console.log(`  Baseline memory: ${baselineMB}MB`);
        console.log(`  Vault memory: ${vaultMB}MB`);
        console.log(`  Memory overhead: ${overheadMB}MB`);
        
        if (overheadMB > this.performanceBudgets.memory_overhead_mb) {
          throw new Error(`Memory overhead too high: ${overheadMB}MB > ${this.performanceBudgets.memory_overhead_mb}MB budget`);
        }
        
        return { 
          baseline_mb: baselineMB,
          vault_mb: vaultMB,
          overhead_mb: overheadMB,
          within_budget: true
        };
      }
    );
  }

  async testStartupOverhead() {
    return await this.runTest(
      'Startup Time Overhead',
      async () => {
        // Test startup time without vault
        const baselineStart = Date.now();
        await this.runCommand(process.execPath, [
          '-e', `
            console.log('STARTUP_COMPLETE');
            process.exit(0);
          `
        ]);
        const baselineTime = Date.now() - baselineStart;
        
        // Test startup time with vault
        const vaultStart = Date.now();
        await this.runCommand(process.execPath, [
          '-r', './dist/vault-env-preloader.cjs',
          '-e', `
            console.log('VAULT_STARTUP_COMPLETE');
            process.exit(0);
          `
        ], { env: { HUGGINGFACE_API_KEY: 'hf_startup_test_key' } });
        const vaultTime = Date.now() - vaultStart;
        
        const overheadMs = vaultTime - baselineTime;
        
        console.log(`  Baseline startup: ${baselineTime}ms`);
        console.log(`  Vault startup: ${vaultTime}ms`);
        console.log(`  Startup overhead: ${overheadMs}ms`);
        
        if (overheadMs > this.performanceBudgets.startup_overhead_ms) {
          throw new Error(`Startup overhead too high: ${overheadMs}ms > ${this.performanceBudgets.startup_overhead_ms}ms budget`);
        }
        
        return {
          baseline_ms: baselineTime,
          vault_ms: vaultTime,
          overhead_ms: overheadMs,
          within_budget: true
        };
      }
    );
  }

  async testCacheEffectiveness() {
    return await this.runTest(
      'Cache Effectiveness',
      async () => {
        const result = await this.runCommand(process.execPath, [
          '-r', './dist/vault-env-preloader.cjs',
          '-e', `
            // Access the same key multiple times to test caching
            const startTime = process.hrtime.bigint();
            
            // First access (cache miss)
            const key1 = process.env.HUGGINGFACE_API_KEY;
            
            const firstAccessTime = process.hrtime.bigint();
            const firstAccessMs = Number(firstAccessTime - startTime) / 1000000;
            
            // Subsequent accesses (cache hits)
            for (let i = 0; i < 10; i++) {
              const key = process.env.HUGGINGFACE_API_KEY;
            }
            
            const endTime = process.hrtime.bigint();
            const totalTime = Number(endTime - startTime) / 1000000;
            const subsequentTime = Number(endTime - firstAccessTime) / 1000000;
            const avgSubsequentMs = subsequentTime / 10;
            
            console.log('CACHE_FIRST_ACCESS_MS:' + firstAccessMs.toFixed(4));
            console.log('CACHE_AVG_SUBSEQUENT_MS:' + avgSubsequentMs.toFixed(4));
            
            process.exit(0);
          `
        ], { env: { HUGGINGFACE_API_KEY: 'hf_cache_test_key' } });
        
        const firstMatch = result.stdout.match(/CACHE_FIRST_ACCESS_MS:([0-9.]+)/);
        const avgMatch = result.stdout.match(/CACHE_AVG_SUBSEQUENT_MS:([0-9.]+)/);
        
        if (!firstMatch || !avgMatch) {
          throw new Error('Cache performance metrics not captured');
        }
        
        const firstAccessMs = parseFloat(firstMatch[1]);
        const avgSubsequentMs = parseFloat(avgMatch[1]);
        const cacheSpeedup = firstAccessMs / avgSubsequentMs;
        
        console.log(`  First access (cache miss): ${firstAccessMs}ms`);
        console.log(`  Avg subsequent (cache hit): ${avgSubsequentMs}ms`);
        console.log(`  Cache speedup: ${cacheSpeedup.toFixed(2)}x`);
        
        if (cacheSpeedup < 2) {
          throw new Error(`Cache not effective enough: ${cacheSpeedup}x speedup < 2x expected`);
        }
        
        return {
          first_access_ms: firstAccessMs,
          avg_subsequent_ms: avgSubsequentMs,
          speedup_factor: cacheSpeedup,
          cache_effective: true
        };
      }
    );
  }

  async runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: '/Users/huntercanning/mouse-ops-o3/ragnos-vault/env-interceptor',
        env: { ...process.env, ...options.env },
        ...options
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({ stdout, stderr, code });
      });

      child.on('error', (error) => {
        reject(error);
      });

      // 15 second timeout
      setTimeout(() => {
        child.kill();
        reject(new Error('Command timed out'));
      }, 15000);
    });
  }

  async runAllTests() {
    console.log('⚡ RAGnos Vault - Performance Benchmark Suite');
    console.log('===========================================');
    console.log('Testing performance impact and budget validation');
    console.log('');

    console.log('📊 Performance Budgets:');
    console.log(`  Single access: <${this.performanceBudgets.single_access_ms}ms`);
    console.log(`  Batch access: <${this.performanceBudgets.batch_access_ms}ms`);
    console.log(`  Memory overhead: <${this.performanceBudgets.memory_overhead_mb}MB`);
    console.log(`  Startup overhead: <${this.performanceBudgets.startup_overhead_ms}ms`);

    await this.testSingleAccessPerformance();
    await this.testBatchAccessPerformance();
    await this.testMemoryOverhead();
    await this.testStartupOverhead();
    await this.testCacheEffectiveness();

    this.printResults();
  }

  printResults() {
    console.log('\n' + '='.repeat(50));
    console.log('📊 Performance Benchmark Results');
    console.log('='.repeat(50));
    
    const passed = this.results.filter(r => r.status === 'passed').length;
    const failed = this.results.filter(r => r.status === 'failed').length;
    
    console.log(`\nOverall Summary:`);
    console.log(`  Total Tests: ${this.results.length}`);
    console.log(`  Passed: ${passed} ✅`);
    console.log(`  Failed: ${failed} ${failed > 0 ? '❌' : '✅'}`);
    console.log(`  Success Rate: ${(passed / this.results.length * 100).toFixed(1)}%`);

    console.log('\nDetailed Results:');
    this.results.forEach(result => {
      const status = result.status === 'passed' ? '✅' : '❌';
      console.log(`  ${status} ${result.name}`);
      if (result.status === 'failed') {
        console.log(`      Error: ${result.error}`);
      }
    });

    if (failed === 0) {
      console.log('\n🎉 ALL PERFORMANCE TESTS PASSED!');
      console.log('\n⚡ RAGnos Vault Performance Validation:');
      console.log('   ✅ Single access time within budget');
      console.log('   ✅ Batch access performance acceptable');
      console.log('   ✅ Memory overhead minimal');
      console.log('   ✅ Startup overhead acceptable');
      console.log('   ✅ Cache effectiveness confirmed');
      console.log('\n🚀 Performance validation complete - ready for staging deployment!');
      process.exit(0);
    } else {
      console.log('\n❌ SOME PERFORMANCE TESTS FAILED');
      console.log('Review the performance issues above and optimize before deployment.');
      process.exit(1);
    }
  }
}

// Run the performance benchmark suite
if (require.main === module) {
  const suite = new PerformanceBenchmarkSuite();
  suite.runAllTests().catch(error => {
    console.error('Fatal error running performance benchmarks:', error);
    process.exit(1);
  });
}

module.exports = { PerformanceBenchmarkSuite };