/**
 * Core Provider Interface for RAGnos Vault
 * Universal secrets management provider abstraction
 */

/**
 * Provider capabilities - what operations this provider supports
 */
export interface ProviderCapabilities {
  read: boolean;
  write: boolean;
  delete: boolean;
  list: boolean;
  versions?: boolean;
  rotate?: boolean;
  batch?: boolean;
}

/**
 * Secret reference for provider operations
 */
export interface SecretRef {
  key: string;
  path?: string;
  env?: string;
  version?: string;
}

/**
 * Secret item with optional value and metadata
 */
export interface SecretItem {
  key: string;
  value?: string;
  version?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, string>;
}

/**
 * Write operation request
 */
export interface WriteSecretRequest {
  key: string;
  value: string;
  path?: string;
  env?: string;
  metadata?: Record<string, string>;
}

/**
 * List operation scope
 */
export interface ListScope {
  path?: string;
  env?: string;
  prefix?: string;
  limit?: number;
}

/**
 * Provider health status
 */
export interface ProviderHealth {
  ok: boolean;
  details?: any;
  timestamp: Date;
}

/**
 * Provider error codes (standardized across all providers)
 */
export type ProviderErrorCode =
  | 'NotFound'
  | 'AlreadyExists'
  | 'PermissionDenied'
  | 'RateLimited'
  | 'Unavailable'
  | 'InvalidRequest'
  | 'Unknown';

/**
 * Standardized provider error
 */
export class ProviderError extends Error {
  public readonly code: ProviderErrorCode;
  public readonly cause?: any;
  public readonly retryable: boolean;

  constructor(code: ProviderErrorCode, message: string, cause?: any) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.cause = cause;
    
    // Determine if error is retryable
    this.retryable = ['RateLimited', 'Unavailable'].includes(code);
    
    // Maintain stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ProviderError);
    }
  }

  /**
   * Create error from unknown cause
   */
  static fromUnknown(cause: unknown, message?: string): ProviderError {
    const errorMessage = message || 
      (cause instanceof Error ? cause.message : String(cause));
    
    return new ProviderError('Unknown', errorMessage, cause);
  }

  /**
   * Determine if an error should be retried
   */
  static isRetryable(error: unknown): boolean {
    if (error instanceof ProviderError) {
      return error.retryable;
    }
    return false;
  }
}

/**
 * Universal secrets provider interface
 * All providers must implement this interface
 */
export interface ISecretProvider {
  /**
   * Provider name/identifier
   */
  name(): string;

  /**
   * Get provider capabilities
   */
  capabilities(): ProviderCapabilities;

  /**
   * Check provider health and connectivity
   */
  healthCheck(): Promise<ProviderHealth>;

  /**
   * Get a secret by reference
   */
  get(ref: SecretRef): Promise<SecretItem>;

  /**
   * Set/update a secret
   */
  set(request: WriteSecretRequest): Promise<SecretItem>;

  /**
   * Delete a secret
   */
  delete(ref: SecretRef): Promise<void>;

  /**
   * List secrets in scope
   */
  list(scope?: ListScope): Promise<SecretItem[]>;

  /**
   * Rotate a secret (optional capability)
   */
  rotate?(ref: SecretRef): Promise<SecretItem>;

  /**
   * Batch operations (optional capability)
   */
  batch?(operations: BatchOperation[]): Promise<BatchResult[]>;

  /**
   * Provider-specific configuration
   */
  getConfig?(): Record<string, any>;

  /**
   * Shutdown/cleanup resources
   */
  shutdown?(): Promise<void>;
}

/**
 * Batch operation types
 */
export type BatchOperation =
  | { type: 'read'; ref: SecretRef; id?: string }
  | { type: 'write'; request: WriteSecretRequest; id?: string }
  | { type: 'delete'; ref: SecretRef; id?: string };

/**
 * Batch operation result
 */
export interface BatchResult {
  id?: string;
  success: boolean;
  result?: SecretItem;
  error?: ProviderError;
}

/**
 * Provider factory function type
 */
export type ProviderFactory<TConfig = any> = (config: TConfig) => ISecretProvider;

/**
 * Provider registration info
 */
export interface ProviderRegistration {
  name: string;
  type: string;
  factory: ProviderFactory;
  capabilities: ProviderCapabilities;
}

/**
 * Utility functions for provider development
 */
export class ProviderUtils {
  /**
   * Normalize secret key (remove leading/trailing slashes, etc.)
   */
  static normalizeKey(key: string): string {
    return key.trim().replace(/^\/+|\/+$/g, '');
  }

  /**
   * Build full path from components
   */
  static buildPath(path?: string, key?: string): string {
    const parts = [path, key].filter(Boolean);
    return parts.join('/').replace(/\/+/g, '/');
  }

  /**
   * Validate secret key format
   */
  static validateKey(key: string): void {
    if (!key || typeof key !== 'string') {
      throw new ProviderError('InvalidRequest', 'Secret key is required and must be a string');
    }
    
    if (key.length > 200) {
      throw new ProviderError('InvalidRequest', 'Secret key too long (max 200 chars)');
    }
    
    // Basic validation - no control characters
    if (/[\x00-\x1f\x7f]/.test(key)) {
      throw new ProviderError('InvalidRequest', 'Secret key contains invalid characters');
    }
  }

  /**
   * Validate secret value
   */
  static validateValue(value: string): void {
    if (typeof value !== 'string') {
      throw new ProviderError('InvalidRequest', 'Secret value must be a string');
    }
    
    // Most providers have size limits
    if (value.length > 64 * 1024) { // 64KB default limit
      throw new ProviderError('InvalidRequest', 'Secret value too large (max 64KB)');
    }
  }

  /**
   * Redact sensitive data for logging
   */
  static redactForLogging(obj: any): any {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    const redacted = { ...obj };
    const sensitiveKeys = ['value', 'token', 'secret', 'password', 'key', 'credential'];
    
    for (const [k, v] of Object.entries(redacted)) {
      if (sensitiveKeys.some(s => k.toLowerCase().includes(s))) {
        redacted[k] = '[REDACTED]';
      } else if (typeof v === 'object') {
        redacted[k] = ProviderUtils.redactForLogging(v);
      }
    }
    
    return redacted;
  }

  /**
   * Create consistent error messages
   */
  static createNotFoundError(key: string): ProviderError {
    return new ProviderError('NotFound', `Secret not found: ${key}`);
  }

  static createAlreadyExistsError(key: string): ProviderError {
    return new ProviderError('AlreadyExists', `Secret already exists: ${key}`);
  }

  static createPermissionError(operation: string): ProviderError {
    return new ProviderError('PermissionDenied', `Permission denied for operation: ${operation}`);
  }
}