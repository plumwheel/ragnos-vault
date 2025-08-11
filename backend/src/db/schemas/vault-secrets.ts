import { z } from "zod";

import { TImmutableDBKeys } from "./models";

export const VaultSecretsSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  key: z.string().min(1).max(255).regex(/^[a-zA-Z0-9/_.-]+$/),
  type: z.enum(["string", "json", "binary"]).default("string"),
  currentVersion: z.number().int().min(1).default(1),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string().max(255).nullable().optional()
});

export type TVaultSecrets = z.infer<typeof VaultSecretsSchema>;
export type TVaultSecretsInsert = Omit<z.input<typeof VaultSecretsSchema>, TImmutableDBKeys>;
export type TVaultSecretsUpdate = Partial<Omit<z.input<typeof VaultSecretsSchema>, TImmutableDBKeys>>;

export const VaultSecretVersionsSchema = z.object({
  id: z.string().uuid(),
  secretId: z.string().uuid(),
  version: z.number().int().min(1),
  encryptedValue: z.string().min(1),
  encryptionIv: z.string().min(1).max(255),
  authTag: z.string().min(1).max(255),
  keyVersion: z.number().int().min(1),
  createdAt: z.date(),
  createdBy: z.string().max(255).nullable().optional(),
  metadata: z.record(z.any()).default({})
});

export type TVaultSecretVersions = z.infer<typeof VaultSecretVersionsSchema>;
export type TVaultSecretVersionsInsert = Omit<z.input<typeof VaultSecretVersionsSchema>, TImmutableDBKeys>;
export type TVaultSecretVersionsUpdate = Partial<Omit<z.input<typeof VaultSecretVersionsSchema>, TImmutableDBKeys>>;

export const TableName = {
  VaultSecrets: "vault_secrets",
  VaultSecretVersions: "vault_secret_versions"
} as const;