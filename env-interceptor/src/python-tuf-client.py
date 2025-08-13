#!/usr/bin/env python3
"""
RAGnos Vault Python-TUF Subprocess Client
Production-ready TUF verification using python-tuf library
"""

import os
import sys
import json
import argparse
import tempfile
import shutil
from pathlib import Path
from typing import Dict, List, Optional, Any

# Try to import python-tuf
try:
    from tuf.api.metadata import Metadata, Root, Timestamp, Snapshot, Targets
    from tuf.repository import Repository
    from tuf.client import Updater
    from tuf.exceptions import UnsignedMetadataError, BadVersionNumberError, ExpiredMetadataError
    import requests
except ImportError as e:
    print(json.dumps({
        "ok": False,
        "error": f"Missing python-tuf dependency: {e}",
        "install_command": "pip install tuf[ed25519]"
    }))
    sys.exit(1)


class PythonTUFClient:
    """Enterprise-grade TUF client using python-tuf"""
    
    def __init__(self, repo_url: str, metadata_dir: str, targets_dir: str, trusted_root: str):
        self.repo_url = repo_url.rstrip('/')
        self.metadata_dir = Path(metadata_dir)
        self.targets_dir = Path(targets_dir)
        self.trusted_root_path = Path(trusted_root)
        
        # Ensure directories exist
        self.metadata_dir.mkdir(parents=True, exist_ok=True)
        self.targets_dir.mkdir(parents=True, exist_ok=True)
        
        self.updater = None
        
    def initialize(self) -> Dict[str, Any]:
        """Initialize TUF client with trusted root"""
        try:
            # Load trusted root metadata
            if not self.trusted_root_path.exists():
                return {
                    "ok": False,
                    "error": f"Trusted root not found: {self.trusted_root_path}"
                }
            
            with open(self.trusted_root_path, 'r') as f:
                root_data = json.load(f)
            
            # Create TUF updater
            self.updater = Updater(
                metadata_dir=str(self.metadata_dir),
                metadata_base_url=f"{self.repo_url}/metadata/",
                target_dir=str(self.targets_dir),
                target_base_url=f"{self.repo_url}/targets/"
            )
            
            # Bootstrap with trusted root
            self.updater.bootstrap(root_data)
            
            return {
                "ok": True,
                "metadata_dir": str(self.metadata_dir),
                "targets_dir": str(self.targets_dir),
                "repo_url": self.repo_url
            }
            
        except Exception as e:
            return {
                "ok": False,
                "error": f"TUF client initialization failed: {str(e)}",
                "error_type": type(e).__name__
            }
    
    def refresh_metadata(self) -> Dict[str, Any]:
        """Refresh TUF metadata from repository"""
        try:
            if not self.updater:
                return {"ok": False, "error": "TUF client not initialized"}
            
            # Refresh metadata
            self.updater.refresh()
            
            return {
                "ok": True,
                "refreshed": True
            }
            
        except ExpiredMetadataError as e:
            return {
                "ok": False,
                "error": f"Expired metadata detected: {str(e)}",
                "error_type": "ExpiredMetadata"
            }
        except UnsignedMetadataError as e:
            return {
                "ok": False,
                "error": f"Invalid signature detected: {str(e)}",
                "error_type": "InvalidSignature"
            }
        except BadVersionNumberError as e:
            return {
                "ok": False,
                "error": f"Rollback attack detected: {str(e)}",
                "error_type": "RollbackAttack"
            }
        except Exception as e:
            return {
                "ok": False,
                "error": f"Metadata refresh failed: {str(e)}",
                "error_type": type(e).__name__
            }
    
    def verify_and_download_target(self, target_path: str) -> Dict[str, Any]:
        """Verify and download a target file"""
        try:
            if not self.updater:
                return {"ok": False, "error": "TUF client not initialized"}
            
            # Get target info
            target_info = self.updater.get_targetinfo(target_path)
            if not target_info:
                return {
                    "ok": False,
                    "error": f"Target not found: {target_path}"
                }
            
            # Download and verify target
            self.updater.download_target(target_info, str(self.targets_dir))
            
            # Verify the downloaded file
            downloaded_path = self.targets_dir / target_path
            if not downloaded_path.exists():
                return {
                    "ok": False,
                    "error": f"Downloaded target not found: {downloaded_path}"
                }
            
            # Read the file content
            with open(downloaded_path, 'rb') as f:
                content = f.read()
            
            return {
                "ok": True,
                "target_path": target_path,
                "local_path": str(downloaded_path),
                "length": len(content),
                "hashes": {
                    "sha256": target_info.hashes.get("sha256", ""),
                    "sha512": target_info.hashes.get("sha512", "")
                },
                "verified": True,
                "content": content.hex()  # Return as hex for safe JSON transport
            }
            
        except Exception as e:
            return {
                "ok": False,
                "error": f"Target verification failed: {str(e)}",
                "error_type": type(e).__name__
            }
    
    def list_targets(self) -> Dict[str, Any]:
        """List all available targets"""
        try:
            if not self.updater:
                return {"ok": False, "error": "TUF client not initialized"}
            
            # Get all targets
            targets = []
            for target_path, target_info in self.updater.targets.signed.targets.items():
                targets.append({
                    "path": target_path,
                    "length": target_info.length,
                    "hashes": dict(target_info.hashes)
                })
            
            return {
                "ok": True,
                "targets": targets,
                "count": len(targets)
            }
            
        except Exception as e:
            return {
                "ok": False,
                "error": f"Failed to list targets: {str(e)}",
                "error_type": type(e).__name__
            }


def main():
    """NDJSON CLI interface for python-tuf client"""
    # Handle test command for availability check
    if len(sys.argv) == 1:
        try:
            # Read NDJSON request from stdin
            line = sys.stdin.readline().strip()
            if not line:
                print(json.dumps({"ok": False, "error": {"code": "PY_TUF_NO_INPUT", "message": "No input received"}}))
                sys.exit(10)
            
            request = json.loads(line)
            command = request.get("command")
            
            if command == "test":
                # Availability check
                result = {
                    "ok": True,
                    "data": {
                        "available": True,
                        "version": "python-tuf available",
                        "python_version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
                    }
                }
                print(json.dumps(result))
                sys.exit(0)
            
            # Extract required parameters
            repo_url = request.get("repo_url")
            metadata_dir = request.get("metadata_dir") 
            targets_dir = request.get("targets_dir")
            trusted_root = request.get("trusted_root")
            
            if not all([repo_url, metadata_dir, targets_dir, trusted_root]):
                result = {
                    "ok": False, 
                    "error": {
                        "code": "PY_TUF_INVALID_ARGS",
                        "message": "Missing required parameters: repo_url, metadata_dir, targets_dir, trusted_root"
                    }
                }
                print(json.dumps(result))
                sys.exit(10)
            
            # Create client
            client = PythonTUFClient(
                repo_url=repo_url,
                metadata_dir=metadata_dir,
                targets_dir=targets_dir,
                trusted_root=trusted_root
            )
            
            # Execute command
            if command == "init":
                result = client.initialize()
                if result["ok"]:
                    result = {"ok": True, "data": result}
                else:
                    result = {"ok": False, "error": {"code": "PY_TUF_INIT_FAILED", "message": result["error"]}}
                    
            elif command == "refresh":
                # Initialize first, then refresh
                init_result = client.initialize()
                if not init_result["ok"]:
                    result = {"ok": False, "error": {"code": "PY_TUF_INIT_FAILED", "message": init_result["error"]}}
                else:
                    refresh_result = client.refresh_metadata()
                    if refresh_result["ok"]:
                        result = {"ok": True, "data": {"refreshed": True}}
                    else:
                        result = {"ok": False, "error": {"code": "PY_TUF_REFRESH_FAILED", "message": refresh_result["error"]}}
                        
            elif command == "download":
                target_path = request.get("target")
                if not target_path:
                    result = {"ok": False, "error": {"code": "PY_TUF_INVALID_ARGS", "message": "Target path required for download"}}
                else:
                    # Initialize, refresh, then download
                    init_result = client.initialize()
                    if not init_result["ok"]:
                        result = {"ok": False, "error": {"code": "PY_TUF_INIT_FAILED", "message": init_result["error"]}}
                    else:
                        refresh_result = client.refresh_metadata()
                        if not refresh_result["ok"]:
                            result = {"ok": False, "error": {"code": "PY_TUF_REFRESH_FAILED", "message": refresh_result["error"]}}
                        else:
                            download_result = client.verify_and_download_target(target_path)
                            if download_result["ok"]:
                                # Convert hex content back to bytes for verification
                                content_hex = download_result.pop("content", "")
                                result = {
                                    "ok": True, 
                                    "data": {
                                        **download_result,
                                        "verified": True,
                                        "content_length": len(content_hex) // 2 if content_hex else 0
                                    }
                                }
                            else:
                                result = {"ok": False, "error": {"code": "PY_TUF_DOWNLOAD_FAILED", "message": download_result["error"]}}
                                
            elif command == "list":
                # Initialize, refresh, then list
                init_result = client.initialize()
                if not init_result["ok"]:
                    result = {"ok": False, "error": {"code": "PY_TUF_INIT_FAILED", "message": init_result["error"]}}
                else:
                    refresh_result = client.refresh_metadata()
                    if not refresh_result["ok"]:
                        result = {"ok": False, "error": {"code": "PY_TUF_REFRESH_FAILED", "message": refresh_result["error"]}}
                    else:
                        list_result = client.list_targets()
                        if list_result["ok"]:
                            result = {"ok": True, "data": list_result}
                        else:
                            result = {"ok": False, "error": {"code": "PY_TUF_LIST_FAILED", "message": list_result["error"]}}
            else:
                result = {"ok": False, "error": {"code": "PY_TUF_UNKNOWN_COMMAND", "message": f"Unknown command: {command}"}}
            
        except json.JSONDecodeError as e:
            result = {"ok": False, "error": {"code": "PY_TUF_BAD_JSON", "message": f"Invalid JSON input: {str(e)}"}}
            sys.exit(10)
        except Exception as e:
            result = {"ok": False, "error": {"code": "PY_TUF_INTERNAL", "message": f"Internal error: {str(e)}"}}
            sys.exit(50)
    else:
        # Legacy CLI mode for direct testing
        result = {"ok": False, "error": {"code": "PY_TUF_INVALID_ARGS", "message": "Use NDJSON stdin interface"}}
    
    # Output result as single JSON line
    print(json.dumps(result))
    
    # Exit with appropriate code
    if result.get("ok", False):
        sys.exit(0)
    else:
        error_code = result.get("error", {}).get("code", "")
        if "INVALID_ARGS" in error_code:
            sys.exit(10)
        elif "REPO" in error_code or "INIT" in error_code or "REFRESH" in error_code:
            sys.exit(20)
        elif "VERIFY" in error_code or "DOWNLOAD" in error_code:
            sys.exit(30)
        else:
            sys.exit(50)


if __name__ == "__main__":
    main()