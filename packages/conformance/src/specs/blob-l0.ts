/**
 * BlobStorage L0 Conformance Tests (Happy Path + Basic Failures)
 * Tests core blob storage operations and error taxonomy
 */

import { TestSpec, TestContext } from '../types';
import {
  ErrorFactory,
  ErrorCode,
  NotFoundError,
  InvalidConfigError,
  DataIntegrityError
} from '@ragnos-vault/sdk';
import { createHash } from 'crypto';

/**
 * L0 BlobStorage Test Specifications
 * Happy path and basic failure scenarios
 */
export const blobL0Specs: TestSpec[] = [
  
  // Basic Object Operations
  async function testPutGetObject(testCtx: TestContext): Promise<void> {
    const blob = testCtx.provider.blobStorage();
    if (!blob) throw new Error('BlobStorage capability not available');
    
    const key = testCtx.namespacedKey('test-object');
    const content = testCtx.randomBytes(1024);
    const contentType = 'application/octet-stream';
    const metadata = { test: 'conformance', timestamp: Date.now().toString() };
    
    // Put object
    const putResult = await blob.putObject(testCtx.ctx, key, content, {
      contentType,
      metadata
    });
    
    if (putResult.key !== key) throw new Error('key mismatch in put result');
    if (!putResult.etag) throw new Error('etag is required in put result');
    if (putResult.size !== content.length) throw new Error('size mismatch in put result');
    
    // Get object
    const getResult = await blob.getObject(testCtx.ctx, key);
    
    if (getResult.key !== key) throw new Error('key mismatch in get result');
    if (getResult.etag !== putResult.etag) throw new Error('etag mismatch');
    if (getResult.size !== content.length) throw new Error('size mismatch in get result');
    if (getResult.contentType !== contentType) throw new Error('contentType mismatch');
    
    // Validate metadata
    Object.entries(metadata).forEach(([k, v]) => {
      if (getResult.metadata[k] !== v) throw new Error(`metadata mismatch for ${k}`);
    });
    
    // Validate body content
    const retrievedContent = await collectAsyncIterable(getResult.body);
    if (!arraysEqual(retrievedContent, content)) {
      throw new Error('retrieved content does not match original');
    }
    
    testCtx.ctx.logger.info('✓ Put/get object successful', { 
      key, 
      size: content.length,
      etag: putResult.etag
    });
  },
  
  async function testPutObjectWithSHA256(testCtx: TestContext): Promise<void> {
    const blob = testCtx.provider.blobStorage();
    if (!blob) throw new Error('BlobStorage capability not available');
    
    const key = testCtx.namespacedKey('sha256-test');
    const content = testCtx.randomBytes(512);
    const sha256 = createHash('sha256').update(content).digest('hex');
    
    const putResult = await blob.putObject(testCtx.ctx, key, content, {
      sha256,
      contentType: 'text/plain'
    });
    
    if (putResult.sha256 && putResult.sha256 !== sha256) {
      throw new Error('SHA256 mismatch in put result');
    }
    
    testCtx.ctx.logger.info('✓ Put object with SHA256 verification successful', { key, sha256 });
  },
  
  async function testPutObjectWithInvalidSHA256(testCtx: TestContext): Promise<void> {
    const blob = testCtx.provider.blobStorage();
    if (!blob) throw new Error('BlobStorage capability not available');
    
    const key = testCtx.namespacedKey('invalid-sha256');
    const content = testCtx.randomBytes(256);
    const invalidSHA256 = 'invalid-sha256-hash';
    
    try {
      await blob.putObject(testCtx.ctx, key, content, {
        sha256: invalidSHA256
      });
      throw new Error('should have thrown DataIntegrityError for invalid SHA256');
    } catch (error) {
      if (!(error instanceof DataIntegrityError)) {
        throw new Error(`Expected DataIntegrityError, got ${error.constructor.name}: ${error.message}`);
      }
    }
    
    testCtx.ctx.logger.info('✓ Invalid SHA256 correctly rejected');
  },
  
  async function testObjectNotFound(testCtx: TestContext): Promise<void> {
    const blob = testCtx.provider.blobStorage();
    if (!blob) throw new Error('BlobStorage capability not available');
    
    const nonexistentKey = testCtx.namespacedKey('nonexistent-object');
    
    try {
      await blob.getObject(testCtx.ctx, nonexistentKey);
      throw new Error('should have thrown NotFoundError');
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        throw new Error(`Expected NotFoundError, got ${error.constructor.name}: ${error.message}`);
      }
      if (error.code !== ErrorCode.NotFound) throw new Error('error code mismatch');
    }
    
    testCtx.ctx.logger.info('✓ Object not found error handled correctly');
  },
  
  async function testDeleteObject(testCtx: TestContext): Promise<void> {
    const blob = testCtx.provider.blobStorage();
    if (!blob) throw new Error('BlobStorage capability not available');
    
    const key = testCtx.namespacedKey('delete-test');
    const content = testCtx.randomBytes(128);
    
    // Put object first
    await blob.putObject(testCtx.ctx, key, content);
    
    // Verify it exists
    const existsBefore = await blob.objectExists(testCtx.ctx, key);
    if (!existsBefore) throw new Error('object should exist before deletion');
    
    // Delete it
    await blob.deleteObject(testCtx.ctx, key);
    
    // Verify it's gone
    const existsAfter = await blob.objectExists(testCtx.ctx, key);
    if (existsAfter) throw new Error('object should not exist after deletion');
    
    // Delete should be idempotent
    await blob.deleteObject(testCtx.ctx, key); // Should not throw
    
    testCtx.ctx.logger.info('✓ Delete object successful', { key });
  },
  
  async function testHeadObject(testCtx: TestContext): Promise<void> {
    const blob = testCtx.provider.blobStorage();
    if (!blob) throw new Error('BlobStorage capability not available');
    
    const key = testCtx.namespacedKey('head-test');
    const content = testCtx.randomBytes(256);
    const contentType = 'application/json';
    const metadata = { purpose: 'head-test' };
    
    const putResult = await blob.putObject(testCtx.ctx, key, content, {
      contentType,
      metadata
    });
    
    const headResult = await blob.headObject(testCtx.ctx, key);
    
    if (headResult.key !== key) throw new Error('key mismatch in head result');
    if (headResult.etag !== putResult.etag) throw new Error('etag mismatch in head result');
    if (headResult.size !== content.length) throw new Error('size mismatch in head result');
    if (headResult.contentType !== contentType) throw new Error('contentType mismatch in head result');
    if (headResult.metadata.purpose !== metadata.purpose) throw new Error('metadata mismatch in head result');
    
    testCtx.ctx.logger.info('✓ Head object successful', { key, etag: headResult.etag });
  },
  
  // Object Listing Tests
  async function testListObjects(testCtx: TestContext): Promise<void> {
    const blob = testCtx.provider.blobStorage();
    if (!blob) throw new Error('BlobStorage capability not available');
    
    const prefix = testCtx.namespacedKey('list-test');
    const objects = [
      `${prefix}/object1`,
      `${prefix}/object2`,
      `${prefix}/subdir/object3`
    ];
    
    // Create test objects
    for (const key of objects) {
      await blob.putObject(testCtx.ctx, key, testCtx.randomBytes(64));
    }
    
    // List with prefix
    const listResult = await blob.listObjects(testCtx.ctx, {
      prefix: `${prefix}/`,
      maxKeys: 10
    });
    
    if (!Array.isArray(listResult.objects)) throw new Error('objects must be array');
    if (listResult.objects.length !== 3) throw new Error(`expected 3 objects, got ${listResult.objects.length}`);
    
    // Validate object structure
    const obj = listResult.objects[0];
    if (!obj.key) throw new Error('key required in list result');
    if (!obj.etag) throw new Error('etag required in list result');
    if (!obj.lastModified) throw new Error('lastModified required in list result');
    if (typeof obj.size !== 'number') throw new Error('size must be number');
    
    // Verify all expected objects are present
    const listedKeys = listResult.objects.map(o => o.key).sort();
    const expectedKeys = objects.sort();
    if (!arraysEqual(listedKeys, expectedKeys)) {
      throw new Error(`key mismatch: expected ${expectedKeys}, got ${listedKeys}`);
    }
    
    testCtx.ctx.logger.info('✓ List objects successful', { 
      prefix: `${prefix}/`, 
      count: listResult.objects.length 
    });
  },
  
  async function testListObjectsPagination(testCtx: TestContext): Promise<void> {
    const blob = testCtx.provider.blobStorage();
    if (!blob) throw new Error('BlobStorage capability not available');
    
    const prefix = testCtx.namespacedKey('pagination-test');
    const objectCount = 5;
    const pageSize = 2;
    
    // Create test objects
    for (let i = 0; i < objectCount; i++) {
      await blob.putObject(testCtx.ctx, `${prefix}/object${i.toString().padStart(3, '0')}`, 
        testCtx.randomBytes(32));
    }
    
    const allObjects: string[] = [];
    let continuationToken: string | undefined;
    
    // Page through results
    do {
      const listResult = await blob.listObjects(testCtx.ctx, {
        prefix: `${prefix}/`,
        maxKeys: pageSize,
        continuationToken
      });
      
      allObjects.push(...listResult.objects.map(o => o.key));
      continuationToken = listResult.continuationToken;
      
      if (listResult.objects.length > pageSize) {
        throw new Error(`page size exceeded: got ${listResult.objects.length}, expected <= ${pageSize}`);
      }
      
    } while (continuationToken);
    
    if (allObjects.length !== objectCount) {
      throw new Error(`expected ${objectCount} objects, got ${allObjects.length}`);
    }
    
    testCtx.ctx.logger.info('✓ List objects pagination successful', { 
      totalObjects: allObjects.length,
      pageSize
    });
  },
  
  // Range Request Tests
  async function testGetObjectRange(testCtx: TestContext): Promise<void> {
    const blob = testCtx.provider.blobStorage();
    if (!blob) throw new Error('BlobStorage capability not available');
    
    const key = testCtx.namespacedKey('range-test');
    const content = testCtx.generateContent(1024, 'ABCDEFGH'); // Repeating pattern
    
    await blob.putObject(testCtx.ctx, key, content);
    
    // Get range 100-199 (100 bytes)
    const rangeResult = await blob.getObject(testCtx.ctx, key, {
      range: { start: 100, end: 199 }
    });
    
    const rangeContent = await collectAsyncIterable(rangeResult.body);
    const expectedRange = content.slice(100, 200);
    
    if (!arraysEqual(rangeContent, expectedRange)) {
      throw new Error('range content does not match expected slice');
    }
    
    if (rangeContent.length !== 100) {
      throw new Error(`expected 100 bytes, got ${rangeContent.length}`);
    }
    
    testCtx.ctx.logger.info('✓ Range request successful', { 
      key,
      range: '100-199',
      size: rangeContent.length
    });
  },
  
  async function testGetObjectInvalidRange(testCtx: TestContext): Promise<void> {
    const blob = testCtx.provider.blobStorage();
    if (!blob) throw new Error('BlobStorage capability not available');
    
    const key = testCtx.namespacedKey('invalid-range-test');
    const content = testCtx.randomBytes(100);
    
    await blob.putObject(testCtx.ctx, key, content);
    
    try {
      // Request range beyond object size
      await blob.getObject(testCtx.ctx, key, {
        range: { start: 200, end: 300 }
      });
      throw new Error('should have thrown error for invalid range');
    } catch (error) {
      if (!(error instanceof InvalidConfigError)) {
        throw new Error(`Expected InvalidConfigError, got ${error.constructor.name}`);
      }
    }
    
    testCtx.ctx.logger.info('✓ Invalid range correctly rejected');
  },
  
  // Copy Operations
  async function testCopyObject(testCtx: TestContext): Promise<void> {
    const blob = testCtx.provider.blobStorage();
    if (!blob) throw new Error('BlobStorage capability not available');
    
    const sourceKey = testCtx.namespacedKey('copy-source');
    const destKey = testCtx.namespacedKey('copy-dest');
    const content = testCtx.randomBytes(512);
    const metadata = { original: 'true' };
    
    // Create source object
    await blob.putObject(testCtx.ctx, sourceKey, content, {
      contentType: 'text/plain',
      metadata
    });
    
    // Copy it
    const copyResult = await blob.copyObject(testCtx.ctx, sourceKey, destKey, {
      metadata: { ...metadata, copied: 'true' }
    });
    
    if (copyResult.key !== destKey) throw new Error('destination key mismatch in copy result');
    if (copyResult.size !== content.length) throw new Error('size mismatch in copy result');
    
    // Verify copied object
    const copiedObject = await blob.getObject(testCtx.ctx, destKey);
    const copiedContent = await collectAsyncIterable(copiedObject.body);
    
    if (!arraysEqual(copiedContent, content)) {
      throw new Error('copied content does not match original');
    }
    
    if (copiedObject.metadata.copied !== 'true') {
      throw new Error('copied metadata not updated');
    }
    
    testCtx.ctx.logger.info('✓ Copy object successful', { sourceKey, destKey });
  },
  
  // Multipart Upload Tests
  async function testMultipartUpload(testCtx: TestContext): Promise<void> {
    const blob = testCtx.provider.blobStorage();
    if (!blob) throw new Error('BlobStorage capability not available');
    
    const key = testCtx.namespacedKey('multipart-test');
    const part1 = testCtx.randomBytes(1024);
    const part2 = testCtx.randomBytes(1024);
    const part3 = testCtx.randomBytes(512);
    const expectedContent = new Uint8Array(part1.length + part2.length + part3.length);
    expectedContent.set(part1, 0);
    expectedContent.set(part2, part1.length);
    expectedContent.set(part3, part1.length + part2.length);
    
    // Create multipart upload
    const createResult = await blob.createMultipartUpload(testCtx.ctx, key, {
      contentType: 'application/octet-stream'
    });
    
    if (!createResult.uploadId) throw new Error('uploadId is required');
    if (createResult.key !== key) throw new Error('key mismatch in create multipart result');
    
    // Upload parts
    const uploadedParts = [];
    
    const part1Result = await blob.uploadPart(testCtx.ctx, createResult.uploadId, 1, part1);
    uploadedParts.push({ partNumber: 1, etag: part1Result.etag });
    
    const part2Result = await blob.uploadPart(testCtx.ctx, createResult.uploadId, 2, part2);
    uploadedParts.push({ partNumber: 2, etag: part2Result.etag });
    
    const part3Result = await blob.uploadPart(testCtx.ctx, createResult.uploadId, 3, part3);
    uploadedParts.push({ partNumber: 3, etag: part3Result.etag });
    
    // Complete multipart upload
    const completeResult = await blob.completeMultipartUpload(testCtx.ctx, createResult.uploadId, uploadedParts);
    
    if (completeResult.key !== key) throw new Error('key mismatch in complete multipart result');
    if (completeResult.size !== expectedContent.length) throw new Error('size mismatch in complete multipart result');
    
    // Verify the completed object
    const finalObject = await blob.getObject(testCtx.ctx, key);
    const finalContent = await collectAsyncIterable(finalObject.body);
    
    if (!arraysEqual(finalContent, expectedContent)) {
      throw new Error('multipart upload content does not match expected');
    }
    
    testCtx.ctx.logger.info('✓ Multipart upload successful', { 
      key,
      uploadId: createResult.uploadId,
      parts: uploadedParts.length,
      totalSize: completeResult.size
    });
  },
  
  async function testAbortMultipartUpload(testCtx: TestContext): Promise<void> {
    const blob = testCtx.provider.blobStorage();
    if (!blob) throw new Error('BlobStorage capability not available');
    
    const key = testCtx.namespacedKey('abort-multipart-test');
    
    // Create multipart upload
    const createResult = await blob.createMultipartUpload(testCtx.ctx, key);
    
    // Upload one part
    await blob.uploadPart(testCtx.ctx, createResult.uploadId, 1, testCtx.randomBytes(512));
    
    // Abort the upload
    await blob.abortMultipartUpload(testCtx.ctx, createResult.uploadId);
    
    // Verify object doesn't exist
    const exists = await blob.objectExists(testCtx.ctx, key);
    if (exists) throw new Error('object should not exist after abort multipart upload');
    
    testCtx.ctx.logger.info('✓ Abort multipart upload successful', { 
      uploadId: createResult.uploadId 
    });
  },
  
  // Signed URL Tests (Mock implementation)
  async function testCreateSignedUrl(testCtx: TestContext): Promise<void> {
    const blob = testCtx.provider.blobStorage();
    if (!blob) throw new Error('BlobStorage capability not available');
    
    const key = testCtx.namespacedKey('signed-url-test');
    const expiresIn = 3600; // 1 hour
    
    const signedUrlResult = await blob.createSignedUrl(testCtx.ctx, key, {
      method: 'GET',
      expiresIn
    });
    
    if (!signedUrlResult.url) throw new Error('url is required in signed URL result');
    if (!signedUrlResult.expiresAt) throw new Error('expiresAt is required in signed URL result');
    if (signedUrlResult.method !== 'GET') throw new Error('method mismatch in signed URL result');
    
    // Verify expiration time is reasonable
    const expectedExpiry = new Date(Date.now() + expiresIn * 1000);
    const timeDiff = Math.abs(signedUrlResult.expiresAt.getTime() - expectedExpiry.getTime());
    if (timeDiff > 5000) { // 5 second tolerance
      throw new Error('expiration time is incorrect');
    }
    
    testCtx.ctx.logger.info('✓ Create signed URL successful', { 
      method: signedUrlResult.method,
      expiresIn
    });
  }
];

/**
 * Helper functions
 */
async function collectAsyncIterable(iterable: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  
  return result;
}

function arraysEqual<T>(a: T[], b: T[]): boolean;
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean;
function arraysEqual(a: any, b: any): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}