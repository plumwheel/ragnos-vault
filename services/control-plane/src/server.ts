/**
 * RAGnos Vault Control Plane Server
 * Fastify-based API server with OpenAPI validation
 */

import fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';

// Database
import { PrismaClient } from '@prisma/client';

// Provider management
import { SimpleSecretProvider } from '@ragnos-vault/sdk';
import { createInfisicalProvider } from '@ragnos-vault/provider-infisical';

/**
 * Server configuration
 */
export interface ServerConfig {
  host?: string;
  port?: number;
  logLevel?: string;
  cors?: {
    origin?: string | string[];
    credentials?: boolean;
  };
  rateLimit?: {
    max?: number;
    timeWindow?: string;
  };
  database?: {
    url: string;
  };
  redis?: {
    url: string;
  };
  auth?: {
    jwtSecret: string;
    apiKeyHash: string;
  };
}

/**
 * Error response schema
 */
const ErrorResponseSchema = z.object({
  type: z.string().default('about:blank'),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.any()).optional()
  })).optional()
});

/**
 * Health check response schema
 */
const HealthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  timestamp: z.string(),
  details: z.record(z.any()).optional()
});

/**
 * Create and configure Fastify server
 */
export async function createServer(config: ServerConfig): Promise<FastifyInstance> {
  const app = fastify({
    logger: {
      level: config.logLevel || 'info',
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url,
            headers: {
              ...request.headers,
              authorization: request.headers.authorization ? '[REDACTED]' : undefined
            }
          };
        }
      }
    }
  });

  // Database connection
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: config.database?.url || process.env.DATABASE_URL
      }
    }
  });

  // Add database to request context
  app.decorate('prisma', prisma);

  // CORS
  await app.register(cors, {
    origin: config.cors?.origin || true,
    credentials: config.cors?.credentials || true
  });

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: false // Disable for Swagger UI
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: config.rateLimit?.max || 100,
    timeWindow: config.rateLimit?.timeWindow || '1 minute'
  });

  // OpenAPI documentation
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'RAGnos Vault Control Plane API',
        description: 'Universal secrets management control plane with pluggable provider backends',
        version: '1.0.0',
        contact: {
          name: 'RAGnos Labs',
          email: 'labs@ragnos.io'
        },
        license: {
          name: 'MIT',
          url: 'https://opensource.org/licenses/MIT'
        }
      },
      servers: [
        {
          url: 'http://localhost:3000',
          description: 'Local development'
        }
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          }
        }
      },
      security: [{ bearerAuth: [] }]
    }
  });

  // Swagger UI
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false
    }
  });

  // Health check endpoint (no auth required)
  app.get('/health', {
    schema: {
      description: 'System health check',
      tags: ['System'],
      response: {
        200: HealthResponseSchema
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Check database connection
      await prisma.$queryRaw`SELECT 1`;
      
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        details: {
          database: 'connected',
          uptime: process.uptime(),
          memory: process.memoryUsage()
        }
      };
    } catch (error) {
      app.log.error('Health check failed', { error });
      reply.status(503);
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        details: {
          error: String(error)
        }
      };
    }
  });

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    app.log.error('Request failed', { error, url: request.url, method: request.method });
    
    const statusCode = error.statusCode || 500;
    const errorResponse = {
      type: 'about:blank',
      title: error.name || 'Internal Server Error',
      status: statusCode,
      detail: error.message,
      instance: request.url
    };

    reply.status(statusCode).send(errorResponse);
  });

  // Not found handler
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: `Route ${request.method} ${request.url} not found`,
      instance: request.url
    });
  });

  return app;
}

/**
 * Start the server
 */
export async function startServer(config: ServerConfig): Promise<FastifyInstance> {
  const app = await createServer(config);
  
  try {
    const address = await app.listen({
      host: config.host || '0.0.0.0',
      port: config.port || 3000
    });
    
    app.log.info(`RAGnos Vault Control Plane started on ${address}`);
    app.log.info(`API Documentation: ${address}/docs`);
    
    return app;
  } catch (error) {
    app.log.error('Failed to start server', { error });
    throw error;
  }
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}