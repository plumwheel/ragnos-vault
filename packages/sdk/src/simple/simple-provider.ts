/**
 * Simple Secret Provider - Ergonomic facade over the full SDK
 * 80% use cases with 20% of the complexity
 */

import { Provider } from '../interfaces/provider';
import { SecretStoreProvider, Secret as SDKSecret, SecretInfo } from '../interfaces/secret-store';
import { ProviderContext } from '../types/context';
import { ProviderError } from '../types/errors';

/**
 * Simple secret item - string values only
 */
export interface Secret {
  value: string;
  version: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  metadata?: Record<string, string>;
}

/**
 * Simple operation options
 */
export interface SimpleOptions {
  version?: string;
  ttl?: number; // seconds
  namespace?: string;
  project?: string;
  encryptionContext?: Record<string, string>;
  cachePolicy?: 'no-cache' | 'cache-first' | 'cache-refresh';
  providerOptions?: Record<string, any>; // Provider-specific passthrough
}

/**
 * Error codes normalized for simple use cases
 */
export type SimpleErrorCode = 
  | 'NotFound'
  | 'PermissionDenied' 
  | 'RateLimited'
  | 'Transient'
  | 'Validation'
  | 'Conflict';

/**
 * Simple provider error
 */
export class SimpleProviderError extends Error {
  constructor(
    public readonly code: SimpleErrorCode,
    message: string,
    public readonly cause?: any
  ) {
    super(message);
    this.name = 'SimpleProviderError';
  }

  get retryable(): boolean {
    return ['RateLimited', 'Transient'].includes(this.code);
  }
}

/**
 * Simple Secret Provider - ergonomic wrapper over SDK SecretStore
 */
export class SimpleSecretProvider {
  private provider: Provider & SecretStoreProvider;
  private context: ProviderContext;
  private cache?: SimpleCache;

  constructor(
    provider: Provider & SecretStoreProvider, 
    context: ProviderContext,
    options: {
      cache?: SimpleCacheConfig;
    } = {}
  ) {
    this.provider = provider;
    this.context = context;
    
    if (options.cache) {
      this.cache = new SimpleCache(options.cache);
    }
  }

  /**
   * Get a secret by name
   */
  async get(name: string, options?: SimpleOptions): Promise<Secret> {
    const cacheKey = this.buildCacheKey(name, options);
    
    // Check cache first
    if (this.cache && options?.cachePolicy !== 'no-cache') {
      const cached = await this.cache.get(cacheKey);
      if (cached && options?.cachePolicy !== 'cache-refresh') {
        return cached;
      }
    }

    try {
      const sdkSecret = await this.provider.getSecret(this.context, name, {
        version: options?.version,
        idempotencyKey: this.generateIdempotencyKey()
      });

      const secret = this.mapFromSDKSecret(sdkSecret);
      
      // Cache the result
      if (this.cache) {
        await this.cache.set(cacheKey, secret, options?.ttl);
      }
      
      return secret;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Set a secret
   */
  async set(name: string, value: string, options?: SimpleOptions): Promise<Secret> {
    try {
      const putResult = await this.provider.putSecret(
        this.context, 
        name, 
        new TextEncoder().encode(value),
        {
          version: options?.version,
          labels: options?.metadata,
          idempotencyKey: this.generateIdempotencyKey()
        }
      );

      // Get the updated secret to return full info
      const updated = await this.provider.getSecret(this.context, name, {
        version: putResult.version
      });

      const secret = this.mapFromSDKSecret(updated);

      // Update cache
      if (this.cache) {
        const cacheKey = this.buildCacheKey(name, options);
        await this.cache.set(cacheKey, secret, options?.ttl);
      }

      return secret;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Delete a secret
   */
  async delete(name: string, options?: SimpleOptions): Promise<void> {
    try {
      await this.provider.deleteSecret(this.context, name, {
        version: options?.version,
        idempotencyKey: this.generateIdempotencyKey()
      });

      // Clear from cache
      if (this.cache) {
        const cacheKey = this.buildCacheKey(name, options);
        await this.cache.delete(cacheKey);
      }
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * List secrets with optional prefix
   */
  async list(prefix?: string, options?: SimpleOptions): Promise<string[]> {
    try {
      const result = await this.provider.listSecrets(this.context, {
        prefix,
        limit: options?.providerOptions?.limit || 100,
        idempotencyKey: this.generateIdempotencyKey()
      });

      return result.secrets.map(s => s.name);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Get specific version of a secret
   */
  async getVersion(name: string, version: string, options?: SimpleOptions): Promise<Secret> {
    return this.get(name, { ...options, version });
  }

  /**
   * Rotate a secret (if supported by provider)
   */
  async rotate(name: string, options?: SimpleOptions): Promise<Secret> {
    try {
      const rotateResult = await this.provider.rotateSecret(this.context, name, {
        idempotencyKey: this.generateIdempotencyKey()
      });

      // Get the rotated secret
      const rotated = await this.provider.getSecret(this.context, name, {
        version: rotateResult.version
      });

      const secret = this.mapFromSDKSecret(rotated);

      // Update cache
      if (this.cache) {
        const cacheKey = this.buildCacheKey(name, options);
        await this.cache.set(cacheKey, secret, options?.ttl);
      }

      return secret;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Check if a secret exists
   */
  async exists(name: string, options?: SimpleOptions): Promise<boolean> {
    try {
      return await this.provider.secretExists(this.context, name, {
        version: options?.version,
        idempotencyKey: this.generateIdempotencyKey()
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Get access to the underlying SDK provider for advanced operations
   */
  sdkHandle(): Provider & SecretStoreProvider {
    return this.provider;
  }

  /**
   * Get provider health
   */
  async health(): Promise<{ ok: boolean; details?: any }> {
    try {
      const health = await this.provider.health();
      return {
        ok: health.status === 'healthy',
        details: health.details
      };
    } catch (error) {
      return {
        ok: false,
        details: { error: String(error) }
      };
    }
  }

  /**
   * Clear cache (if enabled)
   */
  async clearCache(): Promise<void> {
    if (this.cache) {
      await this.cache.clear();
    }
  }

  /**
   * Map SDK secret to simple secret
   */
  private mapFromSDKSecret(sdkSecret: SDKSecret): Secret {
    return {
      value: new TextDecoder().decode(sdkSecret.value),
      version: sdkSecret.version,
      createdAt: sdkSecret.createdAt,
      updatedAt: sdkSecret.updatedAt,
      metadata: sdkSecret.labels
    };
  }

  /**
   * Map SDK/provider errors to simple errors
   */
  private mapError(error: unknown): SimpleProviderError {
    if (error instanceof ProviderError) {
      let code: SimpleErrorCode;
      
      switch (error.code) {
        case 'NotFound':
        case 'ResourceNotFound':
          code = 'NotFound';
          break;
        case 'PermissionDenied':
        case 'Unauthorized':
          code = 'PermissionDenied';
          break;
        case 'RateLimited':
        case 'TooManyRequests':
          code = 'RateLimited';
          break;
        case 'Unavailable':
        case 'ServiceUnavailable':
        case 'Timeout':
          code = 'Transient';
          break;
        case 'InvalidRequest':
        case 'ValidationError':
          code = 'Validation';
          break;
        case 'AlreadyExists':
        case 'Conflict':
          code = 'Conflict';
          break;
        default:
          code = 'Transient';
      }
      
      return new SimpleProviderError(code, error.message, error);
    }
    
    return new SimpleProviderError('Transient', String(error), error);
  }

  /**
   * Build cache key from name and options
   */
  private buildCacheKey(name: string, options?: SimpleOptions): string {
    const parts = [name];
    if (options?.version) parts.push(`v:${options.version}`);
    if (options?.namespace) parts.push(`ns:${options.namespace}`);
    if (options?.project) parts.push(`proj:${options.project}`);
    return parts.join('|');
  }

  /**
   * Generate idempotency key for operations
   */
  private generateIdempotencyKey(): string {
    return `simple-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
  }
}

/**
 * Simple cache configuration
 */
export interface SimpleCacheConfig {
  defaultTtl?: number; // seconds
  maxSize?: number;
  enableSingleflight?: boolean;
}

/**
 * Simple in-memory cache with TTL and singleflight
 */
class SimpleCache {
  private cache = new Map<string, { value: Secret; expiresAt: number }>();
  private inflight = new Map<string, Promise<Secret>>();
  private config: Required<SimpleCacheConfig>;

  constructor(config: SimpleCacheConfig) {
    this.config = {
      defaultTtl: config.defaultTtl ?? 300, // 5 minutes
      maxSize: config.maxSize ?? 1000,
      enableSingleflight: config.enableSingleflight ?? true
    };
  }

  async get(key: string): Promise<Secret | null> {
    // Check cache
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    // Remove expired
    if (cached) {
      this.cache.delete(key);
    }

    return null;
  }

  async set(key: string, value: Secret, ttl?: number): Promise<void> {
    const actualTtl = ttl ?? this.config.defaultTtl;
    const expiresAt = Date.now() + (actualTtl * 1000);

    // Evict oldest entries if at max size
    if (this.cache.size >= this.config.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
    this.inflight.delete(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.inflight.clear();
  }
}