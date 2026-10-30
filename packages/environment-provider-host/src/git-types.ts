import { z } from "zod";

export const workspaceResolutionFailureCodeSchema = z.enum([
  "path_not_found",
  "not_git_repo",
  "workspace_type_mismatch",
  "permission_denied",
  "unknown_environment",
  "unknown",
]);
export const workspaceResolutionFailureSchema = z
  .object({
    code: workspaceResolutionFailureCodeSchema,
    workspacePath: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
export type WorkspaceResolutionFailure = z.infer<
  typeof workspaceResolutionFailureSchema
>;

export const BRANCH_LIST_QUERY_MAX_LENGTH = 256;
export const BRANCH_LIST_LIMIT_MAX = 1_000;

export const gitBranchRefClassificationSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["local", "remote", "missing"]),
});

export const gitBranchOptionsSchema = z.object({
  branches: z.array(z.string()),
  branchesTruncated: z.boolean(),
  remoteBranches: z.array(z.string()),
  remoteBranchesTruncated: z.boolean(),
  selectedBranch: gitBranchRefClassificationSchema.nullable(),
});
export type GitBranchRefClassification = z.infer<
  typeof gitBranchRefClassificationSchema
>;
export type GitBranchOptions = z.infer<typeof gitBranchOptionsSchema>;

export const gitCheckoutRefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("branch"),
    branchName: z.string().min(1),
    headSha: z.string().min(1).nullable(),
  }),
  z.object({
    kind: z.literal("detached"),
    headSha: z.string().min(1).nullable(),
  }),
  z.object({
    kind: z.literal("unborn"),
    branchName: z.string().min(1).nullable(),
  }),
  z.object({
    kind: z.literal("unknown"),
    reason: z.string().min(1),
  }),
]);
export type GitCheckoutRef = z.infer<typeof gitCheckoutRefSchema>;

export type DefaultBranchRelation =
  | "equal"
  | "local-behind"
  | "local-ahead"
  | "diverged"
  | "unknown";
