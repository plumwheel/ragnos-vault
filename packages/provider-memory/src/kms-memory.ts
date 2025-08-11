/**
 * Memory KMS Provider Implementation
 * In-memory key management service for testing and development
 */

import { randomBytes, createCipher, createDecipher, createHash, createSign, createVerify } from 'crypto';
import {
  KmsProvider,
  ProviderContext,
  EncryptOptions,
  DecryptOptions,
  SignOptions,
  VerifyOptions,
  CreateKeyOptions,
  KmsBaseOptions,
  EncryptResult,
  DecryptResult,
  SignResult,
  VerifyResult,
  KeyInfo,
  ErrorFactory,
  ErrorCode
} from '@ragnos-vault/sdk';
import { MemoryProviderConfig } from './config';

/**
 * Key states
 */
enum KeyState {
  Enabled = 'Enabled',
  Disabled = 'Disabled',
  PendingDeletion = 'PendingDeletion'
}

/**
 * Key algorithms
 */
enum KeyAlgorithm {
  AES_256_GCM = 'AES_256_GCM',
  RSA_2048 = 'RSA_2048',
  ECDSA_P256 = 'ECDSA_P256'
}

/**
 * Internal key representation
 */
interface MemoryKey {
  keyId: string;
  alias?: string;
  algorithm: KeyAlgorithm;
  keyUsage: 'ENCRYPT_DECRYPT' | 'SIGN_VERIFY';
  state: KeyState;
  material: Buffer; // Raw key material
  createdAt: Date;
  description?: string;
  tags?: Record<string, string>;
  version: number;
}

/**
 * Encrypted data format
 */
interface EncryptedData {
  version: number;
  algorithm: string;
  keyId: string;
  iv: Buffer;
  ciphertext: Buffer;
  aad?: Buffer;
  tag: Buffer;
}

/**
 * KMS Memory Implementation
 */
export class KmsMemory implements KmsProvider {
  private keys = new Map<string, MemoryKey>();
  private aliases = new Map<string, string>(); // alias -> keyId
  private keyVersions = new Map<string, number>(); // keyId -> latest version
  private operationCounts = new Map<string, number>();
  
  constructor(private config: MemoryProviderConfig) {}
  
  async encrypt(ctx: ProviderContext, input: Uint8Array, options: EncryptOptions): Promise<EncryptResult> {
    this.checkRateLimit('encrypt', ctx);
    
    const key = await this.getKeyForOperation(options.keyId, 'ENCRYPT_DECRYPT', ctx);
    
    if (key.algorithm !== KeyAlgorithm.AES_256_GCM) {
      throw ErrorFactory.create(
        ErrorCode.InvalidConfig,
        `Key ${key.keyId} algorithm ${key.algorithm} does not support encryption`,
        'memory-kms',
        { keyId: key.keyId, algorithm: key.algorithm }
      );
    }
    
    // Generate random IV
    const iv = randomBytes(12); // 96 bits for GCM
    
    // Create cipher
    const cipher = createCipher('aes-256-gcm', key.material);
    cipher.setAAD(options.aad || Buffer.alloc(0));
    
    // Encrypt
    const chunks: Buffer[] = [];
    chunks.push(cipher.update(Buffer.from(input)));
    chunks.push(cipher.final());
    const ciphertext = Buffer.concat(chunks);
    const tag = cipher.getAuthTag();
    
    // Create encrypted data structure
    const encryptedData: EncryptedData = {
      version: 1,
      algorithm: key.algorithm,
      keyId: key.keyId,
      iv,
      ciphertext,
      aad: options.aad ? Buffer.from(options.aad) : undefined,
      tag
    };
    
    // Serialize to bytes
    const serialized = this.serializeEncryptedData(encryptedData);
    
    return {
      ciphertext: new Uint8Array(serialized),
      algorithm: key.algorithm,
      keyId: key.keyId,
      aad: options.aad
    };
  }
  
  async decrypt(ctx: ProviderContext, ciphertext: Uint8Array, options: DecryptOptions): Promise<DecryptResult> {
    this.checkRateLimit('decrypt', ctx);
    
    // Deserialize encrypted data
    const encryptedData = this.deserializeEncryptedData(Buffer.from(ciphertext));
    
    const keyId = options.keyId || encryptedData.keyId;
    const key = await this.getKeyForOperation(keyId, 'ENCRYPT_DECRYPT', ctx);
    
    if (key.algorithm !== encryptedData.algorithm) {
      throw ErrorFactory.create(
        ErrorCode.DataIntegrity,
        `Key algorithm mismatch: key=${key.algorithm}, data=${encryptedData.algorithm}`,
        'memory-kms',
        { keyId: key.keyId }
      );
    }
    
    // Create decipher
    const decipher = createDecipher('aes-256-gcm', key.material);
    if (encryptedData.aad) {
      decipher.setAAD(encryptedData.aad);
    }
    decipher.setAuthTag(encryptedData.tag);
    
    // Decrypt
    try {
      const chunks: Buffer[] = [];
      chunks.push(decipher.update(encryptedData.ciphertext));
      chunks.push(decipher.final());
      const plaintext = Buffer.concat(chunks);
      
      return {
        plaintext: new Uint8Array(plaintext),
        algorithm: encryptedData.algorithm,
        keyId: key.keyId,
        aad: encryptedData.aad ? new Uint8Array(encryptedData.aad) : undefined
      };
      
    } catch (error) {
      throw ErrorFactory.create(
        ErrorCode.DataIntegrity,
        `Decryption failed: ${error.message}`,
        'memory-kms',
        { keyId: key.keyId },
        error
      );
    }
  }
  
  async sign(ctx: ProviderContext, data: Uint8Array, options: SignOptions): Promise<SignResult> {
    this.checkRateLimit('sign', ctx);
    
    const key = await this.getKeyForOperation(options.keyId, 'SIGN_VERIFY', ctx);
    
    let algorithm: string;
    let signAlgorithm: string;
    
    switch (key.algorithm) {
      case KeyAlgorithm.RSA_2048:
        algorithm = 'RSA-SHA256';
        signAlgorithm = 'sha256WithRSAEncryption';
        break;
      case KeyAlgorithm.ECDSA_P256:
        algorithm = 'ECDSA-SHA256';
        signAlgorithm = 'sha256';
        break;
      default:
        throw ErrorFactory.create(
          ErrorCode.InvalidConfig,
          `Key ${key.keyId} algorithm ${key.algorithm} does not support signing`,
          'memory-kms',
          { keyId: key.keyId }
        );
    }
    
    const signer = createSign(signAlgorithm);
    signer.update(Buffer.from(data));
    const signature = signer.sign(key.material);
    
    return {
      signature: new Uint8Array(signature),
      algorithm,
      keyId: key.keyId
    };
  }
  
  async verify(ctx: ProviderContext, data: Uint8Array, signature: Uint8Array, options: VerifyOptions): Promise<VerifyResult> {
    this.checkRateLimit('verify', ctx);
    
    const key = await this.getKeyForOperation(options.keyId, 'SIGN_VERIFY', ctx);
    
    let algorithm: string;
    let verifyAlgorithm: string;
    
    switch (key.algorithm) {
      case KeyAlgorithm.RSA_2048:
        algorithm = 'RSA-SHA256';
        verifyAlgorithm = 'sha256WithRSAEncryption';
        break;
      case KeyAlgorithm.ECDSA_P256:
        algorithm = 'ECDSA-SHA256';
        verifyAlgorithm = 'sha256';
        break;
      default:
        throw ErrorFactory.create(
          ErrorCode.InvalidConfig,
          `Key ${key.keyId} algorithm ${key.algorithm} does not support verification`,
          'memory-kms',
          { keyId: key.keyId }
        );
    }
    
    const verifier = createVerify(verifyAlgorithm);
    verifier.update(Buffer.from(data));
    const valid = verifier.verify(key.material, Buffer.from(signature));
    
    return {
      valid,
      algorithm,
      keyId: key.keyId
    };
  }
  
  async createKey(ctx: ProviderContext, options: CreateKeyOptions): Promise<KeyInfo> {
    this.checkRateLimit('createKey', ctx);
    
    const keyId = `key-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Generate key material based on algorithm
    let material: Buffer;
    let algorithm: KeyAlgorithm;
    
    const algHint = options.algorithm?.toUpperCase();
    
    if (options.keyUsage === 'ENCRYPT_DECRYPT') {
      algorithm = KeyAlgorithm.AES_256_GCM;
      material = randomBytes(32); // 256 bits
    } else if (options.keyUsage === 'SIGN_VERIFY') {
      if (algHint === 'RSA' || algHint === 'RSA_2048') {
        algorithm = KeyAlgorithm.RSA_2048;
        // Generate RSA key pair (simplified - use fixed test key)
        material = Buffer.from('rsa-2048-private-key-material', 'utf8');
      } else {
        algorithm = KeyAlgorithm.ECDSA_P256;
        // Generate ECDSA key pair (simplified)
        material = Buffer.from('ecdsa-p256-private-key-material', 'utf8');
      }
    } else {
      throw ErrorFactory.create(
        ErrorCode.InvalidConfig,
        `Unsupported key usage: ${options.keyUsage}`,
        'memory-kms'
      );
    }
    
    const key: MemoryKey = {
      keyId,
      alias: options.alias,
      algorithm,
      keyUsage: options.keyUsage,
      state: KeyState.Enabled,
      material,
      createdAt: new Date(),
      description: options.description,
      tags: options.tags,
      version: 1
    };
    
    this.keys.set(keyId, key);
    this.keyVersions.set(keyId, 1);
    
    if (options.alias) {
      if (this.aliases.has(options.alias)) {
        throw ErrorFactory.create(
          ErrorCode.AlreadyExists,
          `Key alias ${options.alias} already exists`,
          'memory-kms',
          { alias: options.alias }
        );
      }
      this.aliases.set(options.alias, keyId);
    }
    
    return this.keyToInfo(key);
  }
  
  async rotateKey(ctx: ProviderContext, keyId: string, options?: KmsBaseOptions): Promise<KeyInfo> {
    this.checkRateLimit('rotateKey', ctx);
    
    const key = await this.getKeyForOperation(keyId, undefined, ctx);
    
    // Create new version of the key
    const newVersion = (this.keyVersions.get(key.keyId) || 0) + 1;
    
    // Generate new key material
    let newMaterial: Buffer;
    
    if (key.algorithm === KeyAlgorithm.AES_256_GCM) {
      newMaterial = randomBytes(32);
    } else {
      // For signing keys, generate new key pair
      newMaterial = Buffer.from(`${key.algorithm.toLowerCase()}-rotated-${newVersion}`, 'utf8');
    }
    
    const rotatedKey: MemoryKey = {
      ...key,
      material: newMaterial,
      version: newVersion,
      createdAt: new Date()
    };
    
    this.keys.set(key.keyId, rotatedKey);
    this.keyVersions.set(key.keyId, newVersion);
    
    return this.keyToInfo(rotatedKey);
  }
  
  async getKey(ctx: ProviderContext, keyId: string, options?: KmsBaseOptions): Promise<KeyInfo> {
    this.checkRateLimit('getKey', ctx);
    
    const resolvedKeyId = this.resolveKeyId(keyId);
    const key = this.keys.get(resolvedKeyId);
    
    if (!key) {
      throw ErrorFactory.create(
        ErrorCode.NotFound,
        `Key not found: ${keyId}`,
        'memory-kms',
        { keyId }
      );
    }
    
    return this.keyToInfo(key);
  }
  
  async listKeys(ctx: ProviderContext, options?: { limit?: number; nextToken?: string } & KmsBaseOptions): Promise<{ keys: KeyInfo[]; nextToken?: string }> {
    this.checkRateLimit('listKeys', ctx);
    
    const allKeys = Array.from(this.keys.values());
    const limit = options?.limit || 100;
    const startIndex = options?.nextToken ? parseInt(options.nextToken, 10) : 0;
    
    const pageKeys = allKeys.slice(startIndex, startIndex + limit);
    const nextToken = (startIndex + limit < allKeys.length) ? (startIndex + limit).toString() : undefined;
    
    return {
      keys: pageKeys.map(key => this.keyToInfo(key)),
      nextToken
    };
  }
  
  async setKeyEnabled(ctx: ProviderContext, keyId: string, enabled: boolean, options?: KmsBaseOptions): Promise<void> {
    this.checkRateLimit('setKeyEnabled', ctx);
    
    const resolvedKeyId = this.resolveKeyId(keyId);
    const key = this.keys.get(resolvedKeyId);
    
    if (!key) {
      throw ErrorFactory.create(
        ErrorCode.NotFound,
        `Key not found: ${keyId}`,
        'memory-kms',
        { keyId }
      );
    }
    
    key.state = enabled ? KeyState.Enabled : KeyState.Disabled;
    this.keys.set(resolvedKeyId, key);
  }
  
  private async getKeyForOperation(keyId: string, requiredUsage?: string, ctx?: ProviderContext): Promise<MemoryKey> {
    const resolvedKeyId = this.resolveKeyId(keyId);
    const key = this.keys.get(resolvedKeyId);
    
    if (!key) {
      throw ErrorFactory.create(
        ErrorCode.NotFound,
        `Key not found: ${keyId}`,
        'memory-kms',
        { keyId }
      );
    }
    
    if (key.state === KeyState.Disabled) {
      throw ErrorFactory.create(
        ErrorCode.PermissionDenied,
        `Key is disabled: ${keyId}`,
        'memory-kms',
        { keyId }
      );
    }
    
    if (key.state === KeyState.PendingDeletion) {
      throw ErrorFactory.create(
        ErrorCode.PermissionDenied,
        `Key is pending deletion: ${keyId}`,
        'memory-kms',
        { keyId }
      );
    }
    
    if (requiredUsage && key.keyUsage !== requiredUsage) {
      throw ErrorFactory.create(
        ErrorCode.PermissionDenied,
        `Key usage mismatch: required=${requiredUsage}, actual=${key.keyUsage}`,
        'memory-kms',
        { keyId, requiredUsage, actualUsage: key.keyUsage }
      );
    }
    
    return key;
  }
  
  private resolveKeyId(keyIdOrAlias: string): string {
    // Check if it's an alias
    const resolvedKeyId = this.aliases.get(keyIdOrAlias);
    return resolvedKeyId || keyIdOrAlias;
  }
  
  private keyToInfo(key: MemoryKey): KeyInfo {
    return {
      keyId: key.keyId,
      alias: key.alias,
      algorithm: key.algorithm,
      keyUsage: key.keyUsage,
      enabled: key.state === KeyState.Enabled,
      createdAt: key.createdAt,
      description: key.description,
      tags: key.tags
    };
  }
  
  private checkRateLimit(operation: string, ctx: ProviderContext): void {
    if (!this.config.qpsLimits) return;
    
    const limit = this.config.qpsLimits[operation] || this.config.qpsLimits.default;
    const key = `${operation}:${ctx.tenantId}`;
    const count = (this.operationCounts.get(key) || 0) + 1;
    
    // Simple rate limiting (reset every second)
    if (count > limit) {
      throw ErrorFactory.create(
        ErrorCode.Throttled,
        `Rate limit exceeded for ${operation}: ${count}/${limit}`,
        'memory-kms',
        { operation, count, limit }
      );
    }
    
    this.operationCounts.set(key, count);
    
    // Reset counters periodically
    setTimeout(() => {
      this.operationCounts.delete(key);
    }, 1000);
  }
  
  private serializeEncryptedData(data: EncryptedData): Buffer {
    // Simple binary format: version(4) + keyIdLength(4) + keyId + ivLength(4) + iv + tagLength(4) + tag + aadLength(4) + aad? + ciphertext
    const keyIdBuffer = Buffer.from(data.keyId, 'utf8');
    const aadBuffer = data.aad || Buffer.alloc(0);
    
    const totalLength = 4 + 4 + keyIdBuffer.length + 4 + data.iv.length + 4 + data.tag.length + 4 + aadBuffer.length + data.ciphertext.length;
    const buffer = Buffer.allocUnsafe(totalLength);
    
    let offset = 0;
    buffer.writeUInt32BE(data.version, offset); offset += 4;
    buffer.writeUInt32BE(keyIdBuffer.length, offset); offset += 4;
    keyIdBuffer.copy(buffer, offset); offset += keyIdBuffer.length;
    buffer.writeUInt32BE(data.iv.length, offset); offset += 4;
    data.iv.copy(buffer, offset); offset += data.iv.length;
    buffer.writeUInt32BE(data.tag.length, offset); offset += 4;
    data.tag.copy(buffer, offset); offset += data.tag.length;
    buffer.writeUInt32BE(aadBuffer.length, offset); offset += 4;
    if (aadBuffer.length > 0) {
      aadBuffer.copy(buffer, offset); offset += aadBuffer.length;
    }
    data.ciphertext.copy(buffer, offset);
    
    return buffer;
  }
  
  private deserializeEncryptedData(buffer: Buffer): EncryptedData {
    let offset = 0;
    
    const version = buffer.readUInt32BE(offset); offset += 4;
    const keyIdLength = buffer.readUInt32BE(offset); offset += 4;
    const keyId = buffer.subarray(offset, offset + keyIdLength).toString('utf8'); offset += keyIdLength;
    const ivLength = buffer.readUInt32BE(offset); offset += 4;
    const iv = buffer.subarray(offset, offset + ivLength); offset += ivLength;
    const tagLength = buffer.readUInt32BE(offset); offset += 4;
    const tag = buffer.subarray(offset, offset + tagLength); offset += tagLength;
    const aadLength = buffer.readUInt32BE(offset); offset += 4;
    const aad = aadLength > 0 ? buffer.subarray(offset, offset + aadLength) : undefined; offset += aadLength;
    const ciphertext = buffer.subarray(offset);
    
    return {
      version,
      algorithm: KeyAlgorithm.AES_256_GCM, // Assume AES for now
      keyId,
      iv,
      ciphertext,
      aad,
      tag
    };
  }
}