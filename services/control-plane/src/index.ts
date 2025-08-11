/**
 * RAGnos Vault Control Plane
 * Main entry point
 */

import { startServer, ServerConfig } from './server';

/**
 * Load configuration from environment variables
 */
function loadConfig(): ServerConfig {
  return {
    host: process.env.HOST || '0.0.0.0',
    port: parseInt(process.env.PORT || '3000', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',') || true,
      credentials: true
    },
    rateLimit: {
      max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
      timeWindow: process.env.RATE_LIMIT_WINDOW || '1 minute'
    },
    database: {
      url: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/ragnos_vault'
    },
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    },
    auth: {
      jwtSecret: process.env.JWT_SECRET || 'your-jwt-secret-here',
      apiKeyHash: process.env.API_KEY_HASH || ''
    }
  };
}

/**
 * Graceful shutdown handling
 */
async function setupGracefulShutdown(app: any) {
  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
  
  signals.forEach(signal => {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down gracefully`);
      
      try {
        await app.close();
        app.log.info('Server closed successfully');
        process.exit(0);
      } catch (error) {
        app.log.error('Error during shutdown', { error });
        process.exit(1);
      }
    });
  });
}

/**
 * Start the application
 */
async function main() {
  try {
    const config = loadConfig();
    const app = await startServer(config);
    
    await setupGracefulShutdown(app);
    
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Handle unhandled rejections and exceptions
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start the application
if (require.main === module) {
  main();
}