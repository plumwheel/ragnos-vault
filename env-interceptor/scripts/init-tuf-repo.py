#!/usr/bin/env python3
"""
RAGnos Vault TUF Repository Initialization Script

Creates a minimal viable TUF repository structure for staging:
- Generates staging keys (root, targets, snapshot, timestamp)
- Creates initial metadata with consistent_snapshot=true
- Sets up directory structure for local HTTP serving
- Adds sample test plugin for end-to-end verification

Based on GPT-5 strategic guidance for Phase A implementation.
"""

import os
import json
import hashlib
import sys
from pathlib import Path
from datetime import datetime, timedelta

# TUF library imports
from tuf.api.metadata import (
    Metadata, Root, Timestamp, Snapshot, Targets,
    Role, Key, Signature
)
from tuf.repository import Repository
from securesystemslib.signer import Signer
from securesystemslib.keys import generate_ed25519_key

class TUFRepositoryInitializer:
    def __init__(self, repo_dir="tuf-staging"):
        self.repo_dir = Path(repo_dir)
        self.metadata_dir = self.repo_dir / "metadata"
        self.targets_dir = self.repo_dir / "targets"
        self.keys_dir = self.repo_dir / "keys"
        
        # Staging configuration - short expiries for testing
        self.expiry_config = {
            'root': timedelta(days=90),      # 90 days for staging
            'targets': timedelta(days=30),   # 30 days
            'snapshot': timedelta(days=14),  # 14 days
            'timestamp': timedelta(hours=24) # 24 hours for rapid testing
        }
        
        # Initialize repository structure
        self.repo = None
        self.keys = {}
        
    def initialize_repository(self):
        """Initialize empty TUF repository with proper structure"""
        print("🏗️  Initializing TUF repository structure...")
        
        # Create directories
        self.repo_dir.mkdir(exist_ok=True)
        self.metadata_dir.mkdir(exist_ok=True)
        self.targets_dir.mkdir(exist_ok=True)
        self.keys_dir.mkdir(exist_ok=True)
        
        # Create plugins directory structure
        plugins_dir = self.targets_dir / "plugins"
        plugins_dir.mkdir(exist_ok=True)
        
        print(f"  ✓ Created repository at {self.repo_dir}")
        
    def generate_keys(self):
        """Generate staging keys for all TUF roles"""
        print("🔑 Generating staging keys...")
        
        roles = ['root', 'targets', 'snapshot', 'timestamp']
        
        for role in roles:
            print(f"  Generating {role} key...")
            
            # Generate Ed25519 key
            key_dict = generate_ed25519_key()
            
            # Create signer
            signer = Signer.from_dict(key_dict)
            
            # Store key and signer
            self.keys[role] = {
                'key_dict': key_dict,
                'signer': signer,
                'key_obj': Key.from_dict(key_dict)
            }
            
            # Save private key to file (for staging only!)
            key_file = self.keys_dir / f"{role}_key.json"
            with open(key_file, 'w') as f:
                json.dump(key_dict, f, indent=2)
            
            print(f"    ✓ {role} key: {key_dict['keyid'][:8]}...")
            
        print(f"  ✓ Generated {len(roles)} keys")
        
    def create_root_metadata(self):
        """Create initial root metadata"""
        print("📋 Creating root metadata...")
        
        # Create role definitions
        roles = {}
        for role_name in ['root', 'targets', 'snapshot', 'timestamp']:
            key_obj = self.keys[role_name]['key_obj']
            roles[role_name] = Role(
                keyids=[key_obj.keyid],
                threshold=1  # 1-of-1 for staging
            )
        
        # Create keys dictionary
        keys = {}
        for role_name in ['root', 'targets', 'snapshot', 'timestamp']:
            key_obj = self.keys[role_name]['key_obj']
            keys[key_obj.keyid] = key_obj
        
        # Create root metadata
        root = Root(
            _type="root",
            spec_version="1.0.0",
            version=1,
            expires=datetime.now() + self.expiry_config['root'],
            keys=keys,
            roles=roles,
            consistent_snapshot=True  # Critical for CloudFront compatibility
        )
        
        # Create signed metadata
        root_metadata = Metadata(root)
        
        # Sign with root key
        root_metadata.sign(self.keys['root']['signer'])
        
        # Save metadata
        root_file = self.metadata_dir / "root.json"
        with open(root_file, 'w') as f:
            f.write(root_metadata.to_json())
            
        # Also save versioned copy
        root_versioned = self.metadata_dir / "1.root.json"
        with open(root_versioned, 'w') as f:
            f.write(root_metadata.to_json())
        
        print(f"  ✓ Root metadata created: {len(keys)} keys, consistent_snapshot=true")
        return root_metadata
        
    def create_sample_plugin(self):
        """Create a sample test plugin for verification"""
        print("🧪 Creating sample test plugin...")
        
        # Create sample plugin content
        plugin_content = '''#!/usr/bin/env node
/**
 * Sample Test Plugin for TUF Verification
 * This plugin is used to test the TUF client integration
 */

const { PluginABI } = require('./plugin-abi');

class SampleTestPlugin extends PluginABI {
  constructor() {
    super('sample-test-plugin');
  }
  
  async initialize(config) {
    this.sendReady();
  }
  
  async getCapabilities() {
    return {
      operations: ['test.verify'],
      version: '1.0.0'
    };
  }
  
  async handleOperation(operation, params) {
    if (operation === 'test.verify') {
      return { verified: true, message: 'TUF verification test successful' };
    }
    throw new Error(`Unknown operation: ${operation}`);
  }
}

if (require.main === module) {
  const plugin = new SampleTestPlugin();
  plugin.start();
}

module.exports = SampleTestPlugin;
'''
        
        # Create plugin directory structure
        plugin_dir = self.targets_dir / "plugins" / "ragnos-labs" / "sample-test-plugin"
        plugin_dir.mkdir(parents=True, exist_ok=True)
        
        # Save plugin file
        plugin_file = plugin_dir / "index.js"
        with open(plugin_file, 'w') as f:
            f.write(plugin_content)
            
        # Calculate file hash and size
        file_size = plugin_file.stat().st_size
        with open(plugin_file, 'rb') as f:
            file_hash = hashlib.sha256(f.read()).hexdigest()
            
        plugin_info = {
            'path': str(plugin_file.relative_to(self.targets_dir)),
            'size': file_size,
            'sha256': file_hash
        }
        
        print(f"  ✓ Created test plugin: {plugin_info['path']}")
        print(f"    Size: {file_size} bytes, SHA256: {file_hash[:16]}...")
        
        return plugin_info
        
    def create_targets_metadata(self, plugin_info):
        """Create targets metadata with sample plugin"""
        print("🎯 Creating targets metadata...")
        
        # Create targets entry
        targets = {
            plugin_info['path']: {
                'length': plugin_info['size'],
                'hashes': {
                    'sha256': plugin_info['sha256']
                }
            }
        }
        
        # Create targets metadata
        targets_md = Targets(
            _type="targets",
            spec_version="1.0.0",
            version=1,
            expires=datetime.now() + self.expiry_config['targets'],
            targets=targets
        )
        
        # Create signed metadata
        targets_metadata = Metadata(targets_md)
        targets_metadata.sign(self.keys['targets']['signer'])
        
        # Save metadata
        targets_file = self.metadata_dir / "targets.json"
        with open(targets_file, 'w') as f:
            f.write(targets_metadata.to_json())
            
        # Save versioned copy
        targets_versioned = self.metadata_dir / "1.targets.json"
        with open(targets_versioned, 'w') as f:
            f.write(targets_metadata.to_json())
        
        print(f"  ✓ Targets metadata created: {len(targets)} targets")
        return targets_metadata
        
    def create_snapshot_metadata(self, targets_metadata):
        """Create snapshot metadata"""
        print("📸 Creating snapshot metadata...")
        
        # Calculate targets metadata info
        targets_json = targets_metadata.to_json()
        targets_length = len(targets_json.encode('utf-8'))
        targets_hash = hashlib.sha256(targets_json.encode('utf-8')).hexdigest()
        
        # Create snapshot metadata
        meta = {
            'targets.json': {
                'version': targets_metadata.signed.version,
                'length': targets_length,
                'hashes': {
                    'sha256': targets_hash
                }
            }
        }
        
        snapshot_md = Snapshot(
            _type="snapshot",
            spec_version="1.0.0",
            version=1,
            expires=datetime.now() + self.expiry_config['snapshot'],
            meta=meta
        )
        
        # Create signed metadata
        snapshot_metadata = Metadata(snapshot_md)
        snapshot_metadata.sign(self.keys['snapshot']['signer'])
        
        # Save metadata
        snapshot_file = self.metadata_dir / "snapshot.json"
        with open(snapshot_file, 'w') as f:
            f.write(snapshot_metadata.to_json())
            
        # Save versioned copy
        snapshot_versioned = self.metadata_dir / "1.snapshot.json"
        with open(snapshot_versioned, 'w') as f:
            f.write(snapshot_metadata.to_json())
        
        print(f"  ✓ Snapshot metadata created")
        return snapshot_metadata
        
    def create_timestamp_metadata(self, snapshot_metadata):
        """Create timestamp metadata"""
        print("⏰ Creating timestamp metadata...")
        
        # Calculate snapshot metadata info
        snapshot_json = snapshot_metadata.to_json()
        snapshot_length = len(snapshot_json.encode('utf-8'))
        snapshot_hash = hashlib.sha256(snapshot_json.encode('utf-8')).hexdigest()
        
        # Create timestamp metadata
        meta = {
            'snapshot.json': {
                'version': snapshot_metadata.signed.version,
                'length': snapshot_length,
                'hashes': {
                    'sha256': snapshot_hash
                }
            }
        }
        
        timestamp_md = Timestamp(
            _type="timestamp",
            spec_version="1.0.0",
            version=1,
            expires=datetime.now() + self.expiry_config['timestamp'],
            meta=meta
        )
        
        # Create signed metadata
        timestamp_metadata = Metadata(timestamp_md)
        timestamp_metadata.sign(self.keys['timestamp']['signer'])
        
        # Save metadata
        timestamp_file = self.metadata_dir / "timestamp.json"
        with open(timestamp_file, 'w') as f:
            f.write(timestamp_metadata.to_json())
            
        # Save versioned copy
        timestamp_versioned = self.metadata_dir / "1.timestamp.json"
        with open(timestamp_versioned, 'w') as f:
            f.write(timestamp_metadata.to_json())
        
        print(f"  ✓ Timestamp metadata created")
        return timestamp_metadata
        
    def create_repository_info(self):
        """Create repository information file"""
        info = {
            'repository_type': 'staging',
            'created': datetime.now().isoformat(),
            'base_url': 'http://localhost:8080',
            'metadata_url': 'http://localhost:8080/metadata',
            'targets_url': 'http://localhost:8080/targets',
            'consistent_snapshot': True,
            'expiry_config': {
                'root_days': self.expiry_config['root'].days,
                'targets_days': self.expiry_config['targets'].days,
                'snapshot_days': self.expiry_config['snapshot'].days,
                'timestamp_hours': int(self.expiry_config['timestamp'].total_seconds() / 3600)
            },
            'key_info': {
                role: {
                    'keyid': self.keys[role]['key_obj'].keyid,
                    'keytype': self.keys[role]['key_obj'].keytype
                }
                for role in ['root', 'targets', 'snapshot', 'timestamp']
            }
        }
        
        info_file = self.repo_dir / "repository-info.json"
        with open(info_file, 'w') as f:
            json.dump(info, f, indent=2)
            
        print(f"  ✓ Repository info saved to {info_file}")
        
    def run(self):
        """Run the complete repository initialization"""
        print("🚀 RAGnos Vault TUF Repository Initialization")
        print("=" * 50)
        
        try:
            # Initialize repository structure
            self.initialize_repository()
            
            # Generate keys
            self.generate_keys()
            
            # Create sample plugin
            plugin_info = self.create_sample_plugin()
            
            # Create metadata in dependency order
            root_metadata = self.create_root_metadata()
            targets_metadata = self.create_targets_metadata(plugin_info)
            snapshot_metadata = self.create_snapshot_metadata(targets_metadata)
            timestamp_metadata = self.create_timestamp_metadata(snapshot_metadata)
            
            # Create repository info
            self.create_repository_info()
            
            print("\n✅ TUF Repository Initialization Complete!")
            print(f"📁 Repository: {self.repo_dir}")
            print(f"🌐 Serve with: http-server {self.repo_dir} -p 8080 --cors")
            print(f"🔗 Metadata URL: http://localhost:8080/metadata")
            print(f"🎯 Test plugin: {plugin_info['path']}")
            
            print("\n📋 Next Steps:")
            print("1. Start HTTP server: http-server tuf-staging -p 8080 --cors")
            print("2. Update runtime loader with repository URL")
            print("3. Run end-to-end verification tests")
            print("4. Test negative scenarios (tampering, expiry)")
            
        except Exception as e:
            print(f"\n❌ Repository initialization failed: {e}")
            sys.exit(1)

if __name__ == "__main__":
    initializer = TUFRepositoryInitializer()
    initializer.run()