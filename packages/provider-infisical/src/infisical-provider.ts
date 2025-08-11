/**
 * Infisical CE Provider - First-class integration with Infisical Community Edition
 * Uses Infisical REST API for all operations
 */

import { z } from 'zod';
import { 
  Provider, 
  SecretStoreProvider,
  ProviderContext,
  ProviderInfo,
  CapabilitySet,
  HealthStatus,
  Secret,
  SecretInfo,
  PutSecretOptions,
  PutSecretResult,
  GetSecretOptions,
  ListSecretsOptions,
  ListSecretsResult,
  ListVersionsResult,
  SecretVersion,
  ProviderError
} from '@ragnos-vault/sdk';

/**
 * Infisical provider configuration schema
 */
export const InfisicalConfigSchema = z.object({
  baseUrl: z.string().url().default('http://localhost:8080'),
  serviceToken: z.string().min(1),
  projectId: z.string().optional(), // Can be derived from token
  environment: z.string().default('dev'),
  secretPath: z.string().default('/'),
  timeout: z.number().positive().default(30000),
  retries: z.number().min(0).default(3)
});

export type InfisicalConfig = z.infer<typeof InfisicalConfigSchema>;

/**
 * Infisical API response types
 */
interface InfisicalSecret {
  _id: string;
  version: number;
  workspace: string;
  environment: string;
  secretKeyCiphertext: string;
  secretKeyIV: string;
  secretKeyTag: string;
  secretValueCiphertext: string;
  secretValueIV: string;
  secretValueTag: string;
  secretCommentCiphertext?: string;
  secretCommentIV?: string;
  secretCommentTag?: string;
  type: 'shared' | 'personal';
  tags?: Array<{
    _id: string;
    name: string;
    slug: string;
  }>;
  createdAt: string;
  updatedAt: string;
  
  // Decrypted fields (when using service token)
  secretKey?: string;
  secretValue?: string;
  secretComment?: string;
}

interface InfisicalSecretsResponse {
  secrets: InfisicalSecret[];
}

interface InfisicalServiceTokenInfo {
  _id: string;
  name: string;
  workspace: string;
  environment: string;
  expiresAt?: string;
  encryptedKey: string;
  iv: string;
  tag: string;
  permissions: Array<{
    action: string;
    subject: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Infisical CE Provider Implementation
 */
export class InfisicalProvider implements Provider, SecretStoreProvider {
  readonly info: ProviderInfo = {
    name: 'infisical-ce',
    version: '1.0.0',
    description: 'Infisical Community Edition provider for RAGnos Vault'
  };

  private config: InfisicalConfig;
  private tokenInfo?: InfisicalServiceTokenInfo;

  constructor(config: unknown) {
    this.config = InfisicalConfigSchema.parse(config);
  }

  capabilities(): CapabilitySet {
    return {
      secretStore: {
        get: true,
        put: true,
        delete: true,
        list: true,
        versions: false, // Infisical CE has limited versioning
        rotate: false,   // No built-in rotation
        updateMetadata: false // Limited metadata support
      }
    };
  }

  async init(ctx: ProviderContext): Promise<void> {
    // Validate service token and get project info
    try {
      this.tokenInfo = await this.validateServiceToken();
      ctx.logger.info('Infisical provider initialized', {
        provider: this.info.name,
        project: this.tokenInfo.workspace,
        environment: this.config.environment
      });
    } catch (error) {
      ctx.logger.error('Failed to initialize Infisical provider', { error });
      throw new ProviderError('InitializationFailed', 'Failed to validate Infisical service token');
    }
  }

  async health(): Promise<HealthStatus> {
    try {
      // Simple health check - try to list secrets
      const response = await this.makeRequest('GET', '/api/v3/secrets/raw', {
        environment: this.config.environment,
        workspaceSlug: this.tokenInfo?.workspace,
        secretPath: this.config.secretPath,
        limit: 1
      });

      return {
        status: 'healthy',
        message: 'Infisical CE connection successful',
        lastChecked: new Date(),
        capabilities: this.capabilities(),
        details: {
          baseUrl: this.config.baseUrl,
          environment: this.config.environment,
          project: this.tokenInfo?.workspace
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Infisical CE health check failed: ${error}`,
        lastChecked: new Date(),
        capabilities: this.capabilities(),
        details: { error: String(error) }
      };
    }
  }

  async shutdown(): Promise<void> {
    // No persistent connections to clean up
  }

  // SecretStoreProvider implementation

  async putSecret(
    ctx: ProviderContext,
    name: string,
    value: Uint8Array,
    options?: PutSecretOptions
  ): Promise<PutSecretResult> {
    const secretValue = new TextDecoder().decode(value);
    
    try {
      // Check if secret exists
      const exists = await this.secretExists(ctx, name);
      
      if (exists) {
        // Update existing secret
        await this.makeRequest('PATCH', `/api/v3/secrets/raw/${encodeURIComponent(name)}`, null, {
          secretValue,
          secretComment: options?.description || '',
          type: 'shared',
          tags: this.labelsToTags(options?.labels),
          environment: this.config.environment,
          workspaceSlug: this.tokenInfo?.workspace,
          secretPath: this.config.secretPath
        });
      } else {
        // Create new secret
        await this.makeRequest('POST', '/api/v3/secrets/raw', null, {
          secretKey: name,
          secretValue,
          secretComment: options?.description || '',
          type: 'shared',
          tags: this.labelsToTags(options?.labels),
          environment: this.config.environment,
          workspaceSlug: this.tokenInfo?.workspace,
          secretPath: this.config.secretPath
        });
      }

      return {
        name,
        version: `${Date.now()}`, // Infisical CE doesn't have proper versioning
        createdAt: new Date()
      };
    } catch (error) {
      throw this.mapError(error, `Failed to put secret: ${name}`);
    }
  }

  async getSecret(
    ctx: ProviderContext,
    name: string,
    options?: GetSecretOptions
  ): Promise<Secret> {
    try {
      const response = await this.makeRequest<InfisicalSecret>('GET', `/api/v3/secrets/raw/${encodeURIComponent(name)}`, {
        environment: this.config.environment,
        workspaceSlug: this.tokenInfo?.workspace,
        secretPath: this.config.secretPath
      });

      if (!response.secretKey || !response.secretValue) {
        throw new ProviderError('NotFound', `Secret not found: ${name}`);
      }

      return {
        name: response.secretKey,
        version: response.version?.toString() || '1',
        value: new TextEncoder().encode(response.secretValue),
        createdAt: new Date(response.createdAt),
        updatedAt: new Date(response.updatedAt),
        labels: this.tagsToLabels(response.tags),
        description: response.secretComment
      };
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new ProviderError('NotFound', `Secret not found: ${name}`);
      }
      throw this.mapError(error, `Failed to get secret: ${name}`);
    }
  }

  async deleteSecret(
    ctx: ProviderContext,
    name: string,
    options?: any
  ): Promise<void> {
    try {
      await this.makeRequest('DELETE', `/api/v3/secrets/raw/${encodeURIComponent(name)}`, {
        environment: this.config.environment,
        workspaceSlug: this.tokenInfo?.workspace,
        secretPath: this.config.secretPath
      });
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new ProviderError('NotFound', `Secret not found: ${name}`);
      }
      throw this.mapError(error, `Failed to delete secret: ${name}`);
    }
  }

  async listSecrets(
    ctx: ProviderContext,
    options?: ListSecretsOptions
  ): Promise<ListSecretsResult> {
    try {
      const response = await this.makeRequest<InfisicalSecretsResponse>('GET', '/api/v3/secrets/raw', {
        environment: this.config.environment,
        workspaceSlug: this.tokenInfo?.workspace,
        secretPath: this.config.secretPath,
        limit: options?.limit || 100,
        offset: 0 // Infisical uses offset-based pagination
      });

      let secrets = response.secrets.map(secret => ({
        name: secret.secretKey || secret._id,
        version: secret.version?.toString() || '1',
        createdAt: new Date(secret.createdAt),
        updatedAt: new Date(secret.updatedAt),
        labels: this.tagsToLabels(secret.tags),
        description: secret.secretComment
      } as SecretInfo));

      // Apply prefix filtering (Infisical CE doesn't support server-side prefix filtering)
      if (options?.prefix) {
        secrets = secrets.filter(s => s.name.startsWith(options.prefix!));
      }

      // Apply label filtering
      if (options?.labels) {
        secrets = secrets.filter(secret => {
          return Object.entries(options.labels!).every(([key, value]) =>
            secret.labels[key] === value
          );
        });
      }

      return {
        secrets,
        totalCount: secrets.length
      };
    } catch (error) {
      throw this.mapError(error, 'Failed to list secrets');
    }
  }

  async listVersions(
    ctx: ProviderContext,
    name: string,
    options?: any
  ): Promise<ListVersionsResult> {
    // Infisical CE doesn't have robust versioning
    // Return current version only
    try {
      const secret = await this.getSecret(ctx, name);
      return {
        versions: [{
          version: secret.version,
          createdAt: secret.createdAt,
          labels: secret.labels || {},
          description: secret.description
        }],
        totalCount: 1
      };
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new ProviderError('NotFound', `Secret not found: ${name}`);
      }
      throw this.mapError(error, `Failed to list versions for secret: ${name}`);
    }
  }

  async secretExists(
    ctx: ProviderContext,
    name: string,
    options?: any
  ): Promise<boolean> {
    try {
      await this.getSecret(ctx, name);
      return true;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  async rotateSecret(
    ctx: ProviderContext,
    name: string,
    options?: any
  ): Promise<PutSecretResult> {
    throw new ProviderError('UnsupportedOperation', 'Secret rotation not supported by Infisical CE provider');
  }

  async updateSecretMetadata(
    ctx: ProviderContext,
    name: string,
    metadata: any,
    options?: any
  ): Promise<void> {
    throw new ProviderError('UnsupportedOperation', 'Metadata updates not supported by Infisical CE provider');
  }

  /**
   * Private helper methods
   */

  private async validateServiceToken(): Promise<InfisicalServiceTokenInfo> {
    try {
      // Use the service token to get its info
      const response = await this.makeRequest<InfisicalServiceTokenInfo>('GET', '/api/v2/service-token');
      return response;
    } catch (error) {
      throw new ProviderError('AuthenticationFailed', 'Invalid Infisical service token');
    }
  }

  private async makeRequest<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    params?: Record<string, any>,
    body?: any
  ): Promise<T> {
    const url = new URL(path, this.config.baseUrl);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.serviceToken}`,
      'Content-Type': 'application/json'
    };

    const requestOptions: RequestInit = {
      method,
      headers,
      ...(body && { body: JSON.stringify(body) })
    };

    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const response = await fetch(url.toString(), requestOptions);
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        // Handle empty responses
        const contentLength = response.headers.get('content-length');
        if (contentLength === '0' || method === 'DELETE') {
          return {} as T;
        }

        const data = await response.json();
        return data;
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < this.config.retries && this.isRetryableError(error)) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await this.sleep(delay);
          continue;
        }
        
        break;
      }
    }

    throw lastError || new Error('Request failed');
  }

  private mapError(error: unknown, context?: string): ProviderError {
    const message = context ? `${context}: ${error}` : String(error);
    
    if (typeof error === 'object' && error !== null) {
      const errorObj = error as any;
      
      if (errorObj.message?.includes('404') || errorObj.message?.includes('not found')) {
        return new ProviderError('NotFound', message);
      }
      
      if (errorObj.message?.includes('401') || errorObj.message?.includes('403')) {
        return new ProviderError('PermissionDenied', message);
      }
      
      if (errorObj.message?.includes('429')) {
        return new ProviderError('RateLimited', message);
      }
      
      if (errorObj.message?.includes('500') || errorObj.message?.includes('502') || 
          errorObj.message?.includes('503') || errorObj.message?.includes('504')) {
        return new ProviderError('Unavailable', message);
      }
    }
    
    return new ProviderError('Unknown', message);
  }

  private isNotFoundError(error: unknown): boolean {
    if (error instanceof ProviderError) {
      return error.code === 'NotFound';
    }
    
    if (typeof error === 'object' && error !== null) {
      const errorMessage = (error as any).message || '';
      return errorMessage.includes('404') || errorMessage.includes('not found');
    }
    
    return false;
  }

  private isRetryableError(error: unknown): boolean {
    if (typeof error === 'object' && error !== null) {
      const errorMessage = (error as any).message || '';
      return errorMessage.includes('429') || 
             errorMessage.includes('502') || 
             errorMessage.includes('503') || 
             errorMessage.includes('504') ||
             errorMessage.includes('ECONNRESET') ||
             errorMessage.includes('ETIMEDOUT');
    }
    
    return false;
  }

  private labelsToTags(labels?: Record<string, string>): string[] {
    if (!labels) return [];
    return Object.entries(labels).map(([key, value]) => `${key}:${value}`);
  }

  private tagsToLabels(tags?: Array<{ name: string; slug: string }>): Record<string, string> {
    if (!tags) return {};
    
    const labels: Record<string, string> = {};
    for (const tag of tags) {
      // Try to parse key:value format, otherwise use tag name as both key and value
      const colonIndex = tag.name.indexOf(':');
      if (colonIndex > 0) {
        const key = tag.name.substring(0, colonIndex);
        const value = tag.name.substring(colonIndex + 1);
        labels[key] = value;
      } else {
        labels[tag.name] = tag.name;
      }
    }
    
    return labels;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Factory function for Infisical provider
 */
export function createInfisicalProvider(config: InfisicalConfig): InfisicalProvider {
  return new InfisicalProvider(config);
}