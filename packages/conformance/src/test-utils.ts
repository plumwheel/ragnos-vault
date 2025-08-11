/**
 * Test Utilities for Conformance Suite
 */

import { randomBytes, createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { ProviderContext, ContextBuilder, Logger } from '@ragnos-vault/sdk';

/**
 * Simple console logger for testing
 */
export class TestLogger implements Logger {
  debug(message: string, meta?: Record<string, any>): void {
    if (process.env.DEBUG) {
      console.debug(`[DEBUG] ${message}`, meta ? JSON.stringify(meta) : '');
    }
  }
  
  info(message: string, meta?: Record<string, any>): void {
    console.info(`[INFO] ${message}`, meta ? JSON.stringify(meta) : '');
  }
  
  warn(message: string, meta?: Record<string, any>): void {
    console.warn(`[WARN] ${message}`, meta ? JSON.stringify(meta) : '');
  }
  
  error(message: string, meta?: Record<string, any>): void {
    console.error(`[ERROR] ${message}`, meta ? JSON.stringify(meta) : '');
  }
}

/**
 * Test utilities class
 */
export class TestUtils {
  private static seedCounter = 0;
  
  /**
   * Generate random string with optional prefix
   */
  static randomString(length: number = 16, prefix: string = ''): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = prefix;
    
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return result;
  }
  
  /**
   * Generate random bytes
   */
  static randomBytes(length: number = 32): Uint8Array {
    return new Uint8Array(randomBytes(length));
  }
  
  /**
   * Generate test data with predictable content
   */
  static generateTestData(size: number, seed?: string): Uint8Array {
    const data = new Uint8Array(size);
    const seedBytes = Buffer.from(seed || 'test-seed', 'utf8');
    
    for (let i = 0; i < size; i++) {
      data[i] = (seedBytes[i % seedBytes.length] + i) % 256;
    }
    
    return data;
  }
  
  /**
   * Calculate SHA256 hash of data
   */
  static sha256(data: Uint8Array): string {
    return createHash('sha256').update(data).digest('hex');
  }
  
  /**
   * Calculate MD5 hash of data
   */
  static md5(data: Uint8Array): string {
    return createHash('md5').update(data).digest('hex');
  }
  
  /**
   * Sleep for specified milliseconds
   */
  static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Timeout promise that rejects after specified time
   */
  static timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    );
  }
  
  /**
   * Race promise with timeout
   */
  static async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([promise, this.timeout(timeoutMs)]);
  }
  
  /**
   * Retry function with exponential backoff
   */
  static async retry<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    baseDelayMs: number = 100,
    maxDelayMs: number = 5000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxAttempts) {
          throw lastError;
        }
        
        // Exponential backoff with jitter
        const delay = Math.min(
          baseDelayMs * Math.pow(2, attempt - 1),
          maxDelayMs
        );
        const jitter = Math.random() * 0.1 * delay;
        
        await this.sleep(delay + jitter);
      }
    }
    
    throw lastError!;
  }
  
  /**
   * Generate UUID
   */
  static uuid(): string {
    return uuidv4();
  }
  
  /**
   * Generate unique test identifier
   */
  static uniqueId(prefix: string = 'test'): string {
    const timestamp = Date.now().toString(36);
    const counter = (++this.seedCounter).toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    
    return `${prefix}_${timestamp}_${counter}_${random}`;
  }
  
  /**
   * Create namespaced key
   */
  static namespacedKey(namespace: string, key: string): string {
    return `${namespace}/${key}`;
  }
  
  /**
   * Compare arrays for equality
   */
  static arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    
    return true;
  }
  
  /**
   * Create test provider context
   */
  static createTestContext(
    tenantId: string = 'test-tenant',
    config: Record<string, unknown> = {}
  ): ProviderContext {
    return ContextBuilder.create()
      .tenantId(tenantId)
      .logger(new TestLogger())
      .tracer({ startSpan: () => ({ end: () => {}, setAttributes: () => {} }) } as any)
      .metrics({
        counter: () => {},
        histogram: () => {},
        gauge: () => {}
      })
      .config(config)
      .requestId(this.uniqueId('req'))
      .build();
  }
  
  /**
   * Validate ETag format
   */
  static isValidETag(etag: string): boolean {
    // ETag should be quoted hex string or W/"hex"
    return /^(W\/)?"[a-f0-9]{32,64}"$/i.test(etag);
  }
  
  /**
   * Extract ETag value without quotes
   */
  static extractETagValue(etag: string): string {
    return etag.replace(/^(W\/)?"|"$/g, '');
  }
  
  /**
   * Generate test content with size
   */
  static generateContent(size: number, pattern?: string): Uint8Array {
    const content = new Uint8Array(size);
    const patternBytes = Buffer.from(pattern || 'ABCD', 'utf8');
    
    for (let i = 0; i < size; i++) {
      content[i] = patternBytes[i % patternBytes.length];
    }
    
    return content;
  }
  
  /**
   * Create async iterable from array
   */
  static async *fromArray<T>(items: T[]): AsyncIterable<T> {
    for (const item of items) {
      yield item;
    }
  }
  
  /**
   * Convert async iterable to array
   */
  static async toArray<T>(iterable: AsyncIterable<T>): Promise<T[]> {
    const result: T[] = [];
    
    for await (const item of iterable) {
      result.push(item);
    }
    
    return result;
  }
  
  /**
   * Generate test JSON data
   */
  static generateTestJson(seed: string = 'test'): Record<string, any> {
    return {
      id: this.uuid(),
      name: `test-${seed}`,
      timestamp: new Date().toISOString(),
      data: {
        nested: {
          value: Math.random(),
          items: [1, 2, 3, 4, 5]
        }
      },
      tags: ['test', 'conformance', seed]
    };
  }
  
  /**
   * Validate ISO timestamp
   */
  static isValidISOTimestamp(timestamp: string): boolean {
    const date = new Date(timestamp);
    return !isNaN(date.getTime()) && date.toISOString() === timestamp;
  }
  
  /**
   * Check if timestamp is recent (within last N seconds)
   */
  static isRecentTimestamp(timestamp: string, maxAgeSeconds: number = 300): boolean {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    
    return diffMs >= 0 && diffMs <= maxAgeSeconds * 1000;
  }
}