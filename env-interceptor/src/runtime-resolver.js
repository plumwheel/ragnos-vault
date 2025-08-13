/**
 * RAGnos Vault Runtime Resolver
 * 
 * Securely resolves Node.js interpreter path for sandbox execution.
 * Uses deterministic resolution without relying on PATH.
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const access = promisify(fs.access);

class RuntimeResolver {
  constructor(policyEngine = null) {
    this.policyEngine = policyEngine;
    this.cache = new Map();
  }

  /**
   * Resolve Node.js interpreter path deterministically
   */
  async resolveNodeRuntime(manifest, options = {}) {
    const cacheKey = this.getCacheKey(manifest, options);
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const resolution = await this.performResolution(manifest, options);
      
      // Cache successful resolution
      this.cache.set(cacheKey, resolution);
      
      // Emit telemetry event
      this.emitResolutionEvent(manifest.id, resolution);
      
      return resolution;
      
    } catch (error) {
      this.emitResolutionError(manifest.id, error);
      throw error;
    }
  }

  async performResolution(manifest, options) {
    const resolution = {
      interpreterPath: null,
      version: null,
      source: null,
      timestamp: Date.now()
    };

    // Resolution order: explicit → process.execPath → fail
    
    // 1. Check for explicit interpreter in policy/manifest
    const explicitPath = await this.checkExplicitInterpreter(manifest, options);
    if (explicitPath) {
      resolution.interpreterPath = explicitPath;
      resolution.source = 'explicit';
      resolution.version = await this.getNodeVersion(explicitPath);
      return resolution;
    }

    // 2. Use current process Node.js path (most common case)
    const currentNodePath = process.execPath;
    if (await this.validateInterpreter(currentNodePath)) {
      resolution.interpreterPath = currentNodePath;
      resolution.source = 'process.execPath';
      resolution.version = process.version;
      return resolution;
    }

    // 3. Fail fast - no fallback to PATH for security
    throw new Error('No valid Node.js runtime found - process.execPath not accessible');
  }

  async checkExplicitInterpreter(manifest, options) {
    // Check policy for explicit interpreter override
    const policy = this.policyEngine?.getPolicy();
    if (policy?.runtime?.explicitInterpreter) {
      const explicitPath = policy.runtime.explicitInterpreter;
      
      // Security: Must be absolute path
      if (!path.isAbsolute(explicitPath)) {
        throw new Error('Explicit interpreter must be absolute path');
      }
      
      // Security: Check against allowlist if configured
      if (policy.runtime.interpreterAllowlist) {
        const isAllowed = policy.runtime.interpreterAllowlist.some(allowed => 
          explicitPath === allowed || explicitPath.startsWith(allowed + path.sep)
        );
        
        if (!isAllowed) {
          throw new Error(`Interpreter not in allowlist: ${explicitPath}`);
        }
      }
      
      // Validate executable
      if (await this.validateInterpreter(explicitPath)) {
        return explicitPath;
      } else {
        throw new Error(`Explicit interpreter not executable: ${explicitPath}`);
      }
    }

    // Check manifest for requested Node version (future enhancement)
    if (manifest.sdk?.nodeVersion) {
      // For now, log the requested version but don't resolve it
      console.log(`Plugin ${manifest.id} requests Node.js ${manifest.sdk.nodeVersion} (using current: ${process.version})`);
    }

    return null;
  }

  async validateInterpreter(interpreterPath) {
    try {
      // Check if file exists and is executable
      await access(interpreterPath, fs.constants.F_OK | fs.constants.X_OK);
      
      // Additional security: Check if it's actually a Node.js binary
      // This is a basic check - could be enhanced with binary signature validation
      const isNodeBinary = interpreterPath.includes('node') || 
                          interpreterPath.includes('Node') ||
                          interpreterPath === process.execPath;
      
      return isNodeBinary;
      
    } catch (error) {
      return false;
    }
  }

  async getNodeVersion(interpreterPath) {
    try {
      // If it's the current process, use cached version
      if (interpreterPath === process.execPath) {
        return process.version;
      }
      
      // For other interpreters, we'd need to spawn to get version
      // For now, return unknown to avoid subprocess complexity
      return 'unknown';
      
    } catch (error) {
      return 'unknown';
    }
  }

  getCacheKey(manifest, options) {
    return `${manifest.id}:${manifest.sdk?.nodeVersion || 'default'}:${options.runtimeOverride || 'none'}`;
  }

  emitResolutionEvent(pluginId, resolution) {
    // Emit telemetry event for monitoring
    console.log(`Runtime resolved for ${pluginId}: ${resolution.source} -> ${resolution.interpreterPath} (${resolution.version})`);
    
    // TODO: Integrate with telemetry bus when Phase 2 is implemented
  }

  emitResolutionError(pluginId, error) {
    console.error(`Runtime resolution failed for ${pluginId}: ${error.message}`);
    
    // TODO: Integrate with telemetry bus for error tracking
  }

  /**
   * Clear resolution cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get cached resolutions for monitoring
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }

  /**
   * Validate runtime security requirements
   */
  async validateRuntimeSecurity(interpreterPath, manifest) {
    const checks = {
      absolutePath: path.isAbsolute(interpreterPath),
      executable: await this.validateInterpreter(interpreterPath),
      nodeVersion: null,
      securityIssues: []
    };

    // Check for suspicious paths
    const suspiciousPaths = ['/tmp/', '/var/tmp/', '/dev/shm/'];
    if (suspiciousPaths.some(suspicious => interpreterPath.includes(suspicious))) {
      checks.securityIssues.push('Interpreter in suspicious temporary directory');
    }

    // Check for symlinks (could be an attack vector)
    try {
      const stats = fs.lstatSync(interpreterPath);
      if (stats.isSymbolicLink()) {
        checks.securityIssues.push('Interpreter is a symbolic link');
      }
    } catch (error) {
      checks.securityIssues.push('Cannot stat interpreter file');
    }

    // Version compatibility check (if specified)
    if (manifest.sdk?.nodeVersion) {
      // This would require semver validation
      checks.nodeVersion = 'version check not implemented';
    }

    return checks;
  }
}

module.exports = { RuntimeResolver };