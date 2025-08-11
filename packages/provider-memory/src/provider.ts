/**
 * Memory Provider Implementation
 * Complete in-memory provider for testing and development
 */

import {
  Provider,
  ProviderInfo,
  CapabilitySet,
  HealthStatus,
  ProviderContext,
  KmsProvider,
  SecretStoreProvider,
  BlobStorageProvider,
  ErrorFactory,
  ErrorCode
} from '@ragnos-vault/sdk';
import { MemoryProviderConfig, MemoryProviderConfigSchema, defaultConfig } from './config';
import { KmsMemory } from './kms-memory';
import { SecretStoreMemory } from './secret-store-memory';
import { BlobStorageMemory } from './blob-storage-memory';

/**
 * Memory Provider - Complete reference implementation
 */
export class MemoryProvider implements Provider {
  private _kms: KmsMemory;
  private _secretStore: SecretStoreMemory;
  private _blobStorage: BlobStorageMemory;
  private _initialized = false;
  
  readonly info: ProviderInfo = {
    name: 'memory',
    version: '1.0.0',
    description: 'In-memory provider for testing and development',
    sdkApiVersion: '1.0.0',
    author: 'RAGnos Labs <labs@ragnos.io>',
    homepage: 'https://github.com/ragnos-labs/ragnos-vault'
  };
  
  constructor(private config: MemoryProviderConfig = defaultConfig) {
    // Validate configuration
    this.config = MemoryProviderConfigSchema.parse(config);
    
    // Initialize service implementations
    this._kms = new KmsMemory(this.config);
    this._secretStore = new SecretStoreMemory(this.config);
    this._blobStorage = new BlobStorageMemory(this.config);
  }
  
  capabilities(): CapabilitySet {
    return {
      kms: {
        encrypt: true,
        decrypt: true,
        sign: true,
        verify: true,
        createKey: true,
        rotateKey: true,
        keyAliases: true,
        keyPolicy: false // Not implemented in memory provider
      },
      secretStore: {
        putSecret: true,
        getSecret: true,
        deleteSecret: true,
        listSecrets: true,
        versionedSecrets: true,
        rotationHooks: true, // Basic implementation
        immutableVersions: true
      },
      blobStorage: {
        putObject: true,
        getObject: true,
        deleteObject: true,
        listObjects: true,
        multipart: true,
        signedUrls: true, // Mock implementation
        serverSideEncryption: false, // Not applicable for memory
        bucketPolicy: false // Not implemented
      },
      queue: {
        enqueue: false, // Not implemented in minimal slice
        dequeue: false,
        ack: false,
        nack: false,
        deadLetter: false,
        fifo: false,
        idempotency: false,
        delayedMessages: false
      },
      metadataStore: {
        put: false, // Not implemented in minimal slice
        get: false,
        delete: false,
        list: false,
        transactional: false,
        compareAndSwap: false,
        batchOperations: false
      }
    };
  }
  
  async init(ctx: ProviderContext): Promise<void> {
    if (this._initialized) {
      return;
    }
    
    ctx.logger.info('Initializing Memory Provider', {
      provider: this.info.name,
      version: this.info.version,
      eventualWindowMs: this.config.eventualWindowMs
    });
    
    // Memory provider doesn't need external initialization
    // but we could validate configuration or set up monitoring here
    
    this._initialized = true;
    
    ctx.logger.info('Memory Provider initialized successfully', {
      capabilities: this.capabilities()
    });
  }
  
  async health(): Promise<HealthStatus> {
    if (!this._initialized) {
      return {
        status: 'unhealthy',
        message: 'Provider not initialized',
        lastChecked: new Date(),
        capabilities: this.capabilities()
      };
    }
    
    // Memory provider is always healthy when initialized
    return {
      status: 'healthy',
      message: 'Memory provider operational',
      lastChecked: new Date(),
      capabilities: this.capabilities(),
      details: {
        eventualWindowMs: this.config.eventualWindowMs,
        maxObjectSize: this.config.maxObjectSize,
        maxSecretSize: this.config.maxSecretSize,
        chaos: this.config.chaos
      }
    };
  }
  
  async shutdown(): Promise<void> {
    if (!this._initialized) {
      return;
    }
    
    // Memory provider doesn't need cleanup, but we could
    // clear data, stop timers, etc. here
    
    this._initialized = false;
  }
  
  /**
   * Get KMS provider instance
   */
  kms(): KmsProvider {
    this.ensureInitialized();
    return this._kms;
  }
  
  /**
   * Get SecretStore provider instance
   */
  secretStore(): SecretStoreProvider {
    this.ensureInitialized();
    return this._secretStore;
  }
  
  /**
   * Get BlobStorage provider instance
   */
  blobStorage(): BlobStorageProvider {
    this.ensureInitialized();
    return this._blobStorage;
  }
  
  /**
   * Queue provider not implemented in minimal slice
   */
  queue(): undefined {
    return undefined;
  }
  
  /**
   * MetadataStore provider not implemented in minimal slice
   */
  metadataStore(): undefined {
    return undefined;
  }
  
  private ensureInitialized(): void {
    if (!this._initialized) {
      throw ErrorFactory.create(
        ErrorCode.Internal,
        'Provider not initialized',
        this.info.name
      );
    }
  }
}

/**
 * Provider factory function for registry
 */
export function createMemoryProvider(config: Record<string, unknown> = {}): MemoryProvider {
  try {
    const validatedConfig = MemoryProviderConfigSchema.parse(config);
    return new MemoryProvider(validatedConfig);
  } catch (error) {
    throw ErrorFactory.create(
      ErrorCode.InvalidConfig,
      `Invalid memory provider configuration: ${error.message}`,
      'memory-provider',
      { config },
      error
    );
  }
}

// Export all components
export * from './config';
export * from './kms-memory';
export * from './secret-store-memory';
export * from './blob-storage-memory';