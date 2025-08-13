/**
 * RAGnos Vault - Unified Configuration Schema and Loader
 * 
 * Single source of truth for all configuration across CLI, Docker, and library
 * Eliminates config drift through shared validation and resolution
 */

const fs = require('fs');
const path = require('path');

/**
 * Configuration Schema Definition
 * All config options with validation rules and defaults
 */
const CONFIG_SCHEMA = {
  // Core vault settings
  vault: {
    mode: {
      type: 'string',
      enum: ['shadow', 'dual', 'vault'],
      default: 'shadow',
      description: 'Vault operation mode'
    },
    canary_percent: {
      type: 'number',
      min: 0,
      max: 100,
      default: 25,
      description: 'Percentage of requests routed to vault in dual mode'
    },
    url: {
      type: 'string',
      default: 'http://localhost:8200',
      description: 'Vault server URL'
    },
    timeout_ms: {
      type: 'number',
      min: 100,
      max: 30000,
      default: 5000,
      description: 'Vault request timeout in milliseconds'
    }
  },

  // Provider API keys (normalized naming)
  providers: {
    gemini: {
      api_key: {
        type: 'string',
        env_var: 'RAGVAULT_GEMINI_API_KEY',
        aliases: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        description: 'Google Gemini API key'
      }
    },
    openai: {
      api_key: {
        type: 'string',
        env_var: 'RAGVAULT_OPENAI_API_KEY', 
        aliases: ['OPENAI_API_KEY'],
        description: 'OpenAI API key'
      }
    },
    anthropic: {
      api_key: {
        type: 'string',
        env_var: 'RAGVAULT_ANTHROPIC_API_KEY',
        aliases: ['ANTHROPIC_API_KEY'],
        description: 'Anthropic API key'
      }
    }
  },

  // Demo and testing settings
  demo: {
    duration_seconds: {
      type: 'number',
      min: 10,
      max: 300,
      default: 60,
      description: 'Demo runtime duration'
    },
    interval_ms: {
      type: 'number',
      min: 100,
      max: 10000,
      default: 2000,
      description: 'Interval between demo API calls'
    },
    provider: {
      type: 'string',
      enum: ['gemini', 'openai', 'anthropic'],
      default: 'gemini',
      description: 'Provider to use for demo'
    }
  },

  // Monitoring and telemetry
  telemetry: {
    enabled: {
      type: 'boolean',
      default: true,
      description: 'Enable telemetry collection'
    },
    console_output: {
      type: 'boolean',
      default: true,
      description: 'Print telemetry to console'
    },
    export_interval_ms: {
      type: 'number',
      min: 1000,
      max: 60000,
      default: 5000,
      description: 'Interval for telemetry export'
    }
  },

  // Logging configuration
  logging: {
    level: {
      type: 'string',
      enum: ['debug', 'info', 'warn', 'error'],
      default: 'info',
      description: 'Log level'
    },
    structured: {
      type: 'boolean',
      default: false,
      description: 'Use structured JSON logging'
    }
  }
};

/**
 * Configuration precedence (highest to lowest):
 * 1. CLI flags (--vault-mode=dual)
 * 2. Environment variables (RAGVAULT_VAULT_MODE=dual)
 * 3. Config file (ragvault.config.json)
 * 4. Defaults from schema
 */
class ConfigLoader {
  constructor(options = {}) {
    this.configFile = options.configFile || 'ragvault.config.json';
    this.verbose = options.verbose || false;
    this.resolutionReport = [];
  }

  /**
   * Load and resolve configuration from all sources
   */
  load(cliArgs = {}) {
    const config = {};
    this.resolutionReport = [];

    // Step 1: Apply defaults
    this._applyDefaults(config);

    // Step 2: Load from config file
    this._loadFromFile(config);

    // Step 3: Load from environment variables
    this._loadFromEnvironment(config);

    // Step 4: Apply CLI arguments (highest precedence)
    this._applyCLIArgs(config, cliArgs);

    // Step 5: Validate final configuration
    this._validate(config);

    // Step 6: Detect and warn about conflicts/aliases
    this._detectConflicts();

    return config;
  }

  /**
   * Apply default values from schema
   */
  _applyDefaults(config) {
    this._walkSchema(CONFIG_SCHEMA, config, (path, schemaNode, configNode) => {
      if (schemaNode.default !== undefined) {
        this._setValue(config, path, schemaNode.default);
        this.resolutionReport.push({
          path,
          value: this._maskSecret(path, schemaNode.default),
          source: 'default',
          description: schemaNode.description
        });
      }
    });
  }

  /**
   * Load configuration from file
   */
  _loadFromFile(config) {
    const configPath = path.resolve(this.configFile);
    
    if (fs.existsSync(configPath)) {
      try {
        const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        
        this._walkSchema(CONFIG_SCHEMA, fileConfig, (path, schemaNode, value) => {
          if (value !== undefined) {
            this._setValue(config, path, value);
            this.resolutionReport.push({
              path,
              value: this._maskSecret(path, value),
              source: 'config_file',
              file: configPath
            });
          }
        });
      } catch (error) {
        throw new Error(`Failed to load config file ${configPath}: ${error.message}`);
      }
    }
  }

  /**
   * Load configuration from environment variables
   */
  _loadFromEnvironment(config) {
    this._walkSchema(CONFIG_SCHEMA, config, (path, schemaNode) => {
      // Check primary env var
      if (schemaNode.env_var) {
        const envValue = process.env[schemaNode.env_var];
        if (envValue !== undefined) {
          const parsedValue = this._parseEnvValue(envValue, schemaNode.type);
          this._setValue(config, path, parsedValue);
          this.resolutionReport.push({
            path,
            value: this._maskSecret(path, parsedValue),
            source: 'environment',
            env_var: schemaNode.env_var
          });
          return;
        }
      }

      // Check aliases (with warnings)
      if (schemaNode.aliases) {
        for (const alias of schemaNode.aliases) {
          const aliasValue = process.env[alias];
          if (aliasValue !== undefined) {
            const parsedValue = this._parseEnvValue(aliasValue, schemaNode.type);
            this._setValue(config, path, parsedValue);
            this.resolutionReport.push({
              path,
              value: this._maskSecret(path, parsedValue),
              source: 'environment_alias',
              env_var: alias,
              warning: `Using deprecated alias ${alias}. Use ${schemaNode.env_var} instead.`
            });
            return;
          }
        }
      }

      // Check auto-generated env var names
      const autoEnvVar = this._pathToEnvVar(path);
      const autoValue = process.env[autoEnvVar];
      if (autoValue !== undefined) {
        const parsedValue = this._parseEnvValue(autoValue, schemaNode.type);
        this._setValue(config, path, parsedValue);
        this.resolutionReport.push({
          path,
          value: this._maskSecret(path, parsedValue),
          source: 'environment_auto',
          env_var: autoEnvVar
        });
      }
    });
  }

  /**
   * Apply CLI arguments
   */
  _applyCLIArgs(config, cliArgs) {
    for (const [key, value] of Object.entries(cliArgs)) {
      const path = key.replace(/[-_]/g, '.');
      
      // Find matching schema node
      const schemaNode = this._getSchemaNode(path);
      if (schemaNode) {
        const parsedValue = this._parseEnvValue(value, schemaNode.type);
        this._setValue(config, path, parsedValue);
        this.resolutionReport.push({
          path,
          value: this._maskSecret(path, parsedValue),
          source: 'cli_args',
          flag: key
        });
      }
    }
  }

  /**
   * Validate final configuration
   */
  _validate(config) {
    const errors = [];
    
    this._walkSchema(CONFIG_SCHEMA, config, (path, schemaNode, value) => {
      if (value === undefined) return;

      // Type validation
      if (schemaNode.type === 'number' && typeof value !== 'number') {
        errors.push(`${path}: expected number, got ${typeof value}`);
      }
      if (schemaNode.type === 'string' && typeof value !== 'string') {
        errors.push(`${path}: expected string, got ${typeof value}`);
      }
      if (schemaNode.type === 'boolean' && typeof value !== 'boolean') {
        errors.push(`${path}: expected boolean, got ${typeof value}`);
      }

      // Enum validation
      if (schemaNode.enum && !schemaNode.enum.includes(value)) {
        errors.push(`${path}: must be one of [${schemaNode.enum.join(', ')}], got '${value}'`);
      }

      // Range validation
      if (schemaNode.min !== undefined && value < schemaNode.min) {
        errors.push(`${path}: must be >= ${schemaNode.min}, got ${value}`);
      }
      if (schemaNode.max !== undefined && value > schemaNode.max) {
        errors.push(`${path}: must be <= ${schemaNode.max}, got ${value}`);
      }
    });

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n  ${errors.join('\n  ')}`);
    }
  }

  /**
   * Detect conflicts between multiple sources
   */
  _detectConflicts() {
    const conflicts = {};
    
    for (const entry of this.resolutionReport) {
      if (!conflicts[entry.path]) {
        conflicts[entry.path] = [];
      }
      conflicts[entry.path].push(entry);
    }

    // Report conflicts and aliases
    for (const [path, sources] of Object.entries(conflicts)) {
      if (sources.length > 1) {
        const hasWarning = sources.some(s => s.warning);
        const hasMultipleSources = new Set(sources.map(s => s.source.split('_')[0])).size > 1;
        
        if (hasWarning || hasMultipleSources) {
          console.warn(`\n⚠️  Configuration conflict for ${path}:`);
          for (const source of sources) {
            console.warn(`   ${source.source}: ${source.value}${source.warning ? ' (deprecated)' : ''}`);
          }
        }
      }
    }
  }

  /**
   * Print configuration resolution report
   */
  printResolutionReport() {
    console.log('\n🔧 RAGnos Vault Configuration Resolution Report');
    console.log('='.repeat(50));
    
    const grouped = {};
    for (const entry of this.resolutionReport) {
      const section = entry.path.split('.')[0];
      if (!grouped[section]) grouped[section] = [];
      grouped[section].push(entry);
    }

    for (const [section, entries] of Object.entries(grouped)) {
      console.log(`\n📋 ${section.toUpperCase()}:`);
      for (const entry of entries) {
        const sourceInfo = this._formatSourceInfo(entry);
        console.log(`   ${entry.path}: ${entry.value} (${sourceInfo})`);
        if (entry.warning) {
          console.warn(`      ⚠️  ${entry.warning}`);
        }
      }
    }
    console.log('');
  }

  // Helper methods
  _walkSchema(schema, config, callback, currentPath = '') {
    for (const [key, value] of Object.entries(schema)) {
      const path = currentPath ? `${currentPath}.${key}` : key;
      
      if (value.type) {
        // Leaf node with configuration
        const configValue = this._getValue(config, path);
        callback(path, value, configValue);
      } else {
        // Nested object, recurse
        this._walkSchema(value, config, callback, path);
      }
    }
  }

  _setValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) current[keys[i]] = {};
      current = current[keys[i]];
    }
    
    current[keys[keys.length - 1]] = value;
  }

  _getValue(obj, path) {
    const keys = path.split('.');
    let current = obj;
    
    for (const key of keys) {
      if (current === undefined || current === null) return undefined;
      current = current[key];
    }
    
    return current;
  }

  _getSchemaNode(path) {
    const keys = path.split('.');
    let current = CONFIG_SCHEMA;
    
    for (const key of keys) {
      if (!current[key]) return null;
      current = current[key];
    }
    
    return current.type ? current : null;
  }

  _pathToEnvVar(path) {
    return `RAGVAULT_${path.replace(/\./g, '_').toUpperCase()}`;
  }

  _parseEnvValue(value, type) {
    switch (type) {
      case 'number':
        const num = Number(value);
        if (isNaN(num)) throw new Error(`Cannot parse '${value}' as number`);
        return num;
      case 'boolean':
        return value.toLowerCase() === 'true' || value === '1';
      case 'string':
      default:
        return value;
    }
  }

  _maskSecret(path, value) {
    if (path.includes('api_key') || path.includes('token') || path.includes('secret')) {
      if (typeof value === 'string' && value.length > 10) {
        return `${value.substring(0, 8)}***${value.substring(value.length - 3)}`;
      }
    }
    return value;
  }

  _formatSourceInfo(entry) {
    switch (entry.source) {
      case 'default':
        return 'default';
      case 'config_file':
        return `file: ${path.basename(entry.file)}`;
      case 'environment':
        return `env: ${entry.env_var}`;
      case 'environment_alias':
        return `env: ${entry.env_var} (alias)`;
      case 'environment_auto':
        return `env: ${entry.env_var} (auto)`;
      case 'cli_args':
        return `cli: --${entry.flag}`;
      default:
        return entry.source;
    }
  }
}

module.exports = {
  CONFIG_SCHEMA,
  ConfigLoader
};