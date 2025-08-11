/**
 * Authentication middleware for RAGnos Vault Control Plane
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

/**
 * Authenticated request context
 */
export interface AuthContext {
  actorId: string;
  actorType: 'user' | 'api_key' | 'system';
  organizationId: string;
  projectId?: string;
  scopes: string[];
}

/**
 * JWT payload structure
 */
interface JWTPayload {
  sub: string; // subject (user/service ID)
  iss: string; // issuer
  aud: string; // audience
  exp: number; // expiration
  iat: number; // issued at
  organizationId: string;
  projectId?: string;
  scopes: string[];
  type: 'user' | 'service';
}

/**
 * Authentication middleware
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const authHeader = request.headers.authorization;
  
  if (!authHeader) {
    reply.status(401).send({
      type: 'about:blank',
      title: 'Authentication Required',
      status: 401,
      detail: 'Missing Authorization header'
    });
    return;
  }

  try {
    let authContext: AuthContext;

    if (authHeader.startsWith('Bearer ')) {
      // JWT token authentication
      authContext = await validateJWTToken(authHeader.substring(7), request);
    } else if (authHeader.startsWith('ApiKey ')) {
      // API key authentication  
      authContext = await validateApiKey(authHeader.substring(7), request);
    } else {
      throw new Error('Invalid authorization scheme');
    }

    // Add auth context to request
    (request as any).auth = authContext;
    
    // Log authentication
    request.log.info('Authenticated request', {
      actorId: authContext.actorId,
      actorType: authContext.actorType,
      organizationId: authContext.organizationId,
      projectId: authContext.projectId,
      scopes: authContext.scopes.length
    });

  } catch (error) {
    request.log.warn('Authentication failed', { error: String(error) });
    
    reply.status(401).send({
      type: 'about:blank',
      title: 'Authentication Failed',
      status: 401,
      detail: 'Invalid or expired credentials'
    });
  }
}

/**
 * Validate JWT token
 */
async function validateJWTToken(
  token: string, 
  request: FastifyRequest
): Promise<AuthContext> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET not configured');
  }

  try {
    const payload = jwt.verify(token, jwtSecret) as JWTPayload;
    
    // Validate required fields
    if (!payload.sub || !payload.organizationId || !payload.scopes) {
      throw new Error('Invalid JWT payload');
    }

    return {
      actorId: payload.sub,
      actorType: payload.type === 'service' ? 'api_key' : 'user',
      organizationId: payload.organizationId,
      projectId: payload.projectId,
      scopes: payload.scopes
    };
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error(`JWT validation failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validate API key
 */
async function validateApiKey(
  apiKey: string,
  request: FastifyRequest
): Promise<AuthContext> {
  const prisma = (request.server as any).prisma;
  
  if (!apiKey || apiKey.length < 16) {
    throw new Error('Invalid API key format');
  }

  // Extract prefix (first 8 characters)
  const keyPrefix = apiKey.substring(0, 8);
  
  try {
    // Find API key by prefix
    const apiKeyRecord = await prisma.apiKey.findFirst({
      where: {
        keyPrefix,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      include: {
        organization: true
      }
    });

    if (!apiKeyRecord) {
      throw new Error('API key not found');
    }

    // Verify the full key hash
    const isValid = await bcrypt.compare(apiKey, apiKeyRecord.keyHash);
    if (!isValid) {
      throw new Error('Invalid API key');
    }

    // Update last used timestamp
    await prisma.apiKey.update({
      where: { id: apiKeyRecord.id },
      data: { lastUsedAt: new Date() }
    });

    return {
      actorId: apiKeyRecord.id,
      actorType: 'api_key',
      organizationId: apiKeyRecord.organizationId,
      projectId: apiKeyRecord.projectId || undefined,
      scopes: apiKeyRecord.scopes
    };

  } catch (error) {
    if (error.message.includes('API key')) {
      throw error;
    }
    throw new Error('API key validation failed');
  }
}

/**
 * Authorization middleware - check if user has required scope
 */
export function requireScope(requiredScope: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authContext = (request as any).auth as AuthContext;
    
    if (!authContext) {
      reply.status(401).send({
        type: 'about:blank',
        title: 'Authentication Required',
        status: 401,
        detail: 'Request not authenticated'
      });
      return;
    }

    if (!authContext.scopes.includes(requiredScope) && !authContext.scopes.includes('*')) {
      reply.status(403).send({
        type: 'about:blank',
        title: 'Insufficient Permissions',
        status: 403,
        detail: `Required scope: ${requiredScope}`
      });
      return;
    }
  };
}

/**
 * Generate API key
 */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  // Generate a random API key: rgn_[random_string]
  const randomBytes = require('crypto').randomBytes(32);
  const key = `rgn_${randomBytes.toString('hex')}`;
  const prefix = key.substring(0, 8);
  
  // Hash the key for storage
  const hash = bcrypt.hashSync(key, 10);
  
  return { key, hash, prefix };
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}