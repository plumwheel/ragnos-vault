/**
 * Chaos Adapter for Fault Injection Testing
 * Wraps providers to inject faults, latency, and eventual consistency
 */

import {
  Provider,
  KmsProvider,
  SecretStoreProvider,
  BlobStorageProvider,
  QueueProvider,
  MetadataStoreProvider,
  ProviderContext,
  ProviderInfo,
  CapabilitySet,
  HealthStatus,
  ErrorFactory,
  ErrorCode,
  ThrottledError,
  TransientNetworkError
} from '@ragnos-vault/sdk';
import { ChaosOptions } from './types';

/**
 * Random number generator with seed support
 */
class SeededRandom {
  private seed: number;
  
  constructor(seed: number = Math.floor(Math.random() * 1000000)) {
    this.seed = seed;
  }
  
  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
  
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }
  
  nextBool(probability: number = 0.5): boolean {
    return this.next() < probability;
  }
}

/**
 * Chaos adapter that wraps any provider to inject faults
 */
export class ChaosAdapter implements Provider {
  private rng: SeededRandom;
  private eventualityStore = new Map<string, { value: any; applyAt: number }>();
  
  constructor(
    private inner: Provider,
    private chaos: ChaosOptions
  ) {
    this.rng = new SeededRandom(chaos.seed);
    
    // Process eventuality store periodically
    setInterval(() => {
      this.processEventualityStore();
    }, 100);
  }
  
  get info(): ProviderInfo {
    return {
      ...this.inner.info,
      name: `chaos(${this.inner.info.name})`,
      description: `Chaos-wrapped ${this.inner.info.description}`
    };
  }
  
  capabilities(): CapabilitySet {
    return this.inner.capabilities();
  }
  
  async init(ctx: ProviderContext): Promise<void> {
    await this.inner.init(ctx);
  }
  
  async health(): Promise<HealthStatus> {
    if (await this.shouldInjectError('health', 'provider')) {
      throw ErrorFactory.create(
        ErrorCode.Internal,
        'Chaos-injected health check failure',
        this.info.name
      );
    }
    
    const result = await this.inner.health();
    
    if (this.chaos.injectLatency('health', 'provider') > 0) {
      await this.sleep(this.chaos.injectLatency('health', 'provider'));
    }
    
    return result;
  }
  
  async shutdown(): Promise<void> {
    await this.inner.shutdown();
  }
  
  /**
   * Get KMS provider with chaos injection
   */
  kms(): KmsProvider | undefined {
    const innerKms = (this.inner as any).kms?.();
    if (!innerKms) return undefined;
    
    return new ChaosKmsAdapter(innerKms, this.chaos, this.rng);
  }
  
  /**
   * Get SecretStore provider with chaos injection
   */
  secretStore(): SecretStoreProvider | undefined {
    const innerSecretStore = (this.inner as any).secretStore?.();
    if (!innerSecretStore) return undefined;
    
    return new ChaosSecretStoreAdapter(innerSecretStore, this.chaos, this.rng);
  }
  
  /**
   * Get BlobStorage provider with chaos injection
   */
  blobStorage(): BlobStorageProvider | undefined {
    const innerBlob = (this.inner as any).blobStorage?.();
    if (!innerBlob) return undefined;
    
    return new ChaosBlobStorageAdapter(innerBlob, this.chaos, this.rng);
  }
  
  /**
   * Get Queue provider with chaos injection
   */
  queue(): QueueProvider | undefined {
    const innerQueue = (this.inner as any).queue?.();
    if (!innerQueue) return undefined;
    
    return new ChaosQueueAdapter(innerQueue, this.chaos, this.rng);
  }
  
  /**
   * Get MetadataStore provider with chaos injection
   */
  metadataStore(): MetadataStoreProvider | undefined {
    const innerMeta = (this.inner as any).metadataStore?.();
    if (!innerMeta) return undefined;
    
    return new ChaosMetadataStoreAdapter(innerMeta, this.chaos, this.rng);
  }
  
  private async shouldInjectError(operation: string, resource: string): Promise<boolean> {
    if (!this.chaos.enabled) return false;
    
    if (this.chaos.injectPermanentError(operation, resource)) {
      return true;
    }
    
    if (this.chaos.injectTransientError(operation, resource)) {
      return this.rng.nextBool(0.3); // 30% chance of transient error
    }
    
    return false;
  }
  
  private async injectLatency(operation: string, resource: string): Promise<void> {
    if (!this.chaos.enabled) return;
    
    const latency = this.chaos.injectLatency(operation, resource);
    if (latency > 0) {
      await this.sleep(latency);
    }
  }
  
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  private processEventualityStore(): void {
    const now = Date.now();
    
    for (const [key, entry] of this.eventualityStore.entries()) {
      if (entry.applyAt <= now) {
        // Apply the eventual value
        this.eventualityStore.delete(key);
      }
    }
  }
  
  private storeEventualValue(key: string, value: any, operation: string, resource: string): void {
    const window = this.chaos.eventualWindow(operation, resource);
    if (window > 0) {
      this.eventualityStore.set(key, {
        value,
        applyAt: Date.now() + window
      });
    }
  }
  
  private getEventualValue<T>(key: string, defaultValue: T): T {
    const entry = this.eventualityStore.get(key);
    return entry ? entry.value : defaultValue;
  }
}

/**
 * Base chaos capability adapter
 */
abstract class BaseChaosAdapter {
  protected rng: SeededRandom;
  
  constructor(
    protected chaos: ChaosOptions,
    rng: SeededRandom
  ) {
    this.rng = rng;
  }
  
  protected async injectChaos(operation: string, resource: string): Promise<void> {
    if (!this.chaos.enabled) return;
    
    // Drop first attempt if configured
    if (this.chaos.dropOnFirstAttempt(operation, resource)) {
      throw ErrorFactory.create(
        ErrorCode.TransientNetwork,
        `Chaos: First attempt dropped for ${operation}`,
        'chaos-adapter'
      );
    }
    
    // Inject errors
    if (this.chaos.injectPermanentError(operation, resource)) {
      throw ErrorFactory.create(
        ErrorCode.PermissionDenied,
        `Chaos: Permanent error for ${operation}`,
        'chaos-adapter'
      );
    }
    
    if (this.chaos.injectTransientError(operation, resource)) {
      if (this.rng.nextBool(0.2)) { // 20% throttle
        throw new ThrottledError(
          `Chaos: Throttled ${operation}`,
          'chaos-adapter'
        );
      }
      
      if (this.rng.nextBool(0.1)) { // 10% network error
        throw new TransientNetworkError(
          `Chaos: Network error for ${operation}`,
          'chaos-adapter'
        );
      }
    }
    
    // Inject latency
    const latency = this.chaos.injectLatency(operation, resource);
    if (latency > 0) {
      await new Promise(resolve => setTimeout(resolve, latency));
    }
  }
}

/**
 * KMS chaos adapter
 */
class ChaosKmsAdapter extends BaseChaosAdapter implements KmsProvider {
  constructor(
    private inner: KmsProvider,
    chaos: ChaosOptions,
    rng: SeededRandom
  ) {
    super(chaos, rng);
  }
  
  async encrypt(ctx: ProviderContext, input: Uint8Array, options: any): Promise<any> {
    await this.injectChaos('encrypt', options.keyId);
    return await this.inner.encrypt(ctx, input, options);
  }
  
  async decrypt(ctx: ProviderContext, ciphertext: Uint8Array, options: any): Promise<any> {
    await this.injectChaos('decrypt', options.keyId || 'unknown');
    return await this.inner.decrypt(ctx, ciphertext, options);
  }
  
  async sign(ctx: ProviderContext, data: Uint8Array, options: any): Promise<any> {
    await this.injectChaos('sign', options.keyId);
    return await this.inner.sign(ctx, data, options);
  }
  
  async verify(ctx: ProviderContext, data: Uint8Array, signature: Uint8Array, options: any): Promise<any> {
    await this.injectChaos('verify', options.keyId);
    return await this.inner.verify(ctx, data, signature, options);
  }
  
  async createKey(ctx: ProviderContext, options: any): Promise<any> {
    await this.injectChaos('createKey', options.alias || 'new-key');
    return await this.inner.createKey(ctx, options);
  }
  
  async rotateKey(ctx: ProviderContext, keyId: string, options?: any): Promise<any> {
    await this.injectChaos('rotateKey', keyId);
    return await this.inner.rotateKey(ctx, keyId, options);
  }
  
  async getKey(ctx: ProviderContext, keyId: string, options?: any): Promise<any> {
    await this.injectChaos('getKey', keyId);
    return await this.inner.getKey(ctx, keyId, options);
  }
  
  async listKeys(ctx: ProviderContext, options?: any): Promise<any> {
    await this.injectChaos('listKeys', 'keys');
    return await this.inner.listKeys(ctx, options);
  }
  
  async setKeyEnabled(ctx: ProviderContext, keyId: string, enabled: boolean, options?: any): Promise<void> {
    await this.injectChaos('setKeyEnabled', keyId);
    return await this.inner.setKeyEnabled(ctx, keyId, enabled, options);
  }
}

/**
 * Placeholder chaos adapters for other capabilities
 * These follow the same pattern as KmsAdapter
 */
class ChaosSecretStoreAdapter extends BaseChaosAdapter implements SecretStoreProvider {
  constructor(private inner: SecretStoreProvider, chaos: ChaosOptions, rng: SeededRandom) {
    super(chaos, rng);
  }
  
  // Implement all SecretStoreProvider methods with chaos injection
  async putSecret(ctx: ProviderContext, name: string, value: Uint8Array, options?: any): Promise<any> {
    await this.injectChaos('putSecret', name);
    return await this.inner.putSecret(ctx, name, value, options);
  }
  
  async getSecret(ctx: ProviderContext, name: string, options?: any): Promise<any> {
    await this.injectChaos('getSecret', name);
    return await this.inner.getSecret(ctx, name, options);
  }
  
  async deleteSecret(ctx: ProviderContext, name: string, options?: any): Promise<void> {
    await this.injectChaos('deleteSecret', name);
    return await this.inner.deleteSecret(ctx, name, options);
  }
  
  async listSecrets(ctx: ProviderContext, options?: any): Promise<any> {
    await this.injectChaos('listSecrets', 'secrets');
    return await this.inner.listSecrets(ctx, options);
  }
  
  async listVersions(ctx: ProviderContext, name: string, options?: any): Promise<any> {
    await this.injectChaos('listVersions', name);
    return await this.inner.listVersions(ctx, name, options);
  }
  
  async secretExists(ctx: ProviderContext, name: string, options?: any): Promise<boolean> {
    await this.injectChaos('secretExists', name);
    return await this.inner.secretExists(ctx, name, options);
  }
  
  async rotateSecret(ctx: ProviderContext, name: string, options?: any): Promise<any> {
    await this.injectChaos('rotateSecret', name);
    return await this.inner.rotateSecret(ctx, name, options);
  }
  
  async updateSecretMetadata(ctx: ProviderContext, name: string, metadata: any, options?: any): Promise<void> {
    await this.injectChaos('updateSecretMetadata', name);
    return await this.inner.updateSecretMetadata(ctx, name, metadata, options);
  }
}

class ChaosBlobStorageAdapter extends BaseChaosAdapter implements BlobStorageProvider {
  constructor(private inner: BlobStorageProvider, chaos: ChaosOptions, rng: SeededRandom) {
    super(chaos, rng);
  }
  
  // Implement core BlobStorageProvider methods with chaos injection
  async putObject(ctx: ProviderContext, key: string, body: any, options?: any): Promise<any> {
    await this.injectChaos('putObject', key);
    return await this.inner.putObject(ctx, key, body, options);
  }
  
  async getObject(ctx: ProviderContext, key: string, options?: any): Promise<any> {
    await this.injectChaos('getObject', key);
    return await this.inner.getObject(ctx, key, options);
  }
  
  async deleteObject(ctx: ProviderContext, key: string, options?: any): Promise<void> {
    await this.injectChaos('deleteObject', key);
    return await this.inner.deleteObject(ctx, key, options);
  }
  
  async listObjects(ctx: ProviderContext, options?: any): Promise<any> {
    await this.injectChaos('listObjects', 'objects');
    return await this.inner.listObjects(ctx, options);
  }
  
  async headObject(ctx: ProviderContext, key: string, options?: any): Promise<any> {
    await this.injectChaos('headObject', key);
    return await this.inner.headObject(ctx, key, options);
  }
  
  async objectExists(ctx: ProviderContext, key: string, options?: any): Promise<boolean> {
    await this.injectChaos('objectExists', key);
    return await this.inner.objectExists(ctx, key, options);
  }
  
  async copyObject(ctx: ProviderContext, sourceKey: string, destinationKey: string, options?: any): Promise<any> {
    await this.injectChaos('copyObject', sourceKey);
    return await this.inner.copyObject(ctx, sourceKey, destinationKey, options);
  }
  
  async createSignedUrl(ctx: ProviderContext, key: string, options: any): Promise<any> {
    await this.injectChaos('createSignedUrl', key);
    return await this.inner.createSignedUrl(ctx, key, options);
  }
  
  async createMultipartUpload(ctx: ProviderContext, key: string, options?: any): Promise<any> {
    await this.injectChaos('createMultipartUpload', key);
    return await this.inner.createMultipartUpload(ctx, key, options);
  }
  
  async uploadPart(ctx: ProviderContext, uploadId: string, partNumber: number, body: Uint8Array, options?: any): Promise<any> {
    await this.injectChaos('uploadPart', uploadId);
    return await this.inner.uploadPart(ctx, uploadId, partNumber, body, options);
  }
  
  async completeMultipartUpload(ctx: ProviderContext, uploadId: string, parts: any[], options?: any): Promise<any> {
    await this.injectChaos('completeMultipartUpload', uploadId);
    return await this.inner.completeMultipartUpload(ctx, uploadId, parts, options);
  }
  
  async abortMultipartUpload(ctx: ProviderContext, uploadId: string, options?: any): Promise<void> {
    await this.injectChaos('abortMultipartUpload', uploadId);
    return await this.inner.abortMultipartUpload(ctx, uploadId, options);
  }
}

class ChaosQueueAdapter extends BaseChaosAdapter implements QueueProvider {
  constructor(private inner: QueueProvider, chaos: ChaosOptions, rng: SeededRandom) {
    super(chaos, rng);
  }
  
  // Implement core QueueProvider methods - abbreviated for space
  async enqueue(ctx: ProviderContext, queueName: string, body: Uint8Array, options?: any): Promise<any> {
    await this.injectChaos('enqueue', queueName);
    return await this.inner.enqueue(ctx, queueName, body, options);
  }
  
  async dequeue(ctx: ProviderContext, queueName: string, options?: any): Promise<any> {
    await this.injectChaos('dequeue', queueName);
    return await this.inner.dequeue(ctx, queueName, options);
  }
  
  async ack(ctx: ProviderContext, queueName: string, receiptHandle: string, options?: any): Promise<void> {
    await this.injectChaos('ack', queueName);
    return await this.inner.ack(ctx, queueName, receiptHandle, options);
  }
  
  async nack(ctx: ProviderContext, queueName: string, receiptHandle: string, options?: any): Promise<void> {
    await this.injectChaos('nack', queueName);
    return await this.inner.nack(ctx, queueName, receiptHandle, options);
  }
  
  async createQueue(ctx: ProviderContext, queueName: string, options?: any): Promise<any> {
    await this.injectChaos('createQueue', queueName);
    return await this.inner.createQueue(ctx, queueName, options);
  }
  
  async deleteQueue(ctx: ProviderContext, queueName: string, options?: any): Promise<void> {
    await this.injectChaos('deleteQueue', queueName);
    return await this.inner.deleteQueue(ctx, queueName, options);
  }
  
  async getQueue(ctx: ProviderContext, queueName: string, options?: any): Promise<any> {
    await this.injectChaos('getQueue', queueName);
    return await this.inner.getQueue(ctx, queueName, options);
  }
  
  async listQueues(ctx: ProviderContext, options?: any): Promise<any> {
    await this.injectChaos('listQueues', 'queues');
    return await this.inner.listQueues(ctx, options);
  }
  
  async purgeQueue(ctx: ProviderContext, queueName: string, options?: any): Promise<void> {
    await this.injectChaos('purgeQueue', queueName);
    return await this.inner.purgeQueue(ctx, queueName, options);
  }
  
  async changeMessageVisibility(ctx: ProviderContext, queueName: string, receiptHandle: string, timeoutSeconds: number, options?: any): Promise<void> {
    await this.injectChaos('changeMessageVisibility', queueName);
    return await this.inner.changeMessageVisibility(ctx, queueName, receiptHandle, timeoutSeconds, options);
  }
}

class ChaosMetadataStoreAdapter extends BaseChaosAdapter implements MetadataStoreProvider {
  constructor(private inner: MetadataStoreProvider, chaos: ChaosOptions, rng: SeededRandom) {
    super(chaos, rng);
  }
  
  // Implement core MetadataStoreProvider methods - abbreviated
  async put(ctx: ProviderContext, key: string, value: unknown, options?: any): Promise<any> {
    await this.injectChaos('put', key);
    return await this.inner.put(ctx, key, value, options);
  }
  
  async get(ctx: ProviderContext, key: string, options?: any): Promise<any> {
    await this.injectChaos('get', key);
    return await this.inner.get(ctx, key, options);
  }
  
  async delete(ctx: ProviderContext, key: string, options?: any): Promise<void> {
    await this.injectChaos('delete', key);
    return await this.inner.delete(ctx, key, options);
  }
  
  async list(ctx: ProviderContext, options?: any): Promise<any> {
    await this.injectChaos('list', 'metadata');
    return await this.inner.list(ctx, options);
  }
  
  async exists(ctx: ProviderContext, key: string, options?: any): Promise<boolean> {
    await this.injectChaos('exists', key);
    return await this.inner.exists(ctx, key, options);
  }
  
  async batchGet(ctx: ProviderContext, keys: string[], options?: any): Promise<any> {
    await this.injectChaos('batchGet', keys.join(','));
    return await this.inner.batchGet(ctx, keys, options);
  }
  
  async batchPut(ctx: ProviderContext, items: any[], options?: any): Promise<any> {
    await this.injectChaos('batchPut', 'batch');
    return await this.inner.batchPut(ctx, items, options);
  }
  
  async batchDelete(ctx: ProviderContext, keys: string[], options?: any): Promise<any> {
    await this.injectChaos('batchDelete', keys.join(','));
    return await this.inner.batchDelete(ctx, keys, options);
  }
  
  async compareAndSwap(ctx: ProviderContext, key: string, expectedVersion: string, newValue: unknown, options?: any): Promise<any> {
    await this.injectChaos('compareAndSwap', key);
    return await this.inner.compareAndSwap(ctx, key, expectedVersion, newValue, options);
  }
  
  async transaction(ctx: ProviderContext, operations: any[], options?: any): Promise<any> {
    await this.injectChaos('transaction', 'txn');
    return await this.inner.transaction(ctx, operations, options);
  }
  
  async increment(ctx: ProviderContext, key: string, delta: number, options?: any): Promise<any> {
    await this.injectChaos('increment', key);
    return await this.inner.increment(ctx, key, delta, options);
  }
}