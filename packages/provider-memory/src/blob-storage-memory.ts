/**
 * Memory Blob Storage Provider Implementation
 * In-memory object storage for testing and development
 */

import { createHash } from 'crypto';
import {
  BlobStorageProvider,
  ProviderContext,
  PutObjectOptions,
  GetObjectOptions,
  ListObjectsOptions,
  CreateSignedUrlOptions,
  BlobBaseOptions,
  ObjectInfo,
  ObjectContent,
  PutObjectResult,
  ListObjectsResult,
  SignedUrlResult,
  ErrorFactory,
  ErrorCode
} from '@ragnos-vault/sdk';
import { MemoryProviderConfig } from './config';

/**
 * Internal object representation
 */
interface StoredObject {
  key: string;
  body: Buffer;
  etag: string;
  contentType: string;
  metadata: Record<string, string>;
  sha256?: string;
  kmsKeyId?: string;
  lastModified: Date;
  storageClass: string;
}

/**
 * Multipart upload state
 */
interface MultipartUpload {
  uploadId: string;
  key: string;
  parts: Map<number, { etag: string; body: Buffer }>;
  metadata?: Record<string, string>;
  contentType?: string;
  kmsKeyId?: string;
  createdAt: Date;
}

/**
 * Eventual consistency entry
 */
interface EventualEntry<T> {
  value: T;
  applyAt: number; // timestamp when this should become visible
}

/**
 * Blob Storage Memory Implementation
 */
export class BlobStorageMemory implements BlobStorageProvider {
  private objects = new Map<string, StoredObject>();
  private multipartUploads = new Map<string, MultipartUpload>();
  private eventualStore = new Map<string, EventualEntry<StoredObject | null>>();
  private operationCounts = new Map<string, number>();
  
  constructor(private config: MemoryProviderConfig) {
    // Process eventual consistency periodically
    setInterval(() => {
      this.processEventualStore();
    }, 100);
  }
  
  async putObject(
    ctx: ProviderContext,
    key: string,
    body: AsyncIterable<Uint8Array> | Uint8Array,
    options?: PutObjectOptions
  ): Promise<PutObjectResult> {
    this.checkRateLimit('putObject', ctx);
    this.validateKey(key);
    
    // Collect body data
    const bodyBuffer = await this.collectBody(body);
    
    // Check size limits
    if (bodyBuffer.length > this.config.maxObjectSize) {
      throw ErrorFactory.create(
        ErrorCode.InvalidConfig,
        `Object size ${bodyBuffer.length} exceeds maximum ${this.config.maxObjectSize}`,
        'memory-blob',
        { key, size: bodyBuffer.length, maxSize: this.config.maxObjectSize }
      );
    }
    
    // Calculate checksums
    const etag = this.calculateETag(bodyBuffer);
    const sha256 = options?.sha256 || this.calculateSha256(bodyBuffer);
    
    // Verify provided SHA256 if present
    if (options?.sha256) {
      const actualSha256 = this.calculateSha256(bodyBuffer);
      if (actualSha256 !== options.sha256) {
        throw ErrorFactory.create(
          ErrorCode.DataIntegrity,
          `SHA256 mismatch: expected=${options.sha256}, actual=${actualSha256}`,
          'memory-blob',
          { key }
        );
      }
    }
    
    const storedObject: StoredObject = {
      key,
      body: bodyBuffer,
      etag,
      contentType: options?.contentType || 'application/octet-stream',
      metadata: options?.metadata || {},
      sha256,
      kmsKeyId: options?.kmsKeyId,
      lastModified: new Date(),
      storageClass: 'STANDARD'
    };
    
    // Handle eventual consistency
    if (this.config.eventualWindowMs > 0) {
      this.storeEventual(key, storedObject, this.config.eventualWindowMs);
    } else {
      this.objects.set(key, storedObject);
    }
    
    return {
      key,
      etag,
      size: bodyBuffer.length,
      sha256
    };
  }
  
  async getObject(ctx: ProviderContext, key: string, options?: GetObjectOptions): Promise<ObjectContent> {
    this.checkRateLimit('getObject', ctx);
    this.validateKey(key);
    
    const obj = this.getObjectWithEventualConsistency(key);
    if (!obj) {
      throw ErrorFactory.create(
        ErrorCode.NotFound,
        `Object not found: ${key}`,
        'memory-blob',
        { key }
      );
    }
    
    // Handle conditional requests
    if (options?.ifModifiedSince && obj.lastModified <= options.ifModifiedSince) {
      throw ErrorFactory.create(
        ErrorCode.NotFound, // HTTP 304 equivalent
        'Not modified',
        'memory-blob',
        { key }
      );
    }
    
    if (options?.ifNoneMatch && obj.etag === options.ifNoneMatch) {
      throw ErrorFactory.create(
        ErrorCode.NotFound, // HTTP 304 equivalent
        'Not modified',
        'memory-blob',
        { key }
      );
    }
    
    // Handle range requests
    let body = obj.body;
    if (options?.range) {
      const start = options.range.start;
      const end = options.range.end ?? obj.body.length - 1;
      
      if (start >= obj.body.length || start < 0 || end < start) {
        throw ErrorFactory.create(
          ErrorCode.InvalidConfig,
          `Invalid range: ${start}-${end} for object size ${obj.body.length}`,
          'memory-blob',
          { key, range: options.range, size: obj.body.length }
        );
      }
      
      body = obj.body.subarray(start, end + 1);
    }
    
    return {
      key: obj.key,
      etag: obj.etag,
      size: obj.body.length,
      contentType: obj.contentType,
      lastModified: obj.lastModified,
      metadata: obj.metadata,
      storageClass: obj.storageClass,
      sha256: obj.sha256,
      kmsKeyId: obj.kmsKeyId,
      body: this.createAsyncIterable(body)
    };
  }
  
  async deleteObject(ctx: ProviderContext, key: string, options?: BlobBaseOptions): Promise<void> {
    this.checkRateLimit('deleteObject', ctx);
    this.validateKey(key);
    
    // Handle eventual consistency for deletion
    if (this.config.eventualWindowMs > 0) {
      this.storeEventual(key, null, this.config.eventualWindowMs);
    } else {
      this.objects.delete(key);
    }
  }
  
  async listObjects(ctx: ProviderContext, options?: ListObjectsOptions): Promise<ListObjectsResult> {
    this.checkRateLimit('listObjects', ctx);
    
    let objects = Array.from(this.objects.values());
    
    // Apply prefix filter
    if (options?.prefix) {
      objects = objects.filter(obj => obj.key.startsWith(options.prefix!));
    }
    
    // Sort by key
    objects.sort((a, b) => a.key.localeCompare(b.key));
    
    // Handle pagination
    const startIndex = options?.continuationToken ? parseInt(options.continuationToken, 10) : 0;
    const maxKeys = options?.maxKeys || 1000;
    const pageObjects = objects.slice(startIndex, startIndex + maxKeys);
    
    // Handle delimiter (common prefixes)
    const prefixes: string[] = [];
    if (options?.delimiter) {
      const seenPrefixes = new Set<string>();
      const delimiter = options.delimiter;
      
      pageObjects.forEach(obj => {
        const afterPrefix = options?.prefix ? obj.key.substring(options.prefix.length) : obj.key;
        const delimiterIndex = afterPrefix.indexOf(delimiter);
        
        if (delimiterIndex >= 0) {
          const prefix = (options?.prefix || '') + afterPrefix.substring(0, delimiterIndex + delimiter.length);
          seenPrefixes.add(prefix);
        }
      });
      
      prefixes.push(...Array.from(seenPrefixes).sort());
    }
    
    const continuationToken = (startIndex + maxKeys < objects.length) ? (startIndex + maxKeys).toString() : undefined;
    
    return {
      objects: pageObjects.map(obj => this.objectToInfo(obj)),
      prefixes,
      continuationToken,
      isTruncated: Boolean(continuationToken)
    };
  }
  
  async headObject(ctx: ProviderContext, key: string, options?: BlobBaseOptions): Promise<ObjectInfo> {
    this.checkRateLimit('headObject', ctx);
    this.validateKey(key);
    
    const obj = this.getObjectWithEventualConsistency(key);
    if (!obj) {
      throw ErrorFactory.create(
        ErrorCode.NotFound,
        `Object not found: ${key}`,
        'memory-blob',
        { key }
      );
    }
    
    return this.objectToInfo(obj);
  }
  
  async objectExists(ctx: ProviderContext, key: string, options?: BlobBaseOptions): Promise<boolean> {
    this.checkRateLimit('objectExists', ctx);
    this.validateKey(key);
    
    return this.getObjectWithEventualConsistency(key) !== null;
  }
  
  async copyObject(
    ctx: ProviderContext,
    sourceKey: string,
    destinationKey: string,
    options?: { metadata?: Record<string, string>; kmsKeyId?: string } & BlobBaseOptions
  ): Promise<PutObjectResult> {
    this.checkRateLimit('copyObject', ctx);
    this.validateKey(sourceKey);
    this.validateKey(destinationKey);
    
    const sourceObj = this.getObjectWithEventualConsistency(sourceKey);
    if (!sourceObj) {
      throw ErrorFactory.create(
        ErrorCode.NotFound,
        `Source object not found: ${sourceKey}`,
        'memory-blob',
        { sourceKey }
      );
    }
    
    const destinationObj: StoredObject = {
      key: destinationKey,
      body: Buffer.from(sourceObj.body), // Copy the data
      etag: this.calculateETag(sourceObj.body),
      contentType: sourceObj.contentType,
      metadata: options?.metadata || sourceObj.metadata,
      sha256: sourceObj.sha256,
      kmsKeyId: options?.kmsKeyId || sourceObj.kmsKeyId,
      lastModified: new Date(),
      storageClass: sourceObj.storageClass
    };
    
    this.objects.set(destinationKey, destinationObj);
    
    return {
      key: destinationKey,
      etag: destinationObj.etag,
      size: destinationObj.body.length,
      sha256: destinationObj.sha256
    };
  }
  
  async createSignedUrl(ctx: ProviderContext, key: string, options: CreateSignedUrlOptions): Promise<SignedUrlResult> {
    this.checkRateLimit('createSignedUrl', ctx);
    this.validateKey(key);
    
    // Create a mock signed URL (not actually functional)
    const expiresAt = new Date(Date.now() + options.expiresIn * 1000);
    const signature = this.calculateSha256(Buffer.from(`${key}:${options.method}:${expiresAt.getTime()}`));
    
    const url = `https://mock-storage.example.com/${encodeURIComponent(key)}?` +
      `signature=${signature}&expires=${expiresAt.getTime()}&method=${options.method}`;
    
    return {
      url,
      expiresAt,
      method: options.method
    };
  }
  
  async createMultipartUpload(
    ctx: ProviderContext,
    key: string,
    options?: { contentType?: string; kmsKeyId?: string; metadata?: Record<string, string> } & BlobBaseOptions
  ): Promise<{ uploadId: string; key: string }> {
    this.checkRateLimit('createMultipartUpload', ctx);
    this.validateKey(key);
    
    const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const upload: MultipartUpload = {
      uploadId,
      key,
      parts: new Map(),
      metadata: options?.metadata,
      contentType: options?.contentType,
      kmsKeyId: options?.kmsKeyId,
      createdAt: new Date()
    };
    
    this.multipartUploads.set(uploadId, upload);
    
    return { uploadId, key };
  }
  
  async uploadPart(
    ctx: ProviderContext,
    uploadId: string,
    partNumber: number,
    body: Uint8Array,
    options?: BlobBaseOptions
  ): Promise<{ etag: string; partNumber: number }> {
    this.checkRateLimit('uploadPart', ctx);
    
    const upload = this.multipartUploads.get(uploadId);
    if (!upload) {
      throw ErrorFactory.create(
        ErrorCode.NotFound,
        `Multipart upload not found: ${uploadId}`,
        'memory-blob',
        { uploadId }
      );
    }
    
    if (partNumber < 1 || partNumber > 10000) {
      throw ErrorFactory.create(
        ErrorCode.InvalidConfig,
        `Invalid part number: ${partNumber} (must be 1-10000)`,
        'memory-blob',
        { uploadId, partNumber }
      );
    }
    
    const bodyBuffer = Buffer.from(body);
    const etag = this.calculateETag(bodyBuffer);
    
    upload.parts.set(partNumber, { etag, body: bodyBuffer });
    
    return { etag, partNumber };
  }
  
  async completeMultipartUpload(
    ctx: ProviderContext,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
    options?: BlobBaseOptions
  ): Promise<PutObjectResult> {
    this.checkRateLimit('completeMultipartUpload', ctx);
    
    const upload = this.multipartUploads.get(uploadId);
    if (!upload) {
      throw ErrorFactory.create(
        ErrorCode.NotFound,
        `Multipart upload not found: ${uploadId}`,
        'memory-blob',
        { uploadId }
      );
    }
    
    // Validate all parts are present and ETags match
    parts.sort((a, b) => a.partNumber - b.partNumber);
    
    const bodyChunks: Buffer[] = [];
    for (const partRef of parts) {
      const part = upload.parts.get(partRef.partNumber);
      if (!part) {
        throw ErrorFactory.create(
          ErrorCode.NotFound,
          `Part ${partRef.partNumber} not found for upload ${uploadId}`,
          'memory-blob',
          { uploadId, partNumber: partRef.partNumber }
        );
      }
      
      if (part.etag !== partRef.etag) {
        throw ErrorFactory.create(
          ErrorCode.DataIntegrity,
          `Part ${partRef.partNumber} ETag mismatch: expected=${partRef.etag}, actual=${part.etag}`,
          'memory-blob',
          { uploadId, partNumber: partRef.partNumber }
        );
      }
      
      bodyChunks.push(part.body);
    }
    
    const completeBody = Buffer.concat(bodyChunks);
    const etag = this.calculateETag(completeBody);
    const sha256 = this.calculateSha256(completeBody);
    
    const storedObject: StoredObject = {
      key: upload.key,
      body: completeBody,
      etag,
      contentType: upload.contentType || 'application/octet-stream',
      metadata: upload.metadata || {},
      sha256,
      kmsKeyId: upload.kmsKeyId,
      lastModified: new Date(),
      storageClass: 'STANDARD'
    };
    
    this.objects.set(upload.key, storedObject);
    this.multipartUploads.delete(uploadId);
    
    return {
      key: upload.key,
      etag,
      size: completeBody.length,
      sha256
    };
  }
  
  async abortMultipartUpload(ctx: ProviderContext, uploadId: string, options?: BlobBaseOptions): Promise<void> {
    this.checkRateLimit('abortMultipartUpload', ctx);
    
    if (!this.multipartUploads.has(uploadId)) {
      throw ErrorFactory.create(
        ErrorCode.NotFound,
        `Multipart upload not found: ${uploadId}`,
        'memory-blob',
        { uploadId }
      );
    }
    
    this.multipartUploads.delete(uploadId);
  }
  
  private async collectBody(body: AsyncIterable<Uint8Array> | Uint8Array): Promise<Buffer> {
    if (body instanceof Uint8Array) {
      return Buffer.from(body);
    }
    
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.from(chunk));
    }
    
    return Buffer.concat(chunks);
  }
  
  private validateKey(key: string): void {
    if (!key || key.length === 0) {
      throw ErrorFactory.create(
        ErrorCode.InvalidConfig,
        'Object key cannot be empty',
        'memory-blob'
      );
    }
    
    if (key.length > 1024) {
      throw ErrorFactory.create(
        ErrorCode.InvalidConfig,
        `Object key too long: ${key.length} (max 1024)`,
        'memory-blob',
        { key: key.substring(0, 100) + '...' }
      );
    }
  }
  
  private calculateETag(data: Buffer): string {
    return `"${createHash('md5').update(data).digest('hex')}"`;
  }
  
  private calculateSha256(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }
  
  private objectToInfo(obj: StoredObject): ObjectInfo {
    return {
      key: obj.key,
      etag: obj.etag,
      size: obj.body.length,
      contentType: obj.contentType,
      lastModified: obj.lastModified,
      metadata: obj.metadata,
      storageClass: obj.storageClass,
      sha256: obj.sha256,
      kmsKeyId: obj.kmsKeyId
    };
  }
  
  private async *createAsyncIterable(data: Buffer): AsyncIterable<Uint8Array> {
    const chunkSize = 64 * 1024; // 64KB chunks
    
    for (let i = 0; i < data.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, data.length);
      yield new Uint8Array(data.subarray(i, end));
    }
  }
  
  private getObjectWithEventualConsistency(key: string): StoredObject | null {
    // Check eventual store first
    const eventualEntry = this.eventualStore.get(key);
    if (eventualEntry && Date.now() >= eventualEntry.applyAt) {
      // Entry is ready to be applied
      if (eventualEntry.value === null) {
        this.objects.delete(key);
      } else {
        this.objects.set(key, eventualEntry.value);
      }
      this.eventualStore.delete(key);
      return eventualEntry.value;
    }
    
    // Return current value if no eventual entry or not ready
    return this.objects.get(key) || null;
  }
  
  private storeEventual(key: string, value: StoredObject | null, delayMs: number): void {
    this.eventualStore.set(key, {
      value,
      applyAt: Date.now() + delayMs
    });
  }
  
  private processEventualStore(): void {
    const now = Date.now();
    
    for (const [key, entry] of this.eventualStore.entries()) {
      if (entry.applyAt <= now) {
        if (entry.value === null) {
          this.objects.delete(key);
        } else {
          this.objects.set(key, entry.value);
        }
        this.eventualStore.delete(key);
      }
    }
  }
  
  private checkRateLimit(operation: string, ctx: ProviderContext): void {
    if (!this.config.qpsLimits) return;
    
    const limit = this.config.qpsLimits[operation] || this.config.qpsLimits.default;
    const key = `${operation}:${ctx.tenantId}`;
    const count = (this.operationCounts.get(key) || 0) + 1;
    
    if (count > limit) {
      throw ErrorFactory.create(
        ErrorCode.Throttled,
        `Rate limit exceeded for ${operation}: ${count}/${limit}`,
        'memory-blob',
        { operation, count, limit }
      );
    }
    
    this.operationCounts.set(key, count);
    
    // Reset counters periodically
    setTimeout(() => {
      this.operationCounts.delete(key);
    }, 1000);
  }
}