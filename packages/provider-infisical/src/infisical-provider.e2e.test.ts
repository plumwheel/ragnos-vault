/**
 * E2E Tests for Infisical Provider
 * Run against real Infisical CE instance
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { InfisicalProvider, InfisicalConfig } from './infisical-provider';
import { ProviderContext } from '@ragnos-vault/sdk';

// Skip E2E tests unless explicitly enabled
const isE2EEnabled = process.env.INFISICAL_E2E === 'true';
const skipE2E = isE2EEnabled ? describe : describe.skip;

skipE2E('Infisical Provider E2E Tests', () => {
  let provider: InfisicalProvider;
  let context: ProviderContext;
  let config: InfisicalConfig;

  beforeAll(() => {
    // Configuration from environment variables
    config = {
      baseUrl: process.env.INFISICAL_BASE_URL || 'http://localhost:8080',
      serviceToken: process.env.INFISICAL_SERVICE_TOKEN || 'st.test-token',
      environment: process.env.INFISICAL_ENVIRONMENT || 'dev',
      secretPath: process.env.INFISICAL_SECRET_PATH || '/',
      timeout: 30000,
      retries: 3
    };

    context = {
      tenantId: 'test-tenant',
      logger: {
        info: console.log,
        warn: console.warn,
        error: console.error,
        debug: console.debug
      },
      tracer: {
        startSpan: () => ({
          end: () => {},
          setAttributes: () => {},
          recordException: () => {},
          setStatus: () => {}
        })
      },
      metrics: {
        counter: () => {},
        histogram: () => {},
        gauge: () => {}
      },
      clock: {
        now: () => new Date()
      },
      config: {},
      requestId: 'test-request-e2e'
    };
  });

  beforeEach(async () => {
    provider = new InfisicalProvider(config);
    await provider.init(context);
  });

  afterEach(async () => {
    // Clean up test secrets
    try {
      const secrets = await provider.listSecrets(context, { prefix: 'test-' });
      for (const secret of secrets.secrets) {
        try {
          await provider.deleteSecret(context, secret.name);
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch {
      // Ignore cleanup errors
    }

    await provider.shutdown();
  });

  describe('provider lifecycle', () => {
    it('should initialize successfully', async () => {
      const health = await provider.health();
      expect(health.status).toBe('healthy');
      expect(health.details?.baseUrl).toBe(config.baseUrl);
    });

    it('should report correct capabilities', () => {
      const caps = provider.capabilities();
      expect(caps.secretStore?.get).toBe(true);
      expect(caps.secretStore?.put).toBe(true);
      expect(caps.secretStore?.delete).toBe(true);
      expect(caps.secretStore?.list).toBe(true);
      expect(caps.secretStore?.versions).toBe(false); // CE limitation
      expect(caps.secretStore?.rotate).toBe(false);   // CE limitation
    });
  });

  describe('secret operations', () => {
    const testSecretName = 'test-secret-e2e';
    const testSecretValue = 'test-value-123';

    it('should put and get a secret', async () => {
      const putResult = await provider.putSecret(
        context,
        testSecretName,
        new TextEncoder().encode(testSecretValue)
      );

      expect(putResult.name).toBe(testSecretName);
      expect(putResult.version).toBeTruthy();
      expect(putResult.createdAt).toBeInstanceOf(Date);

      const secret = await provider.getSecret(context, testSecretName);
      expect(secret.name).toBe(testSecretName);
      expect(new TextDecoder().decode(secret.value)).toBe(testSecretValue);
      expect(secret.version).toBeTruthy();
      expect(secret.createdAt).toBeInstanceOf(Date);
      expect(secret.updatedAt).toBeInstanceOf(Date);
    });

    it('should update an existing secret', async () => {
      // Create initial secret
      await provider.putSecret(
        context,
        testSecretName,
        new TextEncoder().encode(testSecretValue)
      );

      // Update with new value
      const updatedValue = 'updated-value-456';
      const updateResult = await provider.putSecret(
        context,
        testSecretName,
        new TextEncoder().encode(updatedValue),
        {
          description: 'Updated secret'
        }
      );

      expect(updateResult.name).toBe(testSecretName);

      // Verify update
      const updated = await provider.getSecret(context, testSecretName);
      expect(new TextDecoder().decode(updated.value)).toBe(updatedValue);
      expect(updated.description).toBe('Updated secret');
    });

    it('should delete a secret', async () => {
      // Create secret
      await provider.putSecret(
        context,
        testSecretName,
        new TextEncoder().encode(testSecretValue)
      );

      // Verify exists
      const exists = await provider.secretExists(context, testSecretName);
      expect(exists).toBe(true);

      // Delete
      await provider.deleteSecret(context, testSecretName);

      // Verify deleted
      const existsAfterDelete = await provider.secretExists(context, testSecretName);
      expect(existsAfterDelete).toBe(false);

      // Verify throws NotFound
      await expect(provider.getSecret(context, testSecretName))
        .rejects.toThrow('NotFound');
    });

    it('should list secrets with filtering', async () => {
      // Create multiple test secrets
      const secretNames = ['test-list-1', 'test-list-2', 'other-secret'];
      const secretValue = 'list-test-value';

      for (const name of secretNames) {
        await provider.putSecret(
          context,
          name,
          new TextEncoder().encode(secretValue)
        );
      }

      // List all secrets
      const allSecrets = await provider.listSecrets(context);
      const testSecretsList = allSecrets.secrets.filter(s => 
        secretNames.includes(s.name)
      );
      expect(testSecretsList).toHaveLength(3);

      // List with prefix filter
      const prefixFiltered = await provider.listSecrets(context, { 
        prefix: 'test-list-' 
      });
      expect(prefixFiltered.secrets).toHaveLength(2);
      expect(prefixFiltered.secrets.every(s => s.name.startsWith('test-list-'))).toBe(true);

      // Cleanup
      for (const name of secretNames) {
        await provider.deleteSecret(context, name);
      }
    });

    it('should handle labels/tags correctly', async () => {
      const labels = {
        environment: 'test',
        team: 'backend',
        version: '1.0'
      };

      await provider.putSecret(
        context,
        testSecretName,
        new TextEncoder().encode(testSecretValue),
        { labels }
      );

      const secret = await provider.getSecret(context, testSecretName);
      // Note: Label mapping depends on Infisical's tag implementation
      // This test validates the mapping works
      expect(secret.labels).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle non-existent secrets correctly', async () => {
      await expect(provider.getSecret(context, 'nonexistent-secret'))
        .rejects.toThrow('NotFound');

      await expect(provider.deleteSecret(context, 'nonexistent-secret'))
        .rejects.toThrow('NotFound');
    });

    it('should handle service token validation', async () => {
      const invalidConfig = { 
        ...config, 
        serviceToken: 'invalid-token' 
      };
      
      const invalidProvider = new InfisicalProvider(invalidConfig);
      
      await expect(invalidProvider.init(context))
        .rejects.toThrow('AuthenticationFailed');
    });
  });

  describe('advanced operations', () => {
    it('should list secret versions (single version)', async () => {
      const testSecretName = 'test-versioning';
      
      await provider.putSecret(
        context,
        testSecretName,
        new TextEncoder().encode('version-1')
      );

      const versions = await provider.listVersions(context, testSecretName);
      expect(versions.versions).toHaveLength(1);
      expect(versions.totalCount).toBe(1);
      expect(versions.versions[0].version).toBeTruthy();

      await provider.deleteSecret(context, testSecretName);
    });

    it('should handle unsupported operations gracefully', async () => {
      await expect(provider.rotateSecret(context, 'any-secret'))
        .rejects.toThrow('UnsupportedOperation');

      await expect(provider.updateSecretMetadata(
        context, 
        'any-secret', 
        { labels: { key: 'value' } }
      )).rejects.toThrow('UnsupportedOperation');
    });
  });

  describe('configuration validation', () => {
    it('should validate configuration schema', () => {
      expect(() => new InfisicalProvider({
        baseUrl: 'invalid-url',
        serviceToken: 'test-token'
      })).toThrow();

      expect(() => new InfisicalProvider({
        baseUrl: 'http://localhost:8080',
        serviceToken: '' // Empty token
      })).toThrow();

      // Valid configuration
      expect(() => new InfisicalProvider({
        baseUrl: 'http://localhost:8080',
        serviceToken: 'st.valid-token',
        environment: 'prod'
      })).not.toThrow();
    });
  });
});