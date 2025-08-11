/**
 * Core Provider Interface
 * Base interface that all providers must implement
 */

import { CapabilitySet, ProviderInfo, HealthStatus } from '../types/capabilities';
import { ProviderContext } from '../types/context';

/**
 * Base provider interface that all providers must implement
 */
export interface Provider {
  // Provider metadata
  readonly info: ProviderInfo;
  
  // Provider capabilities
  capabilities(): CapabilitySet;
  
  // Lifecycle management
  init(ctx: ProviderContext): Promise<void>;
  health(): Promise<HealthStatus>;
  shutdown(): Promise<void>;
}

/**
 * Provider factory function type
 */
export type ProviderFactory<T extends Provider = Provider> = (
  config: Record<string, unknown>
) => T;

/**
 * Provider registration information
 */
export interface ProviderRegistration {
  name: string;
  factory: ProviderFactory;
  configSchema?: any; // Zod schema for config validation
  description?: string;
  version?: string;
}