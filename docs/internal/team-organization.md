---
title: "RAGnos Ecosystem Team Organization"
created: "2025-08-11"
updated: "2025-08-11"
category: "organization"
tags: ["team", "organization", "ecosystem", "standards"]
priority: "medium"
status: "active"
author: "RAGnos Labs <labs@ragnos.io>"
project: "RAGnos Labs"
version: "1.0.0"
---

# RAGnos Ecosystem Team Organization

*Development-first organization for small team scaling*

## Current Team Structure (Aug 2025)

### Core Team
- **Hunter**: Co-founder, Product/PM, Architecture decisions
- **Co-founder**: Technical strategy, CI/CD, Infrastructure  
- **Associate Dev**: Implementation, code review, feature development
- **Consultants**: Specialized tasks, documentation, QA

### Repository Organization

**Current Strategy**: Everything under `plumwheel` GitHub org with clear naming

#### Naming Conventions
```
# RAGnos Ecosystem
plumwheel/ragnos-vault         ← Secret management (this repo)
plumwheel/ragnos-{tool-name}   ← Future RAGnos tools

# Plumwheel Brand Tools  
plumwheel/rough-cutter         ← Existing video tool
plumwheel/plumwheel-{tool}     ← Future Plumwheel tools
```

## Development Process (Development Mode)

### Access & Permissions
- **Hunter & Co-founder**: Admin access to all repositories
- **Associate Dev**: Write access to RAGnos repos, Read access to planning docs
- **Consultants**: Issue-based access, specific repository access as needed

### Branching Strategy
- **main**: Protected, requires PR + CI passing
- **develop**: Integration branch for multi-feature work  
- **feature/**: Short-lived feature branches

### Review Process
1. Feature development in branch
2. PR with CI checks (lint, test, build)
3. Code review from core team member
4. Merge after approval + CI green

## RAGnos Ecosystem Growth Plan

### Phase 1: Current (Development Mode)
- Small team, simple processes
- Focus on working tools over perfect organization
- Use `plumwheel/ragnos-*` naming pattern

### Phase 2: Team Scaling (Future)
- Add dedicated RAGnos developers
- More sophisticated CI/CD and deployment
- Consider dedicated GitHub org when team > 8 people

### Phase 3: Enterprise (Future)
- Separate `ragnos` or `ragnos-labs` GitHub organization
- Repository migration with proper redirects
- Team-based access controls and advanced workflows

## Current Week Priorities

### RAGnos Vault (This Week)
- ✅ CI/CD pipeline working
- ✅ Development environment setup
- 🔄 Documentation for team
- ⏳ Associate dev handoff prep

### Documentation Standards
- **Internal docs**: `docs/internal/` - team-only information
- **Public docs**: Standard project documentation
- **Handoff docs**: Clear onboarding for associate dev

## Ecosystem Tool Pipeline

### Upcoming RAGnos Tools (Prioritized)
1. **RAGnos Agent Framework** - Agent coordination system
2. **RAGnos Memory Lake** - Knowledge management
3. **RAGnos SDK** - Developer integration tools
4. **RAGnos CLI** - Command-line tooling

### Organizational Approach
- Each tool gets its own repository: `plumwheel/ragnos-{tool}`
- Shared documentation in dedicated `plumwheel/ragnos-docs`
- Common CI/CD patterns and workflows

## Communication Channels

### Internal Team
- **Planning**: Team meetings, strategic decisions
- **Development**: Code reviews, technical discussions
- **Issues**: GitHub issues for tracking and assignment

### External (Future)
- **Community**: When RAGnos goes public
- **Enterprise**: Customer feedback and feature requests

## Migration Planning (For Associate Dev)

### When Team Grows
1. **Assess**: Team size, complexity, external users
2. **Plan**: Repository migration strategy
3. **Execute**: Create new org, migrate repos with redirects
4. **Update**: All documentation and links

### Migration Checklist (Future)
- [ ] Create new GitHub organization  
- [ ] Transfer repositories with proper redirects
- [ ] Update CI/CD workflows and secrets
- [ ] Migrate team access and permissions
- [ ] Update all documentation and links

## Success Metrics

### Development Mode (Current)
- ✅ Team can contribute to any RAGnos repo in < 15 minutes
- ✅ CI/CD catches issues before merge
- ✅ Clear handoff documentation exists

### Scaling Mode (Future)
- New team members productive in < 1 day
- Repository organization scales to 20+ tools
- Clear separation between RAGnos and Plumwheel brands

## Key Principles

1. **Working > Perfect**: Ship working tools, iterate organization
2. **Clear Naming**: Always obvious which ecosystem a repo belongs to  
3. **Simple Handoffs**: Associate dev can take over with minimal context
4. **Future-Ready**: Organization pattern scales to enterprise needs

*Updated weekly as team and ecosystem evolve*