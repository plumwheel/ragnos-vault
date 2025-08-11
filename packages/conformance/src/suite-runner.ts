/**
 * Conformance Test Suite Runner
 * Runs provider conformance tests and generates results
 */

import {
  Provider,
  ProviderContext,
  ContextBuilder,
  SystemClock
} from '@ragnos-vault/sdk';
import {
  ProviderFactory,
  SuiteOptions,
  TestContext,
  TestResult,
  TestFailure,
  SuiteResult,
  ChaosOptions,
  ObservabilityAsserts
} from './types';
import { ChaosAdapter } from './chaos-adapter';
import { TestUtils } from './test-utils';
import { kmsL0Specs } from './specs/kms-l0';
import { blobL0Specs } from './specs/blob-l0';

/**
 * Default chaos options (disabled)
 */
const defaultChaosOptions: ChaosOptions = {
  enabled: false,
  seed: 12345,
  injectLatency: () => 0,
  injectTransientError: () => false,
  injectPermanentError: () => false,
  dropOnFirstAttempt: () => false,
  eventualWindow: () => 0
};

/**
 * Default suite options
 */
const defaultSuiteOptions: Partial<SuiteOptions> = {
  seed: 12345,
  parallelism: 1,
  timeBudget: 300000, // 5 minutes
  testLevels: ['L0'],
  cleanupOnFailure: true,
  chaos: defaultChaosOptions
};

/**
 * Conformance Test Suite Runner
 */
export class SuiteRunner {
  constructor(
    private providerFactory: ProviderFactory,
    private config: Record<string, unknown> = {}
  ) {}
  
  /**
   * Run conformance tests for the provider
   */
  async run(options: Partial<SuiteOptions> = {}): Promise<SuiteResult> {
    const opts: SuiteOptions = {
      ...defaultSuiteOptions,
      ...options,
      namespace: options.namespace || `test-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`
    } as SuiteOptions;
    
    const startedAt = new Date();
    const results: TestResult[] = [];
    
    console.log(`🧪 Starting conformance tests for provider: ${this.providerFactory.name}`);
    console.log(`📋 Test namespace: ${opts.namespace}`);
    console.log(`🎯 Test levels: ${opts.testLevels?.join(', ')}`);
    
    try {
      // Create provider instance
      const provider = await this.createProvider(opts);
      
      try {
        // Run capability-specific tests
        if (this.shouldTestCapability('kms', provider, opts)) {
          const kmsResult = await this.runCapabilityTests('kms', kmsL0Specs, provider, opts);
          results.push(kmsResult);
        }
        
        if (this.shouldTestCapability('blobStorage', provider, opts)) {
          const blobResult = await this.runCapabilityTests('blobStorage', blobL0Specs, provider, opts);
          results.push(blobResult);
        }
        
        // TODO: Add other capability tests when implemented
        // if (this.shouldTestCapability('secretStore', provider, opts)) { ... }
        
      } finally {
        // Cleanup provider
        await provider.shutdown();
      }
      
    } catch (error) {
      console.error('❌ Suite setup failed:', error);
      throw error;
    }
    
    const completedAt = new Date();
    const duration = completedAt.getTime() - startedAt.getTime();
    
    const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
    const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
    const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);
    const success = totalFailed === 0;
    
    const suiteResult: SuiteResult = {
      provider: this.providerFactory.name,
      startedAt,
      completedAt,
      duration,
      results,
      totalPassed,
      totalFailed,
      totalSkipped,
      success
    };
    
    this.printSummary(suiteResult);
    
    return suiteResult;
  }
  
  private async createProvider(opts: SuiteOptions): Promise<Provider> {
    let provider = this.providerFactory.create(this.config);
    
    // Wrap with chaos adapter if chaos testing enabled
    if (opts.chaos?.enabled) {
      provider = new ChaosAdapter(provider, opts.chaos);
    }
    
    // Initialize provider
    const ctx = this.createTestContext(opts);
    await provider.init(ctx);
    
    return provider;
  }
  
  private shouldTestCapability(
    capability: string, 
    provider: Provider, 
    opts: SuiteOptions
  ): boolean {
    const capabilities = provider.capabilities();
    
    // Check if provider supports capability
    const capabilitySet = capabilities[capability as keyof typeof capabilities] as any;
    if (!capabilitySet) return false;
    
    // Check if any operation is supported
    const hasAnyOperation = Object.values(capabilitySet).some(v => v === true);
    if (!hasAnyOperation) return false;
    
    // Check if filtered by options
    if (opts.capabilities) {
      const filterSet = opts.capabilities[capability as keyof typeof opts.capabilities] as any;
      if (!filterSet) return false;
    }
    
    return true;
  }
  
  private async runCapabilityTests(
    capability: string,
    specs: any[],
    provider: Provider,
    opts: SuiteOptions
  ): Promise<TestResult> {
    console.log(`\n🔧 Testing ${capability} capability...`);
    
    const startTime = Date.now();
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const failures: TestFailure[] = [];
    
    const testContext = this.createTestContext(opts);
    testContext.provider = provider;
    
    // Run each test spec
    for (const spec of specs) {
      const testName = spec.name || `${capability}_test_${specs.indexOf(spec)}`;
      
      try {
        console.log(`  ⏳ Running ${testName}...`);
        
        const testStart = Date.now();
        await spec(testContext);
        const testDuration = Date.now() - testStart;
        
        passed++;
        console.log(`  ✅ ${testName} (${testDuration}ms)`);
        
      } catch (error) {
        failed++;
        const failure: TestFailure = {
          testName,
          error: error.message,
          stack: error.stack,
          context: {
            capability,
            namespace: opts.namespace
          }
        };
        failures.push(failure);
        
        console.log(`  ❌ ${testName}: ${error.message}`);
        
        if (!opts.cleanupOnFailure) {
          break; // Stop on first failure if cleanup disabled
        }
      }
    }
    
    const duration = Date.now() - startTime;
    
    const result: TestResult = {
      capability,
      provider: this.providerFactory.name,
      level: 'L0', // TODO: Make this dynamic based on test levels
      passed,
      failed,
      skipped,
      duration,
      failures
    };
    
    const status = failed === 0 ? '✅' : '❌';
    console.log(`${status} ${capability}: ${passed} passed, ${failed} failed, ${skipped} skipped (${duration}ms)`);
    
    return result;
  }
  
  private createTestContext(opts: SuiteOptions): TestContext {
    const ctx = ContextBuilder.create()
      .tenantId('test-tenant')
      .logger(new TestUtils.TestLogger())
      .tracer({
        startSpan: () => ({ 
          end: () => {}, 
          setAttributes: () => {},
          recordException: () => {},
          setStatus: () => {}
        })
      } as any)
      .metrics({
        counter: () => {},
        histogram: () => {},
        gauge: () => {}
      })
      .clock(new SystemClock())
      .config({})
      .requestId(TestUtils.uniqueId('test-req'))
      .build();
    
    return {
      provider: null as any, // Will be set by caller
      ctx,
      options: opts,
      namespace: opts.namespace,
      
      // Utility functions
      randomString: TestUtils.randomString,
      randomBytes: TestUtils.randomBytes,
      sleep: TestUtils.sleep,
      timeout: TestUtils.timeout,
      
      // Namespace helpers
      namespacedKey: (key: string) => TestUtils.namespacedKey(opts.namespace, key),
      namespacedQueue: (name: string) => TestUtils.namespacedKey(opts.namespace, `queue-${name}`),
      namespacedSecret: (name: string) => TestUtils.namespacedKey(opts.namespace, `secret-${name}`),
      
      // Additional utilities
      generateContent: TestUtils.generateContent,
      arraysEqual: TestUtils.arraysEqual
    };
  }
  
  private printSummary(result: SuiteResult): void {
    console.log('\n' + '='.repeat(60));
    console.log(`📊 CONFORMANCE TEST SUMMARY`);
    console.log('='.repeat(60));
    console.log(`Provider: ${result.provider}`);
    console.log(`Duration: ${result.duration}ms`);
    console.log(`Status: ${result.success ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Tests: ${result.totalPassed} passed, ${result.totalFailed} failed, ${result.totalSkipped} skipped`);
    
    if (result.results.length > 0) {
      console.log('\nCapability Results:');
      for (const capResult of result.results) {
        const status = capResult.failed === 0 ? '✅' : '❌';
        console.log(`  ${status} ${capResult.capability}: ${capResult.passed}/${capResult.passed + capResult.failed} (${capResult.duration}ms)`);
      }
    }
    
    if (result.totalFailed > 0) {
      console.log('\nFailure Details:');
      for (const capResult of result.results) {
        if (capResult.failures.length > 0) {
          console.log(`\n${capResult.capability} failures:`);
          for (const failure of capResult.failures) {
            console.log(`  ❌ ${failure.testName}: ${failure.error}`);
          }
        }
      }
    }
    
    console.log('='.repeat(60));
  }
}

/**
 * Helper function to run conformance tests
 */
export async function runConformanceTests(
  providerFactory: ProviderFactory,
  config: Record<string, unknown> = {},
  options: Partial<SuiteOptions> = {}
): Promise<SuiteResult> {
  const runner = new SuiteRunner(providerFactory, config);
  return await runner.run(options);
}