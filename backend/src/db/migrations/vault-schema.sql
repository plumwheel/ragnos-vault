-- RAGnos Vault MVP Database Schema
-- Multi-tenant secrets management with audit trails

-- Extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Workspaces table (tenant isolation)
CREATE TABLE vault_workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  encryption_key_hash VARCHAR(255) NOT NULL, -- For key derivation verification
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  settings JSONB DEFAULT '{}',
  CONSTRAINT vault_workspaces_slug_format CHECK (slug ~ '^[a-z0-9-]+$'),
  CONSTRAINT vault_workspaces_slug_length CHECK (length(slug) BETWEEN 3 AND 63)
);

-- API tokens for authentication
CREATE TABLE vault_api_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES vault_workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  hashed_token VARCHAR(255) NOT NULL UNIQUE, -- Argon2 hashed
  role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'write', 'read')),
  scopes TEXT[] DEFAULT '{}', -- Array of permission strings
  last_used_at TIMESTAMP WITH TIME ZONE,
  last_used_ip INET,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by VARCHAR(255), -- User ID who created the token
  is_active BOOLEAN DEFAULT true,
  CONSTRAINT vault_tokens_name_workspace_unique UNIQUE(workspace_id, name)
);

-- Encryption keyrings (envelope encryption)
CREATE TABLE vault_keyrings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES vault_workspaces(id) ON DELETE CASCADE,
  encrypted_dek TEXT NOT NULL, -- KMS-encrypted data encryption key
  key_version INTEGER NOT NULL,
  rotated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  CONSTRAINT vault_keyrings_workspace_version_unique UNIQUE(workspace_id, key_version)
);

-- Secrets metadata (no plaintext values)
CREATE TABLE vault_secrets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES vault_workspaces(id) ON DELETE CASCADE,
  key VARCHAR(255) NOT NULL, -- Secret identifier within workspace
  type VARCHAR(50) NOT NULL DEFAULT 'string' CHECK (type IN ('string', 'json', 'binary')),
  current_version INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by VARCHAR(255),
  CONSTRAINT vault_secrets_workspace_key_unique UNIQUE(workspace_id, key),
  CONSTRAINT vault_secrets_key_format CHECK (key ~ '^[a-zA-Z0-9/_.-]+$'),
  CONSTRAINT vault_secrets_key_length CHECK (length(key) BETWEEN 1 AND 255)
);

-- Secret versions (encrypted values)
CREATE TABLE vault_secret_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  secret_id UUID NOT NULL REFERENCES vault_secrets(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  encrypted_value TEXT NOT NULL, -- Base64 encoded ciphertext
  encryption_iv VARCHAR(255) NOT NULL, -- Base64 encoded initialization vector
  auth_tag VARCHAR(255) NOT NULL, -- Base64 encoded authentication tag
  key_version INTEGER NOT NULL, -- References vault_keyrings.key_version
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  CONSTRAINT vault_secret_versions_secret_version_unique UNIQUE(secret_id, version)
);

-- Audit logs (comprehensive operation tracking)
CREATE TABLE vault_audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES vault_workspaces(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL CHECK (action IN ('CREATE', 'READ', 'UPDATE', 'DELETE', 'ROTATE', 'LOGIN')),
  resource_type VARCHAR(50) NOT NULL CHECK (resource_type IN ('secret', 'workspace', 'token', 'keyring')),
  resource_id VARCHAR(255), -- Secret key, workspace slug, token name, etc.
  user_id VARCHAR(255), -- User or service account identifier
  token_id UUID REFERENCES vault_api_tokens(id), -- Token used for operation
  ip_address INET,
  user_agent TEXT,
  request_id VARCHAR(255), -- For request correlation
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT, -- Only populated if success = false
  metadata JSONB DEFAULT '{}', -- Additional context
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- Partition-ready for time-based partitioning
  CONSTRAINT vault_audit_logs_created_at_check CHECK (created_at IS NOT NULL)
);

-- Indexes for performance

-- Workspace lookups
CREATE INDEX idx_vault_workspaces_slug ON vault_workspaces(slug);

-- Token authentication (most critical path)
CREATE INDEX idx_vault_api_tokens_hashed_token ON vault_api_tokens(hashed_token) WHERE is_active = true;
CREATE INDEX idx_vault_api_tokens_workspace_active ON vault_api_tokens(workspace_id, is_active);

-- Keyring lookups for encryption
CREATE INDEX idx_vault_keyrings_workspace_version ON vault_keyrings(workspace_id, key_version);
CREATE INDEX idx_vault_keyrings_workspace_latest ON vault_keyrings(workspace_id, created_at DESC) WHERE is_active = true;

-- Secret operations (hot path)
CREATE INDEX idx_vault_secrets_workspace_key ON vault_secrets(workspace_id, key);
CREATE INDEX idx_vault_secrets_workspace_updated ON vault_secrets(workspace_id, updated_at DESC);
CREATE INDEX idx_vault_secrets_tags ON vault_secrets USING GIN(tags) WHERE array_length(tags, 1) > 0;

-- Secret version retrieval
CREATE INDEX idx_vault_secret_versions_secret_version ON vault_secret_versions(secret_id, version DESC);
CREATE INDEX idx_vault_secret_versions_secret_latest ON vault_secret_versions(secret_id, created_at DESC);

-- Audit log queries (time-series)
CREATE INDEX idx_vault_audit_logs_workspace_created ON vault_audit_logs(workspace_id, created_at DESC);
CREATE INDEX idx_vault_audit_logs_resource ON vault_audit_logs(workspace_id, resource_type, resource_id, created_at DESC);
CREATE INDEX idx_vault_audit_logs_user ON vault_audit_logs(workspace_id, user_id, created_at DESC);
CREATE INDEX idx_vault_audit_logs_request_id ON vault_audit_logs(request_id) WHERE request_id IS NOT NULL;

-- Row-level security policies (workspace isolation)
ALTER TABLE vault_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_secret_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_api_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_keyrings ENABLE ROW LEVEL SECURITY;

-- Policies (enforced by application setting current_workspace_id)
CREATE POLICY vault_secrets_workspace_policy ON vault_secrets
  USING (workspace_id = current_setting('vault.current_workspace_id', true)::uuid);

CREATE POLICY vault_secret_versions_workspace_policy ON vault_secret_versions
  USING (secret_id IN (SELECT id FROM vault_secrets WHERE workspace_id = current_setting('vault.current_workspace_id', true)::uuid));

CREATE POLICY vault_audit_logs_workspace_policy ON vault_audit_logs
  USING (workspace_id = current_setting('vault.current_workspace_id', true)::uuid);

CREATE POLICY vault_api_tokens_workspace_policy ON vault_api_tokens
  USING (workspace_id = current_setting('vault.current_workspace_id', true)::uuid);

CREATE POLICY vault_keyrings_workspace_policy ON vault_keyrings
  USING (workspace_id = current_setting('vault.current_workspace_id', true)::uuid);

-- Functions for common operations

-- Function to get current secret value
CREATE OR REPLACE FUNCTION vault_get_secret_value(p_workspace_id UUID, p_secret_key VARCHAR)
RETURNS TABLE(
  secret_id UUID,
  encrypted_value TEXT,
  encryption_iv VARCHAR,
  auth_tag VARCHAR,
  key_version INTEGER,
  version INTEGER,
  type VARCHAR,
  description TEXT,
  tags TEXT[],
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    sv.encrypted_value,
    sv.encryption_iv,
    sv.auth_tag,
    sv.key_version,
    sv.version,
    s.type,
    s.description,
    s.tags,
    s.created_at,
    s.updated_at
  FROM vault_secrets s
  JOIN vault_secret_versions sv ON s.id = sv.secret_id AND s.current_version = sv.version
  WHERE s.workspace_id = p_workspace_id AND s.key = p_secret_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create or update secret
CREATE OR REPLACE FUNCTION vault_upsert_secret(
  p_workspace_id UUID,
  p_secret_key VARCHAR,
  p_encrypted_value TEXT,
  p_encryption_iv VARCHAR,
  p_auth_tag VARCHAR,
  p_key_version INTEGER,
  p_type VARCHAR DEFAULT 'string',
  p_description TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT '{}',
  p_created_by VARCHAR DEFAULT NULL
) RETURNS TABLE(secret_id UUID, version INTEGER) AS $$
DECLARE
  v_secret_id UUID;
  v_new_version INTEGER;
BEGIN
  -- Insert or get existing secret
  INSERT INTO vault_secrets (workspace_id, key, type, description, tags, created_by)
  VALUES (p_workspace_id, p_secret_key, p_type, p_description, p_tags, p_created_by)
  ON CONFLICT (workspace_id, key) 
  DO UPDATE SET 
    type = EXCLUDED.type,
    description = EXCLUDED.description,
    tags = EXCLUDED.tags,
    updated_at = NOW()
  RETURNING id INTO v_secret_id;

  -- Get next version number
  SELECT COALESCE(MAX(version), 0) + 1
  INTO v_new_version
  FROM vault_secret_versions
  WHERE secret_id = v_secret_id;

  -- Insert new version
  INSERT INTO vault_secret_versions (
    secret_id, version, encrypted_value, encryption_iv, auth_tag, key_version, created_by
  ) VALUES (
    v_secret_id, v_new_version, p_encrypted_value, p_encryption_iv, p_auth_tag, p_key_version, p_created_by
  );

  -- Update current_version
  UPDATE vault_secrets 
  SET current_version = v_new_version, updated_at = NOW()
  WHERE id = v_secret_id;

  RETURN QUERY SELECT v_secret_id, v_new_version;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cleanup old audit logs (for maintenance)
CREATE OR REPLACE FUNCTION vault_cleanup_audit_logs(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM vault_audit_logs 
  WHERE created_at < NOW() - INTERVAL '1 day' * retention_days;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_vault_workspaces_updated_at 
  BEFORE UPDATE ON vault_workspaces 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vault_secrets_updated_at 
  BEFORE UPDATE ON vault_secrets 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE vault_workspaces IS 'Multi-tenant workspaces for secrets isolation';
COMMENT ON TABLE vault_api_tokens IS 'Authentication tokens scoped to workspaces';
COMMENT ON TABLE vault_keyrings IS 'Encryption key management with versioning';
COMMENT ON TABLE vault_secrets IS 'Secret metadata without plaintext values';
COMMENT ON TABLE vault_secret_versions IS 'Encrypted secret values with versioning';
COMMENT ON TABLE vault_audit_logs IS 'Comprehensive audit trail for all operations';

COMMENT ON COLUMN vault_secrets.key IS 'Secret identifier unique within workspace (no slashes)';
COMMENT ON COLUMN vault_secret_versions.encrypted_value IS 'AES-256-GCM encrypted secret value (base64)';
COMMENT ON COLUMN vault_secret_versions.key_version IS 'Version of encryption key used';
COMMENT ON COLUMN vault_audit_logs.request_id IS 'Correlation ID for distributed tracing';

-- Grant permissions for application user
GRANT USAGE ON SCHEMA public TO vault_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vault_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vault_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO vault_app;