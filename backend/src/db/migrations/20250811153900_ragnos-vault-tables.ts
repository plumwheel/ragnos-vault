import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Enable UUID extension if not already enabled
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  // Create vault_workspaces table
  const hasVaultWorkspaces = await knex.schema.hasTable("vault_workspaces");
  if (!hasVaultWorkspaces) {
    await knex.schema.createTable("vault_workspaces", (table) => {
      table.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
      table.string("name", 255).notNullable();
      table.string("slug", 255).notNullable().unique();
      table.string("encryption_key_hash", 255).notNullable();
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("updated_at").defaultTo(knex.fn.now());
      table.jsonb("settings").defaultTo("{}");
      
      // Constraints
      table.check("length(slug) BETWEEN 3 AND 63", [], "vault_workspaces_slug_length");
    });

    // Add indexes
    await knex.schema.alterTable("vault_workspaces", (table) => {
      table.index(["slug"], "idx_vault_workspaces_slug");
    });
  }

  // Create vault_api_tokens table
  const hasVaultApiTokens = await knex.schema.hasTable("vault_api_tokens");
  if (!hasVaultApiTokens) {
    await knex.schema.createTable("vault_api_tokens", (table) => {
      table.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
      table.uuid("workspace_id").notNullable().references("id").inTable("vault_workspaces").onDelete("CASCADE");
      table.string("name", 255).notNullable();
      table.string("hashed_token", 255).notNullable().unique();
      table.enum("role", ["admin", "write", "read"]).notNullable();
      table.specificType("scopes", "text[]").defaultTo("{}");
      table.timestamp("last_used_at");
      table.specificType("last_used_ip", "inet");
      table.timestamp("expires_at");
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.string("created_by", 255);
      table.boolean("is_active").defaultTo(true);
      
      // Unique constraint on name per workspace
      table.unique(["workspace_id", "name"], { indexName: "vault_tokens_name_workspace_unique" });
    });

    // Add indexes
    await knex.schema.alterTable("vault_api_tokens", (table) => {
      table.index(["hashed_token"], "idx_vault_api_tokens_hashed_token");
      table.index(["workspace_id", "is_active"], "idx_vault_api_tokens_workspace_active");
    });
  }

  // Create vault_keyrings table
  const hasVaultKeyrings = await knex.schema.hasTable("vault_keyrings");
  if (!hasVaultKeyrings) {
    await knex.schema.createTable("vault_keyrings", (table) => {
      table.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
      table.uuid("workspace_id").notNullable().references("id").inTable("vault_workspaces").onDelete("CASCADE");
      table.text("encrypted_dek").notNullable();
      table.integer("key_version").notNullable();
      table.timestamp("rotated_at").defaultTo(knex.fn.now());
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.boolean("is_active").defaultTo(true);
      
      // Unique constraint on workspace and version
      table.unique(["workspace_id", "key_version"], { indexName: "vault_keyrings_workspace_version_unique" });
    });

    // Add indexes
    await knex.schema.alterTable("vault_keyrings", (table) => {
      table.index(["workspace_id", "key_version"], "idx_vault_keyrings_workspace_version");
      table.index(["workspace_id", "created_at"], "idx_vault_keyrings_workspace_latest");
    });
  }

  // Create vault_secrets table
  const hasVaultSecrets = await knex.schema.hasTable("vault_secrets");
  if (!hasVaultSecrets) {
    await knex.schema.createTable("vault_secrets", (table) => {
      table.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
      table.uuid("workspace_id").notNullable().references("id").inTable("vault_workspaces").onDelete("CASCADE");
      table.string("key", 255).notNullable();
      table.enum("type", ["string", "json", "binary"]).notNullable().defaultTo("string");
      table.integer("current_version").notNullable().defaultTo(1);
      table.text("description");
      table.specificType("tags", "text[]").defaultTo("{}");
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("updated_at").defaultTo(knex.fn.now());
      table.string("created_by", 255);
      
      // Unique constraint on workspace and key
      table.unique(["workspace_id", "key"], { indexName: "vault_secrets_workspace_key_unique" });
    });

    // Add indexes
    await knex.schema.alterTable("vault_secrets", (table) => {
      table.index(["workspace_id", "key"], "idx_vault_secrets_workspace_key");
      table.index(["workspace_id", "updated_at"], "idx_vault_secrets_workspace_updated");
    });
  }

  // Create vault_secret_versions table
  const hasVaultSecretVersions = await knex.schema.hasTable("vault_secret_versions");
  if (!hasVaultSecretVersions) {
    await knex.schema.createTable("vault_secret_versions", (table) => {
      table.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
      table.uuid("secret_id").notNullable().references("id").inTable("vault_secrets").onDelete("CASCADE");
      table.integer("version").notNullable();
      table.text("encrypted_value").notNullable();
      table.string("encryption_iv", 255).notNullable();
      table.string("auth_tag", 255).notNullable();
      table.integer("key_version").notNullable();
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.string("created_by", 255);
      table.jsonb("metadata").defaultTo("{}");
      
      // Unique constraint on secret and version
      table.unique(["secret_id", "version"], { indexName: "vault_secret_versions_secret_version_unique" });
    });

    // Add indexes
    await knex.schema.alterTable("vault_secret_versions", (table) => {
      table.index(["secret_id", "version"], "idx_vault_secret_versions_secret_version");
      table.index(["secret_id", "created_at"], "idx_vault_secret_versions_secret_latest");
    });
  }

  // Create vault_audit_logs table
  const hasVaultAuditLogs = await knex.schema.hasTable("vault_audit_logs");
  if (!hasVaultAuditLogs) {
    await knex.schema.createTable("vault_audit_logs", (table) => {
      table.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
      table.uuid("workspace_id").notNullable().references("id").inTable("vault_workspaces").onDelete("CASCADE");
      table.enum("action", ["CREATE", "READ", "UPDATE", "DELETE", "ROTATE", "LOGIN"]).notNullable();
      table.enum("resource_type", ["secret", "workspace", "token", "keyring"]).notNullable();
      table.string("resource_id", 255);
      table.string("user_id", 255);
      table.uuid("token_id").references("id").inTable("vault_api_tokens");
      table.specificType("ip_address", "inet");
      table.text("user_agent");
      table.string("request_id", 255);
      table.boolean("success").notNullable().defaultTo(true);
      table.text("error_message");
      table.jsonb("metadata").defaultTo("{}");
      table.timestamp("created_at").defaultTo(knex.fn.now());
    });

    // Add indexes for audit queries
    await knex.schema.alterTable("vault_audit_logs", (table) => {
      table.index(["workspace_id", "created_at"], "idx_vault_audit_logs_workspace_created");
      table.index(["workspace_id", "resource_type", "resource_id", "created_at"], "idx_vault_audit_logs_resource");
      table.index(["workspace_id", "user_id", "created_at"], "idx_vault_audit_logs_user");
      table.index(["request_id"], "idx_vault_audit_logs_request_id");
    });
  }

  // Create updated_at trigger function if it doesn't exist
  await knex.raw(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Add triggers for updated_at
  await knex.raw(`
    DROP TRIGGER IF EXISTS update_vault_workspaces_updated_at ON vault_workspaces;
    CREATE TRIGGER update_vault_workspaces_updated_at 
      BEFORE UPDATE ON vault_workspaces 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);

  await knex.raw(`
    DROP TRIGGER IF EXISTS update_vault_secrets_updated_at ON vault_secrets;
    CREATE TRIGGER update_vault_secrets_updated_at 
      BEFORE UPDATE ON vault_secrets 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);

  // Add vault helper functions
  await knex.raw(`
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
  `);

  await knex.raw(`
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
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Drop functions
  await knex.raw("DROP FUNCTION IF EXISTS vault_upsert_secret");
  await knex.raw("DROP FUNCTION IF EXISTS vault_get_secret_value");
  await knex.raw("DROP FUNCTION IF EXISTS update_updated_at_column CASCADE");
  
  // Drop tables in reverse order (due to foreign keys)
  await knex.schema.dropTableIfExists("vault_audit_logs");
  await knex.schema.dropTableIfExists("vault_secret_versions");
  await knex.schema.dropTableIfExists("vault_secrets");
  await knex.schema.dropTableIfExists("vault_keyrings");
  await knex.schema.dropTableIfExists("vault_api_tokens");
  await knex.schema.dropTableIfExists("vault_workspaces");
}