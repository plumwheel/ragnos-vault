/**
 * Tests for SimpleSecretProvider
 */

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { SimpleSecretProvider, SimpleProviderError } from './simple-provider';
import { Provider } from '../interfaces/provider';
import { SecretStoreProvider, Secret as SDKSecret, PutSecretResult } from '../interfaces/secret-store';
import { ProviderContext } from '../types/context';
import { ProviderError } from '../types/errors';

// Mock provider that implements both Provider and SecretStoreProvider
class MockProvider implements Provider, SecretStoreProvider {
  readonly info = {
    name: 'mock-provider',
    version: '1.0.0',
    description: 'Mock provider for testing'
  };

  private secrets = new Map<string, SDKSecret>();

  capabilities() {
    return {
      secretStore: {
        get: true,
        put: true,
        delete: true,
        list: true,
        versions: true,
        rotate: true,
        updateMetadata: true
      }
    };
  }

  async init(ctx: ProviderContext): Promise<void> {}

  async health() {
    return {
      status: 'healthy' as const,
      message: 'All systems operational',
      lastChecked: new Date(),
      capabilities: this.capabilities()
    };
  }

  async shutdown(): Promise<void> {
    this.secrets.clear();
  }

  async putSecret(
    ctx: ProviderContext,
    name: string,
    value: Uint8Array,
    options?: any
  ): Promise<PutSecretResult> {
    const version = `v${Date.now()}`;
    const now = new Date();
    
    const secret: SDKSecret = {
      name,
      version,
      value,
      createdAt: now,
      updatedAt: now,
      labels: options?.labels || {}
    };

    this.secrets.set(name, secret);

    return {
      name,
      version,
      createdAt: now
    };
  }

  async getSecret(
    ctx: ProviderContext,
    name: string,
    options?: any
  ): Promise<SDKSecret> {
    const secret = this.secrets.get(name);
    if (!secret) {
      throw new ProviderError('NotFound', `Secret not found: ${name}`);
    }
    return secret;
  }

  async deleteSecret(
    ctx: ProviderContext,
    name: string,
    options?: any
  ): Promise<void> {
    if (!this.secrets.has(name)) {
      throw new ProviderError('NotFound', `Secret not found: ${name}`);
    }
    this.secrets.delete(name);
  }

  async listSecrets(
    ctx: ProviderContext,
    options?: any
  ) {
    const secrets = Array.from(this.secrets.values())
      .filter(s => !options?.prefix || s.name.startsWith(options.prefix))
      .slice(0, options?.limit || 100);

    return {
      secrets,
      totalCount: secrets.length
    };
  }

  async listVersions(ctx: ProviderContext, name: string, options?: any) {
    const secret = this.secrets.get(name);
    if (!secret) {
      throw new ProviderError('NotFound', `Secret not found: ${name}`);
    }

    return {
      versions: [{
        version: secret.version,
        createdAt: secret.createdAt,
        labels: secret.labels
      }],
      totalCount: 1
    };
  }

  async secretExists(
    ctx: ProviderContext,
    name: string,
    options?: any
  ): Promise<boolean> {
    return this.secrets.has(name);
  }

  async rotateSecret(
    ctx: ProviderContext,
    name: string,
    options?: any
  ): Promise<PutSecretResult> {
    const existing = this.secrets.get(name);
    if (!existing) {
      throw new ProviderError('NotFound', `Secret not found: ${name}`);
    }

    // Simple rotation - append timestamp
    const rotatedValue = new TextEncoder().encode(
      new TextDecoder().decode(existing.value) + '-rotated'
    );
    
    return this.putSecret(ctx, name, rotatedValue, { labels: existing.labels });
  }

  async updateSecretMetadata(
    ctx: ProviderContext,
    name: string,
    metadata: any,
    options?: any
  ): Promise<void> {
    const secret = this.secrets.get(name);
    if (!secret) {
      throw new ProviderError('NotFound', `Secret not found: ${name}`);
    }

    secret.labels = { ...secret.labels, ...metadata.labels };
  }
}

describe('SimpleSecretProvider', () => {
  let mockProvider: MockProvider;
  let context: ProviderContext;
  let simpleProvider: SimpleSecretProvider;

  beforeEach(() => {
    mockProvider = new MockProvider();
    context = {
      tenantId: 'test-tenant',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      tracer: {
        startSpan: vi.fn(() => ({
          end: vi.fn(),
          setAttributes: vi.fn(),
          recordException: vi.fn(),
          setStatus: vi.fn()
        }))
      },
      metrics: {
        counter: vi.fn(),
        histogram: vi.fn(),
        gauge: vi.fn()
      },
      clock: {
        now: () => new Date()
      },
      config: {},
      requestId: 'test-request-123'
    };

    simpleProvider = new SimpleSecretProvider(mockProvider, context);
  });

  describe('basic operations', () => {
    it('should set and get a secret', async () => {
      const secret = await simpleProvider.set('test-key', 'test-value');
      
      expect(secret.value).toBe('test-value');
      expect(secret.version).toBeTruthy();
      expect(secret.createdAt).toBeInstanceOf(Date);
      expect(secret.updatedAt).toBeInstanceOf(Date);

      const retrieved = await simpleProvider.get('test-key');
      expect(retrieved.value).toBe('test-value');
      expect(retrieved.version).toBe(secret.version);
    });

    it('should delete a secret', async () => {
      await simpleProvider.set('test-key', 'test-value');
      await simpleProvider.delete('test-key');

      await expect(simpleProvider.get('test-key'))
        .rejects.toThrow(SimpleProviderError);
    });

    it('should list secrets with prefix', async () => {
      await simpleProvider.set('app1/secret1', 'value1');
      await simpleProvider.set('app1/secret2', 'value2');
      await simpleProvider.set('app2/secret3', 'value3');

      const app1Secrets = await simpleProvider.list('app1/');
      expect(app1Secrets).toHaveLength(2);
      expect(app1Secrets).toContain('app1/secret1');
      expect(app1Secrets).toContain('app1/secret2');

      const allSecrets = await simpleProvider.list();
      expect(allSecrets).toHaveLength(3);
    });

    it('should check if secret exists', async () => {
      await simpleProvider.set('test-key', 'test-value');
      
      expect(await simpleProvider.exists('test-key')).toBe(true);
      expect(await simpleProvider.exists('nonexistent')).toBe(false);
    });

    it('should rotate a secret', async () => {
      await simpleProvider.set('test-key', 'original-value');
      const rotated = await simpleProvider.rotate('test-key');
      
      expect(rotated.value).toBe('original-value-rotated');
      expect(rotated.version).toBeTruthy();

      const retrieved = await simpleProvider.get('test-key');
      expect(retrieved.value).toBe('original-value-rotated');
    });
  });

  describe('error handling', () => {
    it('should map NotFound errors correctly', async () => {
      await expect(simpleProvider.get('nonexistent'))
        .rejects.toThrow(SimpleProviderError);

      try {
        await simpleProvider.get('nonexistent');
      } catch (error) {
        expect(error).toBeInstanceOf(SimpleProviderError);
        expect((error as SimpleProviderError).code).toBe('NotFound');
        expect((error as SimpleProviderError).retryable).toBe(false);
      }
    });

    it('should handle provider health checks', async () => {
      const health = await simpleProvider.health();
      expect(health.ok).toBe(true);
      expect(health.details).toBeDefined();
    });
  });

  describe('caching', () => {
    beforeEach(() => {
      simpleProvider = new SimpleSecretProvider(mockProvider, context, {
        cache: { defaultTtl: 300, maxSize: 100 }
      });
    });

    it('should cache retrieved secrets', async () => {
      // Set up spy on the mock provider
      const getSpy = vi.spyOn(mockProvider, 'getSecret');
      
      await simpleProvider.set('test-key', 'test-value');
      
      // First get - should hit provider
      await simpleProvider.get('test-key');
      expect(getSpy).toHaveBeenCalledTimes(2); // Once for set, once for get
      
      // Second get - should hit cache
      await simpleProvider.get('test-key');
      expect(getSpy).toHaveBeenCalledTimes(2); // No additional call
    });

    it('should invalidate cache on set/delete', async () => {
      const getSpy = vi.spyOn(mockProvider, 'getSecret');
      
      await simpleProvider.set('test-key', 'test-value');
      await simpleProvider.get('test-key'); // Cache it
      
      // Update the secret
      await simpleProvider.set('test-key', 'updated-value');
      
      // Get should hit provider again
      const updated = await simpleProvider.get('test-key');
      expect(updated.value).toBe('updated-value');
    });

    it('should clear all cache', async () => {
      await simpleProvider.set('test-key', 'test-value');
      await simpleProvider.get('test-key'); // Cache it
      
      await simpleProvider.clearCache();
      
      const getSpy = vi.spyOn(mockProvider, 'getSecret');
      await simpleProvider.get('test-key');
      expect(getSpy).toHaveBeenCalledTimes(1); // Hit provider after cache clear
    });
  });

  describe('SDK handle', () => {
    it('should provide access to underlying SDK provider', () => {
      const sdkHandle = simpleProvider.sdkHandle();
      expect(sdkHandle).toBe(mockProvider);
      expect(typeof sdkHandle.capabilities).toBe('function');
    });
  });

  describe('options handling', () => {
    it('should handle metadata in set operations', async () => {
      const secret = await simpleProvider.set('test-key', 'test-value', {
        metadata: { env: 'prod', team: 'backend' }
      });

      expect(secret.metadata).toEqual({ env: 'prod', team: 'backend' });
    });

    it('should handle version-specific gets', async () => {
      const secret = await simpleProvider.set('test-key', 'test-value');
      
      const versionedGet = await simpleProvider.getVersion('test-key', secret.version);
      expect(versionedGet.value).toBe('test-value');
      expect(versionedGet.version).toBe(secret.version);
    });
  });
});