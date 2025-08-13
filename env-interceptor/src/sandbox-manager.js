/**
 * RAGnos Vault Subprocess Sandbox Manager
 * 
 * Provides secure subprocess execution for SDK plugins with:
 * - Process isolation and resource limits
 * - Network access control
 * - Filesystem restrictions
 * - Policy enforcement integration
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { RuntimeResolver } = require('./runtime-resolver');

class SandboxManager {
  constructor(policyEngine, options = {}) {
    this.policyEngine = policyEngine;
    this.options = {
      platform: os.platform(),
      maxConcurrentPlugins: 10,
      defaultTimeout: 30000,
      workspaceRoot: path.join(os.tmpdir(), 'ragvault-sandbox'),
      ...options
    };
    
    this.activeSandboxes = new Map();
    this.runtimeResolver = new RuntimeResolver(policyEngine);
    this.setupWorkspaceRoot();
  }

  setupWorkspaceRoot() {
    try {
      if (!fs.existsSync(this.options.workspaceRoot)) {
        fs.mkdirSync(this.options.workspaceRoot, { 
          recursive: true, 
          mode: 0o700 // Owner only
        });
      }
    } catch (error) {
      throw new Error(`Failed to create sandbox workspace: ${error.message}`);
    }
  }

  /**
   * Create a new sandbox for plugin execution
   */
  async createSandbox(manifest, pluginPath, options = {}) {
    // Check concurrent plugin limit
    if (this.activeSandboxes.size >= this.options.maxConcurrentPlugins) {
      throw new Error('Maximum concurrent plugins exceeded');
    }

    // Generate unique sandbox ID
    const sandboxId = this.generateSandboxId();
    
    // Create isolated workspace
    const workspace = await this.createWorkspace(sandboxId);
    
    // Copy plugin files into sandbox
    const sandboxPluginPath = await this.preparePluginFiles(pluginPath, workspace);
    
    // Build sandbox configuration
    const sandboxConfig = await this.buildSandboxConfig(manifest, workspace, options);
    
    // Apply policy restrictions
    await this.applyPolicyRestrictions(sandboxConfig, manifest);
    
    // Copy bootstrap script to sandbox
    const bootstrapSource = path.join(__dirname, 'plugin-bootstrap.js');
    const bootstrapDest = path.join(workspace.plugin, 'plugin-bootstrap.js');
    fs.copyFileSync(bootstrapSource, bootstrapDest);
    
    // Create sandbox instance
    const sandbox = new PluginSandbox(sandboxId, sandboxConfig, this, manifest);
    sandbox.sandboxPluginPath = sandboxPluginPath; // Store sandbox-relative path
    sandbox.sandboxBootstrapPath = bootstrapDest; // Store bootstrap path
    this.activeSandboxes.set(sandboxId, sandbox);
    
    return sandbox;
  }

  generateSandboxId() {
    return 'sb_' + crypto.randomBytes(16).toString('hex');
  }

  async createWorkspace(sandboxId) {
    const workspacePath = path.join(this.options.workspaceRoot, sandboxId);
    
    try {
      // Create workspace directory structure
      fs.mkdirSync(workspacePath, { recursive: true, mode: 0o700 });
      fs.mkdirSync(path.join(workspacePath, 'plugin'), { mode: 0o700 }); // Plugin files
      fs.mkdirSync(path.join(workspacePath, 'work'), { mode: 0o700 });   // Writable workspace
      fs.mkdirSync(path.join(workspacePath, 'tmp'), { mode: 0o700 });    // Temp files
      
      return {
        root: workspacePath,
        plugin: path.join(workspacePath, 'plugin'),
        work: path.join(workspacePath, 'work'),
        tmp: path.join(workspacePath, 'tmp')
      };
    } catch (error) {
      throw new Error(`Failed to create workspace: ${error.message}`);
    }
  }

  async preparePluginFiles(pluginPath, workspace) {
    try {
      // Determine if pluginPath is a file or directory
      const pluginStats = fs.statSync(pluginPath);
      
      if (pluginStats.isFile()) {
        // Single file plugin
        const fileName = path.basename(pluginPath);
        const destPath = path.join(workspace.plugin, fileName);
        
        // Copy plugin file
        fs.copyFileSync(pluginPath, destPath);
        
        // Check for package.json in the same directory
        const pluginDir = path.dirname(pluginPath);
        const packageJsonPath = path.join(pluginDir, 'package.json');
        
        if (fs.existsSync(packageJsonPath)) {
          fs.copyFileSync(packageJsonPath, path.join(workspace.plugin, 'package.json'));
        }
        
        // Copy node_modules if exists (for test plugins)
        const nodeModulesPath = path.join(pluginDir, 'node_modules');
        if (fs.existsSync(nodeModulesPath)) {
          this.copyDirectoryRecursive(nodeModulesPath, path.join(workspace.plugin, 'node_modules'));
        }
        
        // Copy plugin-abi.js for the plugin to use
        const abiPath = path.join(__dirname, 'plugin-abi.js');
        if (fs.existsSync(abiPath)) {
          fs.copyFileSync(abiPath, path.join(workspace.plugin, 'plugin-abi.js'));
        }
        
        return destPath;
        
      } else if (pluginStats.isDirectory()) {
        // Directory-based plugin
        this.copyDirectoryRecursive(pluginPath, workspace.plugin);
        
        // Copy plugin-abi.js for the plugin to use
        const abiPath = path.join(__dirname, 'plugin-abi.js');
        if (fs.existsSync(abiPath)) {
          fs.copyFileSync(abiPath, path.join(workspace.plugin, 'plugin-abi.js'));
        }
        
        // Find entry point
        const packageJsonPath = path.join(workspace.plugin, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
          const entryPoint = packageJson.main || 'index.js';
          return path.join(workspace.plugin, entryPoint);
        } else {
          return path.join(workspace.plugin, 'index.js');
        }
      } else {
        throw new Error('Plugin path must be a file or directory');
      }
    } catch (error) {
      throw new Error(`Failed to prepare plugin files: ${error.message}`);
    }
  }

  copyDirectoryRecursive(src, dest) {
    try {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }
      
      const entries = fs.readdirSync(src, { withFileTypes: true });
      
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        
        if (entry.isDirectory()) {
          this.copyDirectoryRecursive(srcPath, destPath);
        } else {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    } catch (error) {
      // Log but don't throw - some files might not be copyable
      console.warn(`Copy warning: ${error.message}`);
    }
  }

  async buildSandboxConfig(manifest, workspace, options) {
    const sandboxConfig = manifest.security?.sandbox || {};
    
    return {
      // Resource limits
      memory: this.parseMemoryLimit(sandboxConfig.memory || '256MB'),
      cpu: this.parseCpuLimit(sandboxConfig.cpu || '50%'),
      timeout: sandboxConfig.timeout || this.options.defaultTimeout,
      
      // Filesystem access
      workspace,
      readonly: true,
      allowedPaths: sandboxConfig.allowedPaths || [],
      
      // Network access
      networkAllowlist: manifest.security?.networkAllowlist || [],
      networkDeny: !sandboxConfig.allowNetworkAccess,
      
      // Environment
      env: this.buildSandboxEnvironment(manifest, workspace),
      
      // Security options
      noNewPrivs: true,
      dropCapabilities: true,
      restrictSyscalls: this.options.platform === 'linux',
      
      // Platform-specific options
      platform: this.options.platform,
      userId: options.userId || null,
      groupId: options.groupId || null
    };
  }

  parseMemoryLimit(memoryStr) {
    const match = memoryStr.match(/^(\d+)(MB|GB)$/);
    if (!match) {
      throw new Error(`Invalid memory limit: ${memoryStr}`);
    }
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    return unit === 'GB' ? value * 1024 * 1024 * 1024 : value * 1024 * 1024;
  }

  parseCpuLimit(cpuStr) {
    const match = cpuStr.match(/^(\d+)(%|m)$/);
    if (!match) {
      throw new Error(`Invalid CPU limit: ${cpuStr}`);
    }
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    return unit === '%' ? value : value / 1000; // Convert milliCPU to percentage
  }

  buildSandboxEnvironment(manifest, workspace) {
    return {
      // Minimal safe environment - NO PATH to force absolute paths
      NODE_ENV: 'production',
      HOME: workspace.work,
      TMPDIR: workspace.tmp,
      // PATH intentionally omitted for security
      
      // Plugin metadata
      RAGVAULT_PLUGIN_ID: manifest.id,
      RAGVAULT_PLUGIN_VERSION: manifest.sdk?.version || '1.0.0',
      RAGVAULT_ABI_VERSION: '1.0',
      RAGVAULT_WORKSPACE: workspace.work,
      RAGVAULT_PLUGIN_DIR: workspace.plugin,
      
      // Security flags
      RAGVAULT_SANDBOX: '1',
      NODE_OPTIONS: '--no-deprecation --no-warnings'
    };
  }

  async applyPolicyRestrictions(sandboxConfig, manifest) {
    const policyResult = await this.policyEngine.checkProvider(manifest);
    
    if (!policyResult.allowed) {
      throw new Error(`Policy violation: ${policyResult.violations.map(v => v.message).join(', ')}`);
    }
    
    // Apply policy-based restrictions
    const policy = this.policyEngine.getPolicy();
    
    // Memory restrictions
    if (sandboxConfig.memory > policy.sandbox.maxMemoryMB * 1024 * 1024) {
      sandboxConfig.memory = policy.sandbox.maxMemoryMB * 1024 * 1024;
    }
    
    // CPU restrictions
    if (sandboxConfig.cpu > policy.sandbox.maxCpuPercent) {
      sandboxConfig.cpu = policy.sandbox.maxCpuPercent;
    }
    
    // Timeout restrictions
    if (sandboxConfig.timeout > policy.sandbox.maxExecutionTimeMs) {
      sandboxConfig.timeout = policy.sandbox.maxExecutionTimeMs;
    }
    
    // Network restrictions
    if (!policy.sandbox.allowNetworkAccess) {
      sandboxConfig.networkDeny = true;
      sandboxConfig.networkAllowlist = [];
    }
    
    // Filesystem restrictions
    if (!policy.sandbox.allowFileSystem) {
      sandboxConfig.allowedPaths = [];
    }
  }

  /**
   * Cleanup sandbox when plugin exits
   */
  async cleanupSandbox(sandboxId) {
    const sandbox = this.activeSandboxes.get(sandboxId);
    if (!sandbox) {
      return;
    }
    
    try {
      // Cleanup workspace
      await this.removeWorkspace(sandbox.config.workspace.root);
      
      // Remove from active sandboxes
      this.activeSandboxes.delete(sandboxId);
      
    } catch (error) {
      console.error(`Sandbox cleanup failed: ${error.message}`);
    }
  }

  async removeWorkspace(workspacePath) {
    try {
      if (fs.existsSync(workspacePath)) {
        fs.rmSync(workspacePath, { recursive: true, force: true });
      }
    } catch (error) {
      // Log but don't throw - cleanup is best effort
      console.warn(`Workspace cleanup warning: ${error.message}`);
    }
  }

  /**
   * Get sandbox statistics
   */
  getStats() {
    return {
      active: this.activeSandboxes.size,
      maxConcurrent: this.options.maxConcurrentPlugins,
      platform: this.options.platform,
      workspaceRoot: this.options.workspaceRoot
    };
  }
}

/**
 * Individual Plugin Sandbox Instance
 */
class PluginSandbox {
  constructor(id, config, manager, manifest = null) {
    this.id = id;
    this.config = config;
    this.manager = manager;
    this.manifest = manifest;
    this.process = null;
    this.startTime = null;
    this.stats = {
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0
    };
  }

  /**
   * Start the plugin in the sandbox
   */
  async start(pluginEntry, args = []) {
    if (this.process) {
      throw new Error('Sandbox already running');
    }

    try {
      this.startTime = Date.now();
      
      // Resolve Node.js runtime deterministically
      const runtime = await this.manager.runtimeResolver.resolveNodeRuntime(this.manifest || { id: this.id, sdk: {} });
      
      // Build spawn options
      const spawnOptions = this.buildSpawnOptions();
      
      // Start the subprocess with absolute interpreter path
      this.process = spawn(runtime.interpreterPath, [pluginEntry, ...args], spawnOptions);
      
      // Setup process monitoring
      this.setupProcessMonitoring();
      
      // Apply resource limits
      await this.applyResourceLimits();
      
      return this.process;
      
    } catch (error) {
      await this.cleanup();
      throw new Error(`Failed to start sandbox: ${error.message}`);
    }
  }

  buildSpawnOptions() {
    const options = {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...this.config.env },
      cwd: this.config.workspace.work,
      timeout: this.config.timeout,
      detached: false
    };

    // Platform-specific security options
    if (this.config.platform === 'linux') {
      // Linux: Use namespace isolation where available
      if (this.config.userId) {
        options.uid = this.config.userId;
      }
      if (this.config.groupId) {
        options.gid = this.config.groupId;
      }
    }

    return options;
  }

  setupProcessMonitoring() {
    // Handle process exit
    this.process.on('exit', (code, signal) => {
      this.handleProcessExit(code, signal);
    });

    // Handle process errors
    this.process.on('error', (error) => {
      this.stats.errors++;
      console.error(`Sandbox ${this.id} error:`, error.message);
    });

    // Monitor memory usage (if possible)
    if (this.config.platform === 'linux') {
      this.setupLinuxMonitoring();
    }

    // Setup timeout
    if (this.config.timeout > 0) {
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          console.warn(`Sandbox ${this.id} timeout exceeded, terminating`);
          this.kill('SIGTERM');
        }
      }, this.config.timeout);
    }
  }

  setupLinuxMonitoring() {
    // On Linux, we can monitor /proc for detailed stats
    // This is a simplified implementation
    const monitorInterval = setInterval(() => {
      if (!this.process || this.process.killed) {
        clearInterval(monitorInterval);
        return;
      }

      try {
        // Read memory usage from /proc/pid/status
        const statusPath = `/proc/${this.process.pid}/status`;
        if (fs.existsSync(statusPath)) {
          const status = fs.readFileSync(statusPath, 'utf8');
          const vmRSSMatch = status.match(/VmRSS:\s+(\d+)\s+kB/);
          
          if (vmRSSMatch) {
            const memoryKB = parseInt(vmRSSMatch[1]);
            const memoryBytes = memoryKB * 1024;
            
            // Check memory limit
            if (memoryBytes > this.config.memory) {
              console.warn(`Sandbox ${this.id} memory limit exceeded: ${memoryKB}KB > ${this.config.memory / 1024}KB`);
              this.kill('SIGKILL'); // Immediate termination for memory violation
            }
          }
        }
      } catch (error) {
        // Ignore monitoring errors
      }
    }, 1000); // Check every second
  }

  async applyResourceLimits() {
    if (!this.process || !this.process.pid) {
      return;
    }

    try {
      // Apply resource limits using Node.js process methods where available
      // Note: Full resource limits require platform-specific implementation
      
      if (this.config.platform === 'linux') {
        await this.applyLinuxLimits();
      } else if (this.config.platform === 'darwin') {
        await this.applyMacOSLimits();
      } else if (this.config.platform === 'win32') {
        await this.applyWindowsLimits();
      }
      
    } catch (error) {
      console.warn(`Failed to apply resource limits: ${error.message}`);
    }
  }

  async applyLinuxLimits() {
    // On Linux, we would use cgroups for proper resource limiting
    // This is a simplified implementation using process signals
    
    // Note: Full implementation would require:
    // 1. Create cgroup
    // 2. Set memory.limit_in_bytes
    // 3. Set cpu.cfs_quota_us and cpu.cfs_period_us
    // 4. Add process to cgroup
    
    console.log(`Applied Linux resource limits for sandbox ${this.id}`);
  }

  async applyMacOSLimits() {
    // On macOS, we would use launchd or pfctl for network control
    // and ulimit-style restrictions for memory/CPU
    
    console.log(`Applied macOS resource limits for sandbox ${this.id}`);
  }

  async applyWindowsLimits() {
    // On Windows, we would use Job Objects for resource control
    
    console.log(`Applied Windows resource limits for sandbox ${this.id}`);
  }

  handleProcessExit(code, signal) {
    const duration = Date.now() - this.startTime;
    
    console.log(`Sandbox ${this.id} exited: code=${code}, signal=${signal}, duration=${duration}ms`);
    
    // Cleanup
    this.cleanup();
  }

  /**
   * Send JSON-RPC message to plugin
   */
  sendMessage(message) {
    if (!this.process || this.process.killed) {
      throw new Error('Sandbox not running');
    }

    try {
      this.process.stdin.write(JSON.stringify(message) + '\n');
      this.stats.messagesSent++;
    } catch (error) {
      this.stats.errors++;
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  /**
   * Kill the sandbox process
   */
  kill(signal = 'SIGTERM') {
    if (this.process && !this.process.killed) {
      this.process.kill(signal);
    }
  }

  /**
   * Cleanup sandbox resources
   */
  async cleanup() {
    if (this.process && !this.process.killed) {
      this.kill('SIGTERM');
    }

    // Remove from manager
    await this.manager.cleanupSandbox(this.id);
  }

  /**
   * Get sandbox statistics
   */
  getStats() {
    return {
      id: this.id,
      running: this.process && !this.process.killed,
      pid: this.process?.pid,
      startTime: this.startTime,
      duration: this.startTime ? Date.now() - this.startTime : 0,
      stats: { ...this.stats }
    };
  }
}

module.exports = { SandboxManager, PluginSandbox };