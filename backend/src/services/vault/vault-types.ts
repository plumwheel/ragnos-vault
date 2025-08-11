/**
 * RAGnos Vault - Core Types and Interfaces
 * MVP implementation for secrets management
 */

export interface VaultSecret {
  id: string;
  workspaceId: string;
  key: string;
  type: SecretType;
  version: number;
  description?: string;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface VaultSecretVersion {
  id: string;
  secretId: string;
  version: number;
  encryptedValue: string;
  encryptionIv: string;
  authTag: string;
  keyVersion: number;
  createdAt: Date;
  createdBy: string;
  metadata?: Record<string, any>;
}

export interface VaultWorkspace {
  id: string;
  name: string;
  slug: string;
  encryptionKeyHash: string;
  createdAt: Date;
  updatedAt: Date;
  settings: Record<string, any>;
}

export interface VaultApiToken {
  id: string;
  workspaceId: string;
  name: string;
  hashedToken: string;
  role: VaultRole;
  scopes: VaultPermission[];
  lastUsedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  createdBy: string;
}

export interface VaultAuditLog {
  id: string;
  workspaceId: string;
  action: AuditAction;
  resourceType: ResourceType;
  resourceId: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  requestId: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface VaultKeyring {
  id: string;
  workspaceId: string;
  encryptedDek: string;
  keyVersion: number;
  rotatedAt: Date;
  createdAt: Date;
}

// Enums
export enum SecretType {
  STRING = 'string',
  JSON = 'json',
  BINARY = 'binary'
}

export enum VaultRole {
  ADMIN = 'admin',
  WRITE = 'write', 
  READ = 'read'
}

export enum VaultPermission {
  SECRET_CREATE = 'secret:create',
  SECRET_READ = 'secret:read',
  SECRET_UPDATE = 'secret:update', 
  SECRET_DELETE = 'secret:delete',
  SECRET_LIST = 'secret:list',
  SECRET_ROTATE = 'secret:rotate',
  AUDIT_READ = 'audit:read',
  WORKSPACE_ADMIN = 'workspace:admin'
}

export enum AuditAction {
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  ROTATE = 'ROTATE',
  LOGIN = 'LOGIN'
}

export enum ResourceType {
  SECRET = 'secret',
  WORKSPACE = 'workspace',
  TOKEN = 'token',
  KEYRING = 'keyring'
}

// Request/Response interfaces
export interface CreateSecretRequest {
  key: string;
  value: any;
  type: SecretType;
  description?: string;
  tags?: string[];
}

export interface CreateSecretResponse {
  id: string;
  key: string;
  type: SecretType;
  version: number;
  createdAt: string;
}

export interface GetSecretRequest {
  key: string;
  version?: number;
}

export interface GetSecretResponse {
  id: string;
  key: string;
  value: any;
  type: SecretType;
  version: number;
  description?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ListSecretsRequest {
  prefix?: string;
  limit?: number;
  offset?: number;
}

export interface ListSecretsResponse {
  secrets: Array<{
    id: string;
    key: string;
    type: SecretType;
    version: number;
    description?: string;
    tags?: string[];
    updatedAt: string;
  }>;
  total: number;
  limit: number;
  offset: number;
}

export interface CreateWorkspaceRequest {
  name: string;
  slug: string;
  settings?: Record<string, any>;
}

export interface CreateWorkspaceResponse {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface CreateTokenRequest {
  name: string;
  role: VaultRole;
  scopes?: VaultPermission[];
  expiresInDays?: number;
}

export interface CreateTokenResponse {
  id: string;
  name: string;
  token: string; // Only returned once
  role: VaultRole;
  scopes: VaultPermission[];
  expiresAt?: string;
  createdAt: string;
}

// Internal service interfaces
export interface EncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

export interface DecryptedData {
  plaintext: string;
  keyVersion: number;
}

// Error types
export class VaultError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'VAULT_ERROR'
  ) {
    super(message);
    this.name = 'VaultError';
  }
}

export class WorkspaceAccessError extends VaultError {
  constructor(message: string = 'Workspace access denied') {
    super(message, 403, 'WORKSPACE_ACCESS_DENIED');
  }
}

export class SecretNotFoundError extends VaultError {
  constructor(message: string = 'Secret not found') {
    super(message, 404, 'SECRET_NOT_FOUND');
  }
}

export class InvalidTokenError extends VaultError {
  constructor(message: string = 'Invalid or expired token') {
    super(message, 401, 'INVALID_TOKEN');
  }
}

export class EncryptionError extends VaultError {
  constructor(message: string = 'Encryption operation failed') {
    super(message, 500, 'ENCRYPTION_ERROR');
  }
}

// Role-based permissions mapping
export const ROLE_PERMISSIONS: Record<VaultRole, VaultPermission[]> = {
  [VaultRole.ADMIN]: [
    VaultPermission.WORKSPACE_ADMIN,
    VaultPermission.SECRET_CREATE,
    VaultPermission.SECRET_READ,
    VaultPermission.SECRET_UPDATE,
    VaultPermission.SECRET_DELETE,
    VaultPermission.SECRET_LIST,
    VaultPermission.SECRET_ROTATE,
    VaultPermission.AUDIT_READ
  ],
  [VaultRole.WRITE]: [
    VaultPermission.SECRET_CREATE,
    VaultPermission.SECRET_READ,
    VaultPermission.SECRET_UPDATE,
    VaultPermission.SECRET_LIST
  ],
  [VaultRole.READ]: [
    VaultPermission.SECRET_READ,
    VaultPermission.SECRET_LIST
  ]
};

// Configuration interfaces
export interface VaultConfig {
  database: {
    connectionUri: string;
    ssl?: boolean;
    poolSize?: number;
  };
  redis: {
    url: string;
    ttl?: number;
  };
  encryption: {
    masterKey?: string;
    kmsProvider: 'aws' | 'gcp' | 'azure' | 'local';
    kmsConfig?: Record<string, any>;
  };
  auth: {
    tokenTtl: number;
    rateLimiting: {
      windowMs: number;
      maxRequests: number;
    };
  };
  audit: {
    retentionDays: number;
    batchSize: number;
  };
}