---
title: "RAGnos Vault - Development Docker Monitoring Profile Guide"
created: "2025-08-12"
updated: "2025-08-12"
category: "development"
tags: ["vault", "monitoring", "docker-compose", "development", "profiles"]
priority: "medium"
status: "active"
author: "RAGnos Labs <labs@ragnos.io>"
project: "RAGnos Labs"
version: "1.0.0"
---

# RAGnos Vault - Development Docker Monitoring Profile

## Quick Start Guide for Auto-Starting Monitoring

**Status**: ✅ Vault Monitor Working | ⚠️ Dashboard Needs Workspace Setup

## Usage Commands

### Start Vault Only (Default)
```bash
cd /path/to/ragnos-vault
docker compose -f docker-compose.dev.yml up -d
```

### Start Vault + Monitoring Profile
```bash
cd /path/to/ragnos-vault
docker compose -f docker-compose.dev.yml --profile monitoring up -d
```

### Start Only Monitoring Components
```bash
docker compose -f docker-compose.dev.yml --profile monitoring up vault-monitor -d
```

### Stop All Services
```bash
docker compose -f docker-compose.dev.yml --profile monitoring down
```

## What's Included

### ✅ Working Components

**1. Vault Monitor (ragnos-vault-monitor)**
- **Image**: `node:18`
- **Command**: `node simple-api-test.js`
- **Function**: Continuous API key access pattern testing
- **Port**: None (internal monitoring)
- **Status**: ✅ Working - runs API key access tests every few seconds

**2. Database (ragnos-vault-db-1)**
- **Image**: `postgres:14-alpine`
- **Port**: `25431:5432`
- **Function**: PostgreSQL for vault metadata
- **Status**: ✅ Working

**3. Redis (infisical-dev-redis)**
- **Image**: `redis`
- **Port**: `36379:6379`
- **Function**: Caching layer for vault operations
- **Status**: ✅ Working

### ⚠️ Pending Components

**4. Vault Dashboard (ragnos-vault-dashboard)**
- **Status**: ⚠️ Needs workspace dependency setup
- **Issue**: Control plane uses `workspace:*` dependencies
- **Workaround**: Run manually outside Docker:
```bash
cd services/control-plane
npm install
npm run dev
# Visit: http://localhost:3000/docs
```

## Configuration Details

### Port Assignments (Conflict-Free)
- **Database**: `25431:5432` (external:internal)
- **Redis**: `36379:6379` (external:internal)
- **Dashboard**: `3000:3000` (when working)

### Environment Variables
The monitoring profile automatically sets:
```yaml
environment:
  - NODE_ENV=development
  - VAULT_MODE=dual
  - VAULT_CANARY_PERCENT=25
  - HUGGINGFACE_API_KEY=hf_test_key_for_monitoring
```

## Architecture Benefits (GPT-5 Validated)

### Development Benefits ✅
- **Single Command**: `--profile monitoring` starts everything
- **Port Isolation**: No conflicts with existing services
- **Hot Reload**: Volume mounts for development iteration
- **Container Logs**: Easy debugging with `docker logs`

### Production Separation ✅
- **Profile Gated**: Monitoring never starts in production accidentally
- **Override Ready**: Can use `docker-compose.override.yml` for local customization
- **Resource Isolated**: Monitoring containers don't compete with vault performance

## Monitoring Capabilities

### Real-Time Monitoring
```bash
# Watch live monitoring output
docker logs -f ragnos-vault-monitor

# Output shows:
# - API key access patterns
# - Direct access tests
# - Destructuring tests
# - Configuration object tests
# - Fallback chain tests
# - Dynamic key access tests
```

### Container Status
```bash
# Check all monitoring containers
docker compose -f docker-compose.dev.yml --profile monitoring ps

# Check specific monitor
docker ps --filter "name=ragnos-vault-monitor"
```

## Development Workflow

### 1. Daily Development
```bash
# Start vault with monitoring
docker compose -f docker-compose.dev.yml --profile monitoring up -d

# Work on vault code...
# Monitoring runs automatically in background

# Check monitoring status
docker logs ragnos-vault-monitor

# Stop when done
docker compose -f docker-compose.dev.yml --profile monitoring down
```

### 2. Testing Vault Changes
```bash
# Make changes to env-interceptor code
# Monitor automatically picks up volume-mounted changes

# Test specific components
docker compose -f docker-compose.dev.yml --profile monitoring up vault-monitor

# Verify changes in logs
docker logs -f ragnos-vault-monitor
```

### 3. Debugging Issues
```bash
# Check container status
docker compose -f docker-compose.dev.yml --profile monitoring ps

# View logs for debugging
docker logs ragnos-vault-monitor
docker logs ragnos-vault-db-1
docker logs infisical-dev-redis

# Connect to containers for debugging
docker exec -it ragnos-vault-monitor sh
```

## Production Deployment Notes

### ⚠️ Important: Production Separation
- **Do NOT use** monitoring profile in production
- **Production monitoring** should be deployed separately per GPT-5 recommendations:
  - Different hosts/nodes for failure isolation
  - Separate resource allocation
  - Independent scaling and updates
  - External monitoring stack (Prometheus/Grafana)

### Production Commands
```bash
# Production vault only (no monitoring profile)
docker compose -f docker-compose.prod.yml up -d

# Monitoring deployed separately:
# - systemd services for vault monitors
# - External Prometheus/Grafana stack
# - Independent infrastructure
```

## Troubleshooting

### Port Conflicts
If you see "port already allocated" errors:
```bash
# Check what's using ports
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep -E "(25431|36379)"

# Update ports in docker-compose.dev.yml if needed
# Current safe ports: 25431 (postgres), 36379 (redis)
```

### Monitor Not Starting
```bash
# Check container status
docker ps -a --filter "name=ragnos-vault-monitor"

# View container logs
docker logs ragnos-vault-monitor

# Restart if needed
docker compose -f docker-compose.dev.yml --profile monitoring up vault-monitor --force-recreate
```

### Dashboard Build Issues
The dashboard currently has workspace dependency issues. Use manual startup:
```bash
cd services/control-plane
npm install
npm run dev
# Visit: http://localhost:3000/docs
```

## File Structure

```
ragnos-vault/
├── docker-compose.dev.yml          # Main compose file with monitoring profile
├── services/
│   └── control-plane/
│       └── Dockerfile.dev           # Dashboard Dockerfile (needs workspace fix)
├── env-interceptor/
│   ├── simple-api-test.js          # Monitor script (working)
│   └── production-demo.js          # Advanced monitor (needs process.spawn fix)
└── DEVELOPMENT_DOCKER_MONITORING_PROFILE_GUIDE_2025-08-12.md  # This file
```

## Next Steps

### Immediate
1. ✅ Vault monitor working with API key tests
2. ⚠️ Fix dashboard workspace dependencies  
3. 📝 Add health check endpoints

### Future Enhancements
1. **Advanced Monitoring**: Switch to `production-demo.js` with live vault hit tracking
2. **Dashboard Integration**: Resolve workspace dependencies for control plane
3. **Metrics Export**: Add Prometheus metrics export
4. **Alert Integration**: Connect to notification systems

---

**🎯 Status**: Development monitoring profile operational with real-time API key access testing. Dashboard needs workspace dependency resolution for full functionality.

**Commands Summary**:
```bash
# Basic usage
docker compose -f docker-compose.dev.yml --profile monitoring up -d

# Monitor logs  
docker logs -f ragnos-vault-monitor

# Stop
docker compose -f docker-compose.dev.yml --profile monitoring down
```