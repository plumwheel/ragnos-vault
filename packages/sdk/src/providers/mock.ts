/**
 * Mock Provider - In-memory implementation for testing and development
 */

import { 
  ISecretProvider, 
  ProviderCapabilities, 
  ProviderHealth, 
  SecretRef, 
  SecretItem, 
  WriteSecretRequest, 
  ListScope, 
  BatchOperation, 
  BatchResult,
  ProviderError,
  ProviderUtils 
} from '../provider';

/**
 * Mock provider configuration
 */
export interface MockProviderConfig {
  /** Simulate latency in ms */
  latency?: number;
  /** Simulate failure rate (0-1) */
  failureRate?: number;
  /** Maximum number of secrets to store */
  maxSecrets?: number;
  /** Default environment */
  defaultEnv?: string;
  /** Enable deterministic behavior */
  deterministic?: boolean;
}

/**
 * Internal secret storage format
 */
interface StoredSecret {
  key: string;
  value: string;
  path: string;
  env: string;
  version: string;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, string>;
}

/**
 * Mock provider for testing and development
 * Implements full CRUD operations with in-memory storage
 */
export class MockProvider implements ISecretProvider {
  private secrets = new Map<string, StoredSecret>();
  private versionCounter = 1;
  private config: Required<MockProviderConfig>;

  constructor(config: MockProviderConfig = {}) {
    this.config = {
      latency: config.latency ?? 0,
      failureRate: config.failureRate ?? 0,
      maxSecrets: config.maxSecrets ?? 1000,
      defaultEnv: config.defaultEnv ?? 'default',
      deterministic: config.deterministic ?? false
    };
  }

  name(): string {
    return 'mock-provider';
  }

  capabilities(): ProviderCapabilities {
    return {
      read: true,
      write: true,
      delete: true,
      list: true,
      versions: true,
      rotate: true,
      batch: true
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    await this.simulateLatency();
    
    return {
      ok: true,
      timestamp: new Date(),
      details: {
        secretCount: this.secrets.size,
        maxSecrets: this.config.maxSecrets,
        memoryUsage: process.memoryUsage?.()
      }
    };
  }

  async get(ref: SecretRef): Promise<SecretItem> {
    await this.simulateLatency();
    this.simulateFailure();

    ProviderUtils.validateKey(ref.key);

    const storageKey = this.buildStorageKey(ref);
    const stored = this.secrets.get(storageKey);
    
    if (!stored) {
      throw ProviderUtils.createNotFoundError(ref.key);
    }

    // If specific version requested, validate it
    if (ref.version && ref.version !== stored.version) {
      throw new ProviderError('NotFound', `Version ${ref.version} not found for secret: ${ref.key}`);
    }

    return {
      key: stored.key,
      value: stored.value,
      version: stored.version,
      createdAt: stored.createdAt.toISOString(),
      updatedAt: stored.updatedAt.toISOString(),
      metadata: { ...stored.metadata }
    };
  }

  async set(request: WriteSecretRequest): Promise<SecretItem> {
    await this.simulateLatency();
    this.simulateFailure();

    ProviderUtils.validateKey(request.key);
    ProviderUtils.validateValue(request.value);

    if (this.secrets.size >= this.config.maxSecrets) {
      throw new ProviderError('InvalidRequest', `Maximum secrets limit reached: ${this.config.maxSecrets}`);
    }

    const storageKey = this.buildStorageKey({
      key: request.key,
      path: request.path,
      env: request.env
    });

    const now = new Date();
    const version = this.generateVersion();
    const existing = this.secrets.get(storageKey);

    const stored: StoredSecret = {
      key: request.key,
      value: request.value,
      path: request.path || '',
      env: request.env || this.config.defaultEnv,
      version,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      metadata: { ...request.metadata } || {}
    };

    this.secrets.set(storageKey, stored);

    return {
      key: stored.key,
      value: stored.value,
      version: stored.version,
      createdAt: stored.createdAt.toISOString(),
      updatedAt: stored.updatedAt.toISOString(),
      metadata: { ...stored.metadata }
    };
  }

  async delete(ref: SecretRef): Promise<void> {
    await this.simulateLatency();
    this.simulateFailure();

    ProviderUtils.validateKey(ref.key);

    const storageKey = this.buildStorageKey(ref);
    
    if (!this.secrets.has(storageKey)) {
      throw ProviderUtils.createNotFoundError(ref.key);
    }

    this.secrets.delete(storageKey);
  }

  async list(scope: ListScope = {}): Promise<SecretItem[]> {
    await this.simulateLatency();
    this.simulateFailure();

    const results: SecretItem[] = [];
    const env = scope.env || this.config.defaultEnv;
    const path = scope.path || '';
    const prefix = scope.prefix || '';
    const limit = scope.limit || 100;

    for (const [storageKey, stored] of this.secrets.entries()) {
      // Filter by environment
      if (stored.env !== env) continue;
      
      // Filter by path
      if (path && !stored.path.startsWith(path)) continue;
      
      // Filter by prefix
      if (prefix && !stored.key.startsWith(prefix)) continue;

      results.push({
        key: stored.key,
        // Don't include value in list operations
        version: stored.version,
        createdAt: stored.createdAt.toISOString(),
        updatedAt: stored.updatedAt.toISOString(),
        metadata: { ...stored.metadata }
      });

      if (results.length >= limit) break;
    }

    // Sort for deterministic results
    return results.sort((a, b) => a.key.localeCompare(b.key));
  }

  async rotate(ref: SecretRef): Promise<SecretItem> {
    await this.simulateLatency();
    this.simulateFailure();

    // Get existing secret
    const existing = await this.get(ref);
    
    // Generate new value (simple rotation for mock)
    const rotatedValue = this.generateRotatedValue(existing.value!);
    
    // Update with new value
    return await this.set({
      key: ref.key,
      value: rotatedValue,
      path: ref.path,
      env: ref.env,
      metadata: existing.metadata
    });
  }

  async batch(operations: BatchOperation[]): Promise<BatchResult[]> {
    await this.simulateLatency();
    
    const results: BatchResult[] = [];

    for (const op of operations) {
      try {
        let result: SecretItem | null = null;

        switch (op.type) {
          case 'read':
            result = await this.get(op.ref);
            break;
          case 'write':
            result = await this.set(op.request);
            break;
          case 'delete':
            await this.delete(op.ref);
            result = null;
            break;
        }

        results.push({
          id: op.id,
          success: true,
          result: result || undefined
        });
      } catch (error) {
        results.push({
          id: op.id,
          success: false,
          error: error instanceof ProviderError ? error : 
                 ProviderError.fromUnknown(error)
        });
      }
    }

    return results;
  }

  getConfig(): Record<string, any> {
    return { ...this.config };
  }

  async shutdown(): Promise<void> {
    this.secrets.clear();
  }

  /**
   * Test utilities for the mock provider
   */
  getSecretCount(): number {
    return this.secrets.size;
  }

  clearAllSecrets(): void {
    this.secrets.clear();
  }

  getAllSecrets(): StoredSecret[] {
    return Array.from(this.secrets.values());
  }

  /**
   * Private helper methods
   */
  private buildStorageKey(ref: SecretRef): string {
    const env = ref.env || this.config.defaultEnv;
    const path = ref.path || '';
    return `${env}:${path}:${ref.key}`;
  }

  private async simulateLatency(): Promise<void> {
    if (this.config.latency > 0) {
      await new Promise(resolve => setTimeout(resolve, this.config.latency));
    }
  }

  private simulateFailure(): void {
    if (this.config.failureRate > 0) {
      const random = this.config.deterministic ? 0.1 : Math.random();
      if (random < this.config.failureRate) {
        throw new ProviderError('Unavailable', 'Simulated provider failure');
      }
    }
  }

  private generateVersion(): string {
    if (this.config.deterministic) {
      return `v${this.versionCounter++}`;
    }
    return `v${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
  }

  private generateRotatedValue(currentValue: string): string {
    // Simple rotation - append timestamp for mock
    return `${currentValue}-rotated-${Date.now()}`;
  }
}

/**
 * Factory function for mock provider
 */
export function createMockProvider(config: MockProviderConfig = {}): MockProvider {
  return new MockProvider(config);
}