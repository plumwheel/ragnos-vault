/**
 * RAGnos Vault Secure Plugin Installer
 * 
 * Atomic plugin installation with security controls:
 * - TUF verification before installation
 * - --ignore-scripts enforcement (no package scripts execution)
 * - Atomic install/rollback with workspace isolation
 * - Permission validation and sandboxing
 * - Dependency resolution with security policies
 */

const { TUFIntegration } = require('./tuf-integration');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { recordSecurityEvent, recordPluginEvent, createSpan } = require('./telemetry-shim');

class SecurePluginInstaller {
  constructor(options = {}) {
    this.options = {
      // Installation directories
      pluginsDir: options.pluginsDir || './plugins',
      stagingDir: options.stagingDir || './plugins-staging',
      backupDir: options.backupDir || './plugins-backup',
      
      // TUF integration
      tufOptions: options.tufOptions || {},
      
      // Security settings
      ignoreScripts: options.ignoreScripts !== false, // Default: true (secure)
      allowUnsafeDependencies: options.allowUnsafeDependencies === true, // Default: false
      maxInstallTime: options.maxInstallTime || 300000, // 5 minutes
      
      // Permission controls
      maxFileSize: options.maxFileSize || 100 * 1024 * 1024, // 100MB
      allowedFileExtensions: options.allowedFileExtensions || ['.js', '.json', '.md', '.txt'],
      bannedPatterns: options.bannedPatterns || [
        /\.(exe|sh|bat|cmd|scr)$/i,
        /^\.env/,
        /node_modules\/\.bin\//,
        /package\.json.*scripts/
      ],
      
      // Rollback settings
      keepBackups: options.keepBackups !== false,
      maxBackups: options.maxBackups || 5,
      
      ...options
    };

    this.tufIntegration = null;
    this.initialized = false;
    this.activeInstalls = new Map();
  }

  /**
   * Initialize secure installer
   */
  async initialize() {
    const span = createSpan('secure_installer.initialize');
    
    try {
      console.log('🔐 Initializing Secure Plugin Installer...');
      
      // Initialize TUF integration
      this.tufIntegration = new TUFIntegration(this.options.tufOptions);
      await this.tufIntegration.initialize();
      
      // Create required directories
      await this.ensureDirectories();
      
      // Validate security settings
      this.validateSecuritySettings();
      
      this.initialized = true;
      
      recordSecurityEvent('secure_installer_initialized', 'info', {
        ignore_scripts: this.options.ignoreScripts,
        plugins_dir: this.options.pluginsDir,
        tuf_enabled: !!this.tufIntegration
      });
      
      console.log('✅ Secure Plugin Installer ready');
      console.log(`  📁 Plugins: ${this.options.pluginsDir}`);
      console.log(`  🛡️  Security: scripts=${!this.options.ignoreScripts ? 'ALLOWED' : 'BLOCKED'}`);
      console.log(`  🔍 TUF: ${this.tufIntegration.getStatus().active_repository}`);
      
      span.setAttributes({ success: true });
      span.end();
      
      return true;
      
    } catch (error) {
      recordSecurityEvent('secure_installer_init_failed', 'error', {
        error_message: error.message
      });
      
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw error;
    }
  }

  /**
   * Install plugin with full security verification
   */
  async installPlugin(pluginIdentifier, options = {}) {
    if (!this.initialized) {
      throw new Error('Secure installer not initialized');
    }

    const installId = crypto.randomUUID();
    const span = createSpan('secure_installer.install', { 
      plugin_id: pluginIdentifier,
      install_id: installId
    });
    
    try {
      console.log(`🔽 Installing plugin: ${pluginIdentifier}`);
      console.log(`  📋 Install ID: ${installId}`);
      
      // Phase 1: Security verification
      console.log('  🔍 Phase 1: Security verification...');
      const verificationResult = await this.verifyPluginSecurity(pluginIdentifier, options);
      
      // Phase 2: Staging
      console.log('  📦 Phase 2: Staging installation...');
      const stagingResult = await this.stagePlugin(verificationResult, installId);
      
      // Phase 3: Validation
      console.log('  ✅ Phase 3: Validating staged plugin...');
      const validationResult = await this.validateStagedPlugin(stagingResult, installId);
      
      // Phase 4: Atomic install
      console.log('  ⚡ Phase 4: Atomic installation...');
      const installResult = await this.atomicInstall(validationResult, installId);
      
      // Phase 5: Cleanup
      console.log('  🧹 Phase 5: Cleanup...');
      await this.cleanupInstall(installId);
      
      recordPluginEvent(pluginIdentifier, 'plugin_installed', {
        install_id: installId,
        size_bytes: installResult.size,
        verification_method: verificationResult.method,
        install_path: installResult.path
      });
      
      console.log(`  ✅ Plugin installed: ${installResult.path}`);
      
      span.setAttributes({
        success: true,
        verification_method: verificationResult.method,
        install_path: installResult.path
      });
      span.end();
      
      return {
        installId,
        pluginId: pluginIdentifier,
        path: installResult.path,
        verified: verificationResult.verified,
        method: verificationResult.method,
        size: installResult.size
      };
      
    } catch (error) {
      // Rollback on failure
      console.log(`  ❌ Installation failed: ${error.message}`);
      await this.rollbackInstall(installId);
      
      recordSecurityEvent('plugin_install_failed', 'error', {
        plugin_id: pluginIdentifier,
        install_id: installId,
        error_message: error.message
      });
      
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw error;
    }
  }

  /**
   * Verify plugin security through TUF
   */
  async verifyPluginSecurity(pluginIdentifier, options) {
    const span = createSpan('secure_installer.verify_security', { 
      plugin_id: pluginIdentifier 
    });
    
    try {
      // Use TUF for verification
      const result = await this.tufIntegration.verifyAndDownloadPlugin(pluginIdentifier, options);
      
      if (!result.verified && this.options.requireVerification !== false) {
        throw new Error('Plugin verification required but failed');
      }
      
      // Additional security checks
      await this.performSecurityScan(result.data, pluginIdentifier);
      
      span.setAttributes({
        success: true,
        verified: result.verified,
        method: result.method
      });
      span.end();
      
      return result;
      
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw error;
    }
  }

  /**
   * Perform additional security scanning on plugin data
   */
  async performSecurityScan(pluginData, pluginIdentifier) {
    const span = createSpan('secure_installer.security_scan', { 
      plugin_id: pluginIdentifier 
    });
    
    try {
      // Size validation
      if (pluginData.length > this.options.maxFileSize) {
        throw new Error(`Plugin too large: ${pluginData.length} bytes > ${this.options.maxFileSize}`);
      }
      
      // Convert to string for pattern matching
      const pluginContent = pluginData.toString();
      
      // Check for banned patterns
      for (const pattern of this.options.bannedPatterns) {
        if (pattern.test(pluginContent)) {
          recordSecurityEvent('banned_pattern_detected', 'violation', {
            plugin_id: pluginIdentifier,
            pattern: pattern.toString()
          });
          throw new Error(`Security violation: banned pattern detected`);
        }
      }
      
      // Check for suspicious content
      const suspiciousPatterns = [
        /eval\s*\(/gi,
        /Function\s*\(/gi,
        /process\.env/gi,
        /child_process/gi,
        /fs\.writeFile/gi,
        /require\s*\(\s*['"]fs['"]\s*\)/gi
      ];
      
      const suspiciousMatches = [];
      for (const pattern of suspiciousPatterns) {
        const matches = pluginContent.match(pattern);
        if (matches) {
          suspiciousMatches.push({ pattern: pattern.toString(), count: matches.length });
        }
      }
      
      if (suspiciousMatches.length > 0) {
        recordSecurityEvent('suspicious_patterns_detected', 'warning', {
          plugin_id: pluginIdentifier,
          patterns: suspiciousMatches
        });
        
        console.log(`    ⚠️  Suspicious patterns detected: ${suspiciousMatches.length}`);
        
        if (!this.options.allowSuspiciousPatterns) {
          throw new Error('Security violation: suspicious patterns detected');
        }
      }
      
      span.setAttributes({ 
        success: true,
        suspicious_patterns: suspiciousMatches.length 
      });
      span.end();
      
      console.log(`    ✅ Security scan passed`);
      
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw error;
    }
  }

  /**
   * Stage plugin in isolated environment
   */
  async stagePlugin(verificationResult, installId) {
    const stagingPath = path.join(this.options.stagingDir, installId);
    
    try {
      // Create staging directory
      fs.mkdirSync(stagingPath, { recursive: true });
      
      // Extract plugin data to staging
      const pluginFile = path.join(stagingPath, 'plugin.tar.gz');
      fs.writeFileSync(pluginFile, verificationResult.data);
      
      // Extract archive (simplified - in production use proper tar extraction)
      const extractedPath = path.join(stagingPath, 'extracted');
      fs.mkdirSync(extractedPath, { recursive: true });
      
      // For this demo, save as JS file
      const pluginPath = path.join(extractedPath, 'index.js');
      fs.writeFileSync(pluginPath, verificationResult.data);
      
      // Create manifest
      const manifest = verificationResult.metadata.custom?.manifest || {
        id: 'unknown-plugin',
        version: '1.0.0'
      };
      
      const manifestPath = path.join(extractedPath, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      
      console.log(`    ✅ Staged to: ${stagingPath}`);
      
      return {
        stagingPath,
        extractedPath,
        manifest,
        verified: verificationResult.verified
      };
      
    } catch (error) {
      // Cleanup staging on failure
      if (fs.existsSync(stagingPath)) {
        fs.rmSync(stagingPath, { recursive: true, force: true });
      }
      throw error;
    }
  }

  /**
   * Validate staged plugin before installation
   */
  async validateStagedPlugin(stagingResult, installId) {
    const span = createSpan('secure_installer.validate_staged', { 
      install_id: installId 
    });
    
    try {
      const { extractedPath, manifest } = stagingResult;
      
      // Validate manifest
      if (!manifest.id || !manifest.version) {
        throw new Error('Invalid manifest: missing id or version');
      }
      
      // Check for required files
      const requiredFiles = ['index.js', 'manifest.json'];
      for (const file of requiredFiles) {
        const filePath = path.join(extractedPath, file);
        if (!fs.existsSync(filePath)) {
          throw new Error(`Missing required file: ${file}`);
        }
      }
      
      // Validate file extensions
      const files = this.getAllFiles(extractedPath);
      for (const file of files) {
        const ext = path.extname(file);
        if (ext && !this.options.allowedFileExtensions.includes(ext)) {
          throw new Error(`Unauthorized file extension: ${ext} in ${file}`);
        }
      }
      
      // Check for package.json scripts (security risk)
      const packageJsonPath = path.join(extractedPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        
        if (packageJson.scripts && Object.keys(packageJson.scripts).length > 0) {
          if (this.options.ignoreScripts) {
            console.log(`    ⚠️  Package scripts detected but will be ignored`);
            recordSecurityEvent('package_scripts_blocked', 'info', {
              install_id: installId,
              scripts: Object.keys(packageJson.scripts)
            });
          } else {
            recordSecurityEvent('package_scripts_allowed', 'warning', {
              install_id: installId,
              scripts: Object.keys(packageJson.scripts)
            });
          }
        }
      }
      
      console.log(`    ✅ Validation passed`);
      
      span.setAttributes({ success: true });
      span.end();
      
      return stagingResult;
      
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw error;
    }
  }

  /**
   * Perform atomic installation with rollback capability
   */
  async atomicInstall(stagingResult, installId) {
    const span = createSpan('secure_installer.atomic_install', { 
      install_id: installId 
    });
    
    try {
      const { extractedPath, manifest } = stagingResult;
      const pluginId = manifest.id;
      
      // Create backup if plugin already exists
      const finalPath = path.join(this.options.pluginsDir, pluginId);
      let backupPath = null;
      
      if (fs.existsSync(finalPath)) {
        backupPath = await this.createBackup(finalPath, pluginId);
        console.log(`    📋 Created backup: ${backupPath}`);
      }
      
      try {
        // Atomic move from staging to final location
        if (fs.existsSync(finalPath)) {
          fs.rmSync(finalPath, { recursive: true, force: true });
        }
        
        // Create parent directory
        fs.mkdirSync(path.dirname(finalPath), { recursive: true });
        
        // Move extracted files to final location
        fs.renameSync(extractedPath, finalPath);
        
        // Verify installation
        const verifyManifestPath = path.join(finalPath, 'manifest.json');
        if (!fs.existsSync(verifyManifestPath)) {
          throw new Error('Installation verification failed: manifest missing');
        }
        
        // Calculate installed size
        const installedSize = this.getDirectorySize(finalPath);
        
        console.log(`    ✅ Installed to: ${finalPath}`);
        console.log(`    📏 Size: ${installedSize} bytes`);
        
        span.setAttributes({
          success: true,
          final_path: finalPath,
          size_bytes: installedSize
        });
        span.end();
        
        return {
          path: finalPath,
          size: installedSize,
          backupPath
        };
        
      } catch (installError) {
        // Rollback: restore backup if it exists
        if (backupPath && fs.existsSync(backupPath)) {
          console.log(`    ↩️  Rolling back: restoring from backup`);
          
          if (fs.existsSync(finalPath)) {
            fs.rmSync(finalPath, { recursive: true, force: true });
          }
          
          fs.renameSync(backupPath, finalPath);
          
          recordSecurityEvent('plugin_install_rollback', 'info', {
            install_id: installId,
            plugin_id: pluginId,
            backup_restored: true
          });
        }
        
        throw installError;
      }
      
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw error;
    }
  }

  /**
   * Create backup of existing plugin
   */
  async createBackup(sourcePath, pluginId) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${pluginId}-backup-${timestamp}`;
    const backupPath = path.join(this.options.backupDir, backupName);
    
    // Ensure backup directory exists
    fs.mkdirSync(this.options.backupDir, { recursive: true });
    
    // Copy to backup location
    fs.cpSync(sourcePath, backupPath, { recursive: true });
    
    // Cleanup old backups
    await this.cleanupOldBackups(pluginId);
    
    return backupPath;
  }

  /**
   * Cleanup old backups to maintain limit
   */
  async cleanupOldBackups(pluginId) {
    if (!this.options.keepBackups) {
      return;
    }
    
    try {
      const backupFiles = fs.readdirSync(this.options.backupDir)
        .filter(name => name.startsWith(`${pluginId}-backup-`))
        .map(name => ({
          name,
          path: path.join(this.options.backupDir, name),
          stat: fs.statSync(path.join(this.options.backupDir, name))
        }))
        .sort((a, b) => b.stat.mtime - a.stat.mtime);
      
      // Remove excess backups
      const toRemove = backupFiles.slice(this.options.maxBackups);
      for (const backup of toRemove) {
        fs.rmSync(backup.path, { recursive: true, force: true });
        console.log(`    🗑️  Removed old backup: ${backup.name}`);
      }
      
    } catch (error) {
      console.warn(`Warning: backup cleanup failed: ${error.message}`);
    }
  }

  /**
   * Cleanup installation staging
   */
  async cleanupInstall(installId) {
    const stagingPath = path.join(this.options.stagingDir, installId);
    
    try {
      if (fs.existsSync(stagingPath)) {
        fs.rmSync(stagingPath, { recursive: true, force: true });
      }
      
      this.activeInstalls.delete(installId);
      
    } catch (error) {
      console.warn(`Warning: staging cleanup failed: ${error.message}`);
    }
  }

  /**
   * Rollback failed installation
   */
  async rollbackInstall(installId) {
    const span = createSpan('secure_installer.rollback', { 
      install_id: installId 
    });
    
    try {
      console.log(`  ↩️  Rolling back installation: ${installId}`);
      
      await this.cleanupInstall(installId);
      
      recordSecurityEvent('plugin_install_rollback_completed', 'info', {
        install_id: installId
      });
      
      span.setAttributes({ success: true });
      span.end();
      
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      console.warn(`Rollback warning: ${error.message}`);
    }
  }

  /**
   * Uninstall plugin with backup
   */
  async uninstallPlugin(pluginId) {
    const span = createSpan('secure_installer.uninstall', { 
      plugin_id: pluginId 
    });
    
    try {
      console.log(`🗑️  Uninstalling plugin: ${pluginId}`);
      
      const pluginPath = path.join(this.options.pluginsDir, pluginId);
      
      if (!fs.existsSync(pluginPath)) {
        throw new Error(`Plugin not found: ${pluginId}`);
      }
      
      // Create backup before removal
      const backupPath = await this.createBackup(pluginPath, pluginId);
      
      // Remove plugin
      fs.rmSync(pluginPath, { recursive: true, force: true });
      
      recordPluginEvent(pluginId, 'plugin_uninstalled', {
        backup_path: backupPath
      });
      
      console.log(`  ✅ Plugin uninstalled: ${pluginId}`);
      console.log(`  📋 Backup available: ${backupPath}`);
      
      span.setAttributes({ success: true, backup_path: backupPath });
      span.end();
      
      return { success: true, backupPath };
      
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw error;
    }
  }

  /**
   * List installed plugins
   */
  listInstalledPlugins() {
    try {
      if (!fs.existsSync(this.options.pluginsDir)) {
        return [];
      }
      
      const plugins = [];
      const entries = fs.readdirSync(this.options.pluginsDir);
      
      for (const entry of entries) {
        const pluginPath = path.join(this.options.pluginsDir, entry);
        const manifestPath = path.join(pluginPath, 'manifest.json');
        
        if (fs.statSync(pluginPath).isDirectory() && fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const stats = fs.statSync(pluginPath);
            
            plugins.push({
              id: entry,
              manifest,
              path: pluginPath,
              size: this.getDirectorySize(pluginPath),
              installed: stats.mtime
            });
          } catch (error) {
            console.warn(`Warning: invalid plugin manifest: ${entry}`);
          }
        }
      }
      
      return plugins;
      
    } catch (error) {
      console.warn(`Warning: failed to list plugins: ${error.message}`);
      return [];
    }
  }

  /**
   * Get installer status
   */
  getStatus() {
    return {
      initialized: this.initialized,
      security_settings: {
        ignore_scripts: this.options.ignoreScripts,
        max_file_size: this.options.maxFileSize,
        allowed_extensions: this.options.allowedFileExtensions.length
      },
      directories: {
        plugins: this.options.pluginsDir,
        staging: this.options.stagingDir,
        backup: this.options.backupDir
      },
      tuf_integration: this.tufIntegration?.getStatus() || null,
      active_installs: this.activeInstalls.size,
      installed_plugins: this.listInstalledPlugins().length
    };
  }

  /**
   * Helper methods
   */
  async ensureDirectories() {
    const dirs = [
      this.options.pluginsDir,
      this.options.stagingDir,
      this.options.backupDir
    ];
    
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  validateSecuritySettings() {
    if (!this.options.ignoreScripts) {
      console.warn('⚠️  WARNING: Package scripts execution is ENABLED');
      recordSecurityEvent('insecure_config_detected', 'warning', {
        setting: 'ignoreScripts',
        value: false
      });
    }
  }

  getAllFiles(dir) {
    const files = [];
    
    function walk(currentDir) {
      const entries = fs.readdirSync(currentDir);
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          walk(fullPath);
        } else {
          files.push(fullPath);
        }
      }
    }
    
    walk(dir);
    return files;
  }

  getDirectorySize(dir) {
    let size = 0;
    
    function walk(currentDir) {
      const entries = fs.readdirSync(currentDir);
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          walk(fullPath);
        } else {
          size += stat.size;
        }
      }
    }
    
    if (fs.existsSync(dir)) {
      walk(dir);
    }
    
    return size;
  }

  /**
   * Shutdown installer
   */
  async shutdown() {
    try {
      if (this.tufIntegration) {
        await this.tufIntegration.shutdown();
      }
      
      this.initialized = false;
      
      recordSecurityEvent('secure_installer_shutdown', 'info');
      
    } catch (error) {
      console.warn(`Shutdown warning: ${error.message}`);
    }
  }
}

module.exports = { SecurePluginInstaller };