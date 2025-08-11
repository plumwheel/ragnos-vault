# RAGnos Vault

**Universal secrets management platform with pluggable provider backends**

RAGnos Vault is the Kubernetes of secrets management - write your applications once against our unified SDK, then deploy to any secrets backend (Infisical CE, AWS Secrets Manager, HashiCorp Vault, etc.) without code changes.

<h4 align="center">
  <a href="https://ragnos.io/">Website</a> |
  <a href="https://docs.ragnos.io/">Documentation</a> |
  <a href="https://discord.gg/ragnos">Community</a> |
  <a href="#-quick-start">Quick Start</a> |
  <a href="#-architecture">Architecture</a>
</h4>

<h4 align="center">
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="RAGnos Vault is released under the MIT license." />
  </a>
  <a href="CONTRIBUTING.md">
    <img src="https://img.shields.io/badge/PRs-Welcome-brightgreen" alt="PRs welcome!" />
  </a>
</h4>

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/ragnos-labs/ragnos-vault.git
cd ragnos-vault

# Run the demo (shows provider abstraction in action)
npx tsx demo.ts

# Start Infisical CE for testing
docker-compose -f docker-compose.infisical.yml up -d

# Start the Control Plane API
cd services/control-plane && npm run dev
```

Visit http://localhost:3000/docs for the interactive API documentation.

## 🏗️ Architecture

RAGnos Vault consists of three main layers:

### 1. Provider SDK (Universal Interface)
- **SimpleSecretProvider**: Ergonomic facade for 80% of use cases
- **Full SDK**: Complete capability-based interface for advanced scenarios
- **Provider Registry**: Dynamic provider loading with health monitoring

### 2. Provider Ecosystem (Pluggable Backends)
- **Infisical CE**: First-class integration with Infisical Community Edition ✅
- **AWS Secrets Manager**: Enterprise cloud secrets management ⏳
- **HashiCorp Vault**: Enterprise secrets and encryption management ⏳
- **Mock Provider**: In-memory provider for testing and development ✅

### 3. Control Plane (Enterprise Orchestration)
- **Multi-tenant API**: Organization and project-scoped secrets management
- **Policy Engine**: Approval workflows and compliance enforcement ⏳
- **Audit Lake**: Comprehensive audit logging with SIEM integration ✅
- **Migration Engine**: Zero-downtime provider switching ⏳

## 🎯 Key Benefits

### Provider Abstraction
```typescript
// Same code works with any provider backend
const provider = new SimpleSecretProvider(infisicalProvider, context);
await provider.set('database-password', 'secret-value');

// Switch to AWS with zero code changes
const provider = new SimpleSecretProvider(awsProvider, context);
await provider.set('database-password', 'secret-value');
```

### Enterprise Features
- **Zero-downtime migration** between providers
- **Policy-as-code** with GitOps workflows
- **Audit compliance** with comprehensive event logging
- **Multi-provider support** for failover and disaster recovery

### Developer Experience
- **Simple facade API** for common operations
- **Full SDK access** when you need advanced features
- **Built-in caching** with TTL and invalidation
- **Type-safe configuration** and error handling

## 📦 Package Structure

```
ragnos-vault/
├── packages/
│   ├── sdk/                    # Core Provider SDK ✅
│   ├── provider-infisical/     # Infisical CE provider ✅
│   ├── provider-memory/        # Mock provider for testing ✅
│   └── provider-aws/           # AWS Secrets Manager provider ⏳
├── services/
│   └── control-plane/          # Multi-tenant API service ✅
├── examples/
│   ├── node-app/              # Node.js example application ⏳
│   └── docker-app/            # Dockerized example ⏳
└── docs/
    ├── api/                   # API documentation ⏳
    └── guides/                # Integration guides ⏳
```

## 🛠️ Development

### Prerequisites
- Node.js 18+
- PostgreSQL (for control plane)
- Redis (for caching and queues) 
- Docker (for running Infisical CE)

### Setup

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm run test

# Run E2E tests (requires running Infisical CE)
INFISICAL_E2E=true npm run test:e2e

# Start development environment
npm run dev
```

### Running Infisical CE Locally

```bash
# Start Infisical CE with PostgreSQL and Redis
docker-compose -f docker-compose.infisical.yml up -d

# Create a service token in the Infisical UI (http://localhost:8080)
# Then set the environment variable:
export INFISICAL_SERVICE_TOKEN="st.your-service-token-here"
```

## 🔧 Configuration

### Provider Configuration

```typescript
// Infisical CE
const infisicalProvider = createInfisicalProvider({
  baseUrl: 'http://localhost:8080',
  serviceToken: process.env.INFISICAL_SERVICE_TOKEN,
  environment: 'dev',
  secretPath: '/'
});

// AWS Secrets Manager (coming soon)
const awsProvider = createAWSProvider({
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});
```

### Control Plane Configuration

```typescript
// Environment variables
DATABASE_URL=postgresql://postgres:password@localhost:5432/ragnos_vault
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-jwt-secret-here
LOG_LEVEL=info
```

## 📖 Usage Examples

### Basic Secret Operations

```typescript
import { SimpleSecretProvider } from '@ragnos-vault/sdk';
import { createInfisicalProvider } from '@ragnos-vault/provider-infisical';

// Initialize provider
const provider = createInfisicalProvider({
  baseUrl: 'http://localhost:8080',
  serviceToken: process.env.INFISICAL_SERVICE_TOKEN,
  environment: 'prod'
});

const secrets = new SimpleSecretProvider(provider, context);

// Store a secret
await secrets.set('database-password', 'super-secret', {
  metadata: { team: 'backend', env: 'prod' }
});

// Retrieve a secret
const secret = await secrets.get('database-password');
console.log('Password:', secret.value);

// List secrets
const secretNames = await secrets.list('database-');
console.log('Database secrets:', secretNames);
```

### Advanced Provider Features

```typescript
// Access full SDK for advanced features
const sdkProvider = secrets.sdkHandle();
const capabilities = sdkProvider.capabilities();

if (capabilities.secretStore?.versions) {
  const versions = await sdkProvider.listVersions(context, 'database-password');
  console.log('Secret versions:', versions);
}
```

### Provider Health Monitoring

```typescript
// Check provider health
const health = await secrets.health();
if (!health.ok) {
  console.error('Provider unhealthy:', health.details);
  // Failover to backup provider
}
```

### Caching and Performance

```typescript
// Enable caching for better performance
const secrets = new SimpleSecretProvider(provider, context, {
  cache: {
    defaultTtl: 300, // 5 minutes
    maxSize: 1000,
    enableSingleflight: true // Prevent thundering herd
  }
});

// Cache policies
await secrets.get('api-key', { cachePolicy: 'cache-first' });
await secrets.get('api-key', { cachePolicy: 'cache-refresh' });
```

## 🔒 Security

### Credential Storage
- Provider credentials are encrypted at rest using envelope encryption
- KMS integration for key management (AWS, GCP, Azure)
- No secret values are ever logged or stored in audit trails

### Authentication & Authorization
- API key authentication with scoped permissions
- JWT-based service accounts with OIDC integration
- Organization and project-level access controls

### Audit & Compliance
- Comprehensive audit logging for all operations
- SIEM integration with structured event exports
- Immutable audit trail with tamper detection

## 🚀 Deployment

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ragnos-vault-control-plane
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ragnos-vault
  template:
    metadata:
      labels:
        app: ragnos-vault
    spec:
      containers:
      - name: control-plane
        image: ragnos/vault-control-plane:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: ragnos-vault-secrets
              key: database-url
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and add tests
4. Run the test suite: `npm test`
5. Submit a pull request

### Adding New Providers

See our [Provider Development Guide](docs/provider-development.md) for details on creating new provider integrations.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Infisical](https://infisical.com) for inspiration and as our reference provider
- The secrets management community for best practices and security patterns
- Our contributors and early adopters

---

**RAGnos Labs** - Advanced AI Operating System  
[Website](https://ragnos.io) • [Documentation](https://docs.ragnos.io) • [Community](https://discord.gg/ragnos)

---

*"Keep your secrets in the vault, your code in the open, and your operations smooth as silk."*