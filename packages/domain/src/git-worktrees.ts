import { z } from "zod";

export const gitWorktreeCheckoutSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("branch"),
      branchName: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("detached"),
      headSha: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("bare") }).strict(),
]);
export type GitWorktreeCheckout = z.infer<typeof gitWorktreeCheckoutSchema>;

export const gitWorktreeEntrySchema = z
  .object({
    path: z.string().min(1),
    canonicalPath: z.string().min(1).nullable(),
    checkout: gitWorktreeCheckoutSchema,
    lock: z.object({ reason: z.string().nullable() }).strict().nullable(),
    prunable: z.object({ reason: z.string().nullable() }).strict().nullable(),
  })
  .strict();
export type GitWorktreeEntry = z.infer<typeof gitWorktreeEntrySchema>;

export const resolvedHostPathSchema = z
  .object({
    path: z.string().min(1),
    canonicalPath: z.string().min(1).nullable(),
  })
  .strict();
export type ResolvedHostPath = z.infer<typeof resolvedHostPathSchema>;

export const hostWorktreeListResultSchema = z
  .object({
    worktrees: z.array(gitWorktreeEntrySchema),
    resolvedPaths: z.array(resolvedHostPathSchema),
  })
  .strict();
export type HostWorktreeListResult = z.infer<
  typeof hostWorktreeListResultSchema
>;
