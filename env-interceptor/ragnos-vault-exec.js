#!/usr/bin/env node
/**
 * RAGnos Vault Process Wrapper
 * 
 * Command-line wrapper for running any process with vault-aware environment
 * Zero code changes required - transparent vault integration
 * 
 * Usage: 
 *   ragnos-vault exec -- node server.js
 *   ragnos-vault exec --mode=dual --canary=25 -- npm start
 *   ragnos-vault exec --debug -- python3 mcp-server.py
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class VaultProcessWrapper {
  constructor() {
    this.args = process.argv.slice(2);
    this.config = this.parseArgs();
    this.vaultClient = null;
    
    if (this.config.help) {
      this.showHelp();
      process.exit(0);
    }
    
    if (!this.config.command || this.config.command.length === 0) {
      console.error('Error: No command specified. Use -- to separate vault options from command.');
      this.showHelp();
      process.exit(1);
    }
  }
  
  parseArgs() {
    const config = {
      mode: 'shadow',
      canary_percent: 0,
      debug: false,
      help: false,
      kill_switch: true,
      cache_ttl: 300000,
      command: []
    };
    
    let i = 0;
    let foundSeparator = false;
    
    while (i < this.args.length) {
      const arg = this.args[i];
      
      if (arg === '--') {
        foundSeparator = true;
        config.command = this.args.slice(i + 1);
        break;
      }
      
      if (arg === '--help' || arg === '-h') {
        config.help = true;
      } else if (arg === '--debug') {
        config.debug = true;
      } else if (arg.startsWith('--mode=')) {
        config.mode = arg.split('=')[1];
      } else if (arg.startsWith('--canary=')) {
        config.canary_percent = parseInt(arg.split('=')[1]) || 0;
      } else if (arg === '--no-kill-switch') {
        config.kill_switch = false;
      } else if (arg.startsWith('--cache-ttl=')) {
        config.cache_ttl = parseInt(arg.split('=')[1]) * 1000 || 300000;
      } else {
        console.error(`Unknown argument: ${arg}`);
        this.showHelp();
        process.exit(1);
      }
      
      i++;
    }
    
    if (!foundSeparator && !config.help) {
      console.error('Error: Command separator -- not found');
      this.showHelp();
      process.exit(1);
    }
    
    return config;
  }
  
  showHelp() {
    console.log(`
RAGnos Vault Process Wrapper

USAGE:
  ragnos-vault exec [OPTIONS] -- COMMAND [ARGS...]

OPTIONS:
  --mode=MODE           Vault mode: shadow, dual, vault (default: shadow)
  --canary=PERCENT      Canary percentage for dual mode (default: 0)
  --debug               Enable debug logging
  --no-kill-switch      Disable automatic kill switch
  --cache-ttl=SECONDS   Cache TTL in seconds (default: 300)
  --help, -h            Show this help message

EXAMPLES:
  # Shadow mode - monitor vault vs env parity
  ragnos-vault exec -- node huggingface-mcp-server.js
  
  # Dual mode with 25% canary traffic
  ragnos-vault exec --mode=dual --canary=25 -- npm start
  
  # Full vault mode with debug logging
  ragnos-vault exec --mode=vault --debug -- python3 server.py
  
  # Custom cache TTL
  ragnos-vault exec --cache-ttl=600 -- node server.js

VAULT MODES:
  shadow    Use environment variables, validate against vault
  dual      Progressive vault adoption with canary percentage
  vault     Vault primary with environment fallback

FEATURES:
  ✅ Zero code changes required
  ✅ Progressive rollout with kill switch
  ✅ Automatic fallback to environment variables
  ✅ Real-time vault/env parity validation
  ✅ Compatible with any process or runtime
`);
  }
  
  async run() {
    console.log(`[VaultExec] Starting process with vault mode: ${this.config.mode}`);
    
    if (this.config.debug) {
      console.log(`[VaultExec] Config:`, {
        mode: this.config.mode,
        canary_percent: this.config.canary_percent,
        kill_switch: this.config.kill_switch,
        cache_ttl: this.config.cache_ttl,
        command: this.config.command
      });
    }
    
    // Prepare environment with vault configuration
    const childEnv = {
      ...process.env,
      VAULT_MODE: this.config.mode,
      VAULT_CANARY_PERCENT: this.config.canary_percent.toString(),
      VAULT_DEBUG: this.config.debug.toString(),
      VAULT_KILL_SWITCH: this.config.kill_switch.toString(),
      VAULT_CACHE_TTL: this.config.cache_ttl.toString(),
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${path.resolve(__dirname, 'vault-env-preloader.js')}`.trim()
    };
    
    // Execute the wrapped command
    const [command, ...args] = this.config.command;
    
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: childEnv,
      cwd: process.cwd()
    });
    
    // Handle process lifecycle
    child.on('error', (error) => {
      console.error(`[VaultExec] Process error:`, error.message);
      process.exit(1);
    });
    
    child.on('exit', (code, signal) => {
      if (this.config.debug) {
        console.log(`[VaultExec] Process exited with code: ${code}, signal: ${signal}`);
      }
      process.exit(code || 0);
    });
    
    // Forward signals to child process
    const forwardSignal = (signal) => {
      process.on(signal, () => {
        if (this.config.debug) {
          console.log(`[VaultExec] Forwarding ${signal} to child process`);
        }
        child.kill(signal);
      });
    };
    
    forwardSignal('SIGINT');
    forwardSignal('SIGTERM');
    forwardSignal('SIGHUP');
    
    return new Promise((resolve) => {
      child.on('exit', resolve);
    });
  }
}

// CLI Entry Point
if (require.main === module) {
  const wrapper = new VaultProcessWrapper();
  wrapper.run().catch(error => {
    console.error('[VaultExec] Fatal error:', error.message);
    process.exit(1);
  });
}

module.exports = { VaultProcessWrapper };