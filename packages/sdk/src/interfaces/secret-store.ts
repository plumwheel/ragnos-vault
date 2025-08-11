/**
 * Secret Store Interface
 * Secure storage and retrieval of versioned secrets
 */

import { ProviderContext } from '../types/context';

/**
 * Secret store operation options
 */
export interface SecretBaseOptions {
  idempotencyKey?: string;
}

export interface PutSecretOptions extends SecretBaseOptions {
  version?: string; // Optional specific version
  labels?: Record<string, string>;
  description?: string;
  rotationHook?: {
    webhookUrl: string;
    rotationPeriod: number; // seconds
  };
}

export interface GetSecretOptions extends SecretBaseOptions {
  version?: string; // Get specific version, default to latest
}

export interface ListSecretsOptions extends SecretBaseOptions {
  prefix?: string;
  labels?: Record<string, string>;
  limit?: number;
  nextToken?: string;
}

/**
 * Secret metadata and content
 */
export interface SecretInfo {
  name: string;
  version: string;
  createdAt: Date;
  updatedAt: Date;
  labels: Record<string, string>;
  description?: string;
  rotationHook?: {
    webhookUrl: string;
    rotationPeriod: number;
    lastRotated?: Date;
    nextRotation?: Date;
  };
}

export interface Secret extends SecretInfo {
  value: Uint8Array;
}

export interface SecretVersion {
  version: string;
  createdAt: Date;
  labels: Record<string, string>;
  description?: string;
}

/**
 * Secret store operation results
 */
export interface PutSecretResult {
  name: string;
  version: string;
  createdAt: Date;
}

export interface ListSecretsResult {
  secrets: SecretInfo[];
  nextToken?: string;
  totalCount?: number;
}

export interface ListVersionsResult {
  versions: SecretVersion[];
  nextToken?: string;
  totalCount?: number;
}

/**
 * Secret Store interface
 */
export interface SecretStoreProvider {
  /**
   * Store a secret with optional versioning
   */
  putSecret(
    ctx: ProviderContext,
    name: string,
    value: Uint8Array,
    options?: PutSecretOptions
  ): Promise<PutSecretResult>;
  
  /**
   * Retrieve a secret by name and optional version
   */
  getSecret(
    ctx: ProviderContext,
    name: string,
    options?: GetSecretOptions
  ): Promise<Secret>;
  
  /**
   * Delete a secret (all versions or specific version)
   */
  deleteSecret(
    ctx: ProviderContext,
    name: string,
    options?: {
      version?: string; // Delete specific version, omit to delete all
    } & SecretBaseOptions
  ): Promise<void>;
  
  /**
   * List secrets with optional filtering
   */
  listSecrets(
    ctx: ProviderContext,
    options?: ListSecretsOptions
  ): Promise<ListSecretsResult>;
  
  /**
   * List versions of a specific secret
   */
  listVersions(
    ctx: ProviderContext,
    name: string,
    options?: {
      limit?: number;
      nextToken?: string;
    } & SecretBaseOptions
  ): Promise<ListVersionsResult>;
  
  /**
   * Check if a secret exists
   */
  secretExists(
    ctx: ProviderContext,
    name: string,
    options?: {
      version?: string;
    } & SecretBaseOptions
  ): Promise<boolean>;
  
  /**
   * Trigger rotation for a secret with rotation hooks
   */
  rotateSecret(
    ctx: ProviderContext,
    name: string,
    options?: SecretBaseOptions
  ): Promise<PutSecretResult>;
  
  /**
   * Update secret metadata (labels, description) without changing value
   */
  updateSecretMetadata(
    ctx: ProviderContext,
    name: string,
    metadata: {
      labels?: Record<string, string>;
      description?: string;
    },
    options?: SecretBaseOptions
  ): Promise<void>;
}