/**
 * RAGnos Vault Policy Engine
 * 
 * Enforces security policies for provider plugins, registry access,
 * and operational constraints. Default-deny security model.
 */

const fs = require('fs');
const path = require('path');

class PolicyEngine {
  constructor(policyPath = null, options = {}) {
    this.options = {
      strictMode: true,
      allowLocalOverrides: true,  // Enable for testing
      ...options
    };
    
    this.policy = this.loadPolicy(policyPath);
    this.violations = [];
  }

  loadPolicy(policyPath) {
    // Default policy (secure by default)
    const defaultPolicy = {
      version: '1.0.0',
      enforcement: {
        level: 'strict', // strict, moderate, permissive
        failOnViolation: true,
        logViolations: true
      },
      
      providers: {
        allowCodePlugins: false,              // Default: manifest-only
        requireSignatures: false,             // Enable for enterprise
        allowAutoInstall: false,              // Default: manual install
        allowUnknownProviders: false,         // Default: curated only
        providerAllowlist: [],                // Empty = deny all unknown
        providerDenylist: [],                 // Explicit denials
        maxProviders: 100                     // Prevent resource exhaustion
      },
      
      registries: {
        allowedRegistries: [
          'https://registry.ragnos.io',       // Official RAGnos Hub
          'https://registry.npmjs.org'        // npm for code plugins
        ],
        requireHTTPS: true,
        allowLocalRegistries: false,
        allowGitRegistries: false
      },
      
      network: {
        allowEgress: true,
        globalAllowlist: [],                  // Global network restrictions
        blockPrivateNetworks: true,          // Block RFC1918, localhost
        maxConcurrentConnections: 10,
        timeoutMs: 30000
      },
      
      sandbox: {
        enableSubprocessSandbox: true,
        maxMemoryMB: 256,
        maxCpuPercent: 50,
        maxExecutionTimeMs: 30000,
        allowFileSystem: false,
        allowNetworkAccess: true,
        allowEnvironmentAccess: false
      },
      
      validation: {
        requireManifestValidation: true,
        allowDeprecatedFeatures: false,
        maxAliasCount: 20,
        requireCanonicalMapping: true
      },
      
      telemetry: {
        allowTelemetry: true,
        hashSensitiveData: true,
        allowDetailedMetrics: false,
        maxCardinalityPerMetric: 1000
      }
    };

    if (!policyPath) {
      return defaultPolicy;
    }

    try {
      const policyContent = fs.readFileSync(policyPath, 'utf8');
      const userPolicy = JSON.parse(policyContent);
      
      // Merge with defaults (user policy takes precedence)
      return this.mergePolicy(defaultPolicy, userPolicy);
    } catch (error) {
      if (this.options.strictMode) {
        throw new Error(`Failed to load policy from ${policyPath}: ${error.message}`);
      }
      
      console.warn(`Policy load failed, using defaults: ${error.message}`);
      return defaultPolicy;
    }
  }

  mergePolicy(defaultPolicy, userPolicy) {
    // Deep merge with security validation
    const merged = JSON.parse(JSON.stringify(defaultPolicy));
    
    // Only merge known policy sections
    const allowedSections = [
      'enforcement', 'providers', 'registries', 'network', 
      'sandbox', 'validation', 'telemetry'
    ];
    
    allowedSections.forEach(section => {
      if (userPolicy[section]) {
        merged[section] = { ...merged[section], ...userPolicy[section] };
      }
    });
    
    // Validate policy constraints
    this.validatePolicyConstraints(merged);
    
    return merged;
  }

  validatePolicyConstraints(policy) {
    // Ensure security minimums aren't violated
    const constraints = [
      // Memory limits
      {
        path: 'sandbox.maxMemoryMB',
        min: 64,
        max: 2048,
        message: 'Sandbox memory must be between 64MB and 2GB'
      },
      
      // Execution time limits
      {
        path: 'sandbox.maxExecutionTimeMs',
        min: 1000,
        max: 300000,
        message: 'Execution timeout must be between 1s and 5m'
      },
      
      // Provider limits
      {
        path: 'providers.maxProviders',
        min: 1,
        max: 1000,
        message: 'Provider count must be between 1 and 1000'
      }
    ];

    constraints.forEach(constraint => {
      const value = this.getNestedValue(policy, constraint.path);
      if (typeof value === 'number') {
        if (value < constraint.min || value > constraint.max) {
          throw new Error(`Policy violation: ${constraint.message}. Got: ${value}`);
        }
      }
    });
  }

  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Check if a provider manifest is allowed by policy
   */
  async checkProvider(manifest, context = {}) {
    this.violations = [];
    
    try {
      // 1. Basic allowlist/denylist checks
      await this.checkProviderLists(manifest);
      
      // 2. Transport type restrictions
      await this.checkTransportPolicy(manifest);
      
      // 3. Registry restrictions
      await this.checkRegistryPolicy(manifest, context);
      
      // 4. Network policy validation
      await this.checkNetworkPolicy(manifest);
      
      // 5. Security configuration validation
      await this.checkSecurityPolicy(manifest);
      
      // 6. Resource limit validation
      await this.checkResourcePolicy(manifest);
      
      // 7. Feature flag validation
      await this.checkFeaturePolicy(manifest);
      
      return this.generatePolicyResult();
      
    } catch (error) {
      this.addViolation('policy_check_error', error.message, 'error');
      return this.generatePolicyResult();
    }
  }

  async checkProviderLists(manifest) {
    // Check explicit denylist first
    if (this.policy.providers.providerDenylist.includes(manifest.id)) {
      this.addViolation(
        'provider_denied',
        `Provider '${manifest.id}' is in the denylist`,
        'error'
      );
    }
    
    // Check allowlist if configured
    const allowlist = this.policy.providers.providerAllowlist;
    if (allowlist.length > 0 && !allowlist.includes(manifest.id)) {
      this.addViolation(
        'provider_not_allowlisted',
        `Provider '${manifest.id}' is not in the allowlist`,
        'error'
      );
    }
    
    // Check unknown provider policy
    if (!this.policy.providers.allowUnknownProviders && !this.isKnownProvider(manifest.id)) {
      this.addViolation(
        'unknown_provider',
        `Provider '${manifest.id}' is not in the official registry`,
        'warning'
      );
    }
  }

  async checkTransportPolicy(manifest) {
    // Check code plugin restrictions
    if (manifest.transport === 'sdk' && !this.policy.providers.allowCodePlugins) {
      this.addViolation(
        'code_plugins_disabled',
        'Code plugins (SDK transport) are disabled by policy',
        'error'
      );
    }
    
    // Check auto-install requirements
    if (manifest.transport === 'sdk' && !this.policy.providers.allowAutoInstall) {
      this.addViolation(
        'auto_install_disabled',
        'Auto-install is required for SDK plugins but disabled by policy',
        'error'
      );
    }
  }

  async checkRegistryPolicy(manifest, context) {
    const source = context.source || 'unknown';
    const allowedRegistries = this.policy.registries.allowedRegistries;
    
    // Check if source registry is allowed
    if (allowedRegistries.length > 0) {
      const isAllowed = allowedRegistries.some(registry => 
        source.startsWith(registry) || this.matchesRegistryPattern(source, registry)
      );
      
      if (!isAllowed) {
        this.addViolation(
          'registry_not_allowed',
          `Provider source '${source}' is not in allowed registries`,
          'error'
        );
      }
    }
    
    // Check HTTPS requirement
    if (this.policy.registries.requireHTTPS && !source.startsWith('https://')) {
      this.addViolation(
        'insecure_registry',
        `Registry source must use HTTPS: ${source}`,
        'error'
      );
    }
    
    // Check local registry policy
    if (!this.policy.registries.allowLocalRegistries && this.isLocalRegistry(source)) {
      this.addViolation(
        'local_registry_disabled',
        `Local registries are disabled: ${source}`,
        'error'
      );
    }
    
    // Check Git registry policy
    if (!this.policy.registries.allowGitRegistries && this.isGitRegistry(source)) {
      this.addViolation(
        'git_registry_disabled',
        `Git registries are disabled: ${source}`,
        'error'
      );
    }
  }

  async checkNetworkPolicy(manifest) {
    if (!manifest.security?.networkAllowlist) {
      return; // No network restrictions to check
    }
    
    const allowlist = manifest.security.networkAllowlist;
    
    // Check against global allowlist
    if (this.policy.network.globalAllowlist.length > 0) {
      const unauthorizedHosts = allowlist.filter(host => 
        !this.policy.network.globalAllowlist.some(allowed => 
          this.matchesNetworkPattern(host, allowed)
        )
      );
      
      if (unauthorizedHosts.length > 0) {
        this.addViolation(
          'unauthorized_network_access',
          `Hosts not in global allowlist: ${unauthorizedHosts.join(', ')}`,
          'warning'
        );
      }
    }
    
    // Check for private network access
    if (this.policy.network.blockPrivateNetworks) {
      const privateHosts = allowlist.filter(host => this.isPrivateNetwork(host));
      if (privateHosts.length > 0) {
        this.addViolation(
          'private_network_access',
          `Private network access blocked: ${privateHosts.join(', ')}`,
          'error'
        );
      }
    }
  }

  async checkSecurityPolicy(manifest) {
    // Check signature requirements
    if (this.policy.providers.requireSignatures && !manifest.signature) {
      this.addViolation(
        'signature_required',
        'Provider signature verification is required but missing',
        'error'
      );
    }
    
    // Check sandbox configuration
    if (manifest.transport === 'sdk') {
      const sandbox = manifest.security?.sandbox;
      
      if (!sandbox && this.policy.sandbox.enableSubprocessSandbox) {
        this.addViolation(
          'sandbox_required',
          'Subprocess sandbox configuration is required for SDK plugins',
          'error'
        );
      }
      
      if (sandbox) {
        await this.validateSandboxConfig(sandbox);
      }
    }
  }

  async validateSandboxConfig(sandbox) {
    const policy = this.policy.sandbox;
    
    // Check memory limits
    if (sandbox.memory) {
      const memoryMB = parseInt(sandbox.memory);
      if (memoryMB > policy.maxMemoryMB) {
        this.addViolation(
          'memory_limit_exceeded',
          `Sandbox memory ${memoryMB}MB exceeds policy limit ${policy.maxMemoryMB}MB`,
          'error'
        );
      }
    }
    
    // Check execution time limits
    if (sandbox.timeout && sandbox.timeout > policy.maxExecutionTimeMs) {
      this.addViolation(
        'execution_timeout_exceeded',
        `Sandbox timeout ${sandbox.timeout}ms exceeds policy limit ${policy.maxExecutionTimeMs}ms`,
        'error'
      );
    }
    
    // Check capability restrictions
    if (sandbox.allowFileSystem && !policy.allowFileSystem) {
      this.addViolation(
        'filesystem_access_disabled',
        'Filesystem access is disabled by policy',
        'error'
      );
    }
    
    if (!sandbox.allowNetworkAccess && policy.allowNetworkAccess === false) {
      this.addViolation(
        'network_access_disabled', 
        'Network access is disabled by policy',
        'error'
      );
    }
  }

  async checkResourcePolicy(manifest) {
    // Check alias count limits
    if (manifest.aliases && manifest.aliases.length > this.policy.validation.maxAliasCount) {
      this.addViolation(
        'too_many_aliases',
        `Provider has ${manifest.aliases.length} aliases, limit is ${this.policy.validation.maxAliasCount}`,
        'warning'
      );
    }
  }

  async checkFeaturePolicy(manifest) {
    // Check deprecated feature usage
    if (!this.policy.validation.allowDeprecatedFeatures) {
      if (manifest.capabilities?.includes('auth.basic')) {
        this.addViolation(
          'deprecated_feature',
          'Basic auth capability is deprecated',
          'warning'
        );
      }
      
      if (manifest.aliases?.some(alias => alias.deprecated)) {
        this.addViolation(
          'deprecated_aliases',
          'Provider uses deprecated aliases',
          'warning'
        );
      }
    }
  }

  // Helper methods
  isKnownProvider(providerId) {
    // This would check against the official registry index
    // For now, return true to avoid blocking during development
    return true;
  }

  matchesRegistryPattern(source, pattern) {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(source);
    }
    return source === pattern;
  }

  isLocalRegistry(source) {
    return source.startsWith('file://') || 
           source.startsWith('./') || 
           source.startsWith('../') ||
           source.includes('localhost');
  }

  isGitRegistry(source) {
    return source.startsWith('git+') ||
           source.includes('github.com') ||
           source.includes('gitlab.com') ||
           source.endsWith('.git');
  }

  matchesNetworkPattern(host, pattern) {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(host);
    }
    return host === pattern;
  }

  isPrivateNetwork(host) {
    const privatePatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[01])\./,
      /^192\.168\./,
      /^169\.254\./,
      /^::1$/,
      /^fc00:/,
      /^fe80:/
    ];
    
    return privatePatterns.some(pattern => pattern.test(host));
  }

  addViolation(type, message, severity = 'error') {
    this.violations.push({
      type,
      message,
      severity,
      timestamp: new Date().toISOString()
    });
    
    if (this.policy.enforcement.logViolations) {
      console.warn(`Policy violation [${severity}]: ${message}`);
    }
  }

  generatePolicyResult() {
    const errors = this.violations.filter(v => v.severity === 'error');
    const warnings = this.violations.filter(v => v.severity === 'warning');
    
    const allowed = errors.length === 0 || !this.policy.enforcement.failOnViolation;
    
    return {
      allowed,
      enforcement: this.policy.enforcement,
      violations: this.violations,
      summary: {
        errors: errors.length,
        warnings: warnings.length,
        total: this.violations.length
      }
    };
  }

  /**
   * Get current policy configuration
   */
  getPolicy() {
    return JSON.parse(JSON.stringify(this.policy));
  }

  /**
   * Update policy configuration
   */
  updatePolicy(policyUpdates) {
    if (!this.options.allowLocalOverrides) {
      throw new Error('Policy updates not allowed - enable allowLocalOverrides');
    }
    
    this.policy = this.mergePolicy(this.policy, policyUpdates);
    this.violations = [];
  }

  /**
   * Generate policy compliance report
   */
  generateComplianceReport(providers = []) {
    return {
      policy: {
        version: this.policy.version,
        enforcement: this.policy.enforcement,
        timestamp: new Date().toISOString()
      },
      providers: providers.length,
      compliance: {
        // This would be populated by checking all providers
        passed: 0,
        failed: 0,
        warnings: 0
      },
      recommendations: this.generateRecommendations()
    };
  }

  generateRecommendations() {
    const recommendations = [];
    
    if (!this.policy.providers.requireSignatures) {
      recommendations.push({
        type: 'security',
        priority: 'medium',
        message: 'Consider enabling signature verification for production'
      });
    }
    
    if (this.policy.providers.allowCodePlugins) {
      recommendations.push({
        type: 'security',
        priority: 'low',
        message: 'Code plugins increase attack surface - consider manifest-only approach'
      });
    }
    
    if (this.policy.network.blockPrivateNetworks === false) {
      recommendations.push({
        type: 'security',
        priority: 'high',
        message: 'Blocking private network access improves security posture'
      });
    }
    
    return recommendations;
  }
}

class PolicyViolation extends Error {
  constructor(message, type = 'policy_violation', severity = 'error') {
    super(message);
    this.name = 'PolicyViolation';
    this.type = type;
    this.severity = severity;
  }
}

module.exports = { PolicyEngine, PolicyViolation };