/**
 * KMS L0 Conformance Tests (Happy Path + Basic Failures)
 * Tests core KMS operations and error taxonomy
 */

import { TestSpec, TestContext } from '../types';
import {
  ErrorFactory,
  ErrorCode,
  NotFoundError,
  InvalidConfigError,
  PermissionDeniedError
} from '@ragnos-vault/sdk';

/**
 * L0 KMS Test Specifications
 * Happy path and basic failure scenarios
 */
export const kmsL0Specs: TestSpec[] = [
  
  // Key Management Tests
  async function testCreateKey(testCtx: TestContext): Promise<void> {
    const kms = testCtx.provider.kms();
    if (!kms) throw new Error('KMS capability not available');
    
    const keyInfo = await kms.createKey(testCtx.ctx, {
      keyUsage: 'ENCRYPT_DECRYPT',
      algorithm: 'AES_256_GCM',
      description: 'Test encryption key',
      tags: { test: 'conformance' }
    });
    
    // Validate response
    if (!keyInfo.keyId) throw new Error('keyId is required');
    if (!keyInfo.algorithm) throw new Error('algorithm is required');
    if (keyInfo.keyUsage !== 'ENCRYPT_DECRYPT') throw new Error('keyUsage mismatch');
    if (!keyInfo.enabled) throw new Error('key should be enabled by default');
    if (!keyInfo.createdAt) throw new Error('createdAt is required');
    if (keyInfo.description !== 'Test encryption key') throw new Error('description mismatch');
    
    testCtx.ctx.logger.info('✓ Key created successfully', { keyId: keyInfo.keyId });
  },
  
  async function testCreateSigningKey(testCtx: TestContext): Promise<void> {
    const kms = testCtx.provider.kms();
    if (!kms) throw new Error('KMS capability not available');
    
    const keyInfo = await kms.createKey(testCtx.ctx, {
      keyUsage: 'SIGN_VERIFY',
      algorithm: 'RSA_2048',
      alias: testCtx.namespacedKey('test-signing-key'),
      description: 'Test signing key'
    });
    
    if (keyInfo.keyUsage !== 'SIGN_VERIFY') throw new Error('keyUsage mismatch');
    if (keyInfo.alias !== testCtx.namespacedKey('test-signing-key')) throw new Error('alias mismatch');
    
    testCtx.ctx.logger.info('✓ Signing key created successfully', { keyId: keyInfo.keyId });
  },
  
  async function testListKeys(testCtx: TestContext): Promise<void> {
    const kms = testCtx.provider.kms();
    if (!kms) throw new Error('KMS capability not available');
    
    // Create a few test keys first
    await kms.createKey(testCtx.ctx, {
      keyUsage: 'ENCRYPT_DECRYPT',
      description: 'List test key 1'
    });
    await kms.createKey(testCtx.ctx, {
      keyUsage: 'ENCRYPT_DECRYPT',
      description: 'List test key 2'
    });
    
    const result = await kms.listKeys(testCtx.ctx, { limit: 10 });
    
    if (!Array.isArray(result.keys)) throw new Error('keys must be array');
    if (result.keys.length < 2) throw new Error('should have at least 2 keys');
    
    // Validate key structure
    const key = result.keys[0];
    if (!key.keyId) throw new Error('keyId required in list');
    if (!key.algorithm) throw new Error('algorithm required in list');
    if (!key.createdAt) throw new Error('createdAt required in list');
    
    testCtx.ctx.logger.info('✓ Keys listed successfully', { count: result.keys.length });
  },
  
  async function testGetKey(testCtx: TestContext): Promise<void> {
    const kms = testCtx.provider.kms();
    if (!kms) throw new Error('KMS capability not available');
    
    // Create key first
    const createdKey = await kms.createKey(testCtx.ctx, {
      keyUsage: 'ENCRYPT_DECRYPT',
      description: 'Get test key'
    });
    
    const retrievedKey = await kms.getKey(testCtx.ctx, createdKey.keyId);
    
    if (retrievedKey.keyId !== createdKey.keyId) throw new Error('keyId mismatch');
    if (retrievedKey.algorithm !== createdKey.algorithm) throw new Error('algorithm mismatch');
    if (retrievedKey.description !== createdKey.description) throw new Error('description mismatch');
    
    testCtx.ctx.logger.info('✓ Key retrieved successfully', { keyId: retrievedKey.keyId });
  },
  
  // Encryption/Decryption Tests
  async function testEncryptDecrypt(testCtx: TestContext): Promise<void> {
    const kms = testCtx.provider.kms();
    if (!kms) throw new Error('KMS capability not available');
    
    // Create encryption key
    const keyInfo = await kms.createKey(testCtx.ctx, {
      keyUsage: 'ENCRYPT_DECRYPT',
      algorithm: 'AES_256_GCM'
    });
    
    const plaintext = testCtx.randomBytes(256);
    const aad = testCtx.randomBytes(32);
    
    // Encrypt
    const encryptResult = await kms.encrypt(testCtx.ctx, plaintext, {
      keyId: keyInfo.keyId,
      aad
    });
    
    if (!encryptResult.ciphertext) throw new Error('ciphertext is required');
    if (encryptResult.keyId !== keyInfo.keyId) throw new Error('keyId mismatch in encrypt result');
    if (!encryptResult.algorithm) throw new Error('algorithm is required in encrypt result');
    
    // Decrypt
    const decryptResult = await kms.decrypt(testCtx.ctx, encryptResult.ciphertext, {
      keyId: keyInfo.keyId
    });
    
    if (decryptResult.keyId !== keyInfo.keyId) throw new Error('keyId mismatch in decrypt result');
    if (!testCtx.arraysEqual(new Uint8Array(decryptResult.plaintext), plaintext)) {
      throw new Error('decrypted plaintext does not match original');
    }
    
    testCtx.ctx.logger.info('✓ Encrypt/decrypt roundtrip successful', { 
      keyId: keyInfo.keyId,
      plaintextSize: plaintext.length
    });
  },
  
  async function testEncryptDecryptWithoutAAD(testCtx: TestContext): Promise<void> {
    const kms = testCtx.provider.kms();
    if (!kms) throw new Error('KMS capability not available');
    
    const keyInfo = await kms.createKey(testCtx.ctx, {
      keyUsage: 'ENCRYPT_DECRYPT'
    });
    
    const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
    
    const encryptResult = await kms.encrypt(testCtx.ctx, plaintext, {
      keyId: keyInfo.keyId
    });
    
    const decryptResult = await kms.decrypt(testCtx.ctx, encryptResult.ciphertext, {
      keyId: keyInfo.keyId
    });
    
    if (!testCtx.arraysEqual(new Uint8Array(decryptResult.plaintext), plaintext)) {
      throw new Error('plaintext mismatch without AAD');
    }
    
    testCtx.ctx.logger.info('✓ Encrypt/decrypt without AAD successful');
  },
  
  // Sign/Verify Tests
  async function testSignVerify(testCtx: TestContext): Promise<void> {
    const kms = testCtx.provider.kms();
    if (!kms) throw new Error('KMS capability not available');
    
    const keyInfo = await kms.createKey(testCtx.ctx, {
      keyUsage: 'SIGN_VERIFY',
      algorithm: 'RSA_2048'
    });
    
    const data = testCtx.randomBytes(128);
    
    // Sign
    const signResult = await kms.sign(testCtx.ctx, data, {
      keyId: keyInfo.keyId
    });
    
    if (!signResult.signature) throw new Error('signature is required');
    if (signResult.keyId !== keyInfo.keyId) throw new Error('keyId mismatch in sign result');
    
    // Verify
    const verifyResult = await kms.verify(testCtx.ctx, data, signResult.signature, {
      keyId: keyInfo.keyId
    });
    
    if (!verifyResult.valid) throw new Error('signature should be valid');
    if (verifyResult.keyId !== keyInfo.keyId) throw new Error('keyId mismatch in verify result');
    
    testCtx.ctx.logger.info('✓ Sign/verify successful', { keyId: keyInfo.keyId });
  },
  
  async function testVerifyInvalidSignature(testCtx: TestContext): Promise<void> {
    const kms = testCtx.provider.kms();
    if (!kms) throw new Error('KMS capability not available');
    
    const keyInfo = await kms.createKey(testCtx.ctx, {
      keyUsage: 'SIGN_VERIFY'
    });
    
    const data = testCtx.randomBytes(64);
    const invalidSignature = testCtx.randomBytes(256);
    
    const verifyResult = await kms.verify(testCtx.ctx, data, invalidSignature, {
      keyId: keyInfo.keyId
    });
    
    if (verifyResult.valid) throw new Error('invalid signature should not verify');
    
    testCtx.ctx.logger.info('✓ Invalid signature correctly rejected');
  },
  
  // Key Management Operations
  async function testKeyRotation(testCtx: TestContext): Promise<void> {
    const kms = testCtx.provider.kms();
    if (!kms) throw new Error('KMS capability not available');
    
    const originalKey = await kms.createKey(testCtx.ctx, {
      keyUsage: 'ENCRYPT_DECRYPT',
      description: 'Rotation test key'
    });
    
    const rotatedKey = await kms.rotateKey(testCtx.ctx, originalKey.keyId);
    
    if (rotatedKey.keyId !== originalKey.keyId) throw new Error('keyId should remain same after rotation');
    if (rotatedKey.createdAt <= originalKey.createdAt) throw new Error('rotated key should have newer createdAt');
    
    testCtx.ctx.logger.info('✓ Key rotation successful', { keyId: rotatedKey.keyId });
  },
  
  async function testDisableEnableKey(testCtx: TestContext): Promise<void> {
    const kms = testCtx.provider.kms();
    if (!kms) throw new Error('KMS capability not available');
    
    const keyInfo = await kms.createKey(testCtx.ctx, {
      keyUsage: 'ENCRYPT_DECRYPT'
    });
    
    // Disable key
    await kms.setKeyEnabled(testCtx.ctx, keyInfo.keyId, false);
    
    const disabledKey = await kms.getKey(testCtx.ctx, keyInfo.keyId);
    if (disabledKey.enabled) throw new Error('key should be disabled');
    
    // Re-enable key
    await kms.setKeyEnabled(testCtx.ctx, keyInfo.keyId, true);
    
    const enabledKey = await kms.getKey(testCtx.ctx, keyInfo.keyId);
    if (!enabledKey.enabled) throw new Error('key should be enabled');
    
    testCtx.ctx.logger.info('✓ Key enable/disable successful', { keyId: keyInfo.keyId });
  },
  
  // Error Handling Tests
  async function testKeyNotFound(testCtx: TestContext): Promise<void> {
    const kms = testCtx.provider.kms();
    if (!kms) throw new Error('KMS capability not available');
    
    const nonexistentKeyId = 'nonexistent-key-id';
    
    try {
      await kms.getKey(testCtx.ctx, nonexistentKeyId);
      throw new Error('should have thrown NotFoundError');
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        throw new Error(`Expected NotFoundError, got ${error.constructor.name}: ${error.message}`);
      }
      if (error.code !== ErrorCode.NotFound) throw new Error('error code mismatch');
    }
    
    testCtx.ctx.logger.info('✓ Key not found error handled correctly');
  },
  
  async function testEncryptWithDisabledKey(testCtx: TestContext): Promise<void> {
    const kms = testCtx.provider.kms();
    if (!kms) throw new Error('KMS capability not available');
    
    const keyInfo = await kms.createKey(testCtx.ctx, {
      keyUsage: 'ENCRYPT_DECRYPT'
    });
    
    // Disable the key
    await kms.setKeyEnabled(testCtx.ctx, keyInfo.keyId, false);
    
    try {
      await kms.encrypt(testCtx.ctx, testCtx.randomBytes(16), {
        keyId: keyInfo.keyId
      });
      throw new Error('should have thrown PermissionDeniedError');
    } catch (error) {
      if (!(error instanceof PermissionDeniedError)) {
        throw new Error(`Expected PermissionDeniedError, got ${error.constructor.name}: ${error.message}`);
      }
    }
    
    testCtx.ctx.logger.info('✓ Disabled key encryption correctly rejected');
  },
  
  async function testInvalidKeyUsage(testCtx: TestContext): Promise<void> {
    const kms = testCtx.provider.kms();
    if (!kms) throw new Error('KMS capability not available');
    
    // Create signing key
    const signingKey = await kms.createKey(testCtx.ctx, {
      keyUsage: 'SIGN_VERIFY'
    });
    
    try {
      // Try to encrypt with signing key
      await kms.encrypt(testCtx.ctx, testCtx.randomBytes(16), {
        keyId: signingKey.keyId
      });
      throw new Error('should have thrown error for invalid key usage');
    } catch (error) {
      // Should be InvalidConfigError or PermissionDeniedError
      const validErrorTypes = [InvalidConfigError, PermissionDeniedError];
      if (!validErrorTypes.some(ErrorType => error instanceof ErrorType)) {
        throw new Error(`Expected InvalidConfigError or PermissionDeniedError, got ${error.constructor.name}`);
      }
    }
    
    testCtx.ctx.logger.info('✓ Invalid key usage correctly rejected');
  },
  
  async function testAliasHandling(testCtx: TestContext): Promise<void> {
    const kms = testCtx.provider.kms();
    if (!kms) throw new Error('KMS capability not available');
    
    const alias = testCtx.namespacedKey('test-alias');
    
    const keyInfo = await kms.createKey(testCtx.ctx, {
      keyUsage: 'ENCRYPT_DECRYPT',
      alias
    });
    
    // Should be able to get key by alias
    const keyByAlias = await kms.getKey(testCtx.ctx, alias);
    if (keyByAlias.keyId !== keyInfo.keyId) throw new Error('key retrieval by alias failed');
    
    // Should be able to encrypt using alias
    const plaintext = testCtx.randomBytes(32);
    const encryptResult = await kms.encrypt(testCtx.ctx, plaintext, {
      keyId: alias
    });
    
    const decryptResult = await kms.decrypt(testCtx.ctx, encryptResult.ciphertext, {
      keyId: keyInfo.keyId // Use actual keyId for decrypt
    });
    
    if (!testCtx.arraysEqual(new Uint8Array(decryptResult.plaintext), plaintext)) {
      throw new Error('encrypt with alias, decrypt with keyId failed');
    }
    
    testCtx.ctx.logger.info('✓ Alias handling successful', { alias, keyId: keyInfo.keyId });
  }
];

/**
 * Helper function to check if arrays are equal
 */
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}