/**
 * RAGnos Vault HTTP Provider Adapter
 * 
 * Handles manifest-only providers using HTTP transport.
 * Provides secure, configurable API communication with retry logic.
 */

const axios = require('axios');
const https = require('https');

class HttpProviderAdapter {
  constructor(manifest, options = {}) {
    this.manifest = manifest;
    this.options = options;
    
    // Validate transport type
    if (manifest.transport !== 'http') {
      throw new Error(`Invalid transport: expected 'http', got '${manifest.transport}'`);
    }
    
    if (!manifest.http) {
      throw new Error('HTTP configuration missing in manifest');
    }
    
    this.httpConfig = manifest.http;
    this.securityConfig = manifest.security || {};
    
    // Create axios instance with security defaults
    this.client = this.createHttpClient();
  }

  createHttpClient() {
    const config = {
      baseURL: this.httpConfig.baseUrl,
      timeout: this.httpConfig.timeout || 10000,
      
      // Security: Strict HTTPS verification
      httpsAgent: new https.Agent({
        rejectUnauthorized: true,
        secureProtocol: 'TLSv1_2_method'
      }),
      
      // Default headers
      headers: {
        'User-Agent': 'RAGnos-Vault/2.0.0',
        ...this.httpConfig.headers
      },
      
      // Response validation
      validateStatus: (status) => {
        return status >= 200 && status < 500; // Accept client errors for validation
      }
    };

    // Apply rate limiting if configured
    if (this.httpConfig.rateLimits) {
      config.rateLimit = this.httpConfig.rateLimits;
    }

    const client = axios.create(config);
    
    // Add request/response interceptors
    this.setupInterceptors(client);
    
    return client;
  }

  setupInterceptors(client) {
    // Request interceptor for auth and logging
    client.interceptors.request.use(
      (config) => {
        // Add authentication if provided
        if (this.currentApiKey && this.httpConfig.auth) {
          this.addAuthentication(config, this.currentApiKey);
        }
        
        // Apply security network allowlist
        if (this.securityConfig.networkAllowlist) {
          this.validateNetworkAccess(config.url);
        }
        
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling
    client.interceptors.response.use(
      (response) => response,
      (error) => {
        // Enhanced error information
        if (error.response) {
          error.providerError = {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data,
            headers: error.response.headers
          };
        }
        return Promise.reject(error);
      }
    );
  }

  addAuthentication(config, apiKey) {
    const auth = this.httpConfig.auth;
    
    switch (auth.type) {
      case 'bearer':
        config.headers[auth.headerName || 'Authorization'] = 
          `${auth.prefix || 'Bearer '}${apiKey}`;
        break;
        
      case 'api_key':
        if (auth.location === 'header') {
          config.headers[auth.headerName || 'X-API-Key'] = 
            `${auth.prefix || ''}${apiKey}`;
        } else if (auth.location === 'query') {
          config.params = config.params || {};
          config.params[auth.paramName || 'api_key'] = apiKey;
        }
        break;
        
      case 'basic':
        const credentials = Buffer.from(`${auth.username || 'api'}:${apiKey}`).toString('base64');
        config.headers['Authorization'] = `Basic ${credentials}`;
        break;
        
      case 'custom':
        // For custom auth, apply the configuration as-is
        if (auth.headerName) {
          config.headers[auth.headerName] = `${auth.prefix || ''}${apiKey}`;
        }
        break;
        
      default:
        throw new Error(`Unsupported auth type: ${auth.type}`);
    }
  }

  validateNetworkAccess(url) {
    const allowlist = this.securityConfig.networkAllowlist;
    if (!allowlist || allowlist.length === 0) {
      return; // No restrictions
    }
    
    try {
      const parsedUrl = new URL(url, this.httpConfig.baseUrl);
      const hostname = parsedUrl.hostname;
      
      const isAllowed = allowlist.some(pattern => {
        // Support wildcard patterns
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          return regex.test(hostname);
        }
        return hostname === pattern;
      });
      
      if (!isAllowed) {
        throw new Error(`Network access denied: ${hostname} not in allowlist`);
      }
    } catch (error) {
      throw new Error(`Network validation failed: ${error.message}`);
    }
  }

  /**
   * Validate an API key by performing the configured validation operation
   */
  async validate(apiKey, options = {}) {
    if (!apiKey) {
      throw new Error('API key is required for validation');
    }
    
    this.currentApiKey = apiKey;
    
    try {
      const operation = this.httpConfig.operations?.validate;
      if (!operation) {
        throw new Error('No validation operation configured in manifest');
      }
      
      const requestConfig = {
        method: operation.method || 'GET',
        url: operation.path || '/',
        timeout: operation.timeout || this.httpConfig.timeout || 10000
      };
      
      // Add any operation-specific headers
      if (operation.headers) {
        requestConfig.headers = { ...requestConfig.headers, ...operation.headers };
      }
      
      const response = await this.executeWithRetry(requestConfig);
      
      // Check if response status indicates success
      const expectedStatuses = operation.expectedStatus || [200, 201];
      const isValid = expectedStatuses.includes(response.status);
      
      return {
        valid: isValid,
        provider: this.manifest.id,
        status: response.status,
        statusText: response.statusText,
        responseTime: response.config.metadata?.responseTime,
        data: this.sanitizeResponseData(response.data)
      };
      
    } catch (error) {
      return {
        valid: false,
        provider: this.manifest.id,
        error: error.message,
        errorType: this.classifyError(error),
        status: error.providerError?.status,
        responseTime: error.config?.metadata?.responseTime
      };
    } finally {
      // Clear API key from memory
      this.currentApiKey = null;
    }
  }

  async executeWithRetry(requestConfig) {
    const retryPolicy = this.httpConfig.retryPolicy || { attempts: 3, backoff: 'exponential', delay: 1000 };
    let lastError;
    
    for (let attempt = 1; attempt <= retryPolicy.attempts; attempt++) {
      try {
        // Add timing metadata
        const startTime = Date.now();
        
        const response = await this.client.request(requestConfig);
        
        response.config.metadata = {
          responseTime: Date.now() - startTime,
          attempt
        };
        
        return response;
        
      } catch (error) {
        lastError = error;
        
        // Don't retry on client errors (4xx) unless specifically configured
        if (error.response?.status >= 400 && error.response?.status < 500) {
          if (!retryPolicy.retryOn4xx) {
            throw error;
          }
        }
        
        // Don't retry on last attempt
        if (attempt === retryPolicy.attempts) {
          throw error;
        }
        
        // Calculate backoff delay
        const delay = this.calculateBackoffDelay(attempt, retryPolicy);
        await this.sleep(delay);
      }
    }
    
    throw lastError;
  }

  calculateBackoffDelay(attempt, retryPolicy) {
    const baseDelay = retryPolicy.delay || 1000;
    
    switch (retryPolicy.backoff) {
      case 'linear':
        return baseDelay * attempt;
      case 'exponential':
        return baseDelay * Math.pow(2, attempt - 1);
      case 'constant':
      default:
        return baseDelay;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  classifyError(error) {
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return 'network_error';
    }
    
    if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      return 'timeout_error';
    }
    
    if (error.response) {
      const status = error.response.status;
      if (status === 401 || status === 403) {
        return 'auth_error';
      } else if (status === 429) {
        return 'rate_limit_error';
      } else if (status >= 400 && status < 500) {
        return 'client_error';
      } else if (status >= 500) {
        return 'server_error';
      }
    }
    
    return 'unknown_error';
  }

  sanitizeResponseData(data) {
    // Remove potentially sensitive data from response
    if (typeof data !== 'object' || data === null) {
      return data;
    }
    
    const sensitiveKeys = ['api_key', 'token', 'secret', 'password', 'credential'];
    const sanitized = { ...data };
    
    Object.keys(sanitized).forEach(key => {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }

  /**
   * Test connectivity to the provider without authentication
   */
  async testConnection(options = {}) {
    try {
      const response = await this.client.get('/', {
        timeout: options.timeout || 5000,
        validateStatus: () => true // Accept any status for connectivity test
      });
      
      return {
        connected: true,
        status: response.status,
        responseTime: response.config.metadata?.responseTime || 0
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message,
        errorType: this.classifyError(error)
      };
    }
  }

  /**
   * Get provider information and capabilities
   */
  getProviderInfo() {
    return {
      id: this.manifest.id,
      displayName: this.manifest.displayName,
      vendor: this.manifest.vendor,
      transport: this.manifest.transport,
      capabilities: this.manifest.capabilities || [],
      baseUrl: this.httpConfig.baseUrl,
      authType: this.httpConfig.auth?.type,
      rateLimits: this.httpConfig.rateLimits,
      security: {
        networkAllowlist: this.securityConfig.networkAllowlist,
        requiresHTTPS: this.httpConfig.baseUrl?.startsWith('https://'),
        sandbox: this.securityConfig.sandbox
      }
    };
  }

  /**
   * Cleanup resources
   */
  destroy() {
    // Clear any cached API keys
    this.currentApiKey = null;
    
    // Cancel any pending requests
    if (this.client.defaults.cancelToken) {
      this.client.defaults.cancelToken.cancel('HttpProviderAdapter destroyed');
    }
  }
}

module.exports = { HttpProviderAdapter };