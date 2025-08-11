---
title: "Associate Developer Handoff Guide"
created: "2025-08-11"
updated: "2025-08-11"
category: "handoff"
tags: ["handoff", "onboarding", "associate-dev", "checklist"]
priority: "high"
status: "active"
author: "RAGnos Labs <labs@ragnos.io>"
project: "RAGnos Labs"
version: "1.0.0"
---

# Associate Developer Handoff Guide

*Complete onboarding checklist and context for RAGnos Vault development*

## Pre-Handoff Checklist

### Access Setup
- [ ] GitHub access to `plumwheel` organization
- [ ] Write access to `plumwheel/ragnos-vault` repository
- [ ] Docker Hub or GHCR access (if needed)
- [ ] Team communication channels

### Development Environment
- [ ] Docker Desktop installed and running
- [ ] Node.js 20 LTS installed
- [ ] Git configured with SSH keys
- [ ] Code editor with TypeScript support

## 15-Minute Setup Challenge

**Goal**: From zero to running RAGnos Vault in 15 minutes

```bash
# 1. Clone repository (2 min)
git clone git@github.com:plumwheel/ragnos-vault.git
cd ragnos-vault

# 2. Environment setup (1 min)
make bootstrap

# 3. Start services (10 min - Docker pulls)
make dev

# 4. Verify working (2 min)
make health
```

**Success criteria**: 
- ✅ http://localhost:8080 loads
- ✅ Health checks pass
- ✅ Can create account and workspace

## Project Context

### What is RAGnos Vault?
- **Commercial fork** of Infisical (MIT licensed)
- **Secrets management** platform for RAGnos ecosystem
- **Production target**: Replace AWS Secrets Manager
- **Current status**: Development/testing phase

### Technical Stack
- **Backend**: Node.js, PostgreSQL, Redis
- **Frontend**: Next.js, React, TypeScript
- **Infrastructure**: Docker Compose, GitHub Actions
- **Deployment**: GHCR containers, multi-arch builds

### Key Files to Understand
```
ragnos-vault/
├── Makefile              # All development commands
├── docker-compose.dev.yml # Local development stack
├── .github/workflows/    # CI/CD pipelines
├── docs/internal/        # Team documentation
├── backend/              # API and business logic
└── frontend/             # Web interface
```

## Development Workflow

### Daily Development
1. `make dev` - Start everything
2. Make changes (hot reload active)
3. `make reviewable` - Lint/type check
4. Commit and push
5. `make down` - Clean shutdown

### Code Quality Standards
- **TypeScript**: Strict mode, proper typing
- **Linting**: ESLint + Prettier configured
- **Testing**: Jest for backend, tests required for new features
- **Commits**: Descriptive messages, conventional format preferred

### Branch Strategy
- `main` - Protected, production-ready
- `feature/description` - Your feature branches
- Always PR to main, never direct push

## First Week Tasks

### Week 1: Familiarization
- [ ] Complete 15-minute setup challenge
- [ ] Explore the interface, create test workspace/secrets
- [ ] Read through backend and frontend code structure
- [ ] Make a small documentation improvement (first PR)

### Week 2: Development
- [ ] Pick up a "good first issue" from backlog
- [ ] Implement feature with tests
- [ ] Go through full PR review process
- [ ] Deploy and test in development environment

## Important Context

### RAGnos Ecosystem
- **Mouse-Ops**: Parent company (dev tools)
- **RAGnos**: AI operating system ecosystem  
- **Plumwheel**: Brand storytelling company
- **Repository pattern**: `plumwheel/ragnos-*` for ecosystem tools

### Team Structure (Small Team)
- **Hunter**: Product/PM, architecture decisions
- **Co-founder**: Technical strategy, infrastructure
- **You**: Feature development, code review, maintenance
- **Consultants**: Specialized tasks, documentation

### Strategic Goals
1. **Replace AWS Secrets Manager** for RAGnos backend
2. **Provider-agnostic** architecture for customer choice
3. **MIT compliance** while building commercial features
4. **Scale to enterprise** secrets management

## Common Tasks & Solutions

### Starting Services
```bash
# Quick start
make dev

# Check if running
make status

# View logs
make logs

# Stop everything
make down
```

### Code Quality
```bash
# Before committing
make reviewable

# Run tests
make test

# Full cleanup
make clean
```

### Troubleshooting
```bash
# Port conflicts
# Edit docker-compose.dev.yml ports section

# Database issues  
make down && docker volume rm ragnos-vault_postgres-data && make dev

# Docker issues
make clean  # Full Docker cleanup

# Service health
make health
curl http://localhost:8080/api/v1/status
```

### Development Debugging
- **Backend logs**: `docker logs infisical-dev-api`
- **Frontend logs**: `docker logs infisical-dev-frontend`
- **Database**: PGAdmin at http://localhost:5050
- **Redis**: Redis Commander at http://localhost:8085

## CI/CD Pipeline

### PR Workflow
1. Create feature branch
2. Push changes → triggers CI
3. CI runs: lint, test, build, Docker health checks
4. Code review from team
5. Merge → triggers release pipeline

### Release Pipeline  
- Builds multi-arch Docker images
- Pushes to GHCR (ghcr.io/plumwheel/ragnos-vault)
- Runs security scans (Trivy)
- Tags with branch, sha, latest

## Escalation & Help

### When You're Stuck
1. **Check logs**: `make logs` or specific container logs
2. **Clean restart**: `make clean && make dev`
3. **Ask team**: Share specific error messages
4. **Create issue**: Document problem for team tracking

### Team Communication
- **Quick questions**: Team chat
- **Technical decisions**: GitHub discussions
- **Bug reports**: GitHub issues with reproduction steps
- **Feature requests**: Create issue with "enhancement" label

## Success Metrics

### Week 1 Success
- [ ] Can start/stop services consistently
- [ ] Completed first PR (even small docs change)
- [ ] Understands codebase structure
- [ ] Can reproduce issues and find logs

### Month 1 Success
- [ ] Implementing features independently  
- [ ] Providing code reviews for others
- [ ] Identifying and fixing bugs
- [ ] Contributing to architecture discussions

## Next Phase: Scaling

When the team grows, you'll help with:
- **Repository migration** to dedicated RAGnos org
- **New developer onboarding** using this guide
- **CI/CD improvements** and deployment automation
- **Code architecture** decisions for RAGnos ecosystem

## Quick Reference

### Essential Commands
```bash
make help          # Show all commands
make bootstrap     # Setup .env
make dev          # Start & logs  
make status       # Service status
make health       # Health checks
make reviewable   # Lint/type check
make clean        # Full cleanup
```

### Key URLs
- **App**: http://localhost:8080
- **API**: http://localhost:8080/api/v1
- **PGAdmin**: http://localhost:5050 (admin@example.com / pass)
- **Redis**: http://localhost:8085
- **Email**: http://localhost:8025

### Repository Structure
- `backend/` - Node.js API
- `frontend/` - Next.js app
- `docs/internal/` - Team docs
- `.github/workflows/` - CI/CD
- `docker-compose.dev.yml` - Development stack

**Ready to start? Run the 15-minute setup challenge! 🚀**