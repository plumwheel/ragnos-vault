import fp from 'fastify-plugin';
import argon2 from 'argon2';
import { z } from 'zod';

// Fastify plugin for RAGnos Vault authentication
export default fp(async function(fastify) {
  // Decorate request with vault auth context
  fastify.decorateRequest('vault', null);

  // Authentication schema
  const BearerSchema = z.string().regex(/^Bearer\s+([A-Za-z0-9_\-\.]+)$/);

  // Authentication hook for vault routes
  fastify.addHook('preHandler', async (request, reply) => {
    // Only protect vault API routes
    if (!request.routerPath?.startsWith('/api/v1/vault')) {
      return;
    }

    const authHeader = request.headers['authorization'];
    if (!authHeader) {
      return reply.code(401).send({ 
        error: 'Authentication required',
        code: 'MISSING_AUTH_HEADER'
      });
    }

    const match = BearerSchema.safeParse(authHeader);
    if (!match.success) {
      return reply.code(401).send({ 
        error: 'Invalid authorization format. Expected: Bearer <token>',
        code: 'INVALID_AUTH_FORMAT'
      });
    }

    const token = authHeader.split(/\s+/)[1];
    
    try {
      // Look up token by prefix for performance (first 10 chars)
      const tokenPrefix = token.substring(0, 10);
      
      const tokenRecord = await fastify.db('vault_api_tokens')
        .where('hashed_token', 'like', `${tokenPrefix}%`)
        .where('is_active', true)
        .where(function() {
          this.whereNull('expires_at').orWhere('expires_at', '>', fastify.db.fn.now());
        })
        .first();

      if (!tokenRecord) {
        return reply.code(401).send({ 
          error: 'Invalid or expired token',
          code: 'INVALID_TOKEN'
        });
      }

      // Verify token hash (constant time)
      const isValid = await argon2.verify(tokenRecord.hashed_token, token);
      if (!isValid) {
        return reply.code(401).send({ 
          error: 'Invalid token',
          code: 'INVALID_TOKEN'
        });
      }

      // Check token expiration
      if (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date()) {
        return reply.code(401).send({ 
          error: 'Token has expired',
          code: 'TOKEN_EXPIRED'
        });
      }

      // Generate request ID for tracing
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Attach vault context to request
      request.vault = {
        tokenId: tokenRecord.id,
        workspaceId: tokenRecord.workspace_id,
        userId: tokenRecord.created_by || 'system',
        role: tokenRecord.role,
        permissions: tokenRecord.scopes || getDefaultPermissions(tokenRecord.role),
        requestId
      };

      // Update last used timestamp (async, don't block)
      setImmediate(async () => {
        try {
          await fastify.db('vault_api_tokens')
            .where('id', tokenRecord.id)
            .update({
              last_used_at: fastify.db.fn.now(),
              last_used_ip: request.ip
            });
        } catch (error) {
          fastify.log.warn('Failed to update token last_used_at:', error);
        }
      });

    } catch (error) {
      fastify.log.error('Authentication error:', error);
      return reply.code(500).send({ 
        error: 'Authentication service error',
        code: 'AUTH_SERVICE_ERROR'
      });
    }
  });

  // Workspace authorization decorator
  fastify.decorate('authorizeWorkspace', async (request, reply) => {
    if (!request.vault) {
      return reply.code(401).send({ 
        error: 'Authentication required',
        code: 'UNAUTHENTICATED'
      });
    }

    const routeWorkspaceId = request.params?.workspaceId;
    if (!routeWorkspaceId) {
      return reply.code(400).send({ 
        error: 'Workspace ID required in route',
        code: 'MISSING_WORKSPACE_ID'
      });
    }

    if (request.vault.workspaceId !== routeWorkspaceId) {
      return reply.code(403).send({ 
        error: 'Access denied to workspace',
        code: 'WORKSPACE_ACCESS_DENIED'
      });
    }
  });

  // Permission authorization decorator
  fastify.decorate('requirePermission', (permission: string) => {
    return async (request, reply) => {
      if (!request.vault) {
        return reply.code(401).send({ 
          error: 'Authentication required',
          code: 'UNAUTHENTICATED'
        });
      }

      if (!request.vault.permissions.includes(permission)) {
        return reply.code(403).send({ 
          error: `Permission required: ${permission}`,
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }
    };
  });

  // Role authorization decorator
  fastify.decorate('requireRole', (role: string) => {
    return async (request, reply) => {
      if (!request.vault) {
        return reply.code(401).send({ 
          error: 'Authentication required',
          code: 'UNAUTHENTICATED'
        });
      }

      // Admin role has access to everything
      if (request.vault.role === 'admin') {
        return;
      }

      if (request.vault.role !== role) {
        return reply.code(403).send({ 
          error: `Role required: ${role}`,
          code: 'INSUFFICIENT_ROLE'
        });
      }
    };
  });

}, { 
  name: 'vault-auth',
  dependencies: [] 
});

// Helper function to get default permissions based on role
function getDefaultPermissions(role: string): string[] {
  const rolePermissions = {
    admin: [
      'secret:create',
      'secret:read',
      'secret:update',
      'secret:delete',
      'secret:list',
      'secret:rotate',
      'audit:read',
      'workspace:admin'
    ],
    write: [
      'secret:create',
      'secret:read',
      'secret:update',
      'secret:list'
    ],
    read: [
      'secret:read',
      'secret:list'
    ]
  };

  return rolePermissions[role as keyof typeof rolePermissions] || [];
}

// Type declarations for Fastify instance
declare module 'fastify' {
  interface FastifyRequest {
    vault?: {
      tokenId: string;
      workspaceId: string;
      userId: string;
      role: string;
      permissions: string[];
      requestId: string;
    };
  }

  interface FastifyInstance {
    authorizeWorkspace: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (permission: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (role: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}