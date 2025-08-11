/**
 * Provider Context
 * Runtime context passed to all provider operations
 */

import { Tracer, Span } from '@opentelemetry/api';

/**
 * Logger interface for structured logging
 */
export interface Logger {
  debug(message: string, meta?: Record<string, any>): void;
  info(message: string, meta?: Record<string, any>): void;
  warn(message: string, meta?: Record<string, any>): void;
  error(message: string, meta?: Record<string, any>): void;
}

/**
 * Metrics interface for observability
 */
export interface Metrics {
  counter(name: string, value?: number, labels?: Record<string, string>): void;
  histogram(name: string, value: number, labels?: Record<string, string>): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
}

/**
 * Clock interface for time operations (testable)
 */
export interface Clock {
  now(): Date;
  nowMillis(): number;
}

/**
 * Default clock implementation
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  
  nowMillis(): number {
    return Date.now();
  }
}

/**
 * Provider execution context
 */
export interface ProviderContext {
  // Tenant isolation
  tenantId: string;
  
  // Optional region for multi-region providers
  region?: string;
  
  // Observability
  logger: Logger;
  tracer: Tracer;
  metrics: Metrics;
  clock: Clock;
  
  // Provider-specific configuration
  config: Record<string, unknown>;
  
  // Request tracking
  requestId?: string;
  correlationId?: string;
  
  // Timeout/cancellation
  deadline?: Date;
  abortSignal?: AbortSignal;
  
  // Security context
  user?: {
    id: string;
    roles: string[];
    permissions: string[];
    attributes: Record<string, any>;
  };
}

/**
 * Context builder for creating provider contexts
 */
export class ContextBuilder {
  private context: Partial<ProviderContext> = {};
  
  static create(): ContextBuilder {
    return new ContextBuilder();
  }
  
  tenantId(tenantId: string): ContextBuilder {
    this.context.tenantId = tenantId;
    return this;
  }
  
  region(region: string): ContextBuilder {
    this.context.region = region;
    return this;
  }
  
  logger(logger: Logger): ContextBuilder {
    this.context.logger = logger;
    return this;
  }
  
  tracer(tracer: Tracer): ContextBuilder {
    this.context.tracer = tracer;
    return this;
  }
  
  metrics(metrics: Metrics): ContextBuilder {
    this.context.metrics = metrics;
    return this;
  }
  
  clock(clock: Clock): ContextBuilder {
    this.context.clock = clock;
    return this;
  }
  
  config(config: Record<string, unknown>): ContextBuilder {
    this.context.config = { ...this.context.config, ...config };
    return this;
  }
  
  requestId(requestId: string): ContextBuilder {
    this.context.requestId = requestId;
    return this;
  }
  
  correlationId(correlationId: string): ContextBuilder {
    this.context.correlationId = correlationId;
    return this;
  }
  
  deadline(deadline: Date): ContextBuilder {
    this.context.deadline = deadline;
    return this;
  }
  
  abortSignal(abortSignal: AbortSignal): ContextBuilder {
    this.context.abortSignal = abortSignal;
    return this;
  }
  
  user(user: ProviderContext['user']): ContextBuilder {
    this.context.user = user;
    return this;
  }
  
  build(): ProviderContext {
    // Validate required fields
    if (!this.context.tenantId) {
      throw new Error('tenantId is required');
    }
    if (!this.context.logger) {
      throw new Error('logger is required');
    }
    if (!this.context.tracer) {
      throw new Error('tracer is required');
    }
    if (!this.context.metrics) {
      throw new Error('metrics is required');
    }
    
    // Set defaults
    return {
      clock: new SystemClock(),
      config: {},
      ...this.context
    } as ProviderContext;
  }
}

/**
 * Context utilities
 */
export class ContextUtils {
  /**
   * Check if context has exceeded deadline
   */
  static isExpired(ctx: ProviderContext): boolean {
    if (!ctx.deadline) return false;
    return ctx.clock.now() > ctx.deadline;
  }
  
  /**
   * Get remaining time until deadline
   */
  static getRemainingMs(ctx: ProviderContext): number | null {
    if (!ctx.deadline) return null;
    return Math.max(0, ctx.deadline.getTime() - ctx.clock.nowMillis());
  }
  
  /**
   * Create child context with updated deadline
   */
  static withDeadline(ctx: ProviderContext, deadline: Date): ProviderContext {
    return { ...ctx, deadline };
  }
  
  /**
   * Create child context with relative timeout
   */
  static withTimeout(ctx: ProviderContext, timeoutMs: number): ProviderContext {
    const deadline = new Date(ctx.clock.nowMillis() + timeoutMs);
    return { ...ctx, deadline };
  }
  
  /**
   * Extract provider-specific config with validation
   */
  static getConfig<T>(ctx: ProviderContext, schema: any): T {
    try {
      return schema.parse(ctx.config);
    } catch (error) {
      throw new Error(`Invalid provider configuration: ${error.message}`);
    }
  }
}