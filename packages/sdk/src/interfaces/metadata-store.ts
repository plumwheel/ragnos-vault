/**
 * Metadata Store Interface
 * Key-value storage for metadata and small structured data
 */

import { ProviderContext } from '../types/context';

/**
 * Metadata store operation options
 */
export interface MetadataBaseOptions {
  idempotencyKey?: string;
}

export interface PutOptions extends MetadataBaseOptions {
  ifNoneMatch?: boolean; // Only put if key doesn't exist
  ifMatch?: string; // Only put if current version matches
  ttl?: number; // Time to live in seconds
}

export interface GetOptions extends MetadataBaseOptions {
  consistentRead?: boolean;
}

export interface ListOptions extends MetadataBaseOptions {
  prefix?: string;
  limit?: number;
  nextToken?: string;
  consistentRead?: boolean;
}

export interface TransactionOptions extends MetadataBaseOptions {
  isolation?: 'READ_COMMITTED' | 'SERIALIZABLE';
}

/**
 * Metadata item structure
 */
export interface MetadataItem {
  key: string;
  value: unknown;
  version: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  contentType?: string;
}

/**
 * Transaction operation types
 */
export interface TransactionOperation {
  type: 'PUT' | 'DELETE' | 'CHECK';
  key: string;
  value?: unknown;
  condition?: {
    exists?: boolean;
    version?: string;
    value?: unknown;
  };
}

/**
 * Metadata store operation results
 */
export interface PutResult {
  key: string;
  version: string;
  createdAt: Date;
}

export interface ListResult {
  items: MetadataItem[];
  nextToken?: string;
  totalCount?: number;
}

export interface TransactionResult {
  operations: Array<{
    operation: TransactionOperation;
    success: boolean;
    version?: string;
    error?: string;
  }>;
  allSucceeded: boolean;
}

/**
 * Metadata Store interface
 */
export interface MetadataStoreProvider {
  /**
   * Store a key-value pair
   */
  put(
    ctx: ProviderContext,
    key: string,
    value: unknown,
    options?: PutOptions
  ): Promise<PutResult>;
  
  /**
   * Retrieve a value by key
   */
  get(
    ctx: ProviderContext,
    key: string,
    options?: GetOptions
  ): Promise<MetadataItem | null>;
  
  /**
   * Delete a key-value pair
   */
  delete(
    ctx: ProviderContext,
    key: string,
    options?: {
      ifMatch?: string; // Only delete if version matches
    } & MetadataBaseOptions
  ): Promise<void>;
  
  /**
   * List keys and values with optional prefix filtering
   */
  list(
    ctx: ProviderContext,
    options?: ListOptions
  ): Promise<ListResult>;
  
  /**
   * Check if a key exists
   */
  exists(
    ctx: ProviderContext,
    key: string,
    options?: MetadataBaseOptions
  ): Promise<boolean>;
  
  /**
   * Batch get multiple keys
   */
  batchGet(
    ctx: ProviderContext,
    keys: string[],
    options?: {
      consistentRead?: boolean;
    } & MetadataBaseOptions
  ): Promise<{
    items: MetadataItem[];
    missing: string[];
  }>;
  
  /**
   * Batch put multiple key-value pairs
   */
  batchPut(
    ctx: ProviderContext,
    items: Array<{
      key: string;
      value: unknown;
      ttl?: number;
    }>,
    options?: MetadataBaseOptions
  ): Promise<{
    results: PutResult[];
    failed: Array<{
      key: string;
      error: string;
    }>;
  }>;
  
  /**
   * Batch delete multiple keys
   */
  batchDelete(
    ctx: ProviderContext,
    keys: string[],
    options?: MetadataBaseOptions
  ): Promise<{
    deleted: string[];
    failed: Array<{
      key: string;
      error: string;
    }>;
  }>;
  
  /**
   * Compare-and-swap operation
   */
  compareAndSwap(
    ctx: ProviderContext,
    key: string,
    expectedVersion: string,
    newValue: unknown,
    options?: MetadataBaseOptions
  ): Promise<{
    success: boolean;
    currentVersion?: string;
    result?: PutResult;
  }>;
  
  /**
   * Execute multiple operations in a transaction
   */
  transaction(
    ctx: ProviderContext,
    operations: TransactionOperation[],
    options?: TransactionOptions
  ): Promise<TransactionResult>;
  
  /**
   * Increment a numeric value atomically
   */
  increment(
    ctx: ProviderContext,
    key: string,
    delta: number,
    options?: {
      initialValue?: number;
      ttl?: number;
    } & MetadataBaseOptions
  ): Promise<{
    key: string;
    value: number;
    version: string;
  }>;
}