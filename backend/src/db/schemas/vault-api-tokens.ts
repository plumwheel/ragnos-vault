import { z } from "zod";

import { TImmutableDBKeys } from "./models";

export const VaultApiTokensSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(255),
  hashedToken: z.string().min(1).max(255),
  role: z.enum(["admin", "write", "read"]),
  scopes: z.array(z.string()).default([]),
  lastUsedAt: z.date().nullable().optional(),
  lastUsedIp: z.string().nullable().optional(),
  expiresAt: z.date().nullable().optional(),
  createdAt: z.date(),
  createdBy: z.string().max(255).nullable().optional(),
  isActive: z.boolean().default(true)
});

export type TVaultApiTokens = z.infer<typeof VaultApiTokensSchema>;
export type TVaultApiTokensInsert = Omit<z.input<typeof VaultApiTokensSchema>, TImmutableDBKeys>;
export type TVaultApiTokensUpdate = Partial<Omit<z.input<typeof VaultApiTokensSchema>, TImmutableDBKeys>>;

export const TableName = {
  VaultApiTokens: "vault_api_tokens"
} as const;