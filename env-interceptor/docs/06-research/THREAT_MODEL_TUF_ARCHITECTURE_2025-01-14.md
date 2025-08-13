---
title: "RAGnos Vault TUF Architecture Threat Model"
created: "2025-01-14"
updated: "2025-01-14"
category: "security"
tags: ["threat-model", "tuf", "supply-chain", "architecture"]
priority: "critical"
status: "active"
author: "RAGnos Labs <labs@ragnos.io>"
project: "ragnos-vault"
version: "1.0"
---

# RAGnos Vault TUF Architecture Threat Model

## Executive Summary

This threat model establishes the security foundation for RAGnos Vault's TUF-backed plugin distribution system. The highest-value control is a robust TUF pipeline with clear trust anchors, vendor delegations, and compromise-recovery procedures.

**Architecture**: Central RAGnos Hub supporting federated mirrors and enterprise overlays
**Key Strategy**: Offline root keys, HSM-backed online keys, vendor namespace delegations
**Priority**: Supply chain security as the critical foundation for enterprise adoption

## System Assets

### Current (M1 Complete)
- Subprocess sandbox with resource limits and process isolation
- JSON-RPC protocol over stdio for plugin communication  
- Policy engine with manifest validation and audit trails
- Runtime loader with secure plugin lifecycle management
- Dual-tier model: manifest-only + SDK plugins

### Target (M2/M3)
- TUF-backed plugin distribution Hub
- Signature verification and trust establishment
- Secure auto-installer with dependency validation
- License policy enforcement with commercial compliance
- Key management and rotation infrastructure

## Threat Analysis

### Priority 1: Critical Supply Chain Vectors

#### 1. Malicious or Compromised Plugin Publisher
**Scenario**: Vendor key compromise or insider uploads backdoored plugin
**Impact**: Code execution on all client systems  
**Likelihood**: Medium (targeted attacks on popular vendors)

**Mitigations**:
- TUF vendor delegations with threshold signing (2-of-3 minimum)
- Short targets expiry (30-90 days)
- Transparency log/witnessing for all publications
- Reproducible builds and provenance attestations
- Independent malware/static scanning before mirroring
- Rapid key revocation paths with emergency procedures

#### 2. Repository/Mirror Compromise and Targeted Backdooring
**Scenario**: Attacker modifies binaries or serves different versions to specific victims
**Impact**: Targeted compromise of high-value clients
**Likelihood**: Medium (APT-level adversaries)

**Mitigations**:
- TUF signature verification at client
- Consistent snapshots enabled
- Multiple mirrors with identical metadata verification
- Client requires fresh timestamp (24h max staleness)
- Optional witness signatures and transparency auditing
- Multi-mirror equality checks with failover

#### 3. Rollback/Freeze/Replay Attacks  
**Scenario**: Serve older vulnerable plugin or freeze updates
**Impact**: Clients remain on exploitable versions
**Likelihood**: High (low technical barrier)

**Mitigations**:
- TUF timestamp with 24h expiry
- Snapshot with 7-day expiry
- Max staleness policy enforcement
- Monotonically increasing version/epoch tracking
- Persistent client storage of last-seen versions

### Priority 2: Operational Security Vectors

#### 4. Key Theft and Weak Operational Security
**Scenario**: Timestamp/snapshot or vendor targets keys compromised
**Impact**: Repository takeover or targeted plugin injection
**Likelihood**: Medium (human factors, CI/CD complexity)

**Mitigations**:
- HSM/KMS for all online keys
- Short-lived signing tokens (auto-rotation)
- Least-privilege CI/CD with hardware-backed SSO
- Multi-party approvals for sensitive operations
- Regular rotation schedule with documented procedures

#### 5. Dependency Confusion/Typosquatting
**Scenario**: Resolver pulls public "foo" instead of private "corp/foo"
**Impact**: Supply chain infiltration via naming attacks
**Likelihood**: High (demonstrated attack pattern)

**Mitigations**:
- Namespaced identifiers (vendor/plugin format)
- Repository pinning with terminating delegations
- Enterprise allow/deny lists with precedence
- Signed lockfiles with exact digest resolution
- No implicit cross-repo resolution

### Priority 3: Runtime Security Vectors

#### 6. Auto-installer Execution of Untrusted Code
**Scenario**: Install-time scripts run with dangerous privileges
**Impact**: System compromise during plugin installation
**Likelihood**: Medium (common in package managers)

**Mitigations**:
- Prohibit install scripts by default (--ignore-scripts)
- Sandbox any necessary install operations
- Treat install as pure file fetch/verify
- Capability-gated post-install steps only
- Mandatory artifact scanning and SBOM verification

#### 7. License Enforcement Bypass
**Scenario**: Attacker redistributes commercial plugin without entitlements
**Impact**: Revenue loss and compliance violations
**Likelihood**: High (economic incentive)

**Mitigations**:
- Signed entitlement tokens bound to target digest
- Authenticated artifact access with organization credentials
- Offline token verification against License Authority public key
- Audit trail for all commercial plugin usage
- Short-lived tokens (7-30 days) with automatic renewal

## TUF Architecture Design

### Repository Model

#### Central RAGnos Hub
- **Root role**: 3-of-5 threshold, offline keys, 1-2 year expiry
- **Timestamp role**: Single online HSM key, 24-48h expiry  
- **Snapshot role**: 1-of-2 online HSM keys, 7-day expiry
- **Targets role**: 2-of-3 offline keys, 90-day expiry

#### Delegation Structure
```
root
├── timestamp (online HSM)
├── snapshot (online HSM) 
├── targets (offline)
│   ├── vendors/* (terminating delegations)
│   │   ├── vendor1/* (2-of-3 threshold)
│   │   └── vendor2/* (1-of-2 threshold)
│   └── community/* (stricter expiry, lower trust)
└── enterprise-overlay (optional, customer-managed)
```

#### Federation Support
- **Mirrors**: Read-only CDN mirrors with consistent snapshots
- **Enterprise overlays**: Customer-managed policy enforcement
- **Air-gapped**: Offline mirror sync with integrity verification

### Key Management Strategy

#### Key Hierarchy
1. **Root Keys**: 3-of-5 offline HSMs, distributed custody
2. **Online Keys**: HSM/KMS with IP allowlists and MFA
3. **Vendor Keys**: Self-managed offline keys with RAGnos delegation
4. **License Authority**: Separate keypair for entitlement tokens

#### Rotation Schedule
- **Timestamp**: Auto-rotation every 30-90 days
- **Snapshot**: Rotation every 90-180 days or signer change
- **Targets**: Planned rotation annually, emergency as needed
- **Root**: Rotation every 12-24 months with ceremony

#### Compromise Recovery
- **Root compromise**: Multi-version client support with out-of-band updates
- **Online key compromise**: Immediate revocation and reissuance
- **Vendor compromise**: Delegation revocation and transparency log alert
- **License Authority**: Token invalidation and re-enrollment

### Client Security Model

#### Verification Flow
1. **Root pinning**: Ship with trusted root metadata
2. **Metadata refresh**: timestamp → snapshot → targets → delegations
3. **Staleness enforcement**: Reject stale metadata per policy
4. **Digest verification**: Exact target digest matching required
5. **Policy checks**: Vendor allowlist, provenance, license validation

#### Dependency Resolution
- **Namespaced identifiers**: `vendor/plugin@version` format
- **Signed lockfiles**: Exact digest enumeration
- **No cross-repo**: Prevent namespace confusion
- **Reproducible resolution**: Deterministic dependency graphs

### License Verification

#### Distribution Control
- **Private artifacts**: Authenticated CDN for commercial plugins
- **Public metadata**: TUF metadata remains transparent
- **Organization credentials**: Scoped access tokens

#### Entitlement Tokens (JWT/COSE)
```json
{
  "sub": "organization/customer-id",
  "plugin": "vendor/plugin-name", 
  "version": "1.2.3",
  "digest": "sha256:abc123...",
  "features": ["premium", "enterprise"],
  "seats": 100,
  "exp": 1640995200,
  "aud": "ragnos-vault"
}
```

#### Enforcement Points
- **Installer**: Token verification before artifact fetch
- **Runtime loader**: Periodic token validity checks
- **Audit trail**: Usage logging with token subject and plugin digest

## Implementation Priorities

### M2 Phase 1: TUF Foundation (Weeks 1-4)
1. **Root key ceremony**: Generate and secure offline root keys
2. **TUF repository**: Consistent snapshots with HSM-backed online keys
3. **Delegation model**: Vendor namespace delegations
4. **Client integration**: TUF verification in runtime loader

### M2 Phase 2: Security Enforcement (Weeks 3-6)  
1. **Policy integration**: Vendor allowlists and CVE gates
2. **Provenance verification**: in-toto/SLSA attestation support
3. **License tokens**: JWT verification and audit logging
4. **Dependency resolution**: Signed lockfiles with exact digests

### M3 Phase 1: Auto-installer (Weeks 5-8)
1. **Secure installation**: --ignore-scripts by default
2. **SBOM validation**: Component policy enforcement
3. **Artifact scanning**: Malware and static analysis integration
4. **Sandbox installation**: Contained install operations

### M3 Phase 2: Enterprise Features (Weeks 7-9)
1. **Enterprise overlays**: Customer policy enforcement
2. **Mirror support**: Air-gapped and federated scenarios
3. **Compromise response**: Automated revocation and rotation
4. **Audit dashboards**: Security monitoring and alerting

## Operational Parameters

### Default Expiry Windows
- **Timestamp**: 24 hours
- **Snapshot**: 7 days  
- **Targets**: 90 days (30 for community)
- **Root**: 12-24 months

### Threshold Requirements
- **Root**: 3-of-5 keys
- **High-risk vendors**: 2-of-3 keys
- **Low-risk vendors**: 1-of-2 keys
- **License tokens**: 7-30 day lifetime

### Policy Defaults
- **Consistent snapshots**: Enabled
- **Offline verification**: Required
- **Fail closed**: On signature or policy violations
- **Max staleness**: 24h timestamp, 7d snapshot

## Risk Assessment

| Threat Vector | Likelihood | Impact | Risk Level | Mitigation Priority |
|---------------|------------|---------|------------|-------------------|
| Publisher compromise | Medium | Critical | High | P0 - Threshold signing |
| Repository backdoor | Medium | Critical | High | P0 - TUF verification |
| Rollback attacks | High | High | High | P0 - Version tracking |
| Key compromise | Medium | High | Medium | P1 - HSM/rotation |
| Dependency confusion | High | Medium | Medium | P1 - Namespacing |
| Install script RCE | Medium | High | Medium | P2 - Sandbox install |
| License bypass | High | Low | Low | P2 - Token binding |

## Compliance Considerations

### Enterprise Requirements
- **SOC 2 Type II**: Audit trail and access controls
- **ISO 27001**: Risk management and incident response
- **NIST CSF**: Supply chain risk management
- **SLSA**: Provenance and build integrity

### Regulatory Alignment
- **GDPR**: Privacy-aware audit logging
- **SOX**: Financial audit trail for commercial plugins
- **Export controls**: Crypto compliance and distribution restrictions

## Next Steps

1. **Tech stack decisions**: TUF implementation, HSM provider, SBOM format
2. **Root key ceremony**: Security procedures and custody arrangements  
3. **Repository deployment**: Infrastructure and CI/CD integration
4. **Client implementation**: TUF verification in runtime loader
5. **Vendor onboarding**: Key generation and delegation procedures

---

*This threat model provides the security foundation for RAGnos Vault's supply chain security architecture and will be updated as the system evolves.*