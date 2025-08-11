---
title: "RAGnos Vault Development Quickstart"
created: "2025-08-11"
updated: "2025-08-11" 
category: "development"
tags: ["quickstart", "development", "docker", "setup"]
priority: "high"
status: "active"
author: "RAGnos Labs <labs@ragnos.io>"
project: "RAGnos Labs"
version: "1.0.0"
---

# RAGnos Vault Development Quickstart

*Get up and running with RAGnos Vault in 5 minutes*

## Prerequisites

- Docker Desktop or Podman
- Node.js 20 LTS
- Git
- curl (for health checks)

## Quick Start

```bash
# 1. Clone and enter repository
git clone https://github.com/plumwheel/ragnos-vault.git
cd ragnos-vault

# 2. Set up environment
make bootstrap

# 3. Start everything 
make dev

# 4. Check health
make health
```

## Service Endpoints

| Service | URL | Purpose |
|---------|-----|---------|
| **Main App** | http://localhost:8080 | RAGnos Vault web interface |
| **API** | http://localhost:8080/api/v1 | Backend API |
| **PGAdmin** | http://localhost:5050 | Database management |
| **Redis Commander** | http://localhost:8085 | Redis management |
| **MailHog** | http://localhost:8025 | Email testing |

### Default Credentials
- **PGAdmin**: admin@example.com / pass
- **Database**: infisical / infisical

## Development Commands

```bash
# Show all available commands
make help

# Start development environment
make dev              # Start and show logs
make up-dev           # Start in background
make status           # Check service status

# Development tools
make test             # Run tests
make reviewable       # Lint and type-check
make health           # Health check all services

# Cleanup
make down             # Stop services
make clean            # Full cleanup + Docker prune
```

## Project Structure

```
ragnos-vault/
├── backend/          # Node.js/Express API
├── frontend/         # Next.js web interface  
├── docs/internal/    # Team documentation
├── .github/          # CI/CD workflows
├── docker-compose.dev.yml  # Development services
├── Makefile          # Development commands
└── .env              # Local environment (generated)
```

## Development Workflow

1. **Feature Development**
   - Create feature branch from `main`
   - Make changes with hot reload active
   - Test locally with `make test`

2. **Code Quality**
   - Run `make reviewable` before committing
   - PR CI will validate build and tests
   - Health checks must pass

3. **Testing**
   - Services auto-reload on file changes
   - Backend: http://localhost:4000 (direct)
   - Frontend: http://localhost:3000 (direct)

## Troubleshooting

### Services Won't Start
```bash
# Check Docker is running
docker --version

# Clean Docker state  
make clean

# Restart fresh
make dev
```

### Port Conflicts
Default ports: 8080 (main), 4000 (backend), 3000 (frontend), 5432 (postgres), 6379 (redis)

Edit `docker-compose.dev.yml` to change ports if needed.

### Database Issues
```bash
# Reset database
make down
docker volume rm ragnos-vault_postgres-data
make dev
```

### Health Checks Failing
```bash
# Check service status
make status

# View logs
make logs

# Test specific endpoints
curl http://localhost:8080/api/v1/status
curl http://localhost:3000
```

## Next Steps

- See [Architecture Overview](./architecture.md)
- Read [Contributing Guide](../../CONTRIBUTING.md) 
- Check [Team Organization](./team-organization.md)

## Need Help?

- **Internal team**: Ask in team chat
- **Issues**: Check service logs with `make logs`
- **Docker**: Run `make clean` for fresh start