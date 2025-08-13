#!/usr/bin/env node
/**
 * Create Minimal Working TUF Repository
 * 
 * Creates the absolute minimum TUF repository structure that
 * tuf-js will accept for testing purposes. Uses proper signature
 * formatting even if the signatures are not cryptographically valid.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createMinimalTUFRepository() {
  console.log('🚀 Creating minimal working TUF repository...');
  
  const repoDir = 'tuf-minimal';
  const metadataDir = path.join(repoDir, 'metadata');
  const targetsDir = path.join(repoDir, 'targets');
  
  // Create directories
  [repoDir, metadataDir, targetsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
  
  // Create a dummy signature (base64 encoded)
  const dummySignature = Buffer.from('dummy_signature_for_testing_only').toString('base64');
  
  // Generate a key
  const keyId = crypto.randomBytes(32).toString('hex');
  const publicKey = Buffer.from('dummy_public_key_for_testing').toString('base64');
  
  const key = {
    keytype: 'rsa',
    scheme: 'rsa-pss-sha256',
    keyval: {
      public: publicKey
    }
  };
  
  // Create minimal root metadata
  const root = {
    signed: {
      _type: 'root',
      spec_version: '1.0.0',
      version: 1,
      expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      keys: {
        [keyId]: key
      },
      roles: {
        root: { keyids: [keyId], threshold: 1 },
        timestamp: { keyids: [keyId], threshold: 1 },
        snapshot: { keyids: [keyId], threshold: 1 },
        targets: { keyids: [keyId], threshold: 1 }
      },
      consistent_snapshot: false // Simplified for testing
    },
    signatures: [
      {
        keyid: keyId,
        signature: dummySignature
      }
    ]
  };
  
  // Create empty targets
  const targets = {
    signed: {
      _type: 'targets',
      spec_version: '1.0.0',
      version: 1,
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      targets: {}
    },
    signatures: [
      {
        keyid: keyId,
        signature: dummySignature
      }
    ]
  };
  
  // Create snapshot
  const targetsJson = JSON.stringify(targets);
  const snapshot = {
    signed: {
      _type: 'snapshot',
      spec_version: '1.0.0',
      version: 1,
      expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      meta: {
        'targets.json': {
          version: 1,
          length: Buffer.byteLength(targetsJson, 'utf8'),
          hashes: {
            sha256: crypto.createHash('sha256').update(targetsJson).digest('hex')
          }
        }
      }
    },
    signatures: [
      {
        keyid: keyId,
        signature: dummySignature
      }
    ]
  };
  
  // Create timestamp
  const snapshotJson = JSON.stringify(snapshot);
  const timestamp = {
    signed: {
      _type: 'timestamp',
      spec_version: '1.0.0',
      version: 1,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      meta: {
        'snapshot.json': {
          version: 1,
          length: Buffer.byteLength(snapshotJson, 'utf8'),
          hashes: {
            sha256: crypto.createHash('sha256').update(snapshotJson).digest('hex')
          }
        }
      }
    },
    signatures: [
      {
        keyid: keyId,
        signature: dummySignature
      }
    ]
  };
  
  // Save all metadata
  fs.writeFileSync(path.join(metadataDir, 'root.json'), JSON.stringify(root, null, 2));
  fs.writeFileSync(path.join(metadataDir, 'targets.json'), JSON.stringify(targets, null, 2));
  fs.writeFileSync(path.join(metadataDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(path.join(metadataDir, 'timestamp.json'), JSON.stringify(timestamp, null, 2));
  
  console.log('✅ Minimal TUF repository created at:', repoDir);
  console.log('📁 Structure:');
  console.log('  metadata/root.json');
  console.log('  metadata/targets.json');
  console.log('  metadata/snapshot.json');
  console.log('  metadata/timestamp.json');
  console.log('');
  console.log('🧪 Test with: http-server tuf-minimal -p 8082 --cors');
  
  return repoDir;
}

if (require.main === module) {
  createMinimalTUFRepository();
}