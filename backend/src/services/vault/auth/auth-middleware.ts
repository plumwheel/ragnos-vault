/**
 * RAGnos Vault - Authentication Middleware
 * JWT-based authentication with workspace isolation
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import rateLimit from 'express-rate-limit';
import { 
  VaultApiToken, 
  VaultRole, 
  VaultPermission, 
  ROLE_PERMISSIONS,
  InvalidTokenError,
  WorkspaceAccessError,
  VaultError 
} from '../vault-types';

// Extend Express Request to include vault context
declare global {
  namespace Express {
    interface Request {
      vault?: VaultAuthContext;
    }
  }
}

export interface VaultAuthContext {
  workspaceId: string;
  tokenId: string;
  userId: string;
  role: VaultRole;
  permissions: VaultPermission[];
  requestId: string;
}

export interface TokenService {
  validateToken(hashedToken: string): Promise<VaultApiToken | null>;
  updateLastUsed(tokenId: string, ipAddress?: string): Promise<void>;
}

export interface AuthConfig {
  jwtSecret: string;
  rateLimiting: {
    windowMs: number;
    maxRequests: number;
    skipSuccessfulRequests: boolean;
  };
  tokenValidation: {
    enableIpBinding: boolean;
    maxTokenAge: number; // in seconds
  };
}

export class VaultAuthMiddleware {
  private readonly tokenService: TokenService;
  private readonly config: AuthConfig;
  private readonly rateLimiter: any;

  constructor(tokenService: TokenService, config: AuthConfig) {
    this.tokenService = tokenService;
    this.config = config;
    
    // Configure rate limiting per IP
    this.rateLimiter = rateLimit({
      windowMs: config.rateLimiting.windowMs,
      max: config.rateLimiting.maxRequests,
      message: { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: config.rateLimiting.skipSuccessfulRequests,
      keyGenerator: (req: Request) => {
        // Rate limit per IP + token combination for better granularity
        const token = this.extractToken(req);
        const ip = this.getClientIP(req);
        return `${ip}:${token ? token.substring(0, 10) : 'anonymous'}`;
      }
    });
  }

  // Main authentication middleware
  authenticate() {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Apply rate limiting
        await new Promise<void>((resolve, reject) => {
          this.rateLimiter(req, res, (err: any) => {
            if (err) reject(err);
            else resolve();
          });
        });

        // Extract and validate token
        const token = this.extractToken(req);
        if (!token) {
          throw new InvalidTokenError('Authentication token required');
        }

        // Hash token for database lookup (constant time)
        const hashedToken = await this.hashToken(token);
        
        // Validate token against database
        const apiToken = await this.tokenService.validateToken(hashedToken);
        if (!apiToken) {
          throw new InvalidTokenError('Invalid or expired token');
        }

        // Check token expiration
        if (apiToken.expiresAt && new Date() > apiToken.expiresAt) {
          throw new InvalidTokenError('Token has expired');
        }

        // Additional security checks
        const clientIP = this.getClientIP(req);
        await this.performSecurityChecks(apiToken, clientIP);

        // Create vault context
        const requestId = this.generateRequestId();
        req.vault = {
          workspaceId: apiToken.workspaceId,
          tokenId: apiToken.id,
          userId: apiToken.createdBy || 'system',
          role: apiToken.role,
          permissions: this.getTokenPermissions(apiToken),
          requestId
        };

        // Set workspace context for RLS policies
        await this.setWorkspaceContext(req.vault.workspaceId);

        // Update token last used (async, don't block)
        setImmediate(async () => {
          try {
            await this.tokenService.updateLastUsed(apiToken.id, clientIP);
          } catch (error) {
            console.error('Failed to update token last_used:', error);
          }
        });

        next();
      } catch (error) {
        this.handleAuthError(error, res);
      }
    };
  }

  // Workspace authorization middleware
  authorizeWorkspace() {
    return (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.vault) {
          throw new InvalidTokenError('Authentication required');
        }

        // Extract workspace ID from route params
        const routeWorkspaceId = req.params.workspaceId;
        if (!routeWorkspaceId) {
          throw new WorkspaceAccessError('Workspace ID required in route');
        }

        // Verify token has access to requested workspace
        if (req.vault.workspaceId !== routeWorkspaceId) {
          throw new WorkspaceAccessError('Access denied to workspace');
        }

        next();
      } catch (error) {
        this.handleAuthError(error, res);
      }
    };
  }

  // Permission-based authorization middleware
  requirePermission(permission: VaultPermission) {
    return (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.vault) {
          throw new InvalidTokenError('Authentication required');
        }

        if (!req.vault.permissions.includes(permission)) {
          throw new WorkspaceAccessError(`Permission required: ${permission}`);
        }

        next();
      } catch (error) {
        this.handleAuthError(error, res);
      }
    };
  }

  // Role-based authorization middleware
  requireRole(role: VaultRole) {
    return (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.vault) {
          throw new InvalidTokenError('Authentication required');
        }

        // Admin role has access to everything
        if (req.vault.role === VaultRole.ADMIN) {
          return next();
        }

        // Check exact role match
        if (req.vault.role !== role) {
          throw new WorkspaceAccessError(`Role required: ${role}`);
        }

        next();
      } catch (error) {
        this.handleAuthError(error, res);
      }
    };
  }

  // Utility methods
  private extractToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    // Alternative: API key header
    const apiKeyHeader = req.headers['x-vault-token'];
    if (apiKeyHeader && typeof apiKeyHeader === 'string') {
      return apiKeyHeader;
    }

    return null;
  }

  private async hashToken(token: string): Promise<string> {
    try {
      // Use Argon2 for token hashing (same as stored in database)
      return await argon2.hash(token, {
        type: argon2.argon2id,
        memoryCost: 2 ** 16, // 64 MB
        timeCost: 3,
        parallelism: 1,
      });
    } catch (error) {
      throw new InvalidTokenError('Token validation failed');
    }
  }

  private getTokenPermissions(token: VaultApiToken): VaultPermission[] {
    // If token has specific scopes, use those
    if (token.scopes && token.scopes.length > 0) {
      return token.scopes;
    }

    // Otherwise, use role-based permissions
    return ROLE_PERMISSIONS[token.role] || [];
  }

  private getClientIP(req: Request): string {
    // Handle various proxy headers
    const xForwardedFor = req.headers['x-forwarded-for'];
    if (xForwardedFor) {
      const ips = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor;
      return ips.split(',')[0].trim();
    }

    const xRealIP = req.headers['x-real-ip'];
    if (xRealIP && typeof xRealIP === 'string') {
      return xRealIP;
    }

    return req.ip || req.connection.remoteAddress || 'unknown';
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async performSecurityChecks(token: VaultApiToken, clientIP: string): Promise<void> {
    // Check if token is still active
    if (!token.isActive) {
      throw new InvalidTokenError('Token has been revoked');
    }

    // IP binding check (if enabled)
    if (this.config.tokenValidation.enableIpBinding && token.lastUsedIp) {
      if (token.lastUsedIp !== clientIP) {
        // Log suspicious activity but don't block (IP can change legitimately)
        console.warn(`Token ${token.id} used from different IP: ${clientIP} vs ${token.lastUsedIp}`);
      }
    }

    // Token age check
    const tokenAgeSeconds = (Date.now() - new Date(token.createdAt).getTime()) / 1000;
    if (tokenAgeSeconds > this.config.tokenValidation.maxTokenAge) {
      throw new InvalidTokenError('Token too old, please create a new one');
    }
  }

  private async setWorkspaceContext(workspaceId: string): Promise<void> {
    // Set PostgreSQL session variable for RLS policies
    // This would be implemented with your database connection
    // Example: await db.query('SET vault.current_workspace_id = $1', [workspaceId]);
  }

  private handleAuthError(error: any, res: Response): void {
    if (error instanceof VaultError) {
      res.status(error.statusCode).json({
        error: error.message,
        code: error.code
      });
    } else {
      console.error('Authentication error:', error);
      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  }
}

// Token generation utilities
export class VaultTokenGenerator {
  private static readonly TOKEN_LENGTH = 32;
  private static readonly TOKEN_PREFIX = 'vt_';

  static generateToken(): string {
    const randomBytes = require('crypto').randomBytes(this.TOKEN_LENGTH);
    const tokenValue = randomBytes.toString('base64url');
    return `${this.TOKEN_PREFIX}${tokenValue}`;
  }

  static async hashTokenForStorage(token: string): Promise<string> {
    return await argon2.hash(token, {
      type: argon2.argon2id,
      memoryCost: 2 ** 16, // 64 MB
      timeCost: 3,
      parallelism: 1,
    });
  }

  static async verifyToken(token: string, hashedToken: string): Promise<boolean> {
    try {
      return await argon2.verify(hashedToken, token);
    } catch (error) {
      return false;
    }
  }
}

// Request logging middleware for audit trails
export function requestLoggingMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Add request start time
    req.startTime = Date.now();
    
    // Log request details (without sensitive data)
    const logData = {
      requestId: req.vault?.requestId,
      method: req.method,
      path: req.path,
      workspaceId: req.vault?.workspaceId,
      userId: req.vault?.userId,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    };

    console.info('Request started', logData);

    // Log response on finish
    res.on('finish', () => {
      const duration = Date.now() - (req.startTime || Date.now());
      console.info('Request completed', {
        ...logData,
        statusCode: res.statusCode,
        duration
      });
    });

    next();
  };
}

declare global {
  namespace Express {
    interface Request {
      startTime?: number;
    }
  }
}