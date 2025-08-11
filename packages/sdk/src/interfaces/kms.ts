/**
 * Key Management Service (KMS) Interface
 * Encryption, decryption, signing, and key management operations
 */

import { ProviderContext } from '../types/context';

/**
 * KMS operation options
 */
export interface KmsBaseOptions {
  idempotencyKey?: string;
}

export interface EncryptOptions extends KmsBaseOptions {
  keyId: string;
  aad?: Uint8Array; // Additional Authenticated Data
  algorithm?: string; // Optional algorithm hint
}

export interface DecryptOptions extends KmsBaseOptions {
  keyId?: string; // Optional if encoded in ciphertext
}

export interface SignOptions extends KmsBaseOptions {
  keyId: string;
  algorithm?: string; // e.g., 'RSASSA_PSS_SHA_256', 'ECDSA_SHA_256'
}

export interface VerifyOptions extends KmsBaseOptions {
  keyId: string;
  algorithm?: string;
}

export interface CreateKeyOptions extends KmsBaseOptions {
  keyUsage: 'ENCRYPT_DECRYPT' | 'SIGN_VERIFY';
  algorithm?: string;
  alias?: string;
  description?: string;
  tags?: Record<string, string>;
}

export interface KeyInfo {
  keyId: string;
  alias?: string;
  algorithm: string;
  keyUsage: string;
  enabled: boolean;
  createdAt: Date;
  description?: string;
  tags?: Record<string, string>;
}

/**
 * KMS operation results
 */
export interface EncryptResult {
  ciphertext: Uint8Array;
  algorithm: string;
  keyId: string;
  aad?: Uint8Array;
}

export interface DecryptResult {
  plaintext: Uint8Array;
  algorithm: string;
  keyId: string;
  aad?: Uint8Array;
}

export interface SignResult {
  signature: Uint8Array;
  algorithm: string;
  keyId: string;
}

export interface VerifyResult {
  valid: boolean;
  algorithm: string;
  keyId: string;
}

/**
 * Key Management Service interface
 */
export interface KmsProvider {
  /**
   * Encrypt plaintext data using the specified key
   */
  encrypt(
    ctx: ProviderContext,
    input: Uint8Array, 
    options: EncryptOptions
  ): Promise<EncryptResult>;
  
  /**
   * Decrypt ciphertext data
   */
  decrypt(
    ctx: ProviderContext,
    ciphertext: Uint8Array, 
    options: DecryptOptions
  ): Promise<DecryptResult>;
  
  /**
   * Sign data using the specified key
   */
  sign(
    ctx: ProviderContext,
    data: Uint8Array, 
    options: SignOptions
  ): Promise<SignResult>;
  
  /**
   * Verify a signature
   */
  verify(
    ctx: ProviderContext,
    data: Uint8Array, 
    signature: Uint8Array,
    options: VerifyOptions
  ): Promise<VerifyResult>;
  
  /**
   * Create a new key
   */
  createKey(
    ctx: ProviderContext,
    options: CreateKeyOptions
  ): Promise<KeyInfo>;
  
  /**
   * Rotate an existing key
   */
  rotateKey(
    ctx: ProviderContext,
    keyId: string,
    options?: KmsBaseOptions
  ): Promise<KeyInfo>;
  
  /**
   * Get key information
   */
  getKey(
    ctx: ProviderContext,
    keyId: string,
    options?: KmsBaseOptions
  ): Promise<KeyInfo>;
  
  /**
   * List keys
   */
  listKeys(
    ctx: ProviderContext,
    options?: {
      limit?: number;
      nextToken?: string;
    } & KmsBaseOptions
  ): Promise<{
    keys: KeyInfo[];
    nextToken?: string;
  }>;
  
  /**
   * Enable/disable a key
   */
  setKeyEnabled(
    ctx: ProviderContext,
    keyId: string,
    enabled: boolean,
    options?: KmsBaseOptions
  ): Promise<void>;
}