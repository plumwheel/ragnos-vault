/**
 * Memory Provider Configuration
 */

import { z } from 'zod';

export const MemoryProviderConfigSchema = z.object({
  // Eventual consistency simulation
  eventualWindowMs: z.number().min(0).default(0),
  
  // Size limits
  maxObjectSize: z.number().positive().default(100 * 1024 * 1024), // 100MB
  maxSecretSize: z.number().positive().default(1024 * 1024), // 1MB
  maxMetadataSize: z.number().positive().default(64 * 1024), // 64KB
  
  // QPS limits for throttling simulation
  qpsLimits: z.object({
    default: z.number().positive().default(1000),
    encrypt: z.number().positive().default(100),
    decrypt: z.number().positive().default(100),
    putObject: z.number().positive().default(50),
    getObject: z.number().positive().default(100)
  }).default({}),
  
  // Queue configuration
  queue: z.object({
    defaultVisibilityTimeoutSeconds: z.number().positive().default(30),
    maxMessages: z.number().positive().default(1000),
    maxMessageSize: z.number().positive().default(256 * 1024) // 256KB
  }).default({}),
  
  // Failure simulation
  chaos: z.object({
    enabled: z.boolean().default(false),
    errorRate: z.number().min(0).max(1).default(0.01), // 1% error rate
    latencyMultiplier: z.number().positive().default(1)
  }).default({})
});

export type MemoryProviderConfig = z.infer<typeof MemoryProviderConfigSchema>;

/**
 * Default configuration
 */
export const defaultConfig: MemoryProviderConfig = {
  eventualWindowMs: 0,
  maxObjectSize: 100 * 1024 * 1024,
  maxSecretSize: 1024 * 1024,
  maxMetadataSize: 64 * 1024,
  qpsLimits: {
    default: 1000,
    encrypt: 100,
    decrypt: 100,
    putObject: 50,
    getObject: 100
  },
  queue: {
    defaultVisibilityTimeoutSeconds: 30,
    maxMessages: 1000,
    maxMessageSize: 256 * 1024
  },
  chaos: {
    enabled: false,
    errorRate: 0.01,
    latencyMultiplier: 1
  }
};