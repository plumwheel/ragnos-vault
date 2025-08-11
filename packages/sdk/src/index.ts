/**
 * RAGnos Vault Provider SDK
 * Main entry point for the SDK
 */

// Types and capabilities
export * from './types/capabilities';
export * from './types/errors';
export * from './types/context';

// Core interfaces
export * from './interfaces/provider';
export * from './interfaces/kms';
export * from './interfaces/secret-store';
export * from './interfaces/blob-storage';
export * from './interfaces/queue';
export * from './interfaces/metadata-store';

// Utilities (will be added)
// export * from './utils/retry';
// export * from './utils/observability';
// export * from './utils/validation';

// Registry
export * from './registry/provider-registry';

// Simple facade (recommended for most use cases)
export * from './simple/simple-provider';

/**
 * SDK version
 */
export const SDK_VERSION = '1.0.0';

/**
 * SDK API version that providers should implement
 */
export const SDK_API_VERSION = '1.0.0';