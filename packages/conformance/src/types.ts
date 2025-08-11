/**
 * Conformance Test Suite Types
 */

import { 
  Provider, 
  ProviderContext,
  CapabilitySet,
  KmsProvider,
  SecretStoreProvider,
  BlobStorageProvider,
  QueueProvider,
  MetadataStoreProvider
} from '@ragnos-vault/sdk';

/**
 * Provider factory for conformance testing
 */
export interface ProviderFactory {
  name: string;
  create(config: Record<string, unknown>): Provider;
}

/**
 * Chaos testing options
 */
export interface ChaosOptions {
  enabled: boolean;
  seed?: number;
  
  // Fault injection probabilities (0-1)
  injectLatency: (operation: string, resource: string) => number; // ms delay
  injectTransientError: (operation: string, resource: string) => boolean;
  injectPermanentError: (operation: string, resource: string) => boolean;
  dropOnFirstAttempt: (operation: string, resource: string) => boolean;
  
  // Eventual consistency window
  eventualWindow: (operation: string, resource: string) => number; // ms
}

/**
 * Observability assertions for testing
 */
export interface ObservabilityAsserts {
  expectSpan?: (operationName: string, attributes: Record<string, any>) => void;
  expectMetric?: (name: string, value: number, labels: Record<string, string>) => void;
  expectLog?: (level: string, message: string, meta: Record<string, any>) => void;
}

/**
 * Conformance test suite options
 */
export interface SuiteOptions {
  // Test execution
  seed?: number;
  parallelism?: number;
  timeBudget?: number; // milliseconds
  
  // Test selection
  capabilities?: Partial<CapabilitySet>; // Filter which capabilities to test
  testLevels?: ('L0' | 'L1' | 'L2' | 'L3')[]; // Test levels to run
  
  // Test environment
  namespace: string; // Prefix for all test resources
  cleanupOnFailure?: boolean;
  
  // Chaos testing
  chaos?: ChaosOptions;
  
  // Observability
  observability?: ObservabilityAsserts;
}

/**
 * Test result for individual capability
 */
export interface TestResult {
  capability: string;
  provider: string;
  level: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number; // milliseconds
  failures: TestFailure[];
}

/**
 * Individual test failure
 */
export interface TestFailure {
  testName: string;
  error: string;
  stack?: string;
  context?: Record<string, any>;
}

/**
 * Complete suite results
 */
export interface SuiteResult {
  provider: string;
  startedAt: Date;
  completedAt: Date;
  duration: number;
  results: TestResult[];
  
  // Summary
  totalPassed: number;
  totalFailed: number;
  totalSkipped: number;
  success: boolean;
}

/**
 * Test context passed to each spec
 */
export interface TestContext {
  provider: Provider;
  ctx: ProviderContext;
  options: SuiteOptions;
  namespace: string;
  
  // Utility functions
  randomString: (length?: number) => string;
  randomBytes: (length?: number) => Uint8Array;
  sleep: (ms: number) => Promise<void>;
  timeout: (ms: number) => Promise<never>;
  
  // Namespace helpers
  namespacedKey: (key: string) => string;
  namespacedQueue: (name: string) => string;
  namespacedSecret: (name: string) => string;
}

/**
 * Provider capability extraction
 */
export interface ProviderCapabilities {
  kms?: KmsProvider;
  secretStore?: SecretStoreProvider;
  blobStorage?: BlobStorageProvider;
  queue?: QueueProvider;
  metadataStore?: MetadataStoreProvider;
}

/**
 * Test specification function type
 */
export type TestSpec = (testCtx: TestContext) => Promise<void>;

/**
 * Capability test specifications
 */
export interface CapabilitySpecs {
  kms?: {
    L0: TestSpec[];
    L1: TestSpec[];
    L2: TestSpec[];
    L3: TestSpec[];
  };
  secretStore?: {
    L0: TestSpec[];
    L1: TestSpec[];
    L2: TestSpec[];
    L3: TestSpec[];
  };
  blobStorage?: {
    L0: TestSpec[];
    L1: TestSpec[];
    L2: TestSpec[];
    L3: TestSpec[];
  };
  queue?: {
    L0: TestSpec[];
    L1: TestSpec[];
    L2: TestSpec[];
    L3: TestSpec[];
  };
  metadataStore?: {
    L0: TestSpec[];
    L1: TestSpec[];
    L2: TestSpec[];
    L3: TestSpec[];
  };
}