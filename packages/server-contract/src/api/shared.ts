import { z } from "zod";
import {
  BRANCH_LIST_QUERY_MAX_LENGTH,
  changedMessageLenientSchema,
  changedMessageSchema,
  gitBranchNameSchema,
} from "@bb/domain";
import type { GitBranchName } from "@bb/domain";

export {
  BRANCH_LIST_LIMIT_MAX,
  BRANCH_LIST_QUERY_MAX_LENGTH,
  FILE_LIST_LIMIT_MAX,
  FILE_LIST_QUERY_MAX_LENGTH,
} from "@bb/domain";

interface IncludeQueryValidationArgs {
  allowedValues: readonly string[];
  value: string;
}

export function isCommaSeparatedIncludeQueryValue(
  args: IncludeQueryValidationArgs,
): boolean {
  const requestedValues = args.value.split(",");
  return requestedValues.every(
    (value) => value.length > 0 && args.allowedValues.includes(value),
  );
}

export const threadContextWindowUsageSchema = z.object({
  usedTokens: z.number(),
  modelContextWindow: z.number(),
  estimated: z.boolean(),
});
export type ThreadContextWindowUsage = z.infer<
  typeof threadContextWindowUsageSchema
>;

export { gitBranchNameSchema };
export type { GitBranchName };

/**
 * Pre-thread checkout intent for an unmanaged workspace. Omitting this from
 * the workspace request means "don't touch HEAD"; including it asks the
 * daemon to switch to the named branch or create a server-named branch from
 * `baseBranch` before the thread starts.
 */
export const unmanagedBranchSpecSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("existing"),
      name: gitBranchNameSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("new"), baseBranch: gitBranchNameSchema })
    .strict(),
]);
export type UnmanagedBranchSpec = z.infer<typeof unmanagedBranchSpecSchema>;

export const unmanagedWorkspaceSchema = z.object({
  type: z.literal("unmanaged"),
  path: z.string().min(1).nullable(),
  /**
   * If set, the daemon checks out this branch in the unmanaged workspace
   * before the thread starts. `existing` switches to a named branch; `new`
   * asks the server to mint a thread-scoped branch name and create it from
   * the requested base branch.
   */
  branch: unmanagedBranchSpecSchema.optional(),
});

/**
 * Identifies the base branch a managed worktree should be created from.
 * `named` carries an explicit branch name; `default` defers to the source's
 * default branch (resolved server-side so the daemon always receives a real
 * branch name).
 */
export const baseBranchSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("named"), name: gitBranchNameSchema }),
  z.object({ kind: z.literal("default") }),
]);
export type BaseBranchSpec = z.infer<typeof baseBranchSpecSchema>;

export const managedWorktreeWorkspaceSchema = z.object({
  type: z.literal("managed-worktree"),
  /** Branch the new worktree should be based on. */
  baseBranch: baseBranchSpecSchema,
});

export const personalWorkspaceSchema = z.object({
  type: z.literal("personal"),
});

export const workspaceArgsSchema = z.discriminatedUnion("type", [
  unmanagedWorkspaceSchema,
  managedWorktreeWorkspaceSchema,
  personalWorkspaceSchema,
]);
export type WorkspaceArgs = z.infer<typeof workspaceArgsSchema>;

export const reuseEnvironmentSchema = z.object({
  type: z.literal("reuse"),
  environmentId: z.string().min(1),
});

export const hostEnvironmentSchema = z
  .object({
    type: z.literal("host"),
    hostId: z.string().min(1).optional(),
    workspace: workspaceArgsSchema,
  })
  .superRefine((value, ctx) => {
    if (value.workspace.type !== "personal" && value.hostId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "hostId is required unless workspace.type is personal",
        path: ["hostId"],
      });
    }
  });

export const environmentArgsSchema = z.discriminatedUnion("type", [
  reuseEnvironmentSchema,
  hostEnvironmentSchema,
]);
export type EnvironmentArgs = z.infer<typeof environmentArgsSchema>;

export const pathListIncludeQueryValueSchema = z.enum(["true", "false"]);
export type PathListIncludeQueryValue = z.infer<
  typeof pathListIncludeQueryValueSchema
>;

export const branchListQuerySchema = z.object({
  query: z.string().min(1).max(BRANCH_LIST_QUERY_MAX_LENGTH).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});
export type BranchListQuery = z.infer<typeof branchListQuerySchema>;

export const serverMessageSchema = changedMessageSchema;
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/**
 * Lenient counterpart of {@link serverMessageSchema} for INBOUND parsing on
 * clients. The strict schema guards the server's outgoing boundary; clients
 * (SDK consumers, the web app) may be older than the server they talk to, so
 * they strip unknown fields and filter unknown change kinds instead of
 * dropping whole messages on additive server changes. Output stays assignable
 * to {@link ServerMessage}.
 */
export const serverMessageLenientSchema = changedMessageLenientSchema;

export const workspaceFileSchema = z.object({
  path: z.string(),
  name: z.string(),
});
export type WorkspaceFile = z.infer<typeof workspaceFileSchema>;

export const workspacePathEntryKindSchema = z.enum(["file", "directory"]);

export const workspacePathEntrySchema = z.object({
  kind: workspacePathEntryKindSchema,
  path: z.string(),
  name: z.string(),
  score: z.number(),
  positions: z.array(z.number().int().nonnegative()),
});
export type WorkspacePathEntry = z.infer<typeof workspacePathEntrySchema>;

export const workspaceFileListResponseSchema = z.object({
  files: z.array(workspaceFileSchema),
  truncated: z.boolean(),
});
export type WorkspaceFileListResponse = z.infer<
  typeof workspaceFileListResponseSchema
>;

export const workspacePathListResponseSchema = z.object({
  paths: z.array(workspacePathEntrySchema),
  truncated: z.boolean(),
});
export type WorkspacePathListResponse = z.infer<
  typeof workspacePathListResponseSchema
>;
