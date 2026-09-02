import { z } from "zod";

/**
 * Host-local facts about the worktrees registered with one git repository,
 * parsed from `git worktree list --porcelain -z` and canonicalized on the
 * owning host. These are raw facts only: availability, ownership, and merge
 * policy against stored environments are the server's job.
 */
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
    /** Exact absolute path reported by git, for display. */
    path: z.string().min(1),
    /** realpath(path), or null when the registered path does not exist. */
    canonicalPath: z.string().min(1).nullable(),
    checkout: gitWorktreeCheckoutSchema,
    /** Null when unlocked; a locked worktree may have no recorded reason. */
    lock: z.object({ reason: z.string().nullable() }).strict().nullable(),
    /** Null when git considers the registration healthy. */
    prunable: z.object({ reason: z.string().nullable() }).strict().nullable(),
  })
  .strict();
export type GitWorktreeEntry = z.infer<typeof gitWorktreeEntrySchema>;

/**
 * Canonical resolution of a stored environment path, computed on the owning
 * host because a stored path may be an alias (macOS `/var` vs `/private/var`)
 * and remote paths cannot be resolved on the server machine.
 */
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
