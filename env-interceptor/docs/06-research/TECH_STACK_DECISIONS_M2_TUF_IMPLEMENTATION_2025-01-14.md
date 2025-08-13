---
title: "RAGnos Vault M2 TUF Implementation Tech Stack Decisions"
created: "2025-01-14"
updated: "2025-01-14"
category: "architecture"
tags: ["tech-stack", "tuf", "m2", "security", "decisions"]
priority: "critical"
status: "active"
author: "RAGnos Labs <labs@ragnos.io>"
project: "ragnos-vault"
version: "1.0"
---

# RAGnos Vault M2 TUF Implementation Tech Stack Decisions

## Executive Summary

Following comprehensive threat model analysis and GPT-5 strategic consultation, we have established the definitive tech stack for RAGnos Vault's M2 TUF-backed plugin distribution system. This stack prioritizes security-first design with enterprise viability, air-gap support, and commercial scalability.

**Core Stack**:
- **TUF**: tough/Rust + python-tuf (conformance)
- **HSM/KMS**: AWS KMS/CloudHSM with multi-cloud parity
- **SBOM**: CycloneDX v1.5 JSON primary, SPDX 2.3 secondary
- **Storage**: S3 + CloudFront with self-hosted nginx mirrors

## 1. TUF Implementation Architecture

### Primary: tough/Rust
**Decision**: tough (Rust) as core TUF implementation
**Rationale**:
- Memory-safe, production-proven (AWS Bottlerocket)
- Small static cross-platform binary for client and server
- Supports multiple stores (filesystem, S3, HTTP)
- Strong TUF semantics compliance

**Implementation**:
```bash
# Core components
ragv-tuf CLI           # Repository management and client operations
ragv-tuf-lib          # Embeddable library for integrations
ragv-mirror           # Offline mirror synchronization
```

**Delivery Pattern**:
- Primary CLI in Rust for security-critical operations
- Thin SDKs (Go/Node/Python) calling CLI or using FFI
- Avoid multiple crypto stacks initially

### Conformance: python-tuf
**Purpose**: CI validation and cross-implementation testing
**Usage**:
- Validate metadata correctness
- Interoperability testing
- Reference implementation comparison

### Future (Phase 3): go-tuf
**Condition**: Customer demand for Go-native client
**Requirement**: Must maintain parity tests with python-tuf

### Explicitly Rejected: Custom Node.js TUF
**Reason**: High maintenance burden, security risk, unnecessary duplication

## 2. HSM/KMS Provider Strategy

### Algorithm Selection
**Primary**: ECDSA P-256
- FIPS-friendly
- Universal KMS/HSM support
- AWS/GCP/Azure compatibility

**Optional**: Ed25519
- Better performance/simplicity
- Local HSM support
- Policy-gated for FIPS environments

### Key Role Distribution

#### Root Keys (3-of-5 Threshold)
- **Location**: Offline local HSM tokens
- **Hardware**: YubiHSM/Nitrokey/Smartcards
- **Process**: Documented key ceremony with audit trail
- **Expiry**: 12 months with staged rotation

#### Targets Keys (2-of-3 Threshold)
- **Multi-cloud**: AWS KMS + Azure Managed HSM + GCP Cloud HSM
- **Purpose**: Reduce single-cloud risk
- **Delegations**: Per-tenant/publisher keys
- **Expiry**: 90 days

#### Snapshot Keys (1-of-2)
- **Location**: Independent KMS/HSMs
- **Expiry**: 7 days

#### Timestamp Keys (1-of-1)
- **Location**: KMS/HSM with auto-rotation
- **Expiry**: 24 hours

### Provider Priority Matrix

| Priority | Provider | Use Case | Implementation Phase |
|----------|----------|----------|---------------------|
| P0 | AWS KMS/CloudHSM | Primary hosted | Phase 1 |
| P1 | Azure Key Vault Managed HSM | Multi-cloud parity | Phase 2 |
| P1 | Google Cloud KMS/HSM | Multi-cloud parity | Phase 2 |
| P2 | HashiCorp Vault Transit | Hybrid/on-prem | Phase 2 |
| P2 | Local HSM (YubiHSM/Nitrokey) | Air-gapped | Phase 2 |
| Test | SoftHSM2 | Development only | Phase 1 |

### Security Controls
- Abstract signers behind common interface (PKCS#11 + native KMS APIs)
- Log every signing operation with exportable audit trails
- Threshold at TUF level, not KMS MPC/M-of-N
- Object Lock (WORM) for tamper prevention

## 3. SBOM Format Strategy

### Primary: CycloneDX v1.5 JSON
**Rationale**:
- Industry standard with excellent tooling (Dependency-Track, OWASP, cdxgen)
- Supports component graphs, services, and attestations
- Good adoption in enterprise environments

### Secondary: SPDX 2.3 (Phase 2)
**Implementation**: Auto-generate from CycloneDX source-of-truth
**Purpose**: Standards compliance and ecosystem compatibility

### Attestation Integration
**Format**: SLSA v1 provenance with DSSE envelopes
**Distribution**: Signed TUF targets in "attestations" delegated role
**Linking**: bom-ref → provenance → SBOM → artifact (GUAC integration)

### Explicitly Rejected: Custom JSON
**Reason**: Zero added value, increases parsing/maintenance burden

## 4. Storage Backend Architecture

### Primary: AWS S3 + CloudFront
**Features**:
- Object versioning and Object Lock (WORM)
- Multi-region replication
- Differentiated cache policies:
  - Timestamp: no-cache with aggressive invalidation
  - Snapshot/Targets: cacheable with proper TTL

**Configuration**:
```yaml
timestamp_cache: no-store
snapshot_cache: 7_days
targets_cache: 90_days
invalidation: automatic_on_publish
```

### Parity: GCS + Cloud CDN
**Timeline**: Phase 2
**Purpose**: Multi-cloud redundancy and vendor flexibility

### Air-gapped: Self-hosted nginx
**Features**:
- Read-only filesystem layout (TUF compliant)
- Container/Helm/Ansible deployment options
- Atomic directory swaps for consistent snapshots

**Export/Import Process**:
```bash
ragv-export --destination /path/to/bundle.tar.gz
ragv-import --source bundle.tar.gz --atomic-swap
```

### Optional (Phase 3): OCI Registries
**Implementation**: ORAS for non-container artifacts
**Constraint**: TUF remains trust layer; OCI as transport only
**Avoid**: Conflation with Notary v2 policies

## 5. Federation and Tenancy Model

### Delegation Strategy
**Structure**:
```
root
├── timestamp (online HSM)
├── snapshot (online HSM)
├── targets (offline keys)
│   ├── vendors/* (terminating delegations)
│   │   ├── vendor1/* (2-of-3 threshold)
│   │   └── vendor2/* (customer KMS keys)
│   └── attestations/* (SLSA provenance)
```

### Cross-organization Federation
- TUF delegations for per-tenant/publisher namespaces
- Customer-controlled keys in their KMS/HSM
- Policy guardrails: path constraints, size limits, attestation requirements

### Security Boundaries
- Path pattern enforcement
- Required SBOM + SLSA provenance per delegated scope
- Audit trail for cross-organization signing events

## 6. Implementation Phases

### Phase 1: Security Foundation (Weeks 1-4)
**Deliverables**:
- tough/Rust repo service and client CLI
- AWS KMS integration with ECDSA P-256
- Offline root ceremony (3-of-5 YubiHSM tokens)
- S3 + CloudFront with Object Lock
- CycloneDX v1.5 SBOM generation and signing
- SLSA v1 provenance attestations (DSSE)
- ragv-mirror CLI for offline synchronization

**Policies**:
- Timestamp: 1 day expiry
- Snapshot: 7 day expiry  
- Targets: 90 day expiry
- Root: 12 month expiry
- Consistent snapshots: enabled

**Testing**:
- python-tuf interoperability validation
- Negative tests: rollback/freeze/indirection attacks
- Air-gap mirror functionality

### Phase 2: Federation and Multi-cloud (Weeks 5-8)
**Deliverables**:
- Azure Managed HSM, GCP Cloud KMS/HSM signers
- HashiCorp Vault Transit integration
- Per-tenant delegated roles with customer-held keys
- Policy enforcement on delegated scopes
- Hardened self-hosted nginx mirror package
- Export/import bundles with integrity checks
- SPDX 2.3 auto-generation from CycloneDX
- GUAC integration reference

### Phase 3: Ecosystem Integration (Weeks 9-12)
**Deliverables**:
- Go-native client via go-tuf (demand-driven)
- Conformance suite with python-tuf
- Optional OCI transport via ORAS
- Transparency log integration (Rekor)
- FIPS client mode (OpenSSL 3 FIPS module)

## 7. Operational Hardening

### Upload Sequence
**Required Order**: new targets → new snapshot → new timestamp
**Critical**: Timestamp upload must be last and fast

### Cache Management
**Timestamp**: no-store, aggressive purge/invalidation
**Targets**: WORM enforcement, content-addressed naming
**CDN**: Automated invalidation on publish

### Audit and Monitoring
**Logging**: Tamper-evident audit logs for all signing events
**Alerting**: Unusual signing frequency, device/location changes
**Compliance**: Exportable audit trails for SOC 2/ISO 27001

### Disaster Recovery
**Documentation**: Root key rotation procedures
**Testing**: Partner revocation scenarios
**Backup**: Multi-location key custody arrangements

### Policy Gates
**Requirements**:
- No publish without SBOM + SLSA provenance
- Delegated scope path validation
- Size and frequency limits per vendor

## 8. Risk Mitigation Matrix

| Risk | Mitigation | Implementation Phase |
|------|------------|---------------------|
| KMS algorithm gaps | Standardize ECDSA P-256, Ed25519 where supported | Phase 1 |
| CDN caching pitfalls | Timestamp no-store, automated invalidations | Phase 1 |
| Federation complexity | Constrained delegations, tooling validation | Phase 2 |
| Multi-language needs | Secure Rust CLI, SDK wrappers, Go on demand | Phase 1-3 |
| Air-gap operations | nginx mirrors, export/import bundles | Phase 2 |
| Key compromise | Rapid revocation, multi-party controls | Phase 1 |

## 9. Success Metrics

### Security Metrics
- Zero compromise incidents in key management
- Sub-24h mean time to revocation (MTTR)
- 100% audit trail coverage for signing operations

### Performance Metrics
- <2s timestamp update propagation
- <10s mirror synchronization for standard plugin
- 99.9% CDN cache hit rate for targets/snapshots

### Operational Metrics
- <5min root key ceremony execution
- <1hr air-gap bundle export/import cycle
- Zero failed delegated signing attempts

### Business Metrics
- Support for 100+ enterprise customers per hub
- <1 week vendor onboarding time
- Zero license policy enforcement bypasses

## 10. Next Steps

1. **Immediate**: Begin Phase 1 implementation with tough/Rust evaluation
2. **Week 1**: AWS KMS integration and key ceremony design
3. **Week 2**: S3 + CloudFront configuration and caching policies
4. **Week 3**: CycloneDX SBOM generation and TUF integration
5. **Week 4**: python-tuf interoperability testing and security validation

## 11. Technology Evaluation Criteria

### Security Assessment
- Memory safety and attack surface minimization
- Cryptographic algorithm support and compliance
- Key management integration capabilities
- Audit trail and monitoring capabilities

### Operational Assessment  
- Multi-cloud and air-gap deployment support
- Enterprise integration complexity
- Performance and scalability characteristics
- Maintenance and support ecosystem

### Commercial Assessment
- Licensing and intellectual property considerations
- Vendor lock-in and portability concerns
- Cost structure and pricing models
- Customer adoption and market acceptance

---

*This tech stack foundation enables secure, scalable, enterprise-grade plugin distribution with comprehensive supply chain security controls and operational flexibility.*