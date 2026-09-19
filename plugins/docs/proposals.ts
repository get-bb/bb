import { z } from "zod";

export const proposalSchema = z
  .object({
    vaultId: z.string().min(1),
    path: z.string().min(1),
    version: z.number().int().positive(),
    baseContent: z.string(),
    baseSha256: z.string().min(1),
    content: z.string(),
    status: z.enum(["pending", "accepted", "rejected", "undone"]),
    resolvedSha256: z.string().nullable(),
    undoAction: z.enum(["accept", "reject"]).nullable(),
  })
  .strict();

export type Proposal = z.infer<typeof proposalSchema>;
