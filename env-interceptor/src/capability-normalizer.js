/**
 * RAGnos Vault Capability Normalizer
 * 
 * Converts legacy and v2 capability formats to a canonical internal model.
 * Implements GPT-5 strategic guidance for dual-format support with
 * backward compatibility and migration path.
 */

const { recordPluginEvent } = require('./telemetry-shim');

/**
 * Canonical capability request format (internal model)
 * @typedef {Object} CanonicalCapabilityRequest
 * @property {string} type - Capability type (network, filesystem, environment, etc.)
 * @property {Object} params - Capability-specific parameters
 * @property {string} [justification] - Human-readable justification
 * @property {'v2'|'legacy'} source - Format source for tracking
 */

/**
 * Legacy capability mapping to structured format
 */
const LEGACY_CAPABILITY_MAP = {
  // Text capabilities
  'text.generate': {
    type: 'text.generate',
    params: {},
    justification: 'Legacy text generation capability'
  },
  'text.embed': {
    type: 'text.embed',
    params: {},
    justification: 'Legacy text embedding capability'
  },
  
  // Image capabilities  
  'image.generate': {
    type: 'image.generate',
    params: {},
    justification: 'Legacy image generation capability'
  },
  'image.analyze': {
    type: 'image.analyze',
    params: {},
    justification: 'Legacy image analysis capability'
  },
  
  // Audio capabilities
  'audio.transcribe': {
    type: 'audio.transcribe',
    params: {},
    justification: 'Legacy audio transcription capability'
  },
  'audio.synthesize': {
    type: 'audio.synthesize',
    params: {},
    justification: 'Legacy audio synthesis capability'
  },
  
  // Moderation and search
  'moderate.content': {
    type: 'moderate.content',
    params: {},
    justification: 'Legacy content moderation capability'
  },
  'search.web': {
    type: 'search.web',
    params: {},
    justification: 'Legacy web search capability'
  },
  'search.semantic': {
    type: 'search.semantic',
    params: {},
    justification: 'Legacy semantic search capability'
  },
  
  // API and authentication
  'api.generic': {
    type: 'api.generic',
    params: {},
    justification: 'Legacy generic API capability'
  },
  'auth.oauth2': {
    type: 'auth.oauth2',
    params: {},
    justification: 'Legacy OAuth2 authentication capability'
  },
  'auth.api_key': {
    type: 'auth.api_key',
    params: {},
    justification: 'Legacy API key authentication capability'
  },
  
  // Special capabilities that map to structured requests
  'streaming': {
    type: 'response.stream',
    params: { mode: 'event' },
    justification: 'Legacy streaming support converted to structured response streaming',
    prerequisites: ['response']
  },
  'batch_processing': {
    type: 'compute.batch',
    params: { mode: 'async' },
    justification: 'Legacy batch processing converted to structured compute capability'
  }
};

class CapabilityNormalizer {
  constructor() {
    this.stats = {
      legacySeen: 0,
      v2Seen: 0,
      conflicts: 0,
      unknownLegacy: 0,
      autoDefaults: 0
    };
  }

  /**
   * Normalize capabilities from manifest to canonical format
   * @param {Object} manifest - Provider manifest
   * @returns {CanonicalCapabilityRequest[]} Normalized capabilities
   */
  normalizeCapabilities(manifest) {
    const pluginId = manifest.id || 'unknown';
    
    // Check for both formats present (conflict detection)
    const hasLegacy = manifest.capabilities && Array.isArray(manifest.capabilities);
    const hasV2 = manifest.capabilitiesV2 && Array.isArray(manifest.capabilitiesV2);
    
    let normalized = [];
    
    if (hasLegacy && hasV2) {
      this.stats.conflicts++;
      recordPluginEvent(pluginId, 'capabilities_conflict', {
        legacy_count: manifest.capabilities.length,
        v2_count: manifest.capabilitiesV2.length
      });
      
      // Prefer v2 format per GPT-5 guidance
      normalized = this.normalizeV2Capabilities(manifest.capabilitiesV2, pluginId);
    } else if (hasV2) {
      this.stats.v2Seen++;
      normalized = this.normalizeV2Capabilities(manifest.capabilitiesV2, pluginId);
    } else if (hasLegacy) {
      this.stats.legacySeen++;
      normalized = this.normalizeLegacyCapabilities(manifest.capabilities, pluginId);
    } else {
      // No capabilities specified
      return [];
    }
    
    // Compute prerequisite closure
    return this.computePrerequisiteClosure(normalized, pluginId);
  }

  /**
   * Normalize v2 structured capabilities
   * @param {Object[]} capabilitiesV2 - V2 capability objects
   * @param {string} pluginId - Plugin identifier
   * @returns {CanonicalCapabilityRequest[]}
   */
  normalizeV2Capabilities(capabilitiesV2, pluginId) {
    return capabilitiesV2.map(cap => {
      const canonical = {
        type: cap.type,
        params: cap.params || {},
        justification: cap.justification || `V2 capability: ${cap.type}`,
        source: 'v2'
      };
      
      recordPluginEvent(pluginId, 'capability_v2_normalized', {
        type: cap.type,
        has_params: Object.keys(canonical.params).length > 0,
        has_justification: !!cap.justification
      });
      
      return canonical;
    });
  }

  /**
   * Normalize legacy string capabilities
   * @param {string[]} capabilities - Legacy capability strings
   * @param {string} pluginId - Plugin identifier
   * @returns {CanonicalCapabilityRequest[]}
   */
  normalizeLegacyCapabilities(capabilities, pluginId) {
    return capabilities.map(capString => {
      const mapping = LEGACY_CAPABILITY_MAP[capString];
      
      if (mapping) {
        const canonical = {
          ...mapping,
          source: 'legacy'
        };
        
        recordPluginEvent(pluginId, 'capability_legacy_normalized', {
          legacy_string: capString,
          mapped_type: canonical.type,
          has_params: Object.keys(canonical.params).length > 0
        });
        
        return canonical;
      } else {
        // Unknown legacy capability
        this.stats.unknownLegacy++;
        
        const canonical = {
          type: capString,
          params: {},
          justification: `Legacy unknown capability: ${capString}`,
          source: 'legacy'
        };
        
        recordPluginEvent(pluginId, 'capability_legacy_unknown', {
          unknown_capability: capString
        });
        
        return canonical;
      }
    });
  }

  /**
   * Compute prerequisite closure for capabilities
   * @param {CanonicalCapabilityRequest[]} capabilities - Normalized capabilities
   * @param {string} pluginId - Plugin identifier
   * @returns {CanonicalCapabilityRequest[]} Capabilities with prerequisites included
   */
  computePrerequisiteClosure(capabilities, pluginId) {
    const capabilityMap = new Map();
    const toProcess = [...capabilities];
    
    // Process capabilities and their prerequisites
    while (toProcess.length > 0) {
      const capability = toProcess.shift();
      const key = capability.type;
      
      // Skip if already processed
      if (capabilityMap.has(key)) {
        continue;
      }
      
      // Add to map
      capabilityMap.set(key, capability);
      
      // Check for prerequisites in legacy mapping
      const legacyMapping = Object.values(LEGACY_CAPABILITY_MAP).find(
        mapping => mapping.type === capability.type
      );
      
      if (legacyMapping?.prerequisites) {
        for (const prerequisite of legacyMapping.prerequisites) {
          // Create canonical capability for prerequisite
          const prereqCapability = {
            type: prerequisite,
            params: {},
            justification: `Prerequisite for ${capability.type}`,
            source: 'prerequisite'
          };
          
          toProcess.push(prereqCapability);
          
          recordPluginEvent(pluginId, 'capability_prerequisite_added', {
            child: capability.type,
            prerequisite: prerequisite
          });
        }
      }
    }
    
    // Return capabilities in deterministic order
    const result = Array.from(capabilityMap.values()).sort((a, b) => 
      a.type.localeCompare(b.type)
    );
    
    recordPluginEvent(pluginId, 'capability_closure_computed', {
      input_count: capabilities.length,
      output_count: result.length,
      prerequisites_added: result.length - capabilities.length
    });
    
    return result;
  }

  /**
   * Get normalization statistics
   * @returns {Object} Statistics about capability normalization
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset statistics (useful for testing)
   */
  resetStats() {
    this.stats = {
      legacySeen: 0,
      v2Seen: 0,
      conflicts: 0,
      unknownLegacy: 0,
      autoDefaults: 0
    };
  }

  /**
   * Check if a capability requires network access
   * @param {CanonicalCapabilityRequest} capability
   * @returns {boolean}
   */
  static requiresNetwork(capability) {
    const networkCapabilities = [
      'api.generic',
      'auth.oauth2',
      'auth.api_key',
      'search.web',
      'network'
    ];
    
    return networkCapabilities.includes(capability.type) || 
           capability.type.startsWith('network.');
  }

  /**
   * Check if a capability requires filesystem access
   * @param {CanonicalCapabilityRequest} capability
   * @returns {boolean}
   */
  static requiresFilesystem(capability) {
    const filesystemCapabilities = [
      'filesystem',
      'storage.local',
      'cache.filesystem'
    ];
    
    return filesystemCapabilities.includes(capability.type) ||
           capability.type.startsWith('filesystem.');
  }

  /**
   * Check if a capability requires environment access
   * @param {CanonicalCapabilityRequest} capability
   * @returns {boolean}
   */
  static requiresEnvironment(capability) {
    const environmentCapabilities = [
      'environment',
      'env.read',
      'env.write'
    ];
    
    return environmentCapabilities.includes(capability.type) ||
           capability.type.startsWith('environment.');
  }
}

module.exports = { 
  CapabilityNormalizer, 
  LEGACY_CAPABILITY_MAP 
};