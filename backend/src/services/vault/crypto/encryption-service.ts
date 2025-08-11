/**
 * RAGnos Vault - Encryption Service
 * Envelope encryption with workspace isolation and KMS integration
 */

import crypto from 'crypto';
import { VaultConfig, EncryptedData, DecryptedData, EncryptionError, VaultKeyring } from '../vault-types';

export interface KMSAdapter {
  encrypt(plaintext: Buffer): Promise<string>;
  decrypt(ciphertext: string): Promise<Buffer>;
  generateDataKey(): Promise<{ plaintext: Buffer; ciphertext: string }>;
}

export interface EncryptionService {
  encrypt(workspaceId: string, plaintext: string): Promise<EncryptedData>;
  decrypt(workspaceId: string, encryptedData: EncryptedData): Promise<DecryptedData>;
  rotateWorkspaceKey(workspaceId: string): Promise<VaultKeyring>;
  getKeyVersion(workspaceId: string): Promise<number>;
}

export class VaultEncryptionService implements EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyCache = new Map<string, { key: Buffer; version: number; expiry: number }>();
  private readonly cacheExpiryMs = 15 * 60 * 1000; // 15 minutes

  constructor(
    private readonly kmsAdapter: KMSAdapter,
    private readonly keyringService: KeyringService,
    private readonly config: VaultConfig
  ) {}

  async encrypt(workspaceId: string, plaintext: string): Promise<EncryptedData> {
    try {
      const workspaceKey = await this.getWorkspaceKey(workspaceId);
      const iv = crypto.randomBytes(16);
      
      const cipher = crypto.createCipher(this.algorithm, workspaceKey.key, iv);
      
      // Additional Authenticated Data (AAD) for workspace isolation
      const aad = Buffer.from(`workspace:${workspaceId}`, 'utf8');
      cipher.setAAD(aad);
      
      let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
      ciphertext += cipher.final('base64');
      
      const authTag = cipher.getAuthTag();
      
      return {
        ciphertext,
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        keyVersion: workspaceKey.version
      };
    } catch (error) {
      throw new EncryptionError(`Encryption failed: ${error.message}`);
    }
  }

  async decrypt(workspaceId: string, encryptedData: EncryptedData): Promise<DecryptedData> {
    try {
      const workspaceKey = await this.getWorkspaceKeyByVersion(workspaceId, encryptedData.keyVersion);
      const iv = Buffer.from(encryptedData.iv, 'base64');
      const authTag = Buffer.from(encryptedData.authTag, 'base64');
      
      const decipher = crypto.createDecipher(this.algorithm, workspaceKey.key, iv);
      
      // Set the same AAD used during encryption
      const aad = Buffer.from(`workspace:${workspaceId}`, 'utf8');
      decipher.setAAD(aad);
      decipher.setAuthTag(authTag);
      
      let plaintext = decipher.update(encryptedData.ciphertext, 'base64', 'utf8');
      plaintext += decipher.final('utf8');
      
      return {
        plaintext,
        keyVersion: encryptedData.keyVersion
      };
    } catch (error) {
      throw new EncryptionError(`Decryption failed: ${error.message}`);
    }
  }

  async rotateWorkspaceKey(workspaceId: string): Promise<VaultKeyring> {
    try {
      // Generate new DEK via KMS
      const { plaintext: newDek, ciphertext: encryptedDek } = await this.kmsAdapter.generateDataKey();
      
      // Create new keyring entry
      const newKeyring = await this.keyringService.createKeyring({
        workspaceId,
        encryptedDek,
        keyVersion: await this.getNextKeyVersion(workspaceId)
      });
      
      // Update cache with new key
      this.keyCache.set(workspaceId, {
        key: newDek,
        version: newKeyring.keyVersion,
        expiry: Date.now() + this.cacheExpiryMs
      });
      
      // Clear old keys from memory after brief delay
      setTimeout(() => {
        newDek.fill(0);
      }, 1000);
      
      return newKeyring;
    } catch (error) {
      throw new EncryptionError(`Key rotation failed: ${error.message}`);
    }
  }

  async getKeyVersion(workspaceId: string): Promise<number> {
    const cachedKey = this.keyCache.get(workspaceId);
    if (cachedKey && cachedKey.expiry > Date.now()) {
      return cachedKey.version;
    }
    
    return await this.keyringService.getLatestKeyVersion(workspaceId);
  }

  private async getWorkspaceKey(workspaceId: string): Promise<{ key: Buffer; version: number }> {
    // Check cache first
    const cached = this.keyCache.get(workspaceId);
    if (cached && cached.expiry > Date.now()) {
      return { key: cached.key, version: cached.version };
    }

    // Fetch latest keyring from database
    const keyring = await this.keyringService.getLatestKeyring(workspaceId);
    if (!keyring) {
      // Auto-create first keyring for workspace
      const newKeyring = await this.rotateWorkspaceKey(workspaceId);
      return await this.getWorkspaceKey(workspaceId); // Recursive call after creation
    }

    // Decrypt DEK using KMS
    const decryptedDek = await this.kmsAdapter.decrypt(keyring.encryptedDek);
    
    // Cache the key
    this.keyCache.set(workspaceId, {
      key: decryptedDek,
      version: keyring.keyVersion,
      expiry: Date.now() + this.cacheExpiryMs
    });

    return { key: decryptedDek, version: keyring.keyVersion };
  }

  private async getWorkspaceKeyByVersion(workspaceId: string, version: number): Promise<{ key: Buffer; version: number }> {
    // Check if cached key matches version
    const cached = this.keyCache.get(workspaceId);
    if (cached && cached.version === version && cached.expiry > Date.now()) {
      return { key: cached.key, version: cached.version };
    }

    // Fetch specific version from database
    const keyring = await this.keyringService.getKeyringByVersion(workspaceId, version);
    if (!keyring) {
      throw new EncryptionError(`Key version ${version} not found for workspace ${workspaceId}`);
    }

    // Decrypt DEK using KMS
    const decryptedDek = await this.kmsAdapter.decrypt(keyring.encryptedDek);
    
    return { key: decryptedDek, version: keyring.keyVersion };
  }

  private async getNextKeyVersion(workspaceId: string): Promise<number> {
    const currentVersion = await this.keyringService.getLatestKeyVersion(workspaceId);
    return currentVersion + 1;
  }

  // Utility methods for secure operations
  private constantTimeEqual(a: Buffer, b: Buffer): boolean {
    return crypto.timingSafeEqual(a, b);
  }

  private secureRandomBytes(size: number): Buffer {
    return crypto.randomBytes(size);
  }

  // Cleanup method to clear sensitive data from memory
  clearCache(): void {
    for (const [key, value] of this.keyCache.entries()) {
      value.key.fill(0); // Zero out the key bytes
    }
    this.keyCache.clear();
  }
}

// Local development KMS adapter (insecure - for development only)
export class LocalKMSAdapter implements KMSAdapter {
  private readonly masterKey: Buffer;

  constructor(masterKeyHex?: string) {
    if (masterKeyHex) {
      this.masterKey = Buffer.from(masterKeyHex, 'hex');
    } else {
      // Generate a random master key for development
      this.masterKey = crypto.randomBytes(32);
      console.warn('⚠️  Using random master key for development. Data will not persist across restarts.');
    }
  }

  async encrypt(plaintext: Buffer): Promise<string> {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-gcm', this.masterKey, iv);
    
    let ciphertext = cipher.update(plaintext);
    ciphertext = Buffer.concat([ciphertext, cipher.final()]);
    
    const authTag = cipher.getAuthTag();
    
    // Combine IV + ciphertext + authTag
    const combined = Buffer.concat([iv, ciphertext, authTag]);
    return combined.toString('base64');
  }

  async decrypt(ciphertext: string): Promise<Buffer> {
    const combined = Buffer.from(ciphertext, 'base64');
    
    const iv = combined.slice(0, 16);
    const encrypted = combined.slice(16, -16);
    const authTag = combined.slice(-16);
    
    const decipher = crypto.createDecipher('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted;
  }

  async generateDataKey(): Promise<{ plaintext: Buffer; ciphertext: string }> {
    const plaintext = crypto.randomBytes(32); // 256-bit key
    const ciphertext = await this.encrypt(plaintext);
    
    return { plaintext, ciphertext };
  }
}

// Keyring service interface (to be implemented with database layer)
export interface KeyringService {
  createKeyring(data: {
    workspaceId: string;
    encryptedDek: string;
    keyVersion: number;
  }): Promise<VaultKeyring>;
  
  getLatestKeyring(workspaceId: string): Promise<VaultKeyring | null>;
  getKeyringByVersion(workspaceId: string, version: number): Promise<VaultKeyring | null>;
  getLatestKeyVersion(workspaceId: string): Promise<number>;
}