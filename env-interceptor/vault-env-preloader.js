#!/usr/bin/env node
/**
 * RAGnos Vault Environment Variable Preloader
 * 
 * Transparent process.env interception via Node.js preloader pattern
 * Zero code changes required for existing MCP servers
 * 
 * Usage: node --require ./vault-env-preloader.js your-mcp-server.js
 */

const fs = require('fs');
const path = require('path');

class VaultEnvironmentInterceptor {
  constructor() {
    this.config = this.loadConfig();
    this.stats = {
      requests: 0,
      vault_hits: 0,
      env_fallbacks: 0,
      errors: 0,
      cache_hits: 0
    };
    
    this.cache = new Map();
    this.killSwitch = false;
    
    console.log(`[VaultInterceptor] Initialized in ${this.config.mode} mode`);
    this.setupProcessEnvProxy();
  }
  
  loadConfig() {
    // Load configuration from environment or config file
    const defaultConfig = {
      mode: process.env.VAULT_MODE || 'shadow', // shadow, dual, vault
      canary_percent: parseInt(process.env.VAULT_CANARY_PERCENT) || 0,
      vault_url: process.env.VAULT_URL || 'http://localhost:8200',
      vault_token: process.env.VAULT_TOKEN || 'dev-token',
      cache_ttl: parseInt(process.env.VAULT_CACHE_TTL) || 300000, // 5 minutes
      enable_kill_switch: process.env.VAULT_KILL_SWITCH !== 'false',
      debug: process.env.VAULT_DEBUG === 'true'
    };
    
    try {
      const configPath = path.resolve(process.cwd(), '.vault-config.json');
      if (fs.existsSync(configPath)) {
        const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return { ...defaultConfig, ...fileConfig };
      }
    } catch (error) {
      console.warn('[VaultInterceptor] Config file error, using defaults:', error.message);
    }
    
    return defaultConfig;
  }
  
  setupProcessEnvProxy() {
    // Store original process.env for fallback
    const originalEnv = { ...process.env };
    const self = this;
    
    // Store original property descriptors for all current env vars
    const originalDescriptors = {};
    for (const key of Object.keys(process.env)) {
      originalDescriptors[key] = Object.getOwnPropertyDescriptor(process.env, key);
    }
    
    // Hook into property access for vault-managed keys
    const interceptedKeys = new Set();
    
    // Function to intercept a specific key
    const interceptKey = (key) => {
      if (interceptedKeys.has(key) || !self.isVaultManagedKey(key)) {
        return;
      }
      
      interceptedKeys.add(key);
      const originalValue = process.env[key];
      
      try {
        Object.defineProperty(process.env, key, {
          get: () => {
            return self.getVaultAwareValue(key, originalValue);
          },
          set: (value) => {
            // Update both our original env and the actual process.env
            originalEnv[key] = value;
          },
          enumerable: true,
          configurable: true
        });
      } catch (error) {
        // If we can't redefine the property, fall back to original value
        if (self.config.debug) {
          console.warn(`[VaultInterceptor] Could not intercept ${key}: ${error.message}`);
        }
      }
    };
    
    // Intercept all current vault-managed keys
    Object.keys(process.env).forEach(interceptKey);
    
    // Hook into new property creation using a Proxy on the process object itself
    // This is a more compatible approach for Node.js v22
    const originalProcess = process;
    if (originalProcess.env && typeof originalProcess.env === 'object') {
      // Monitor for new environment variable assignments
      const checkNewKeys = () => {
        Object.keys(process.env).forEach(key => {
          if (!interceptedKeys.has(key) && self.isVaultManagedKey(key)) {
            interceptKey(key);
          }
        });
      };
      
      // Check for new keys periodically (with cleanup on exit)
      this.keyCheckInterval = setInterval(checkNewKeys, 1000);
    }
    
    if (this.config.debug) {
      console.log(`[VaultInterceptor] Environment interception setup for ${interceptedKeys.size} vault-managed keys`);
    }
  }
  
  isVaultManagedKey(key) {
    // Define which environment variables should be managed by vault
    const vaultManagedPatterns = [
      /.*_API_KEY$/,
      /.*_SECRET$/,
      /.*_TOKEN$/,
      /.*_PASSWORD$/,
      /DATABASE_URL$/,
      /REDIS_URL$/,
      // Add specific keys for testing
      'HUGGINGFACE_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY'
    ];
    
    return vaultManagedPatterns.some(pattern => {
      if (pattern instanceof RegExp) {
        return pattern.test(key);
      }
      return pattern === key;
    });
  }
  
  getVaultAwareValue(key, envValue) {
    this.stats.requests++;
    
    // Kill switch - return env value immediately
    if (this.killSwitch) {
      this.stats.env_fallbacks++;
      return envValue;
    }
    
    try {
      switch (this.config.mode) {
        case 'shadow':
          return this.handleShadowMode(key, envValue);
          
        case 'dual':
          return this.handleDualMode(key, envValue);
          
        case 'vault':
          return this.handleVaultMode(key, envValue);
          
        default:
          console.warn(`[VaultInterceptor] Unknown mode: ${this.config.mode}, falling back to env`);
          this.stats.env_fallbacks++;
          return envValue;
      }
    } catch (error) {
      console.error(`[VaultInterceptor] Error processing ${key}:`, error.message);
      this.stats.errors++;
      
      // Activate kill switch on repeated errors
      if (this.stats.errors > 10 && this.config.enable_kill_switch) {
        this.activateKillSwitch('High error rate detected');
      }
      
      return envValue;
    }
  }
  
  handleShadowMode(key, envValue) {
    // Shadow mode: Use env, but validate against vault asynchronously
    setImmediate(async () => {
      try {
        const vaultValue = await this.getFromVault(key);
        if (vaultValue && vaultValue !== envValue) {
          console.warn(`[VaultInterceptor] MISMATCH ${key}: env vs vault differ`);
        }
      } catch (error) {
        if (this.config.debug) {
          console.warn(`[VaultInterceptor] Vault validation failed for ${key}:`, error.message);
        }
      }
    });
    
    this.stats.env_fallbacks++;
    return envValue;
  }
  
  handleDualMode(key, envValue) {
    // Dual mode: Use canary percentage to route to vault
    const useVault = Math.random() * 100 < this.config.canary_percent;
    
    if (useVault) {
      // Return a promise that resolves to vault value with env fallback
      return this.getFromVault(key)
        .then(vaultValue => {
          if (vaultValue) {
            this.stats.vault_hits++;
            return vaultValue;
          }
          this.stats.env_fallbacks++;
          return envValue;
        })
        .catch(error => {
          if (this.config.debug) {
            console.warn(`[VaultInterceptor] Vault fallback for ${key}:`, error.message);
          }
          this.stats.env_fallbacks++;
          return envValue;
        });
    } else {
      this.stats.env_fallbacks++;
      return envValue;
    }
  }
  
  handleVaultMode(key, envValue) {
    // Vault mode: Vault primary, env emergency fallback
    return this.getFromVault(key)
      .then(vaultValue => {
        if (vaultValue) {
          this.stats.vault_hits++;
          return vaultValue;
        }
        
        console.warn(`[VaultInterceptor] Vault miss, using env fallback for ${key}`);
        this.stats.env_fallbacks++;
        return envValue;
      })
      .catch(error => {
        console.warn(`[VaultInterceptor] Vault error, emergency env fallback for ${key}:`, error.message);
        this.stats.env_fallbacks++;
        return envValue;
      });
  }
  
  async getFromVault(key) {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      this.stats.cache_hits++;
      return cached.value;
    }
    
    // Simulate network latency for testing
    await new Promise(resolve => setTimeout(resolve, Math.random() * 50 + 10));
    
    // TODO: Implement real vault client
    // For now, simulate by checking if env value exists
    const envValue = process.env[key];
    if (!envValue) {
      throw new Error(`Secret ${key} not found in vault`);
    }
    
    // Cache the result
    this.cache.set(key, {
      value: envValue,
      expires: Date.now() + this.config.cache_ttl
    });
    
    return envValue;
  }
  
  activateKillSwitch(reason) {
    console.error(`[VaultInterceptor] 🚨 KILL SWITCH ACTIVATED: ${reason}`);
    this.killSwitch = true;
    
    // Optionally notify monitoring systems
    if (this.config.webhook_url) {
      this.notifyKillSwitch(reason).catch(console.error);
    }
  }
  
  async notifyKillSwitch(reason) {
    try {
      const payload = {
        event: 'vault_kill_switch_activated',
        reason,
        timestamp: new Date().toISOString(),
        stats: this.getStats()
      };
      
      // Implementation would send to monitoring webhook
      console.log('[VaultInterceptor] Kill switch notification:', payload);
    } catch (error) {
      console.error('[VaultInterceptor] Failed to notify kill switch:', error.message);
    }
  }
  
  getStats() {
    return {
      ...this.stats,
      kill_switch_active: this.killSwitch,
      cache_size: this.cache.size,
      vault_hit_rate: this.stats.requests > 0 ? 
        ((this.stats.vault_hits / this.stats.requests) * 100).toFixed(2) + '%' : '0%'
    };
  }
  
  // Graceful shutdown
  shutdown() {
    console.log('[VaultInterceptor] Shutting down...');
    console.log('[VaultInterceptor] Final stats:', this.getStats());
    this.cache.clear();
    
    // Clear the interval to allow process to exit
    if (this.keyCheckInterval) {
      clearInterval(this.keyCheckInterval);
    }
  }
}

// Initialize the interceptor when loaded
const interceptor = new VaultEnvironmentInterceptor();

// Handle process termination
process.on('SIGINT', () => interceptor.shutdown());
process.on('SIGTERM', () => interceptor.shutdown());

// Export for testing
module.exports = { VaultEnvironmentInterceptor };

console.log('[VaultInterceptor] Environment interception system active');