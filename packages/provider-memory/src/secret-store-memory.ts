/**
 * Memory Secret Store Provider Implementation (Minimal)
 * In-memory secret storage for testing and development
 */

import {
  SecretStoreProvider,
  ProviderContext,
  PutSecretOptions,
  GetSecretOptions,
  ListSecretsOptions,
  SecretBaseOptions,
  SecretInfo,
  Secret,
  SecretVersion,
  PutSecretResult,
  ListSecretsResult,
  ListVersionsResult,
  ErrorFactory,
  ErrorCode
} from '@ragnos-vault/sdk';
import { MemoryProviderConfig } from './config';

/**
 * Internal secret representation
 */
interface StoredSecretVersion {
  version: string;
  value: Buffer;
  createdAt: Date;
  labels: Record<string, string>;
  description?: string;
}

interface StoredSecret {
  name: string;
  versions: Map<string, StoredSecretVersion>;
  latestVersion: string;
  labels: Record<string, string>;
  description?: string;
  rotationHook?: {
    webhookUrl: string;
    rotationPeriod: number;
    lastRotated?: Date;
    nextRotation?: Date;
  };
}

/**
 * Secret Store Memory Implementation (Minimal)
 */
export class SecretStoreMemory implements SecretStoreProvider {
  private secrets = new Map<string, StoredSecret>();
  private operationCounts = new Map<string, number>();
  
  constructor(private config: MemoryProviderConfig) {}
  
  async putSecret(
    ctx: ProviderContext,
    name: string,
    value: Uint8Array,
    options?: PutSecretOptions
  ): Promise<PutSecretResult> {
    this.checkRateLimit('putSecret', ctx);
    this.validateSecretName(name);
    this.validateSecretValue(value);
    
    const version = options?.version || this.generateVersion();
    const valueBuffer = Buffer.from(value);
    
    // Get or create secret
    let secret = this.secrets.get(name);
    if (!secret) {
      secret = {
        name,
        versions: new Map(),
        latestVersion: version,
        labels: options?.labels || {},
        description: options?.description,
        rotationHook: options?.rotationHook
      };
      this.secrets.set(name, secret);
    } else {
      // Check if version already exists
      if (secret.versions.has(version)) {
        throw ErrorFactory.create(
          ErrorCode.AlreadyExists,
          `Secret version already exists: ${name}@${version}`,
          'memory-secret',
          { name, version }
        );
      }
    }
    
    // Add version
    const secretVersion: StoredSecretVersion = {
      version,
      value: valueBuffer,
      createdAt: new Date(),
      labels: options?.labels || {},
      description: options?.description
    };
    
    secret.versions.set(version, secretVersion);
    secret.latestVersion = version;
    
    // Update secret-level metadata
    if (options?.labels) {
      secret.labels = { ...secret.labels, ...options.labels };
    }
    if (options?.description) {
      secret.description = options.description;
    }
    
    return {
      name,
      version,
      createdAt: secretVersion.createdAt
    };
  }
  
  async getSecret(ctx: ProviderContext, name: string, options?: GetSecretOptions): Promise<Secret> {
    this.checkRateLimit('getSecret', ctx);
    this.validateSecretName(name);
    
    const secret = this.secrets.get(name);
    if (!secret) {
      throw ErrorFactory.create(
        ErrorCode.NotFound,
        `Secret not found: ${name}`,
        'memory-secret',
        { name }
      );
    }
    
    const version = options?.version || secret.latestVersion;
    const secretVersion = secret.versions.get(version);
    
    if (!secretVersion) {
      throw ErrorFactory.create(
        ErrorCode.NotFound,
        `Secret version not found: ${name}@${version}`,
        'memory-secret',
        { name, version }
      );
    }
    
    return {
      name: secret.name,
      version: secretVersion.version,
      value: new Uint8Array(secretVersion.value),
      createdAt: secretVersion.createdAt,
      updatedAt: secretVersion.createdAt,
      labels: secretVersion.labels,
      description: secretVersion.description,
      rotationHook: secret.rotationHook
    };
  }
  
  async deleteSecret(ctx: ProviderContext, name: string, options?: { version?: string } & SecretBaseOptions): Promise<void> {
    this.checkRateLimit('deleteSecret', ctx);
    this.validateSecretName(name);
    
    const secret = this.secrets.get(name);
    if (!secret) {
      // Deletion is idempotent
      return;
    }
    
    if (options?.version) {
      // Delete specific version
      secret.versions.delete(options.version);
      
      // If we deleted the latest version, find new latest
      if (secret.latestVersion === options.version) {
        const remainingVersions = Array.from(secret.versions.values());
        if (remainingVersions.length > 0) {
          // Find most recent version
          remainingVersions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          secret.latestVersion = remainingVersions[0].version;
        } else {
          // No versions left, delete secret entirely
          this.secrets.delete(name);
        }
      }
    } else {
      // Delete all versions
      this.secrets.delete(name);
    }
  }
  
  async listSecrets(ctx: ProviderContext, options?: ListSecretsOptions): Promise<ListSecretsResult> {
    this.checkRateLimit('listSecrets', ctx);
    
    let secrets = Array.from(this.secrets.values());
    
    // Apply prefix filter
    if (options?.prefix) {
      secrets = secrets.filter(secret => secret.name.startsWith(options.prefix!));
    }
    
    // Apply label filters
    if (options?.labels) {
      secrets = secrets.filter(secret => {
        return Object.entries(options.labels!).every(([key, value]) => {
          return secret.labels[key] === value;
        });
      });
    }
    
    // Sort by name
    secrets.sort((a, b) => a.name.localeCompare(b.name));
    
    // Handle pagination
    const startIndex = options?.nextToken ? parseInt(options.nextToken, 10) : 0;
    const limit = options?.limit || 100;
    const pageSecrets = secrets.slice(startIndex, startIndex + limit);
    
    const nextToken = (startIndex + limit < secrets.length) ? (startIndex + limit).toString() : undefined;
    
    const secretInfos: SecretInfo[] = pageSecrets.map(secret => {
      const latestVersion = secret.versions.get(secret.latestVersion)!;
      return {
        name: secret.name,
        version: secret.latestVersion,
        createdAt: latestVersion.createdAt,
        updatedAt: latestVersion.createdAt,
        labels: secret.labels,
        description: secret.description,
        rotationHook: secret.rotationHook
      };
    });
    
    return {
      secrets: secretInfos,
      nextToken,
      totalCount: secrets.length
    };
  }
  
  async listVersions(
    ctx: ProviderContext,
    name: string,
    options?: { limit?: number; nextToken?: string } & SecretBaseOptions
  ): Promise<ListVersionsResult> {
    this.checkRateLimit('listVersions', ctx);
    this.validateSecretName(name);
    
    const secret = this.secrets.get(name);
    if (!secret) {
      throw ErrorFactory.create(
        ErrorCode.NotFound,
        `Secret not found: ${name}`,
        'memory-secret',
        { name }
      );
    }
    
    const versions = Array.from(secret.versions.values());
    versions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // Most recent first
    
    // Handle pagination
    const startIndex = options?.nextToken ? parseInt(options.nextToken, 10) : 0;
    const limit = options?.limit || 100;
    const pageVersions = versions.slice(startIndex, startIndex + limit);
    
    const nextToken = (startIndex + limit < versions.length) ? (startIndex + limit).toString() : undefined;
    
    const versionInfos: SecretVersion[] = pageVersions.map(version => ({
      version: version.version,
      createdAt: version.createdAt,
      labels: version.labels,
      description: version.description
    }));
    
    return {
      versions: versionInfos,
      nextToken,
      totalCount: versions.length
    };
  }
  
  async secretExists(ctx: ProviderContext, name: string, options?: { version?: string } & SecretBaseOptions): Promise<boolean> {
    this.checkRateLimit('secretExists', ctx);
    this.validateSecretName(name);
    
    const secret = this.secrets.get(name);
    if (!secret) {
      return false;
    }
    
    if (options?.version) {
      return secret.versions.has(options.version);
    }
    
    return true;
  }
  
  async rotateSecret(ctx: ProviderContext, name: string, options?: SecretBaseOptions): Promise<PutSecretResult> {
    this.checkRateLimit('rotateSecret', ctx);
    
    const secret = this.secrets.get(name);
    if (!secret || !secret.rotationHook) {
      throw ErrorFactory.create(
        ErrorCode.NotFound,
        `Secret not found or no rotation hook configured: ${name}`,
        'memory-secret',
        { name }
      );
    }
    
    // In a real implementation, this would call the webhook
    // For memory provider, generate new test value
    const newValue = Buffer.from(`rotated-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`, 'utf8');
    const newVersion = this.generateVersion();
    
    return await this.putSecret(ctx, name, new Uint8Array(newValue), {
      version: newVersion,
      description: `Rotated version created at ${new Date().toISOString()}`
    });
  }
  
  async updateSecretMetadata(
    ctx: ProviderContext,
    name: string,
    metadata: { labels?: Record<string, string>; description?: string },
    options?: SecretBaseOptions
  ): Promise<void> {
    this.checkRateLimit('updateSecretMetadata', ctx);
    this.validateSecretName(name);
    
    const secret = this.secrets.get(name);
    if (!secret) {
      throw ErrorFactory.create(
        ErrorCode.NotFound,
        `Secret not found: ${name}`,
        'memory-secret',
        { name }
      );
    }
    
    if (metadata.labels) {
      secret.labels = { ...secret.labels, ...metadata.labels };
    }
    
    if (metadata.description !== undefined) {
      secret.description = metadata.description;
    }
  }
  
  private validateSecretName(name: string): void {
    if (!name || name.length === 0) {
      throw ErrorFactory.create(
        ErrorCode.InvalidConfig,
        'Secret name cannot be empty',
        'memory-secret'
      );
    }
    
    if (name.length > 512) {
      throw ErrorFactory.create(
        ErrorCode.InvalidConfig,
        `Secret name too long: ${name.length} (max 512)`,
        'memory-secret',
        { name: name.substring(0, 100) + '...' }
      );
    }
    
    // Basic name validation - no control characters
    if (!/^[a-zA-Z0-9/_.-]+$/.test(name)) {
      throw ErrorFactory.create(
        ErrorCode.InvalidConfig,
        `Invalid characters in secret name: ${name}`,
        'memory-secret',
        { name }
      );
    }
  }
  
  private validateSecretValue(value: Uint8Array): void {
    if (value.length > this.config.maxSecretSize) {
      throw ErrorFactory.create(
        ErrorCode.InvalidConfig,
        `Secret value too large: ${value.length} bytes (max ${this.config.maxSecretSize})`,
        'memory-secret',
        { size: value.length, maxSize: this.config.maxSecretSize }
      );
    }
  }
  
  private generateVersion(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `v${timestamp}${random}`;
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
        'memory-secret',
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