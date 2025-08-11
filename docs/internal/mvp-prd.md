---
title: "RAGnos Vault MVP - Product Requirements Document"
created: "2025-08-11"
updated: "2025-08-11"
category: "product"
tags: ["mvp", "prd", "product", "requirements"]
priority: "high"
status: "active"
author: "RAGnos Labs <labs@ragnos.io>"
project: "RAGnos Labs"
version: "1.0.0"
---

# RAGnos Vault MVP - Product Requirements Document

*Deliver measurable value in 2 weeks with focused vertical slice*

## Executive Summary

**Vision**: Replace AWS Secrets Manager for RAGnos ecosystem while proving provider-agnostic architecture for enterprise customers.

**MVP Goal**: Demonstrate secure, scalable secrets management with multi-tenant isolation and audit trails in 2 weeks.

**Success Metrics**: 
- Setup time < 15 minutes for new tenant
- Secret operations < 200ms p95 latency  
- 100% audit trail coverage
- Zero secret leaks in development/testing

## Canonical Use Case

**Primary**: "RAGnos backend services need secure, auditable secret management with workspace isolation and API key rotation"

### User Journey
1. **Admin** creates workspace for new RAGnos service/customer
2. **Developer** stores API keys, DB credentials, certificates in workspace
3. **Service** retrieves secrets via SDK with automatic caching/refresh
4. **Compliance** reviews audit logs for secret access patterns
5. **Rotation** happens automatically with zero downtime

### Success Story
*"We migrated our 12 RAGnos microservices from AWS Secrets Manager to RAGnos Vault in one afternoon. Each service got its own workspace, audit trails show exactly who accessed what, and our monthly secrets costs dropped 60%. The Node.js SDK was drop-in compatible with our existing code."*

## MVP Scope (2 Weeks)

### In Scope ✅
- **Core API**: Store, retrieve, list, delete secrets with versioning
- **Multi-tenant**: Workspace-based isolation (1 workspace = 1 RAGnos service/customer)
- **Authentication**: JWT tokens with workspace-scoped permissions
- **Audit Logging**: Every secret operation logged with user/service identity
- **SDK**: Node.js client with caching, retry, circuit breaker
- **Migration**: Import from AWS Secrets Manager format
- **Demo**: Working web interface for secret management

### Out of Scope ❌ (Future)
- Enterprise SSO integration (OIDC)
- Secret rotation automation  
- Kubernetes operator
- Multi-region deployment
- Advanced RBAC (admin/read/write only for MVP)
- CLI tooling
- Terraform provider

### Success Criteria

#### Functional Requirements
- [ ] Store/retrieve 1000+ secrets per workspace
- [ ] Support JSON, string, binary secret formats
- [ ] Workspace isolation (no cross-workspace access)
- [ ] Secret versioning with rollback capability
- [ ] Bulk operations for migration scenarios

#### Non-Functional Requirements
- [ ] **Latency**: < 200ms p95 for secret retrieval
- [ ] **Availability**: 99.5% uptime in development
- [ ] **Security**: All secrets encrypted at rest (AES-256)
- [ ] **Audit**: 100% operation logging with 7-day retention
- [ ] **Scale**: Support 50+ concurrent workspaces

#### Demo Requirements
- [ ] **Setup**: New tenant operational in < 15 minutes
- [ ] **Migration**: Import 100 AWS secrets in < 5 minutes  
- [ ] **SDK**: Drop-in replacement for AWS SDK calls
- [ ] **Audit**: Real-time access logging in web interface

## Technical Architecture

### Core Components
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web UI        │    │   Node.js SDK   │    │   REST API      │
│   (Next.js)     │    │   (TypeScript)  │    │   (Express)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │   Core Engine   │
                    │   - Auth/AuthZ  │
                    │   - Encryption  │
                    │   - Audit Log   │
                    │   - Workspace   │
                    └─────────────────┘
                                 │
                    ┌─────────────────┐
                    │   PostgreSQL    │
                    │   - Secrets     │
                    │   - Audit Trail │
                    │   - Workspaces  │
                    └─────────────────┘
```

### Data Model
```sql
-- Core entities
workspaces(id, name, created_at, settings)
secrets(id, workspace_id, key, encrypted_value, version, created_at)
secret_versions(secret_id, version, encrypted_value, created_at)
audit_logs(id, workspace_id, action, resource, user_id, ip, created_at)
```

### Security Architecture
- **Encryption**: AES-256-GCM with workspace-specific keys
- **Key Management**: Integration with existing KMS (AWS/Azure/GCP)
- **Transport**: TLS 1.3 for all API calls
- **Authentication**: JWT tokens with workspace claims
- **Authorization**: Workspace-scoped permissions only

## Implementation Plan (2 Weeks)

### Week 1: Core Engine
**Days 1-3**: Core API and data layer
- PostgreSQL schema with encryption
- Basic CRUD operations for secrets
- Workspace isolation logic
- JWT authentication middleware

**Days 4-5**: Audit and security
- Audit logging system
- Encryption key management
- Basic web interface for testing

### Week 2: SDK and Demo
**Days 6-8**: SDK and integrations
- Node.js SDK with retry/caching
- AWS Secrets Manager compatibility layer
- Migration tooling from AWS format

**Days 9-10**: Demo and polish
- Web interface for secret management
- End-to-end demo scenario
- Performance optimization and testing

### Success Milestones
- **Day 5**: Core API working, basic encryption
- **Day 7**: Multi-tenant isolation working
- **Day 10**: SDK can replace AWS SDK calls
- **Day 14**: Complete demo with migration

## Metrics and Monitoring

### Business Metrics
- **Setup Time**: New workspace to first secret stored
- **Migration Speed**: AWS secrets imported per minute
- **Developer Experience**: Lines of code changed to adopt SDK

### Technical Metrics
- **Latency**: p50, p95, p99 for secret operations
- **Error Rate**: Failed requests per 100 operations
- **Throughput**: Secrets operations per second
- **Storage**: Average secrets per workspace

### Security Metrics
- **Audit Coverage**: % operations logged
- **Encryption**: % secrets encrypted at rest
- **Access Patterns**: Unusual access attempts
- **Key Rotation**: Days since last key rotation

### Cost Metrics
- **Per Secret**: Monthly cost per secret stored
- **Per Operation**: Cost per secret retrieval/storage
- **Vs AWS**: Cost comparison for equivalent operations

## Risk Mitigation

### Technical Risks
- **Encryption Performance**: Use hardware acceleration, optimize key caching
- **Multi-tenant Isolation**: Row-level security in PostgreSQL
- **SDK Compatibility**: Extensive testing against AWS SDK patterns

### Business Risks  
- **Security Incidents**: Comprehensive audit logging, encryption at rest
- **Performance Issues**: Load testing, caching strategy
- **Migration Complexity**: Automated import tools, validation

## Definition of Done

### MVP Complete When:
- [ ] 3 RAGnos services successfully migrated from AWS
- [ ] All services using Node.js SDK in production
- [ ] Zero manual secret management processes
- [ ] Audit dashboard showing real usage patterns
- [ ] 15-minute setup demo working for new customers

### Demo Script Ready
1. **Setup** (5 min): Create workspace, configure access
2. **Migration** (5 min): Import 50 secrets from AWS
3. **Integration** (3 min): Connect service via SDK
4. **Monitoring** (2 min): Show audit logs and metrics

## Next Phase Priorities (Post-MVP)

### Phase 2: Enterprise Features (Weeks 3-6)
- Enterprise SSO (OIDC)
- Advanced RBAC with custom roles
- Secret rotation automation
- CLI tooling for DevOps workflows

### Phase 3: Scale and Reliability (Weeks 7-10)  
- Multi-region deployment
- Kubernetes operator
- Terraform provider
- High availability clustering

### Phase 4: Market Expansion (Weeks 11-14)
- Customer onboarding automation
- Self-service workspace creation
- Usage-based billing integration
- Partner integrations (Vault, Azure Key Vault)

## Team Assignments

### Hunter (Product/Architecture)
- MVP scope decisions and trade-offs
- Demo script and success criteria validation
- Customer/partner feedback integration

### Co-founder (Technical Strategy)
- Security architecture and encryption design
- Performance requirements and testing
- Infrastructure and deployment planning

### Associate Dev (Implementation)  
- Core API development and testing
- SDK implementation and compatibility
- Migration tooling development

### Consultants (Specialized Tasks)
- Web interface development
- Documentation and demo materials
- Security testing and audit compliance

*Updated daily as MVP develops*