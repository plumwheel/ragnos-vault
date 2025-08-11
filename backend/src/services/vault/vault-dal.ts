import { TDbClient } from "@app/db";
import { ormify } from "@app/lib/knex";
import { 
  TableName as VaultWorkspacesTableName,
} from "@app/db/schemas/vault-workspaces";
import { 
  TableName as VaultApiTokensTableName,
} from "@app/db/schemas/vault-api-tokens";
import { 
  TableName as VaultSecretsTableName,
} from "@app/db/schemas/vault-secrets";
import { 
  TableName as VaultAuditLogsTableName,
} from "@app/db/schemas/vault-audit-logs";

export type TVaultWorkspaceDALFactory = ReturnType<typeof vaultWorkspaceDALFactory>;
export type TVaultApiTokenDALFactory = ReturnType<typeof vaultApiTokenDALFactory>;
export type TVaultSecretDALFactory = ReturnType<typeof vaultSecretDALFactory>;
export type TVaultSecretVersionDALFactory = ReturnType<typeof vaultSecretVersionDALFactory>;
export type TVaultAuditLogDALFactory = ReturnType<typeof vaultAuditLogDALFactory>;
export type TVaultKeyringDALFactory = ReturnType<typeof vaultKeyringDALFactory>;

export const vaultWorkspaceDALFactory = (db: TDbClient) => 
  ormify(db, VaultWorkspacesTableName.VaultWorkspaces);

export const vaultApiTokenDALFactory = (db: TDbClient) => 
  ormify(db, VaultApiTokensTableName.VaultApiTokens);

export const vaultSecretDALFactory = (db: TDbClient) => 
  ormify(db, VaultSecretsTableName.VaultSecrets);

export const vaultSecretVersionDALFactory = (db: TDbClient) => 
  ormify(db, VaultSecretsTableName.VaultSecretVersions);

export const vaultAuditLogDALFactory = (db: TDbClient) => 
  ormify(db, VaultAuditLogsTableName.VaultAuditLogs);

export const vaultKeyringDALFactory = (db: TDbClient) => 
  ormify(db, VaultAuditLogsTableName.VaultKeyrings);