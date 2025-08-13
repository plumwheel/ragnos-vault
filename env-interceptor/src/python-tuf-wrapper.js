/**
 * RAGnos Vault Python-TUF Subprocess Wrapper
 * Node.js integration layer for production-ready TUF verification using python-tuf
 */

const { spawn } = require('child_process');
const path = require('path');
const { createSpan, recordSecurityEvent } = require('./telemetry-shim');

class PythonTUFWrapper {
  constructor(options = {}) {
    this.options = {
      pythonBinary: options.pythonBinary || process.env.RAGNOS_PYTHON_BIN || 'python3',
      scriptPath: options.scriptPath || path.resolve(__dirname, 'python-tuf-client.py'),
      defaultTimeout: options.defaultTimeout || 25000, // 25 seconds
      maxRetries: options.maxRetries || 1,
      ...options
    };
  }

  /**
   * Run Python TUF command with structured I/O
   */
  async runCommand(command, args = {}, options = {}) {
    const span = createSpan('python_tuf.command', { 
      command,
      timeout_ms: options.timeoutMs || this.options.defaultTimeout
    });
    
    const startTime = Date.now();
    
    try {
      const request = {
        command,
        ...args,
        timeout_ms: options.timeoutMs || this.options.defaultTimeout
      };
      
      const result = await this.executeSubprocess(request, options);
      const duration = Date.now() - startTime;
      
      recordSecurityEvent('python_tuf_success', 'info', {
        command,
        duration_ms: duration,
        repo_url: args.repo_url?.split('/')[2] // Domain only for privacy
      });
      
      span.setAttributes({ 
        success: true, 
        duration_ms: duration,
        verified: result.verified || false
      });
      span.end();
      
      return result;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      recordSecurityEvent('python_tuf_failed', 'error', {
        command,
        error_code: error.code || 'UNKNOWN',
        error_message: error.message,
        duration_ms: duration
      });
      
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      
      throw error;
    }
  }

  /**
   * Execute Python subprocess with robust error handling
   */
  async executeSubprocess(request, options = {}) {
    const timeoutMs = options.timeoutMs || this.options.defaultTimeout;
    
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.pythonBinary, [this.options.scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { 
          ...process.env, 
          PYTHONUNBUFFERED: '1',
          PYTHONDONTWRITEBYTECODE: '1'
        }
      });

      let stdout = '';
      let stderr = '';
      let resolved = false;

      // Hard timeout with cleanup
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          child.kill('SIGKILL');
          const error = new Error('Python TUF subprocess timeout');
          error.code = 'PY_TUF_TIMEOUT';
          error.details = { timeout_ms: timeoutMs, stderr: stderr.substring(0, 1000) };
          reject(error);
        }
      }, timeoutMs);

      // Collect output
      child.stdout.setEncoding('utf8').on('data', (data) => {
        stdout += data;
      });

      child.stderr.setEncoding('utf8').on('data', (data) => {
        stderr += data;
      });

      // Handle subprocess errors
      child.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          error.code = error.code || 'PY_TUF_SPAWN_ERROR';
          error.details = { stderr: stderr.substring(0, 1000) };
          reject(error);
        }
      });

      // Handle subprocess completion
      child.on('close', (exitCode) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          
          try {
            // Parse JSON response (expect single line)
            const lines = stdout.split('\n').filter(line => line.trim());
            if (lines.length === 0) {
              throw new Error('No output from Python TUF client');
            }
            
            const response = JSON.parse(lines[0]);
            
            if (response.ok) {
              resolve(response.data || response);
            } else {
              const error = new Error(response.error?.message || 'Python TUF operation failed');
              error.code = response.error?.code || this.mapExitCodeToError(exitCode);
              error.details = {
                exit_code: exitCode,
                stderr: stderr.substring(0, 1000),
                python_error: response.error
              };
              reject(error);
            }
            
          } catch (parseError) {
            const error = new Error('Invalid JSON response from Python TUF client');
            error.code = 'PY_TUF_BAD_JSON';
            error.details = {
              exit_code: exitCode,
              stdout: stdout.substring(0, 1000),
              stderr: stderr.substring(0, 1000),
              parse_error: parseError.message
            };
            reject(error);
          }
        }
      });

      // Send request to Python client
      try {
        child.stdin.write(JSON.stringify(request) + '\n');
        child.stdin.end();
      } catch (writeError) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          writeError.code = 'PY_TUF_WRITE_ERROR';
          reject(writeError);
        }
      }
    });
  }

  /**
   * Map Python exit codes to error codes
   */
  mapExitCodeToError(exitCode) {
    const errorMap = {
      10: 'PY_TUF_INVALID_ARGS',
      20: 'PY_TUF_REPO_ERROR', 
      30: 'PY_TUF_VERIFY_FAILED',
      50: 'PY_TUF_INTERNAL',
      124: 'PY_TUF_TIMEOUT'
    };
    return errorMap[exitCode] || 'PY_TUF_UNKNOWN';
  }

  /**
   * Initialize TUF client with trusted root
   */
  async initialize(repoUrl, metadataDir, targetsDir, trustedRootPath) {
    return this.runCommand('init', {
      repo_url: repoUrl,
      metadata_dir: metadataDir,
      targets_dir: targetsDir,
      trusted_root: trustedRootPath
    });
  }

  /**
   * Refresh TUF metadata from repository
   */
  async refreshMetadata(repoUrl, metadataDir, targetsDir, trustedRootPath) {
    return this.runCommand('refresh', {
      repo_url: repoUrl,
      metadata_dir: metadataDir,
      targets_dir: targetsDir,
      trusted_root: trustedRootPath
    });
  }

  /**
   * Verify and download target file
   */
  async downloadTarget(targetPath, repoUrl, metadataDir, targetsDir, trustedRootPath, expectedSha256 = null) {
    return this.runCommand('download', {
      repo_url: repoUrl,
      metadata_dir: metadataDir,
      targets_dir: targetsDir,
      trusted_root: trustedRootPath,
      target: targetPath,
      expected_sha256: expectedSha256
    });
  }

  /**
   * List available targets
   */
  async listTargets(repoUrl, metadataDir, targetsDir, trustedRootPath) {
    return this.runCommand('list', {
      repo_url: repoUrl,
      metadata_dir: metadataDir,
      targets_dir: targetsDir,
      trusted_root: trustedRootPath
    });
  }

  /**
   * Check if Python TUF is available
   */
  async checkAvailability() {
    try {
      const result = await this.executeSubprocess({ command: 'test' }, { timeoutMs: 5000 });
      return { available: true, version: result.version || 'unknown' };
    } catch (error) {
      return { 
        available: false, 
        error: error.message,
        suggestion: 'Install python-tuf: pip install tuf[ed25519]'
      };
    }
  }
}

module.exports = { PythonTUFWrapper };