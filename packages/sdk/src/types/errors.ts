/**
 * Provider Error Model
 * Stable, typed errors with vendor-neutral codes
 */

export enum ErrorCode {
  // Configuration errors
  InvalidConfig = 'INVALID_CONFIG',
  
  // Authentication/Authorization errors  
  AuthFailure = 'AUTH_FAILURE',
  PermissionDenied = 'PERMISSION_DENIED',
  
  // Resource errors
  NotFound = 'NOT_FOUND',
  AlreadyExists = 'ALREADY_EXISTS',
  
  // Rate limiting and capacity
  QuotaExceeded = 'QUOTA_EXCEEDED',
  Throttled = 'THROTTLED',
  
  // Network and infrastructure
  TransientNetwork = 'TRANSIENT_NETWORK',
  DeadlineExceeded = 'DEADLINE_EXCEEDED',
  
  // Provider capabilities
  UnsupportedCapability = 'UNSUPPORTED_CAPABILITY',
  
  // Data integrity
  DataIntegrity = 'DATA_INTEGRITY',
  
  // Catch-all
  Internal = 'INTERNAL'
}

/**
 * Base provider error class
 */
export abstract class ProviderError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly retryable: boolean;
  
  public readonly providerName: string;
  public readonly causeType: string;
  public readonly context: Record<string, any>;
  public readonly timestamp: Date;
  
  constructor(
    message: string,
    providerName: string,
    context: Record<string, any> = {},
    cause?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
    this.providerName = providerName;
    this.causeType = cause?.constructor.name || 'Unknown';
    this.context = { ...context };
    this.timestamp = new Date();
    
    // Maintain proper stack trace
    Error.captureStackTrace(this, this.constructor);
    
    // Chain original error if provided
    if (cause && 'cause' in Error.prototype) {
      (this as any).cause = cause;
    }
  }
  
  toJSON(): Record<string, any> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      providerName: this.providerName,
      causeType: this.causeType,
      retryable: this.retryable,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack
    };
  }
}

// Configuration Errors
export class InvalidConfigError extends ProviderError {
  readonly code = ErrorCode.InvalidConfig;
  readonly retryable = false;
}

// Authentication/Authorization Errors  
export class AuthFailureError extends ProviderError {
  readonly code = ErrorCode.AuthFailure;
  readonly retryable = false;
}

export class PermissionDeniedError extends ProviderError {
  readonly code = ErrorCode.PermissionDenied;
  readonly retryable = false;
}

// Resource Errors
export class NotFoundError extends ProviderError {
  readonly code = ErrorCode.NotFound;
  readonly retryable = false;
}

export class AlreadyExistsError extends ProviderError {
  readonly code = ErrorCode.AlreadyExists;
  readonly retryable = false;
}

// Rate Limiting and Capacity
export class QuotaExceededError extends ProviderError {
  readonly code = ErrorCode.QuotaExceeded;
  readonly retryable = false;
}

export class ThrottledError extends ProviderError {
  readonly code = ErrorCode.Throttled;
  readonly retryable = true;
}

// Network and Infrastructure
export class TransientNetworkError extends ProviderError {
  readonly code = ErrorCode.TransientNetwork;
  readonly retryable = true;
}

export class DeadlineExceededError extends ProviderError {
  readonly code = ErrorCode.DeadlineExceeded;
  readonly retryable = true;
}

// Provider Capabilities
export class UnsupportedCapabilityError extends ProviderError {
  readonly code = ErrorCode.UnsupportedCapability;
  readonly retryable = false;
}

// Data Integrity
export class DataIntegrityError extends ProviderError {
  readonly code = ErrorCode.DataIntegrity;
  readonly retryable = false;
}

// Internal/Unknown
export class InternalError extends ProviderError {
  readonly code = ErrorCode.Internal;
  readonly retryable = false;
}

/**
 * Error factory for creating typed errors
 */
export class ErrorFactory {
  static create(
    code: ErrorCode,
    message: string, 
    providerName: string,
    context: Record<string, any> = {},
    cause?: Error
  ): ProviderError {
    switch (code) {
      case ErrorCode.InvalidConfig:
        return new InvalidConfigError(message, providerName, context, cause);
      case ErrorCode.AuthFailure:
        return new AuthFailureError(message, providerName, context, cause);
      case ErrorCode.PermissionDenied:
        return new PermissionDeniedError(message, providerName, context, cause);
      case ErrorCode.NotFound:
        return new NotFoundError(message, providerName, context, cause);
      case ErrorCode.AlreadyExists:
        return new AlreadyExistsError(message, providerName, context, cause);
      case ErrorCode.QuotaExceeded:
        return new QuotaExceededError(message, providerName, context, cause);
      case ErrorCode.Throttled:
        return new ThrottledError(message, providerName, context, cause);
      case ErrorCode.TransientNetwork:
        return new TransientNetworkError(message, providerName, context, cause);
      case ErrorCode.DeadlineExceeded:
        return new DeadlineExceededError(message, providerName, context, cause);
      case ErrorCode.UnsupportedCapability:
        return new UnsupportedCapabilityError(message, providerName, context, cause);
      case ErrorCode.DataIntegrity:
        return new DataIntegrityError(message, providerName, context, cause);
      case ErrorCode.Internal:
      default:
        return new InternalError(message, providerName, context, cause);
    }
  }
  
  static isRetryable(error: Error): boolean {
    if (error instanceof ProviderError) {
      return error.retryable;
    }
    return false;
  }
  
  static getErrorCode(error: Error): ErrorCode | null {
    if (error instanceof ProviderError) {
      return error.code;
    }
    return null;
  }
}