#!/usr/bin/env tsx

/**
 * RAGnos Vault Bootstrap Script
 * Creates initial workspace and API token for testing
 */

import { randomBytes } from 'crypto';
import argon2 from 'argon2';

// Generate test data
async function bootstrap() {
  console.log('🚀 RAGnos Vault Bootstrap');
  
  // Generate workspace
  const workspaceId = crypto.randomUUID();
  const workspaceSlug = 'default-workspace';
  const workspaceName = 'Default Workspace';
  
  // Generate API token
  const tokenValue = generateToken();
  const hashedToken = await argon2.hash(tokenValue);
  const tokenId = crypto.randomUUID();
  
  console.log('📋 Workspace Created:');
  console.log(`  ID: ${workspaceId}`);
  console.log(`  Name: ${workspaceName}`);
  console.log(`  Slug: ${workspaceSlug}`);
  
  console.log('\n🔑 API Token Generated:');
  console.log(`  ID: ${tokenId}`);
  console.log(`  Token: ${tokenValue}`);
  console.log(`  Role: admin`);
  
  console.log('\n📝 SQL Insert Statements:');
  console.log('-- Insert workspace');
  console.log(`INSERT INTO vault_workspaces (id, name, slug, encryption_key_hash) VALUES ('${workspaceId}', '${workspaceName}', '${workspaceSlug}', 'placeholder-hash');`);
  
  console.log('\n-- Insert API token');
  console.log(`INSERT INTO vault_api_tokens (id, workspace_id, name, hashed_token, role) VALUES ('${tokenId}', '${workspaceId}', 'Bootstrap Token', '${hashedToken}', 'admin');`);
  
  console.log('\n🧪 Test Commands:');
  console.log(`export VAULT_TOKEN="${tokenValue}"`);
  console.log(`export WORKSPACE_ID="${workspaceId}"`);
  console.log(`curl -H "Authorization: Bearer $VAULT_TOKEN" http://localhost:4000/api/v1/vault/workspaces/$WORKSPACE_ID/secrets`);
}

function generateToken(): string {
  const TOKEN_LENGTH = 32;
  const TOKEN_PREFIX = 'vt_';
  const randomBytesValue = randomBytes(TOKEN_LENGTH);
  const tokenValue = randomBytesValue.toString('base64url');
  return `${TOKEN_PREFIX}${tokenValue}`;
}

bootstrap().catch(console.error);