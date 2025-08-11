/**
 * Provider Registry
 * Manages provider instances, health checks, and routing
 */

import { Provider, ProviderRegistration } from '../interfaces/provider';
import { ProviderContext, ContextBuilder, Logger } from '../types/context';
import { CapabilitySet, HealthStatus } from '../types/capabilities';
import { ErrorFactory, ErrorCode } from '../types/errors';

/**
 * Provider instance with metadata
 */
export interface ProviderInstance {
  provider: Provider;
  registration: ProviderRegistration;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'initializing';
  lastHealthCheck: Date;
  failureCount: number;
  circuitBreakerOpen: boolean;
}

/**
 * Tenant to provider mapping
 */
export interface TenantProviderMapping {
  tenantId: string;
  providerName: string;
  region?: string;
  config: Record<string, unknown>;
  weight?: number; // For load balancing
}

/**
 * Registry configuration
 */
export interface RegistryConfig {
  healthCheckInterval: number; // milliseconds
  maxFailures: number; // Circuit breaker threshold
  circuitBreakerTimeout: number; // milliseconds
  initializationTimeout: number; // milliseconds
}

/**
 * Provider Registry implementation
 */
export class ProviderRegistry {
  private registrations = new Map<string, ProviderRegistration>();
  private instances = new Map<string, ProviderInstance>();
  private tenantMappings = new Map<string, TenantProviderMapping[]>();
  private healthCheckTimer?: NodeJS.Timer;
  
  constructor(
    private config: RegistryConfig,
    private logger: Logger
  ) {
    this.startHealthChecks();
  }
  
  /**
   * Register a provider factory
   */
  register(registration: ProviderRegistration): void {
    if (this.registrations.has(registration.name)) {
      throw ErrorFactory.create(
        ErrorCode.AlreadyExists,
        `Provider ${registration.name} is already registered`,
        'ProviderRegistry'
      );
    }
    
    this.registrations.set(registration.name, registration);
    this.logger.info('Provider registered', { 
      providerName: registration.name,
      version: registration.version 
    });
  }
  
  /**
   * Unregister a provider
   */
  async unregister(name: string): Promise<void> {
    const instance = this.instances.get(name);
    if (instance) {
      try {
        await instance.provider.shutdown();
      } catch (error) {
        this.logger.warn('Error shutting down provider', { 
          providerName: name, 
          error: error.message 
        });
      }
      this.instances.delete(name);
    }
    
    this.registrations.delete(name);
    this.logger.info('Provider unregistered', { providerName: name });
  }
  
  /**
   * Create and initialize a provider instance
   */
  async createInstance(
    name: string, 
    config: Record<string, unknown>,
    ctx: ProviderContext
  ): Promise<ProviderInstance> {
    const registration = this.registrations.get(name);
    if (!registration) {
      throw ErrorFactory.create(
        ErrorCode.NotFound,
        `Provider ${name} is not registered`,
        'ProviderRegistry'
      );
    }
    
    // Validate configuration if schema provided
    if (registration.configSchema) {
      try {
        registration.configSchema.parse(config);
      } catch (error) {
        throw ErrorFactory.create(
          ErrorCode.InvalidConfig,
          `Invalid configuration for provider ${name}: ${error.message}`,
          'ProviderRegistry',
          { providerName: name }
        );
      }
    }
    
    const provider = registration.factory(config);
    const instance: ProviderInstance = {
      provider,
      registration,
      status: 'initializing',
      lastHealthCheck: new Date(),
      failureCount: 0,
      circuitBreakerOpen: false
    };
    
    // Initialize provider with timeout
    try {
      const initContext = ContextBuilder.create()
        .tenantId(ctx.tenantId)
        .region(ctx.region)
        .logger(ctx.logger)
        .tracer(ctx.tracer)
        .metrics(ctx.metrics)
        .clock(ctx.clock)
        .config(config)
        .deadline(new Date(Date.now() + this.config.initializationTimeout))
        .build();
        
      await provider.init(initContext);
      
      // Initial health check
      const health = await provider.health();
      instance.status = health.status;
      
    } catch (error) {
      instance.status = 'unhealthy';
      throw ErrorFactory.create(
        ErrorCode.Internal,
        `Failed to initialize provider ${name}: ${error.message}`,
        'ProviderRegistry',
        { providerName: name },
        error
      );
    }
    
    this.instances.set(name, instance);
    this.logger.info('Provider instance created', { 
      providerName: name, 
      status: instance.status 
    });
    
    return instance;
  }
  
  /**
   * Get provider instance for a tenant
   */
  async getProvider(tenantId: string, capability?: string): Promise<Provider> {
    const mappings = this.tenantMappings.get(tenantId);
    if (!mappings || mappings.length === 0) {
      throw ErrorFactory.create(
        ErrorCode.NotFound,
        `No provider configured for tenant ${tenantId}`,
        'ProviderRegistry',
        { tenantId }
      );
    }
    
    // Select provider based on weights and capability requirements
    const availableProviders = mappings.filter(mapping => {
      const instance = this.instances.get(mapping.providerName);
      if (!instance) return false;
      
      // Check health and circuit breaker
      if (instance.circuitBreakerOpen || instance.status === 'unhealthy') {
        return false;
      }
      
      // Check capability if specified
      if (capability) {
        const capabilities = instance.provider.capabilities();
        try {
          this.requireCapability(capabilities, capability);
        } catch {
          return false;
        }
      }
      
      return true;
    });
    
    if (availableProviders.length === 0) {
      throw ErrorFactory.create(
        ErrorCode.UnsupportedCapability,
        `No healthy provider available for tenant ${tenantId}${capability ? ` with capability ${capability}` : ''}`,
        'ProviderRegistry',
        { tenantId, capability }
      );
    }
    
    // Simple weighted random selection
    const totalWeight = availableProviders.reduce((sum, mapping) => sum + (mapping.weight || 1), 0);
    const random = Math.random() * totalWeight;
    
    let currentWeight = 0;
    for (const mapping of availableProviders) {
      currentWeight += mapping.weight || 1;
      if (random <= currentWeight) {
        const instance = this.instances.get(mapping.providerName)!;
        return instance.provider;
      }
    }
    
    // Fallback to first available
    const instance = this.instances.get(availableProviders[0].providerName)!;
    return instance.provider;
  }
  
  /**
   * Map a tenant to provider(s)
   */
  setTenantMapping(mapping: TenantProviderMapping): void {
    const existing = this.tenantMappings.get(mapping.tenantId) || [];
    
    // Remove existing mapping for same provider
    const filtered = existing.filter(m => m.providerName !== mapping.providerName);
    filtered.push(mapping);
    
    this.tenantMappings.set(mapping.tenantId, filtered);
    
    this.logger.info('Tenant mapping updated', {
      tenantId: mapping.tenantId,
      providerName: mapping.providerName,
      region: mapping.region
    });
  }
  
  /**
   * Remove tenant mapping
   */
  removeTenantMapping(tenantId: string, providerName?: string): void {
    if (!providerName) {
      this.tenantMappings.delete(tenantId);
    } else {
      const existing = this.tenantMappings.get(tenantId) || [];
      const filtered = existing.filter(m => m.providerName !== providerName);
      
      if (filtered.length === 0) {
        this.tenantMappings.delete(tenantId);
      } else {
        this.tenantMappings.set(tenantId, filtered);
      }
    }
    
    this.logger.info('Tenant mapping removed', { tenantId, providerName });
  }
  
  /**
   * Get all registered providers
   */
  getRegistrations(): ProviderRegistration[] {
    return Array.from(this.registrations.values());
  }
  
  /**
   * Get provider instance status
   */
  getInstanceStatus(name: string): ProviderInstance | null {
    return this.instances.get(name) || null;
  }
  
  /**
   * Get all provider instances
   */
  getAllInstances(): ProviderInstance[] {
    return Array.from(this.instances.values());
  }
  
  /**
   * Force health check for all providers
   */
  async healthCheckAll(): Promise<void> {
    const promises = Array.from(this.instances.values()).map(instance => 
      this.healthCheckInstance(instance)
    );
    
    await Promise.allSettled(promises);
  }
  
  /**
   * Shutdown the registry and all providers
   */
  async shutdown(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
    
    const shutdownPromises = Array.from(this.instances.values()).map(async instance => {
      try {
        await instance.provider.shutdown();
      } catch (error) {
        this.logger.error('Error shutting down provider', {
          providerName: instance.registration.name,
          error: error.message
        });
      }
    });
    
    await Promise.allSettled(shutdownPromises);
    
    this.instances.clear();
    this.tenantMappings.clear();
    
    this.logger.info('Provider registry shut down');
  }
  
  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(async () => {
      await this.healthCheckAll();
    }, this.config.healthCheckInterval);
  }
  
  private async healthCheckInstance(instance: ProviderInstance): Promise<void> {
    try {
      const health = await instance.provider.health();
      
      // Update status
      const previousStatus = instance.status;
      instance.status = health.status;
      instance.lastHealthCheck = new Date();
      
      // Reset failure count on successful health check
      if (health.status === 'healthy') {
        instance.failureCount = 0;
        
        // Close circuit breaker if it was open
        if (instance.circuitBreakerOpen) {
          instance.circuitBreakerOpen = false;
          this.logger.info('Circuit breaker closed', {
            providerName: instance.registration.name
          });
        }
      }
      
      // Log status changes
      if (previousStatus !== instance.status) {
        this.logger.info('Provider status changed', {
          providerName: instance.registration.name,
          previousStatus,
          newStatus: instance.status,
          message: health.message
        });
      }
      
    } catch (error) {
      instance.failureCount++;
      instance.status = 'unhealthy';
      instance.lastHealthCheck = new Date();
      
      // Open circuit breaker if threshold exceeded
      if (instance.failureCount >= this.config.maxFailures && !instance.circuitBreakerOpen) {
        instance.circuitBreakerOpen = true;
        this.logger.warn('Circuit breaker opened', {
          providerName: instance.registration.name,
          failureCount: instance.failureCount,
          error: error.message
        });
        
        // Schedule circuit breaker reset
        setTimeout(() => {
          if (instance.circuitBreakerOpen) {
            this.logger.info('Circuit breaker half-open', {
              providerName: instance.registration.name
            });
            // Next health check will determine if we can close it
          }
        }, this.config.circuitBreakerTimeout);
      }
      
      this.logger.error('Provider health check failed', {
        providerName: instance.registration.name,
        failureCount: instance.failureCount,
        error: error.message
      });
    }
  }
  
  private requireCapability(capabilities: CapabilitySet, capability: string): void {
    const [service, operation] = capability.split('.');
    const serviceCapabilities = capabilities[service as keyof CapabilitySet];
    
    if (!serviceCapabilities || typeof serviceCapabilities === 'boolean') {
      throw new Error(`Unsupported service: ${service}`);
    }
    
    if (!serviceCapabilities[operation as keyof typeof serviceCapabilities]) {
      throw new Error(`Unsupported capability: ${capability}`);
    }
  }
}