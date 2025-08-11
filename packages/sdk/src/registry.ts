/**
 * Provider Registry - Dynamic loading and health management
 */

import { 
  ISecretProvider, 
  ProviderFactory, 
  ProviderRegistration, 
  ProviderError,
  ProviderHealth
} from './provider';

/**
 * Provider instance with metadata
 */
interface ProviderInstance {
  id: string;
  provider: ISecretProvider;
  registration: ProviderRegistration;
  config: Record<string, any>;
  createdAt: Date;
  lastHealthCheck?: ProviderHealth;
  healthCheckInterval?: NodeJS.Timeout;
}

/**
 * Registry configuration
 */
export interface RegistryConfig {
  healthCheckInterval?: number; // ms, 0 to disable
  healthCheckTimeout?: number;  // ms
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * Provider Registry for dynamic loading and management
 */
export class ProviderRegistry {
  private providers = new Map<string, ProviderInstance>();
  private factories = new Map<string, ProviderFactory>();
  private config: Required<RegistryConfig>;

  constructor(config: RegistryConfig = {}) {
    this.config = {
      healthCheckInterval: config.healthCheckInterval ?? 30000, // 30s
      healthCheckTimeout: config.healthCheckTimeout ?? 5000,   // 5s
      maxRetries: config.maxRetries ?? 3,
      retryDelayMs: config.retryDelayMs ?? 1000
    };
  }

  /**
   * Register a provider factory
   */
  registerFactory(type: string, factory: ProviderFactory): void {
    if (this.factories.has(type)) {
      throw new Error(`Provider factory already registered: ${type}`);
    }
    
    this.factories.set(type, factory);
  }

  /**
   * Create and register a provider instance
   */
  async createProvider(
    id: string,
    type: string,
    config: Record<string, any>
  ): Promise<ISecretProvider> {
    if (this.providers.has(id)) {
      throw new ProviderError('AlreadyExists', `Provider already exists: ${id}`);
    }

    const factory = this.factories.get(type);
    if (!factory) {
      throw new ProviderError('NotFound', `Unknown provider type: ${type}`);
    }

    try {
      // Create provider instance
      const provider = factory(config);
      
      // Test capabilities and health
      const capabilities = provider.capabilities();
      const health = await this.executeWithTimeout(
        () => provider.healthCheck(),
        this.config.healthCheckTimeout
      );

      if (!health.ok) {
        throw new ProviderError('Unavailable', `Provider health check failed: ${health.details?.message || 'Unknown error'}`);
      }

      // Register provider
      const instance: ProviderInstance = {
        id,
        provider,
        registration: {
          name: provider.name(),
          type,
          factory,
          capabilities
        },
        config: this.sanitizeConfig(config),
        createdAt: new Date(),
        lastHealthCheck: health
      };

      // Start health checking if enabled
      if (this.config.healthCheckInterval > 0) {
        instance.healthCheckInterval = setInterval(
          () => this.performHealthCheck(id),
          this.config.healthCheckInterval
        );
      }

      this.providers.set(id, instance);
      return provider;

    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      throw new ProviderError('Unknown', `Failed to create provider: ${error}`);
    }
  }

  /**
   * Get provider by ID
   */
  getProvider(id: string): ISecretProvider {
    const instance = this.providers.get(id);
    if (!instance) {
      throw new ProviderError('NotFound', `Provider not found: ${id}`);
    }

    // Check if provider is healthy
    if (instance.lastHealthCheck && !instance.lastHealthCheck.ok) {
      throw new ProviderError('Unavailable', `Provider is unhealthy: ${id}`);
    }

    return instance.provider;
  }

  /**
   * List all registered providers
   */
  listProviders(): ProviderRegistration[] {
    return Array.from(this.providers.values()).map(instance => ({
      ...instance.registration,
      // Don't expose factory in listing
      factory: undefined as any
    }));
  }

  /**
   * Get provider health status
   */
  async getProviderHealth(id: string): Promise<ProviderHealth> {
    const instance = this.providers.get(id);
    if (!instance) {
      throw new ProviderError('NotFound', `Provider not found: ${id}`);
    }

    try {
      const health = await this.executeWithTimeout(
        () => instance.provider.healthCheck(),
        this.config.healthCheckTimeout
      );
      
      instance.lastHealthCheck = health;
      return health;
    } catch (error) {
      const health: ProviderHealth = {
        ok: false,
        timestamp: new Date(),
        details: { error: String(error) }
      };
      
      instance.lastHealthCheck = health;
      return health;
    }
  }

  /**
   * Remove provider
   */
  async removeProvider(id: string): Promise<void> {
    const instance = this.providers.get(id);
    if (!instance) {
      throw new ProviderError('NotFound', `Provider not found: ${id}`);
    }

    // Stop health checking
    if (instance.healthCheckInterval) {
      clearInterval(instance.healthCheckInterval);
    }

    // Shutdown provider if supported
    if (instance.provider.shutdown) {
      try {
        await instance.provider.shutdown();
      } catch (error) {
        // Log but don't fail - we're removing it anyway
        console.warn(`Error shutting down provider ${id}:`, error);
      }
    }

    this.providers.delete(id);
  }

  /**
   * Shutdown all providers
   */
  async shutdown(): Promise<void> {
    const shutdownPromises = Array.from(this.providers.keys()).map(id => 
      this.removeProvider(id)
    );
    
    await Promise.allSettled(shutdownPromises);
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalProviders: number;
    healthyProviders: number;
    unhealthyProviders: number;
    providersByType: Record<string, number>;
  } {
    const instances = Array.from(this.providers.values());
    const healthyProviders = instances.filter(i => i.lastHealthCheck?.ok).length;
    
    const providersByType: Record<string, number> = {};
    for (const instance of instances) {
      const type = instance.registration.type;
      providersByType[type] = (providersByType[type] || 0) + 1;
    }

    return {
      totalProviders: instances.length,
      healthyProviders,
      unhealthyProviders: instances.length - healthyProviders,
      providersByType
    };
  }

  /**
   * Execute operation with timeout
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new ProviderError('Unavailable', `Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      operation()
        .then(resolve)
        .catch(reject)
        .finally(() => clearTimeout(timer));
    });
  }

  /**
   * Perform health check for a provider
   */
  private async performHealthCheck(id: string): Promise<void> {
    try {
      await this.getProviderHealth(id);
    } catch (error) {
      // Health check errors are logged, provider marked unhealthy
      console.warn(`Health check failed for provider ${id}:`, error);
    }
  }

  /**
   * Sanitize config for storage (remove sensitive data)
   */
  private sanitizeConfig(config: Record<string, any>): Record<string, any> {
    const sanitized = { ...config };
    const sensitiveKeys = ['token', 'secret', 'password', 'key', 'credential'];
    
    for (const [k, v] of Object.entries(sanitized)) {
      if (sensitiveKeys.some(s => k.toLowerCase().includes(s))) {
        sanitized[k] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }
}

/**
 * Global provider registry instance
 */
export const globalRegistry = new ProviderRegistry();