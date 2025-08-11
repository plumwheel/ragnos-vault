/**
 * Provider Capability Model
 * Defines what capabilities each provider supports
 */

export interface CapabilitySet {
  // Key Management Service capabilities
  kms: {
    encrypt: boolean;
    decrypt: boolean;
    sign: boolean;
    verify: boolean;
    createKey: boolean;
    rotateKey: boolean;
    keyAliases: boolean;
    keyPolicy: boolean;
  };
  
  // Secret Store capabilities  
  secretStore: {
    putSecret: boolean;
    getSecret: boolean;
    deleteSecret: boolean;
    listSecrets: boolean;
    versionedSecrets: boolean;
    rotationHooks: boolean;
    immutableVersions: boolean;
  };
  
  // Blob Storage capabilities
  blobStorage: {
    putObject: boolean;
    getObject: boolean;
    deleteObject: boolean;
    listObjects: boolean;
    multipart: boolean;
    signedUrls: boolean;
    serverSideEncryption: boolean;
    bucketPolicy: boolean;
  };
  
  // Queue/Event capabilities
  queue: {
    enqueue: boolean;
    dequeue: boolean;
    ack: boolean;
    nack: boolean;
    deadLetter: boolean;
    fifo: boolean;
    idempotency: boolean;
    delayedMessages: boolean;
  };
  
  // Metadata Store capabilities
  metadataStore: {
    put: boolean;
    get: boolean;
    delete: boolean;
    list: boolean;
    transactional: boolean;
    compareAndSwap: boolean;
    batchOperations: boolean;
  };
  
  // Optional Vector Index capabilities (feature-flagged)
  vectorIndex?: {
    upsert: boolean;
    query: boolean;
    delete: boolean;
    hybridSearch: boolean;
    metadataFilters: boolean;
    hnswIndex: boolean;
    ivfIndex: boolean;
  };
  
  // Optional Log Sink capabilities (feature-flagged) 
  logSink?: {
    append: boolean;
    immutable: boolean;
    hashChaining: boolean;
    queryLogs: boolean;
    retention: boolean;
  };
}

/**
 * Provider metadata and version info
 */
export interface ProviderInfo {
  name: string;
  version: string; // SemVer format
  description: string;
  sdkApiVersion: string; // SDK version this provider implements
  author: string;
  homepage?: string;
}

/**
 * Provider health status
 */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  details?: Record<string, any>;
  lastChecked: Date;
  capabilities: CapabilitySet;
}

/**
 * Capability checker utility functions
 */
export class CapabilityChecker {
  static requiresCapability(capabilities: CapabilitySet, capability: string): void {
    const [service, operation] = capability.split('.');
    const serviceCapabilities = capabilities[service as keyof CapabilitySet];
    
    if (!serviceCapabilities || typeof serviceCapabilities === 'boolean') {
      throw new Error(`Unsupported service: ${service}`);
    }
    
    if (!serviceCapabilities[operation as keyof typeof serviceCapabilities]) {
      throw new Error(`Unsupported capability: ${capability}`);
    }
  }
  
  static hasCapability(capabilities: CapabilitySet, capability: string): boolean {
    try {
      this.requiresCapability(capabilities, capability);
      return true;
    } catch {
      return false;
    }
  }
  
  static getUnsupportedCapabilities(
    required: string[], 
    available: CapabilitySet
  ): string[] {
    return required.filter(capability => !this.hasCapability(available, capability));
  }
}