---
title: "RAGnos Vault MVP - Technical RFC"
created: "2025-08-11"
updated: "2025-08-11"
category: "architecture"
tags: ["mvp", "rfc", "technical", "architecture"]
priority: "high"
status: "active"
author: "RAGnos Labs <labs@ragnos.io>"
project: "RAGnos Labs"
version: "1.0.0"
---

# RAGnos Vault MVP - Technical RFC

*Engineering specification for 2-week MVP implementation*

## Technical Goals

**Primary**: Prove that provider-agnostic secrets management can replace AWS Secrets Manager with better cost/performance.

**Secondary**: Establish architecture pattern for RAGnos ecosystem security services.

## Architecture Decisions

### Technology Stack
```
Frontend:  Next.js 14 + TypeScript + TailwindCSS
Backend:   Node.js 20 + Express + TypeScript  
Database:  PostgreSQL 15 + Redis 7
Security:  JWT + AES-256-GCM + bcrypt
SDK:       TypeScript with CommonJS/ESM builds
Infra:     Docker Compose → Kubernetes (future)
```

**Rationale**: Leverage existing Infisical foundation, focus on proving business value over technology novelty.

### Core Technical Requirements

#### Secrets Engine
```typescript
interface SecretEngine {
  store(workspaceId: string, key: string, value: any): Promise<SecretVersion>
  retrieve(workspaceId: string, key: string, version?: number): Promise<Secret>
  delete(workspaceId: string, key: string): Promise<void>
  list(workspaceId: string, prefix?: string): Promise<SecretMeta[]>
  versions(workspaceId: string, key: string): Promise<SecretVersion[]>
}
```

#### Multi-tenant Isolation
```sql
-- Row-level security enforced at database level
CREATE POLICY workspace_isolation ON secrets
  USING (workspace_id = current_workspace_id());

-- Application-level middleware validates JWT workspace claims
function enforceWorkspace(req, res, next) {
  const { workspaceId } = req.params;
  if (!req.jwt.workspaces.includes(workspaceId)) {
    return res.status(403).json({ error: 'Workspace access denied' });
  }
  next();
}
```

#### Encryption Strategy
```typescript
class EncryptionService {
  // Workspace-specific encryption keys derived from master key
  private getWorkspaceKey(workspaceId: string): Buffer {
    return crypto.pbkdf2Sync(MASTER_KEY, workspaceId, 100000, 32, 'sha256');
  }

  encrypt(workspaceId: string, plaintext: string): EncryptedData {
    const key = this.getWorkspaceKey(workspaceId);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-gcm', key, iv);
    // ... implementation
    return { ciphertext, iv, authTag };
  }
}
```

### API Design

#### REST API Surface
```
POST   /api/v1/workspaces/{id}/secrets          # Create secret
GET    /api/v1/workspaces/{id}/secrets/{key}    # Retrieve secret  
PUT    /api/v1/workspaces/{id}/secrets/{key}    # Update secret
DELETE /api/v1/workspaces/{id}/secrets/{key}    # Delete secret
GET    /api/v1/workspaces/{id}/secrets          # List secrets
GET    /api/v1/workspaces/{id}/secrets/{key}/versions  # Secret versions

POST   /api/v1/auth/login                       # JWT authentication
GET    /api/v1/workspaces/{id}/audit            # Audit logs
POST   /api/v1/workspaces/{id}/migrate/aws      # AWS import
```

#### Request/Response Format
```typescript
// Create secret request
interface CreateSecretRequest {
  key: string;           // Secret identifier
  value: any;            // Secret data (string, JSON, binary)
  type: 'string' | 'json' | 'binary';
  description?: string;  // Optional metadata
  tags?: string[];       // Optional categorization
}

// Secret response
interface SecretResponse {
  id: string;
  key: string;
  value: any;
  type: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  metadata: {
    description?: string;
    tags?: string[];
  };
}
```

### Database Schema

#### Core Tables
```sql
-- Workspaces (tenants)
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  encryption_key_hash VARCHAR(255) NOT NULL, -- For key derivation
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  settings JSONB DEFAULT '{}'
);

-- Secrets with encryption
CREATE TABLE secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key VARCHAR(255) NOT NULL,
  encrypted_value TEXT NOT NULL,        -- Base64 encoded ciphertext
  encryption_iv VARCHAR(255) NOT NULL,  -- Base64 encoded IV
  auth_tag VARCHAR(255) NOT NULL,       -- Base64 encoded auth tag
  type VARCHAR(50) DEFAULT 'string',    -- string, json, binary
  version INTEGER DEFAULT 1,
  description TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(workspace_id, key, version)
);

-- Secret versions for history
CREATE TABLE secret_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_id UUID NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  encrypted_value TEXT NOT NULL,
  encryption_iv VARCHAR(255) NOT NULL,
  auth_tag VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID -- Reference to user who created this version
);

-- Audit logs
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,      -- CREATE, READ, UPDATE, DELETE
  resource_type VARCHAR(50) NOT NULL, -- secret, workspace
  resource_id VARCHAR(255),         -- Secret key or resource identifier
  user_id VARCHAR(255),            -- User or service account
  ip_address INET,
  user_agent TEXT,
  request_id VARCHAR(255),         -- For request correlation
  metadata JSONB DEFAULT '{}',     -- Additional context
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_secrets_workspace_key ON secrets(workspace_id, key);
CREATE INDEX idx_audit_workspace_created ON audit_logs(workspace_id, created_at);
CREATE INDEX idx_secret_versions_secret_version ON secret_versions(secret_id, version);
```

#### Row-Level Security
```sql
-- Enable RLS on all tables
ALTER TABLE secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Policies enforced by application context
CREATE POLICY secrets_workspace_policy ON secrets
  USING (workspace_id = current_setting('app.current_workspace_id')::uuid);

CREATE POLICY audit_workspace_policy ON audit_logs  
  USING (workspace_id = current_setting('app.current_workspace_id')::uuid);
```

### SDK Architecture

#### Node.js SDK Interface
```typescript
import { RAGnOSVault } from '@ragnos/vault-sdk';

// Drop-in replacement for AWS Secrets Manager
const vault = new RAGnOSVault({
  apiUrl: 'https://vault.ragnos.io',
  workspaceId: 'workspace-123',
  apiKey: 'token-abc',
  // AWS compatibility mode
  awsCompatible: true
});

// AWS-style interface
const secret = await vault.getSecretValue({
  SecretId: 'database/postgres/password'
});

// Native interface with enhanced features
const secretWithMetadata = await vault.secrets.get('api-keys/stripe', {
  includeMetadata: true,
  version: 2
});
```

#### SDK Features
```typescript
class RAGnOSVaultClient {
  // Automatic retry with exponential backoff
  private async retry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T>

  // Response caching with TTL
  private cache = new Map<string, { value: any, expiry: number }>();

  // Circuit breaker for failure handling  
  private circuitBreaker = new CircuitBreaker(this.apiCall, {
    threshold: 5,
    timeout: 10000
  });

  // AWS compatibility layer
  async getSecretValue(params: AWS.GetSecretValueRequest): Promise<AWS.GetSecretValueResponse>
  async putSecretValue(params: AWS.PutSecretValueRequest): Promise<AWS.PutSecretValueResponse>
}
```

### Authentication & Authorization

#### JWT Token Structure
```typescript
interface VaultJWT {
  sub: string;           // User ID
  iss: 'ragnos-vault';   // Issuer
  aud: string[];         // Allowed workspaces
  workspaces: {          // Workspace permissions
    [workspaceId: string]: {
      role: 'admin' | 'write' | 'read';
      scopes: string[];  // Specific permissions
    };
  };
  exp: number;           // Expiration
  iat: number;           // Issued at
}
```

#### Permission Model (MVP)
```typescript
enum Permission {
  SECRET_CREATE = 'secret:create',
  SECRET_READ = 'secret:read', 
  SECRET_UPDATE = 'secret:update',
  SECRET_DELETE = 'secret:delete',
  SECRET_LIST = 'secret:list',
  AUDIT_READ = 'audit:read',
  WORKSPACE_ADMIN = 'workspace:admin'
}

// Role definitions
const ROLES = {
  admin: [Permission.WORKSPACE_ADMIN, ...ALL_PERMISSIONS],
  write: [Permission.SECRET_CREATE, Permission.SECRET_READ, Permission.SECRET_UPDATE, Permission.SECRET_LIST],
  read: [Permission.SECRET_READ, Permission.SECRET_LIST]
};
```

### Performance Requirements

#### Latency Targets
- **Secret Retrieval**: < 100ms p95 (cached), < 200ms p95 (uncached)
- **Secret Storage**: < 300ms p95
- **List Operations**: < 500ms p95 for 1000 secrets
- **Audit Queries**: < 1000ms p95 for 30-day range

#### Caching Strategy
```typescript
class CacheService {
  // L1: In-memory cache (hot secrets)
  private memoryCache = new LRUCache<string, Secret>({ max: 1000 });
  
  // L2: Redis cache (warm secrets) 
  private redisCache: Redis;
  
  // L3: Database (cold storage)
  async getSecret(workspaceId: string, key: string): Promise<Secret> {
    // Try L1 → L2 → L3 with write-back caching
  }
}
```

#### Database Optimization
```sql
-- Partitioning for audit logs by month
CREATE TABLE audit_logs_2025_08 PARTITION OF audit_logs 
  FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');

-- Read replicas for audit queries
-- Write to primary, read audits from replica

-- Connection pooling
-- 10-20 connections per service, 100 max per workspace
```

### Security Implementation

#### Encryption Details
```typescript
class EncryptionService {
  // AES-256-GCM with workspace-specific keys
  private algorithm = 'aes-256-gcm';
  
  // Master key from environment (KMS in production)
  private masterKey = process.env.VAULT_MASTER_KEY;
  
  // Key derivation per workspace
  private deriveKey(workspaceId: string): Buffer {
    return crypto.pbkdf2Sync(
      this.masterKey, 
      `workspace:${workspaceId}`, 
      100000, 
      32, 
      'sha256'
    );
  }
  
  // Constant-time comparison for auth tags
  private verifyAuthTag(expected: Buffer, actual: Buffer): boolean {
    return crypto.timingSafeEqual(expected, actual);
  }
}
```

#### Audit Implementation
```typescript
class AuditService {
  async logAction(context: {
    workspaceId: string;
    action: string;
    resourceType: string; 
    resourceId: string;
    userId: string;
    ip: string;
    userAgent: string;
    requestId: string;
    metadata?: any;
  }): Promise<void> {
    // Async logging to avoid blocking secret operations
    setImmediate(() => {
      this.db.query(
        'INSERT INTO audit_logs (...) VALUES (...)',
        [context.workspaceId, context.action, ...]
      );
    });
  }
}
```

### Migration Strategy

#### AWS Secrets Manager Import
```typescript
interface AWSMigrationService {
  // Discover secrets in AWS account
  async discoverSecrets(region: string, filters?: any): Promise<AWSSecretMetadata[]>
  
  // Import with validation
  async importSecrets(
    secrets: AWSSecretMetadata[], 
    targetWorkspaceId: string
  ): Promise<MigrationResult>
  
  // Validate imported secrets
  async validateMigration(
    sourceSecrets: AWSSecretMetadata[],
    targetWorkspaceId: string  
  ): Promise<ValidationResult>
}
```

### Deployment Architecture

#### Development (Current)
```yaml
# docker-compose.dev.yml enhanced for MVP
services:
  vault-api:
    build: ./backend
    environment:
      NODE_ENV: development
      DATABASE_URL: postgres://vault:vault@db/vault
      REDIS_URL: redis://redis:6379
      VAULT_MASTER_KEY: dev-key-change-in-production
    ports: ["4000:4000"]
    
  vault-ui:
    build: ./frontend  
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:4000
    ports: ["3000:3000"]
```

#### Production (Future)
```yaml
# Kubernetes deployment with:
# - Horizontal pod autoscaling
# - Persistent volumes for PostgreSQL
# - Redis cluster for caching
# - Load balancer with TLS termination
# - Secrets stored in cloud KMS
```

### Testing Strategy

#### Test Pyramid
```typescript
// Unit Tests (70%)
describe('EncryptionService', () => {
  it('should encrypt/decrypt with workspace isolation', async () => {
    const service = new EncryptionService();
    const plaintext = 'secret-value';
    const encrypted = service.encrypt('workspace-1', plaintext);
    const decrypted = service.decrypt('workspace-1', encrypted);
    expect(decrypted).toBe(plaintext);
    
    // Cross-workspace should fail
    expect(() => service.decrypt('workspace-2', encrypted)).toThrow();
  });
});

// Integration Tests (20%)  
describe('Secrets API', () => {
  it('should enforce workspace isolation', async () => {
    const token1 = createJWT({ workspaces: ['ws-1'] });
    const token2 = createJWT({ workspaces: ['ws-2'] });
    
    await request(app)
      .post('/api/v1/workspaces/ws-1/secrets')
      .auth(token1)
      .send({ key: 'test', value: 'secret' })
      .expect(201);
      
    await request(app)
      .get('/api/v1/workspaces/ws-1/secrets/test')
      .auth(token2)  // Wrong workspace token
      .expect(403);
  });
});

// E2E Tests (10%)
describe('Migration Workflow', () => {
  it('should migrate AWS secrets end-to-end', async () => {
    // Mock AWS Secrets Manager
    // Import secrets via API
    // Verify all secrets accessible via SDK
    // Verify audit logs created
  });
});
```

### Monitoring and Observability

#### Metrics Collection
```typescript
// Prometheus metrics
const secretOperationDuration = new Histogram({
  name: 'vault_secret_operation_duration_seconds',
  help: 'Time to complete secret operations',
  labelNames: ['operation', 'workspace_id', 'status']
});

const secretOperationCount = new Counter({
  name: 'vault_secret_operations_total', 
  help: 'Total secret operations',
  labelNames: ['operation', 'workspace_id', 'status']
});
```

#### Logging Strategy
```typescript
// Structured logging with correlation
import { Logger } from 'winston';

const logger = Logger.child({
  service: 'vault-api',
  version: process.env.APP_VERSION
});

// Request correlation
app.use((req, res, next) => {
  req.requestId = uuidv4();
  req.logger = logger.child({ requestId: req.requestId });
  next();
});
```

### Risk Mitigation

#### Security Risks
- **Key Management**: Use cloud KMS in production, rotate keys quarterly
- **Timing Attacks**: Constant-time comparisons for auth tags and tokens
- **Side Channel**: No secrets in logs, error messages, or stack traces

#### Performance Risks  
- **Database Load**: Connection pooling, read replicas for audits
- **Memory Leaks**: Explicit secret clearing, GC optimization
- **Cascade Failures**: Circuit breakers, graceful degradation

#### Operational Risks
- **Data Loss**: Daily backups with point-in-time recovery
- **Service Outage**: Health checks, restart policies, failover
- **Migration Issues**: Rollback procedures, validation steps

### Implementation Timeline

#### Week 1 (Days 1-7)
- **Days 1-2**: Database schema, encryption service, basic CRUD
- **Days 3-4**: Authentication, workspace isolation, audit logging  
- **Days 5-7**: REST API, error handling, basic testing

#### Week 2 (Days 8-14)
- **Days 8-9**: Node.js SDK, AWS compatibility layer
- **Days 10-11**: Migration tooling, web interface
- **Days 12-14**: End-to-end testing, performance optimization, demo prep

### Success Criteria Validation

#### Technical Validation
- [ ] All API endpoints return < 200ms p95 latency
- [ ] Workspace isolation verified via penetration testing
- [ ] 1000+ secrets stored/retrieved without performance degradation
- [ ] AWS SDK drop-in replacement working with existing code

#### Business Validation
- [ ] 3 RAGnos services migrated and running in production  
- [ ] Zero manual secret management processes remaining
- [ ] 15-minute setup demo successful with new workspace
- [ ] Cost analysis showing 50%+ savings vs AWS Secrets Manager

*This RFC will be updated as implementation progresses and technical decisions are refined.*