/**
 * RAGnos Vault Provider Manifest Validator
 * 
 * Validates provider manifests against JSON schema with enhanced
 * security checks and compatibility validation.
 */

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');
const semver = require('semver');

class ManifestValidator {
  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      verbose: true,
      strict: false,
      validateFormats: false
    });
    
    // Add format validators
    addFormats(this.ajv);
    
    // Load schema
    this.schema = this.loadSchema();
    this.validate = this.ajv.compile(this.schema);
    
    // Security patterns
    this.suspiciousPatterns = [
      /eval\s*\(/i,
      /function\s*\(/i,
      /require\s*\(/i,
      /import\s*\(/i,
      /process\./i,
      /global\./i,
      /window\./i,
      /__proto__/i,
      /constructor/i
    ];
  }

  loadSchema() {
    const schemaPath = path.join(__dirname, '../schemas/provider-manifest.schema.json');
    return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  }

  /**
   * Validate a provider manifest with comprehensive checks
   */
  async validateManifest(manifest, options = {}) {
    const result = {
      valid: false,
      errors: [],
      warnings: [],
      security: {
        safe: true,
        issues: []
      },
      compatibility: {
        compatible: true,
        issues: []
      }
    };

    try {
      // 1. JSON Schema validation
      const schemaValid = this.validate(manifest);
      if (!schemaValid) {
        result.errors.push(...this.formatSchemaErrors(this.validate.errors));
        return result;
      }

      // 2. Security validation
      await this.validateSecurity(manifest, result);

      // 3. Compatibility validation
      await this.validateCompatibility(manifest, result, options);

      // 4. Business logic validation
      await this.validateBusinessLogic(manifest, result);

      // 5. Performance validation
      await this.validatePerformance(manifest, result);

      result.valid = result.errors.length === 0 && result.security.safe;

    } catch (error) {
      result.errors.push({
        type: 'validation_error',
        message: `Validation failed: ${error.message}`,
        severity: 'error'
      });
    }

    return result;
  }

  /**
   * Validate security aspects of the manifest
   */
  async validateSecurity(manifest, result) {
    // Check for suspicious patterns in strings
    const manifestString = JSON.stringify(manifest);
    for (const pattern of this.suspiciousPatterns) {
      if (pattern.test(manifestString)) {
        result.security.safe = false;
        result.security.issues.push({
          type: 'suspicious_pattern',
          message: `Suspicious pattern detected: ${pattern}`,
          severity: 'error'
        });
      }
    }

    // Validate SDK security if present
    if (manifest.transport === 'sdk') {
      await this.validateSdkSecurity(manifest.sdk, result);
    }

    // Validate HTTP security if present
    if (manifest.transport === 'http') {
      await this.validateHttpSecurity(manifest.http, result);
    }

    // Check network allowlist
    if (manifest.security?.networkAllowlist) {
      for (const host of manifest.security.networkAllowlist) {
        if (this.isSuspiciousHost(host)) {
          result.security.issues.push({
            type: 'suspicious_host',
            message: `Suspicious host in allowlist: ${host}`,
            severity: 'warning'
          });
        }
      }
    }
  }

  async validateSdkSecurity(sdk, result) {
    // Check package name for suspicious patterns
    if (this.isSuspiciousPackageName(sdk.package)) {
      result.security.safe = false;
      result.security.issues.push({
        type: 'suspicious_package',
        message: `Suspicious package name: ${sdk.package}`,
        severity: 'error'
      });
    }

    // Warn about install scripts
    if (sdk.installScripts === true) {
      result.security.issues.push({
        type: 'install_scripts_enabled',
        message: 'Package allows install scripts - security risk',
        severity: 'warning'
      });
    }

    // Check entry point for path traversal
    if (sdk.entry.includes('..') || path.isAbsolute(sdk.entry)) {
      result.security.safe = false;
      result.security.issues.push({
        type: 'path_traversal',
        message: `Unsafe entry point path: ${sdk.entry}`,
        severity: 'error'
      });
    }
  }

  async validateHttpSecurity(http, result) {
    // Check for non-HTTPS URLs in production contexts
    if (!http.baseUrl.startsWith('https://')) {
      result.security.issues.push({
        type: 'insecure_url',
        message: `Non-HTTPS URL: ${http.baseUrl}`,
        severity: 'warning'
      });
    }

    // Check for suspicious URLs
    if (this.isSuspiciousUrl(http.baseUrl)) {
      result.security.safe = false;
      result.security.issues.push({
        type: 'suspicious_url',
        message: `Suspicious base URL: ${http.baseUrl}`,
        severity: 'error'
      });
    }

    // Validate auth configuration
    if (http.auth?.type === 'custom') {
      result.security.issues.push({
        type: 'custom_auth',
        message: 'Custom auth requires manual security review',
        severity: 'info'
      });
    }
  }

  /**
   * Validate compatibility with current RAGnos Vault version
   */
  async validateCompatibility(manifest, result, options) {
    const currentVersion = options.ragvaultVersion || '2.0.0';

    // Check core version requirement
    if (manifest.requiresCore) {
      if (!semver.satisfies(currentVersion, manifest.requiresCore)) {
        result.compatibility.compatible = false;
        result.compatibility.issues.push({
          type: 'version_incompatible',
          message: `Requires core ${manifest.requiresCore}, current: ${currentVersion}`,
          severity: 'error'
        });
      }
    }

    // Check for deprecated features
    await this.checkDeprecatedFeatures(manifest, result);

    // Check for conflicting providers if context provided
    if (options.existingProviders) {
      await this.checkProviderConflicts(manifest, options.existingProviders, result);
    }
  }

  async checkDeprecatedFeatures(manifest, result) {
    // Check for deprecated aliases
    if (manifest.aliases) {
      const deprecatedAliases = manifest.aliases.filter(alias => alias.deprecated);
      if (deprecatedAliases.length > 0) {
        result.warnings.push({
          type: 'deprecated_aliases',
          message: `Deprecated aliases: ${deprecatedAliases.map(a => a.name).join(', ')}`,
          severity: 'warning'
        });
      }
    }

    // Check for deprecated capabilities
    const deprecatedCapabilities = ['auth.basic']; // Example
    if (manifest.capabilities) {
      const foundDeprecated = manifest.capabilities.filter(cap => 
        deprecatedCapabilities.includes(cap)
      );
      if (foundDeprecated.length > 0) {
        result.warnings.push({
          type: 'deprecated_capabilities',
          message: `Deprecated capabilities: ${foundDeprecated.join(', ')}`,
          severity: 'warning'
        });
      }
    }
  }

  async checkProviderConflicts(manifest, existingProviders, result) {
    // Check for ID conflicts
    if (existingProviders.some(p => p.id === manifest.id)) {
      result.compatibility.compatible = false;
      result.compatibility.issues.push({
        type: 'id_conflict',
        message: `Provider ID '${manifest.id}' already exists`,
        severity: 'error'
      });
    }

    // Check for canonical environment variable conflicts
    const existingCanonicals = existingProviders.map(p => p.canonical);
    if (existingCanonicals.includes(manifest.canonical)) {
      result.compatibility.compatible = false;
      result.compatibility.issues.push({
        type: 'canonical_conflict',
        message: `Canonical variable '${manifest.canonical}' already used`,
        severity: 'error'
      });
    }

    // Check for alias conflicts
    if (manifest.aliases) {
      const aliasNames = manifest.aliases.map(a => a.name);
      const conflictingAliases = aliasNames.filter(alias =>
        existingProviders.some(p => 
          p.canonical === alias || 
          (p.aliases && p.aliases.some(a => a.name === alias))
        )
      );

      if (conflictingAliases.length > 0) {
        result.warnings.push({
          type: 'alias_conflicts',
          message: `Conflicting aliases: ${conflictingAliases.join(', ')}`,
          severity: 'warning'
        });
      }
    }

    // Check explicit conflicts
    if (manifest.conflictsWith) {
      const activeConflicts = manifest.conflictsWith.filter(conflictId =>
        existingProviders.some(p => p.id === conflictId)
      );

      if (activeConflicts.length > 0) {
        result.compatibility.compatible = false;
        result.compatibility.issues.push({
          type: 'explicit_conflicts',
          message: `Conflicts with active providers: ${activeConflicts.join(', ')}`,
          severity: 'error'
        });
      }
    }
  }

  /**
   * Validate business logic rules
   */
  async validateBusinessLogic(manifest, result) {
    // Canonical should not be in aliases
    if (manifest.aliases && manifest.aliases.some(a => a.name === manifest.canonical)) {
      result.errors.push({
        type: 'canonical_in_aliases',
        message: 'Canonical environment variable should not appear in aliases',
        severity: 'error'
      });
    }

    // High confidence aliases should not be ambiguous
    if (manifest.aliases) {
      const problematicAliases = manifest.aliases.filter(
        alias => alias.confidence === 'high' && alias.ambiguous === true
      );
      if (problematicAliases.length > 0) {
        result.warnings.push({
          type: 'high_confidence_ambiguous',
          message: `High confidence aliases marked as ambiguous: ${problematicAliases.map(a => a.name).join(', ')}`,
          severity: 'warning'
        });
      }
    }

    // SDK transport should have reasonable timeout
    if (manifest.transport === 'sdk' && manifest.security?.sandbox?.timeout) {
      const timeout = manifest.security.sandbox.timeout;
      if (timeout > 300000) { // 5 minutes
        result.warnings.push({
          type: 'excessive_timeout',
          message: `SDK timeout ${timeout}ms exceeds recommended 300000ms`,
          severity: 'warning'
        });
      }
    }
  }

  /**
   * Validate performance characteristics
   */
  async validatePerformance(manifest, result) {
    // Check for excessive rate limits
    if (manifest.http?.rateLimits) {
      const { requests, window } = manifest.http.rateLimits;
      const windowMs = this.parseTimeWindow(window);
      const requestsPerSecond = requests / (windowMs / 1000);
      
      if (requestsPerSecond > 1000) {
        result.warnings.push({
          type: 'excessive_rate_limit',
          message: `Rate limit ${requestsPerSecond} req/s may cause performance issues`,
          severity: 'warning'
        });
      }
    }

    // Check for excessive memory limits
    if (manifest.security?.sandbox?.memory) {
      const memoryMB = parseInt(manifest.security.sandbox.memory);
      if (memoryMB > 1024) {
        result.warnings.push({
          type: 'excessive_memory',
          message: `Memory limit ${memoryMB}MB exceeds recommended 1024MB`,
          severity: 'warning'
        });
      }
    }
  }

  // Helper methods
  formatSchemaErrors(errors) {
    return errors.map(error => ({
      type: 'schema_validation',
      message: `${error.instancePath || 'root'}: ${error.message}`,
      severity: 'error',
      data: error.data
    }));
  }

  isSuspiciousPackageName(packageName) {
    const suspiciousPatterns = [
      /^[0-9]/,                    // Starts with number
      /[^a-z0-9\-._@\/]/,         // Invalid characters
      /\.\./,                      // Path traversal
      /^(con|prn|aux|nul)$/i,     // Windows reserved names
      /^npm$/i,                    // Reserved npm name
      /password|secret|key/i       // Suspicious keywords in name
    ];

    return suspiciousPatterns.some(pattern => pattern.test(packageName));
  }

  isSuspiciousHost(host) {
    const suspiciousPatterns = [
      /localhost/i,
      /127\.0\.0\.1/,
      /0\.0\.0\.0/,
      /192\.168\./,
      /10\./,
      /172\.(1[6-9]|2[0-9]|3[01])\./,
      /\.local$/i,
      /\.internal$/i
    ];

    return suspiciousPatterns.some(pattern => pattern.test(host));
  }

  isSuspiciousUrl(url) {
    try {
      const parsed = new URL(url);
      
      // Check for suspicious protocols
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return true;
      }
      
      // Check for suspicious hosts
      if (this.isSuspiciousHost(parsed.hostname)) {
        return true;
      }
      
      // Check for suspicious ports
      if (parsed.port && !['80', '443', '8080', '8443'].includes(parsed.port)) {
        return true;
      }
      
      return false;
    } catch {
      return true; // Invalid URL
    }
  }

  parseTimeWindow(window) {
    const match = window.match(/^(\d+)([smhd])$/);
    if (!match) return 0;
    
    const [, amount, unit] = match;
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    
    return parseInt(amount) * multipliers[unit];
  }

  /**
   * Validate multiple manifests for batch operations
   */
  async validateManifests(manifests, options = {}) {
    const results = [];
    const allProviders = [...(options.existingProviders || [])];

    for (const manifest of manifests) {
      const result = await this.validateManifest(manifest, {
        ...options,
        existingProviders: allProviders
      });
      
      results.push({
        id: manifest.id,
        ...result
      });

      // Add to existing providers if valid for next validation
      if (result.valid) {
        allProviders.push(manifest);
      }
    }

    return {
      results,
      summary: {
        total: manifests.length,
        valid: results.filter(r => r.valid).length,
        invalid: results.filter(r => !r.valid).length,
        warnings: results.reduce((sum, r) => sum + r.warnings.length, 0),
        securityIssues: results.reduce((sum, r) => sum + r.security.issues.length, 0)
      }
    };
  }
}

module.exports = { ManifestValidator };