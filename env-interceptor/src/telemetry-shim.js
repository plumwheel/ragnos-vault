/**
 * RAGnos Vault Telemetry Shim
 * 
 * Minimal OpenTelemetry integration using no-op providers to establish
 * telemetry infrastructure without performance overhead. Designed for
 * easy upgrade to full telemetry in Phase 2.
 */

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { Resource } = require('@opentelemetry/resources');
const { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } = require('@opentelemetry/semantic-conventions');
const { NoopSpanProcessor } = require('@opentelemetry/sdk-trace-node');
const { NoopMeterProvider } = require('@opentelemetry/api');

class TelemetryShim {
  constructor(options = {}) {
    this.options = {
      serviceName: 'ragnos-vault',
      serviceVersion: '2.0.0',
      environment: process.env.NODE_ENV || 'development',
      enabledInProduction: false,
      enabledInDevelopment: false,
      ...options
    };
    
    this.sdk = null;
    this.initialized = false;
    this.metrics = {
      pluginLoads: 0,
      sandboxStarts: 0,
      rpcCalls: 0,
      policyViolations: 0,
      errors: 0
    };
  }

  /**
   * Initialize telemetry with no-op providers
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Create resource with service identification
      const resource = new Resource({
        [SEMRESATTRS_SERVICE_NAME]: this.options.serviceName,
        [SEMRESATTRS_SERVICE_VERSION]: this.options.serviceVersion,
        'environment': this.options.environment,
        'ragnos.vault.component': 'env-interceptor'
      });

      // Initialize SDK with no-op processors (zero overhead)
      this.sdk = new NodeSDK({
        resource,
        spanProcessor: new NoopSpanProcessor(),
        instrumentations: [], // No auto-instrumentation yet
        autoDetectResources: false,
        metricReader: undefined // No metrics export yet
      });

      await this.sdk.start();
      this.initialized = true;

      this.recordEvent('telemetry.initialized', {
        service: this.options.serviceName,
        version: this.options.serviceVersion,
        mode: 'no-op'
      });

    } catch (error) {
      console.warn('Telemetry initialization failed (non-fatal):', error.message);
      this.initialized = false;
    }
  }

  /**
   * Record a telemetry event (currently stored locally)
   */
  recordEvent(name, attributes = {}, timestamp = Date.now()) {
    // For now, just track in memory - Phase 2 will export to OTEL
    const event = {
      name,
      attributes: {
        ...attributes,
        timestamp,
        environment: this.options.environment
      }
    };

    // Simple in-memory tracking for development visibility
    if (this.options.environment === 'development') {
      console.debug('📊 Telemetry event:', name, event.attributes);
    }
  }

  /**
   * Record plugin lifecycle events
   */
  recordPluginEvent(pluginId, event, metadata = {}) {
    this.recordEvent(`plugin.${event}`, {
      plugin_id: pluginId,
      ...metadata
    });

    // Update counters
    switch (event) {
      case 'loaded':
        this.metrics.pluginLoads++;
        break;
      case 'sandbox_started':
        this.metrics.sandboxStarts++;
        break;
      case 'rpc_call':
        this.metrics.rpcCalls++;
        break;
      case 'error':
        this.metrics.errors++;
        break;
    }
  }

  /**
   * Record security events
   */
  recordSecurityEvent(type, severity, details = {}) {
    this.recordEvent(`security.${type}`, {
      severity,
      ...details
    });

    if (severity === 'violation') {
      this.metrics.policyViolations++;
    }
  }

  /**
   * Record performance metrics
   */
  recordPerformanceMetric(operation, duration, metadata = {}) {
    this.recordEvent(`performance.${operation}`, {
      duration_ms: duration,
      ...metadata
    });
  }

  /**
   * Create a telemetry span (no-op for now)
   */
  createSpan(name, attributes = {}) {
    const telemetry = this;
    
    // Return a simple span-like object for interface compatibility
    return {
      name,
      attributes,
      startTime: Date.now(),
      
      setAttributes(attrs) {
        Object.assign(this.attributes, attrs);
        return this;
      },
      
      recordException(exception) {
        telemetry.recordEvent('span.exception', {
          span_name: name,
          exception_type: exception.constructor.name,
          exception_message: exception.message
        });
        return this;
      },
      
      setStatus(status) {
        this.status = status;
        return this;
      },
      
      end() {
        const duration = Date.now() - this.startTime;
        telemetry.recordEvent('span.completed', {
          span_name: name,
          duration_ms: duration,
          status: this.status,
          ...this.attributes
        });
      }
    };
  }

  /**
   * Get telemetry statistics
   */
  getStats() {
    return {
      initialized: this.initialized,
      mode: 'no-op',
      metrics: { ...this.metrics },
      config: {
        serviceName: this.options.serviceName,
        environment: this.options.environment
      }
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    if (this.sdk) {
      try {
        await this.sdk.shutdown();
        this.recordEvent('telemetry.shutdown');
      } catch (error) {
        console.warn('Telemetry shutdown warning:', error.message);
      }
    }
    
    this.initialized = false;
  }

  /**
   * Health check for telemetry system
   */
  healthCheck() {
    return {
      status: this.initialized ? 'healthy' : 'disabled',
      mode: 'no-op',
      overhead: 'minimal',
      metrics_count: Object.values(this.metrics).reduce((sum, val) => sum + val, 0),
      ready_for_upgrade: true
    };
  }
}

/**
 * Global telemetry instance - shared across the application
 */
let globalTelemetry = null;

/**
 * Get or create the global telemetry instance
 */
function getTelemetry(options = {}) {
  if (!globalTelemetry) {
    globalTelemetry = new TelemetryShim(options);
  }
  return globalTelemetry;
}

/**
 * Initialize global telemetry (called once at application startup)
 */
async function initializeTelemetry(options = {}) {
  const telemetry = getTelemetry(options);
  await telemetry.initialize();
  return telemetry;
}

/**
 * Convenience function for recording events
 */
function recordEvent(name, attributes = {}) {
  const telemetry = getTelemetry();
  telemetry.recordEvent(name, attributes);
}

/**
 * Convenience function for recording plugin events
 */
function recordPluginEvent(pluginId, event, metadata = {}) {
  const telemetry = getTelemetry();
  telemetry.recordPluginEvent(pluginId, event, metadata);
}

/**
 * Convenience function for recording security events
 */
function recordSecurityEvent(type, severity, details = {}) {
  const telemetry = getTelemetry();
  telemetry.recordSecurityEvent(type, severity, details);
}

/**
 * Convenience function for recording performance metrics
 */
function recordPerformanceMetric(operation, duration, metadata = {}) {
  const telemetry = getTelemetry();
  telemetry.recordPerformanceMetric(operation, duration, metadata);
}

/**
 * Convenience function for creating spans
 */
function createSpan(name, attributes = {}) {
  const telemetry = getTelemetry();
  return telemetry.createSpan(name, attributes);
}

module.exports = {
  TelemetryShim,
  getTelemetry,
  initializeTelemetry,
  recordEvent,
  recordPluginEvent,
  recordSecurityEvent,
  recordPerformanceMetric,
  createSpan
};