#!/usr/bin/env tsx

/**
 * RAGnos Vault CLI - Simple command-line interface for testing
 * Usage: ./scripts/vault-cli.ts <command> [options]
 */

import { Command } from 'commander';
import axios, { AxiosInstance } from 'axios';
import { config } from 'dotenv';
import chalk from 'chalk';

// Load environment variables
config();

interface VaultConfig {
  apiUrl: string;
  token: string;
  workspaceId: string;
}

class VaultClient {
  private http: AxiosInstance;
  
  constructor(private config: VaultConfig) {
    this.http = axios.create({
      baseURL: config.apiUrl,
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Request/response interceptors for debugging
    this.http.interceptors.request.use(request => {
      console.log(chalk.gray(`→ ${request.method?.toUpperCase()} ${request.url}`));
      return request;
    });
    
    this.http.interceptors.response.use(
      response => {
        console.log(chalk.green(`✓ ${response.status} ${response.statusText}`));
        return response;
      },
      error => {
        if (error.response) {
          console.log(chalk.red(`✗ ${error.response.status} ${error.response.statusText}`));
          console.log(chalk.red(JSON.stringify(error.response.data, null, 2)));
        } else {
          console.log(chalk.red(`✗ Network error: ${error.message}`));
        }
        throw error;
      }
    );
  }
  
  async createSecret(key: string, value: any, type: string = 'string', description?: string) {
    const response = await this.http.put(`/api/v1/vault/workspaces/${this.config.workspaceId}/secrets`, {
      key,
      value,
      type,
      description
    });
    
    console.log(chalk.green('Secret created successfully:'));
    console.log(JSON.stringify(response.data, null, 2));
    return response.data;
  }
  
  async getSecret(key: string, version?: number) {
    const params = version ? { version } : {};
    const response = await this.http.get(`/api/v1/vault/workspaces/${this.config.workspaceId}/secrets/${key}`, {
      params
    });
    
    console.log(chalk.green('Secret retrieved:'));
    console.log(JSON.stringify(response.data, null, 2));
    return response.data;
  }
  
  async listSecrets(prefix?: string, limit: number = 20, offset: number = 0) {
    const params: any = { limit, offset };
    if (prefix) params.prefix = prefix;
    
    const response = await this.http.get(`/api/v1/vault/workspaces/${this.config.workspaceId}/secrets`, {
      params
    });
    
    console.log(chalk.green(`Found ${response.data.total} secrets:`));
    response.data.secrets.forEach((secret: any) => {
      console.log(`  ${chalk.cyan(secret.key)} (v${secret.version}) - ${secret.type}`);
      if (secret.description) {
        console.log(`    ${chalk.gray(secret.description)}`);
      }
    });
    
    return response.data;
  }
  
  async getAuditLogs(limit: number = 10, action?: string) {
    const params: any = { limit };
    if (action) params.action = action;
    
    const response = await this.http.get(`/api/v1/vault/workspaces/${this.config.workspaceId}/audit`, {
      params
    });
    
    console.log(chalk.green(`Audit logs (${response.data.items.length}/${limit}):`));
    response.data.items.forEach((log: any) => {
      const status = log.success ? chalk.green('✓') : chalk.red('✗');
      const timestamp = new Date(log.createdAt).toLocaleString();
      console.log(`  ${status} ${log.action} ${log.resourceType}/${log.resourceId} - ${timestamp}`);
      if (!log.success && log.errorMessage) {
        console.log(`    ${chalk.red('Error:')} ${log.errorMessage}`);
      }
    });
    
    return response.data;
  }
  
  async getAuditStats(days: number = 7) {
    const response = await this.http.get(`/api/v1/vault/workspaces/${this.config.workspaceId}/audit/stats`, {
      params: { days }
    });
    
    console.log(chalk.green(`Audit statistics (last ${days} days):`));
    console.log(`  Total events: ${response.data.totalEvents}`);
    console.log(`  Error rate: ${response.data.errorRate}%`);
    console.log(`  Events by action:`);
    Object.entries(response.data.eventsByAction).forEach(([action, count]) => {
      console.log(`    ${action}: ${count}`);
    });
    
    return response.data;
  }
}

const program = new Command();

program
  .name('vault-cli')
  .description('RAGnos Vault CLI for testing and automation')
  .version('1.0.0');

// Global options
program
  .option('--url <url>', 'Vault API URL', process.env.VAULT_URL || 'http://localhost:4000')
  .option('--token <token>', 'API token', process.env.VAULT_TOKEN)
  .option('--workspace <id>', 'Workspace ID', process.env.WORKSPACE_ID);

// Create secret command
program
  .command('create <key> <value>')
  .description('Create or update a secret')
  .option('-t, --type <type>', 'Secret type (string|json|binary)', 'string')
  .option('-d, --description <desc>', 'Secret description')
  .action(async (key: string, value: string, options: any) => {
    try {
      const config = getConfig();
      const client = new VaultClient(config);
      
      let parsedValue = value;
      if (options.type === 'json') {
        try {
          parsedValue = JSON.parse(value);
        } catch (error) {
          console.error(chalk.red('Invalid JSON value provided'));
          process.exit(1);
        }
      }
      
      await client.createSecret(key, parsedValue, options.type, options.description);
    } catch (error) {
      console.error(chalk.red('Failed to create secret'));
      process.exit(1);
    }
  });

// Get secret command
program
  .command('get <key>')
  .description('Retrieve a secret')
  .option('-v, --version <version>', 'Secret version')
  .action(async (key: string, options: any) => {
    try {
      const config = getConfig();
      const client = new VaultClient(config);
      
      await client.getSecret(key, options.version ? parseInt(options.version) : undefined);
    } catch (error) {
      console.error(chalk.red('Failed to retrieve secret'));
      process.exit(1);
    }
  });

// List secrets command
program
  .command('list')
  .description('List secrets in workspace')
  .option('-p, --prefix <prefix>', 'Key prefix filter')
  .option('-l, --limit <limit>', 'Number of results', '20')
  .option('-o, --offset <offset>', 'Offset for pagination', '0')
  .action(async (options: any) => {
    try {
      const config = getConfig();
      const client = new VaultClient(config);
      
      await client.listSecrets(
        options.prefix,
        parseInt(options.limit),
        parseInt(options.offset)
      );
    } catch (error) {
      console.error(chalk.red('Failed to list secrets'));
      process.exit(1);
    }
  });

// Audit logs command
program
  .command('audit')
  .description('View audit logs')
  .option('-l, --limit <limit>', 'Number of results', '10')
  .option('-a, --action <action>', 'Filter by action (CREATE|READ|UPDATE|DELETE)')
  .action(async (options: any) => {
    try {
      const config = getConfig();
      const client = new VaultClient(config);
      
      await client.getAuditLogs(parseInt(options.limit), options.action);
    } catch (error) {
      console.error(chalk.red('Failed to retrieve audit logs'));
      process.exit(1);
    }
  });

// Audit stats command
program
  .command('stats')
  .description('View audit statistics')
  .option('-d, --days <days>', 'Number of days to analyze', '7')
  .action(async (options: any) => {
    try {
      const config = getConfig();
      const client = new VaultClient(config);
      
      await client.getAuditStats(parseInt(options.days));
    } catch (error) {
      console.error(chalk.red('Failed to retrieve audit statistics'));
      process.exit(1);
    }
  });

// Demo command - runs through a full workflow
program
  .command('demo')
  .description('Run a complete demo workflow')
  .action(async () => {
    try {
      const config = getConfig();
      const client = new VaultClient(config);
      
      console.log(chalk.blue('\n🚀 RAGnos Vault Demo\n'));
      
      // Create some test secrets
      console.log(chalk.yellow('1. Creating test secrets...'));
      await client.createSecret('database/password', 'super-secret-password', 'string', 'Main database password');
      await client.createSecret('api/keys', { stripe: 'sk_test_123', github: 'ghp_xyz' }, 'json', 'External API keys');
      await client.createSecret('app/config', 'debug=true\nport=3000', 'string', 'Application configuration');
      
      console.log(chalk.yellow('\n2. Listing all secrets...'));
      await client.listSecrets();
      
      console.log(chalk.yellow('\n3. Retrieving a secret...'));
      await client.getSecret('api/keys');
      
      console.log(chalk.yellow('\n4. Viewing recent audit logs...'));
      await client.getAuditLogs(5);
      
      console.log(chalk.yellow('\n5. Audit statistics...'));
      await client.getAuditStats(1);
      
      console.log(chalk.green('\n✅ Demo completed successfully!'));
      
    } catch (error) {
      console.error(chalk.red('Demo failed'));
      process.exit(1);
    }
  });

function getConfig(): VaultConfig {
  const opts = program.opts();
  
  if (!opts.token) {
    console.error(chalk.red('Error: API token required. Use --token or set VAULT_TOKEN environment variable'));
    process.exit(1);
  }
  
  if (!opts.workspace) {
    console.error(chalk.red('Error: Workspace ID required. Use --workspace or set WORKSPACE_ID environment variable'));
    process.exit(1);
  }
  
  return {
    apiUrl: opts.url,
    token: opts.token,
    workspaceId: opts.workspace
  };
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('Unhandled error:'), error);
  process.exit(1);
});

// Parse command line arguments
program.parse();