import { z } from "zod";
import { FastifyPluginAsync } from "fastify";

// Core Vault API routes for secrets management
export const registerVaultRoutes: FastifyPluginAsync = async (server) => {
  // PUT /api/v1/vault/workspaces/:workspaceId/secrets
  await server.register(async (vaultApi) => {
    vaultApi.route({
      method: "PUT",
      url: "/workspaces/:workspaceId/secrets",
      schema: {
        params: z.object({
          workspaceId: z.string().uuid()
        }),
        body: z.object({
          key: z.string().min(1).max(255).regex(/^[a-zA-Z0-9/_.-]+$/),
          value: z.any(),
          type: z.enum(["string", "json", "binary"]).default("string"),
          description: z.string().optional(),
          tags: z.array(z.string()).optional()
        }),
        response: {
          200: z.object({
            id: z.string().uuid(),
            key: z.string(),
            type: z.string(),
            version: z.number(),
            createdAt: z.string()
          })
        }
      },
      preHandler: [
        server.authenticate, // JWT authentication
        server.authorizeWorkspace, // Workspace access check
        server.requirePermission("secret:create")
      ],
      handler: async (req, res) => {
        const { workspaceId } = req.params;
        const { key, value, type = "string", description, tags } = req.body;
        
        try {
          // Encrypt the secret value
          const encryptedData = await server.vaultEncryption.encrypt(workspaceId, JSON.stringify(value));
          
          // Store in database using helper function
          const result = await server.db.raw(`
            SELECT secret_id, version FROM vault_upsert_secret(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            workspaceId,
            key,
            encryptedData.ciphertext,
            encryptedData.iv,
            encryptedData.authTag,
            encryptedData.keyVersion,
            type,
            description || null,
            tags || [],
            req.vault?.userId || 'system'
          ]);
          
          const { secret_id: secretId, version } = result.rows[0];
          
          // Log audit event (async)
          setImmediate(() => {
            server.vaultAudit.logAction({
              workspaceId,
              action: 'CREATE',
              resourceType: 'secret',
              resourceId: key,
              userId: req.vault?.userId || 'system',
              tokenId: req.vault?.tokenId,
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'],
              requestId: req.vault?.requestId || 'unknown',
              success: true
            });
          });
          
          return res.send({
            id: secretId,
            key,
            type,
            version,
            createdAt: new Date().toISOString()
          });
        } catch (error) {
          server.log.error('Failed to create secret:', error);
          
          // Log failed audit event
          setImmediate(() => {
            server.vaultAudit.logAction({
              workspaceId,
              action: 'CREATE',
              resourceType: 'secret',
              resourceId: key,
              userId: req.vault?.userId || 'system',
              tokenId: req.vault?.tokenId,
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'],
              requestId: req.vault?.requestId || 'unknown',
              success: false,
              errorMessage: error.message
            });
          });
          
          throw server.httpErrors.internalServerError('Failed to create secret');
        }
      }
    });

    // GET /api/v1/vault/workspaces/:workspaceId/secrets/:key
    vaultApi.route({
      method: "GET",
      url: "/workspaces/:workspaceId/secrets/:key",
      schema: {
        params: z.object({
          workspaceId: z.string().uuid(),
          key: z.string().min(1).max(255)
        }),
        querystring: z.object({
          version: z.coerce.number().optional()
        }),
        response: {
          200: z.object({
            id: z.string().uuid(),
            key: z.string(),
            value: z.any(),
            type: z.string(),
            version: z.number(),
            description: z.string().nullable(),
            tags: z.array(z.string()),
            createdAt: z.string(),
            updatedAt: z.string()
          })
        }
      },
      preHandler: [
        server.authenticate,
        server.authorizeWorkspace,
        server.requirePermission("secret:read")
      ],
      handler: async (req, res) => {
        const { workspaceId, key } = req.params;
        const { version } = req.query;
        
        try {
          // Get secret from database
          const result = await server.db.raw(`
            SELECT * FROM vault_get_secret_value(?, ?)
          `, [workspaceId, key]);
          
          if (!result.rows.length) {
            throw server.httpErrors.notFound('Secret not found');
          }
          
          const secretData = result.rows[0];
          
          // Decrypt the value
          const decryptedData = await server.vaultEncryption.decrypt(workspaceId, {
            ciphertext: secretData.encrypted_value,
            iv: secretData.encryption_iv,
            authTag: secretData.auth_tag,
            keyVersion: secretData.key_version
          });
          
          let parsedValue;
          try {
            parsedValue = JSON.parse(decryptedData.plaintext);
          } catch {
            parsedValue = decryptedData.plaintext;
          }
          
          // Log audit event (async)
          setImmediate(() => {
            server.vaultAudit.logAction({
              workspaceId,
              action: 'READ',
              resourceType: 'secret',
              resourceId: key,
              userId: req.vault?.userId || 'system',
              tokenId: req.vault?.tokenId,
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'],
              requestId: req.vault?.requestId || 'unknown',
              success: true,
              metadata: { version: secretData.version }
            });
          });
          
          return res.send({
            id: secretData.secret_id,
            key,
            value: parsedValue,
            type: secretData.type,
            version: secretData.version,
            description: secretData.description,
            tags: secretData.tags || [],
            createdAt: secretData.created_at,
            updatedAt: secretData.updated_at
          });
        } catch (error) {
          if (error.statusCode === 404) {
            throw error;
          }
          
          server.log.error('Failed to retrieve secret:', error);
          
          // Log failed audit event
          setImmediate(() => {
            server.vaultAudit.logAction({
              workspaceId,
              action: 'READ',
              resourceType: 'secret',
              resourceId: key,
              userId: req.vault?.userId || 'system',
              tokenId: req.vault?.tokenId,
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'],
              requestId: req.vault?.requestId || 'unknown',
              success: false,
              errorMessage: error.message
            });
          });
          
          throw server.httpErrors.internalServerError('Failed to retrieve secret');
        }
      }
    });

    // GET /api/v1/vault/workspaces/:workspaceId/secrets
    vaultApi.route({
      method: "GET",
      url: "/workspaces/:workspaceId/secrets",
      schema: {
        params: z.object({
          workspaceId: z.string().uuid()
        }),
        querystring: z.object({
          prefix: z.string().optional(),
          limit: z.coerce.number().min(1).max(100).default(20),
          offset: z.coerce.number().min(0).default(0)
        }),
        response: {
          200: z.object({
            secrets: z.array(z.object({
              id: z.string().uuid(),
              key: z.string(),
              type: z.string(),
              version: z.number(),
              description: z.string().nullable(),
              tags: z.array(z.string()),
              updatedAt: z.string()
            })),
            total: z.number(),
            limit: z.number(),
            offset: z.number()
          })
        }
      },
      preHandler: [
        server.authenticate,
        server.authorizeWorkspace,
        server.requirePermission("secret:list")
      ],
      handler: async (req, res) => {
        const { workspaceId } = req.params;
        const { prefix, limit, offset } = req.query;
        
        try {
          let query = server.db('vault_secrets')
            .where('workspace_id', workspaceId)
            .orderBy('updated_at', 'desc');
          
          if (prefix) {
            query = query.where('key', 'like', `${prefix}%`);
          }
          
          // Get total count
          const countResult = await query.clone().count('* as count').first();
          const total = parseInt(countResult.count as string);
          
          // Get paginated results
          const secrets = await query
            .select('id', 'key', 'type', 'current_version as version', 'description', 'tags', 'updated_at')
            .limit(limit)
            .offset(offset);
          
          // Log audit event (async)
          setImmediate(() => {
            server.vaultAudit.logAction({
              workspaceId,
              action: 'READ',
              resourceType: 'secret',
              resourceId: 'list',
              userId: req.vault?.userId || 'system',
              tokenId: req.vault?.tokenId,
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'],
              requestId: req.vault?.requestId || 'unknown',
              success: true,
              metadata: { prefix, limit, offset, total }
            });
          });
          
          return res.send({
            secrets: secrets.map(secret => ({
              id: secret.id,
              key: secret.key,
              type: secret.type,
              version: secret.version,
              description: secret.description,
              tags: secret.tags || [],
              updatedAt: secret.updated_at
            })),
            total,
            limit,
            offset
          });
        } catch (error) {
          server.log.error('Failed to list secrets:', error);
          
          // Log failed audit event
          setImmediate(() => {
            server.vaultAudit.logAction({
              workspaceId,
              action: 'READ',
              resourceType: 'secret',
              resourceId: 'list',
              userId: req.vault?.userId || 'system',
              tokenId: req.vault?.tokenId,
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'],
              requestId: req.vault?.requestId || 'unknown',
              success: false,
              errorMessage: error.message
            });
          });
          
          throw server.httpErrors.internalServerError('Failed to list secrets');
        }
      }
    });
  }, { prefix: "/vault" });
};

// Add type extensions for Fastify instance
declare module "fastify" {
  interface FastifyInstance {
    vaultEncryption: {
      encrypt: (workspaceId: string, plaintext: string) => Promise<{
        ciphertext: string;
        iv: string;
        authTag: string;
        keyVersion: number;
      }>;
      decrypt: (workspaceId: string, encryptedData: {
        ciphertext: string;
        iv: string;
        authTag: string;
        keyVersion: number;
      }) => Promise<{
        plaintext: string;
        keyVersion: number;
      }>;
    };
    vaultAudit: {
      logAction: (action: {
        workspaceId: string;
        action: string;
        resourceType: string;
        resourceId: string;
        userId: string;
        tokenId?: string;
        ipAddress?: string;
        userAgent?: string;
        requestId: string;
        success: boolean;
        errorMessage?: string;
        metadata?: any;
      }) => void;
    };
    authenticate: any;
    authorizeWorkspace: any;
    requirePermission: (permission: string) => any;
  }
}

export default registerVaultRoutes;