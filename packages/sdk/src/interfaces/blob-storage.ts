/**
 * Blob Storage Interface  
 * Object storage for files and large data
 */

import { ProviderContext } from '../types/context';

/**
 * Blob storage operation options
 */
export interface BlobBaseOptions {
  idempotencyKey?: string;
}

export interface PutObjectOptions extends BlobBaseOptions {
  contentType?: string;
  sha256?: string; // Content hash for integrity
  kmsKeyId?: string; // Server-side encryption key
  metadata?: Record<string, string>;
  cacheControl?: string;
  contentEncoding?: string;
  contentLanguage?: string;
}

export interface GetObjectOptions extends BlobBaseOptions {
  range?: {
    start: number;
    end?: number;
  };
  ifModifiedSince?: Date;
  ifNoneMatch?: string; // ETag
}

export interface ListObjectsOptions extends BlobBaseOptions {
  prefix?: string;
  delimiter?: string;
  maxKeys?: number;
  continuationToken?: string;
}

export interface CreateSignedUrlOptions extends BlobBaseOptions {
  expiresIn: number; // seconds
  method: 'GET' | 'PUT' | 'DELETE';
  contentType?: string;
}

/**
 * Object metadata and content
 */
export interface ObjectInfo {
  key: string;
  etag: string;
  size: number;
  contentType: string;
  lastModified: Date;
  metadata: Record<string, string>;
  storageClass?: string;
  sha256?: string;
  kmsKeyId?: string;
}

export interface ObjectContent extends ObjectInfo {
  body: AsyncIterable<Uint8Array>;
}

/**
 * Blob storage operation results
 */
export interface PutObjectResult {
  key: string;
  etag: string;
  size: number;
  sha256?: string;
}

export interface ListObjectsResult {
  objects: ObjectInfo[];
  prefixes: string[]; // Common prefixes when using delimiter
  continuationToken?: string;
  isTruncated: boolean;
}

export interface SignedUrlResult {
  url: string;
  expiresAt: Date;
  method: string;
}

/**
 * Blob Storage interface
 */
export interface BlobStorageProvider {
  /**
   * Upload an object to storage
   */
  putObject(
    ctx: ProviderContext,
    key: string,
    body: AsyncIterable<Uint8Array> | Uint8Array,
    options?: PutObjectOptions
  ): Promise<PutObjectResult>;
  
  /**
   * Download an object from storage
   */
  getObject(
    ctx: ProviderContext,
    key: string,
    options?: GetObjectOptions
  ): Promise<ObjectContent>;
  
  /**
   * Delete an object from storage
   */
  deleteObject(
    ctx: ProviderContext,
    key: string,
    options?: BlobBaseOptions
  ): Promise<void>;
  
  /**
   * List objects with optional prefix filtering
   */
  listObjects(
    ctx: ProviderContext,
    options?: ListObjectsOptions
  ): Promise<ListObjectsResult>;
  
  /**
   * Get object metadata without downloading content
   */
  headObject(
    ctx: ProviderContext,
    key: string,
    options?: BlobBaseOptions
  ): Promise<ObjectInfo>;
  
  /**
   * Check if an object exists
   */
  objectExists(
    ctx: ProviderContext,
    key: string,
    options?: BlobBaseOptions
  ): Promise<boolean>;
  
  /**
   * Copy an object within storage
   */
  copyObject(
    ctx: ProviderContext,
    sourceKey: string,
    destinationKey: string,
    options?: {
      metadata?: Record<string, string>;
      kmsKeyId?: string;
    } & BlobBaseOptions
  ): Promise<PutObjectResult>;
  
  /**
   * Create a signed URL for direct access
   */
  createSignedUrl(
    ctx: ProviderContext,
    key: string,
    options: CreateSignedUrlOptions
  ): Promise<SignedUrlResult>;
  
  /**
   * Start multipart upload for large objects
   */
  createMultipartUpload(
    ctx: ProviderContext,
    key: string,
    options?: {
      contentType?: string;
      kmsKeyId?: string;
      metadata?: Record<string, string>;
    } & BlobBaseOptions
  ): Promise<{
    uploadId: string;
    key: string;
  }>;
  
  /**
   * Upload a part in multipart upload
   */
  uploadPart(
    ctx: ProviderContext,
    uploadId: string,
    partNumber: number,
    body: Uint8Array,
    options?: BlobBaseOptions
  ): Promise<{
    etag: string;
    partNumber: number;
  }>;
  
  /**
   * Complete multipart upload
   */
  completeMultipartUpload(
    ctx: ProviderContext,
    uploadId: string,
    parts: Array<{
      partNumber: number;
      etag: string;
    }>,
    options?: BlobBaseOptions
  ): Promise<PutObjectResult>;
  
  /**
   * Abort multipart upload
   */
  abortMultipartUpload(
    ctx: ProviderContext,
    uploadId: string,
    options?: BlobBaseOptions
  ): Promise<void>;
}