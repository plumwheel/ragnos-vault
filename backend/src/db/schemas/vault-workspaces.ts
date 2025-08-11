import { z } from "zod";

import { TImmutableDBKeys } from "./models";

export const VaultWorkspacesSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  slug: z.string().min(3).max(63).regex(/^[a-z0-9-]+$/),
  encryptionKeyHash: z.string().min(1).max(255),
  createdAt: z.date(),
  updatedAt: z.date(),
  settings: z.record(z.any()).default({})
});

export type TVaultWorkspaces = z.infer<typeof VaultWorkspacesSchema>;
export type TVaultWorkspacesInsert = Omit<z.input<typeof VaultWorkspacesSchema>, TImmutableDBKeys>;
export type TVaultWorkspacesUpdate = Partial<Omit<z.input<typeof VaultWorkspacesSchema>, TImmutableDBKeys>>;

export const TableName = {
  VaultWorkspaces: "vault_workspaces"
} as const;