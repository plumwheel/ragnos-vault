import { z } from "zod";

import { TImmutableDBKeys } from "./models";

export const VaultAuditLogsSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  action: z.enum(["CREATE", "READ", "UPDATE", "DELETE", "ROTATE", "LOGIN"]),
  resourceType: z.enum(["secret", "workspace", "token", "keyring"]),
  resourceId: z.string().max(255).nullable().optional(),
  userId: z.string().max(255).nullable().optional(),
  tokenId: z.string().uuid().nullable().optional(),
  ipAddress: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  requestId: z.string().max(255).nullable().optional(),
  success: z.boolean().default(true),
  errorMessage: z.string().nullable().optional(),
  metadata: z.record(z.any()).default({}),
  createdAt: z.date()
});

export type TVaultAuditLogs = z.infer<typeof VaultAuditLogsSchema>;
export type TVaultAuditLogsInsert = Omit<z.input<typeof VaultAuditLogsSchema>, TImmutableDBKeys>;
export type TVaultAuditLogsUpdate = Partial<Omit<z.input<typeof VaultAuditLogsSchema>, TImmutableDBKeys>>;

export const VaultKeyringsSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  encryptedDek: z.string().min(1),
  keyVersion: z.number().int().min(1),
  rotatedAt: z.date(),
  createdAt: z.date(),
  isActive: z.boolean().default(true)
});

export type TVaultKeyrings = z.infer<typeof VaultKeyringsSchema>;
export type TVaultKeyringsInsert = Omit<z.input<typeof VaultKeyringsSchema>, TImmutableDBKeys>;
export type TVaultKeyringsUpdate = Partial<Omit<z.input<typeof VaultKeyringsSchema>, TImmutableDBKeys>>;

export const TableName = {
  VaultAuditLogs: "vault_audit_logs",
  VaultKeyrings: "vault_keyrings"
} as const;