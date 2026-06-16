import { z } from "zod";
import {
  FILE_LIST_QUERY_MAX_LENGTH,
  gitBranchNameSchema,
  gitBranchRefClassificationSchema,
  threadGitDiffResponseSchema,
  threadPullRequestSchema,
  workspaceStatusSchema,
} from "@bb/domain";
import { workspaceResolutionFailureSchema } from "@bb/host-daemon-contract";
import { apiErrorSchema } from "../errors.js";
import {
  branchListQuerySchema,
  pathListIncludeQueryValueSchema,
} from "./shared.js";

export const environmentNameSchema = z.string().trim().min(1).max(80);

export const updateEnvironmentRequestSchema = z
  .object({
    // Omitted fields are left unchanged. `null` clears the configured value.
    mergeBaseBranch: gitBranchNameSchema.nullable(),
    name: environmentNameSchema.nullable(),
  })
  .partial()
  .refine(
    (value) => value.mergeBaseBranch !== undefined || value.name !== undefined,
    "At least one field must be provided",
  );
export type UpdateEnvironmentRequest = z.infer<
  typeof updateEnvironmentRequestSchema
>;

/**
 * Query for searching paths in an environment's workspace. Unlike the
 * project-scoped variant this needs no `environmentId` — the environment is
 * the route param — and is project-agnostic, so it works for projectless
 * (personal) environments too.
 */
export const environmentPathsQuerySchema = z.object({
  query: z.string().min(1).max(FILE_LIST_QUERY_MAX_LENGTH).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  includeFiles: pathListIncludeQueryValueSchema,
  includeDirectories: pathListIncludeQueryValueSchema,
});
export type EnvironmentPathsQuery = z.infer<typeof environmentPathsQuerySchema>;

export const environmentDiffBranchesQuerySchema = branchListQuerySchema.extend({
  selectedBranch: gitBranchNameSchema.optional(),
});
export type EnvironmentDiffBranchesQuery = z.infer<
  typeof environmentDiffBranchesQuerySchema
>;

export const environmentDiffBranchesResponseSchema = z.object({
  /** Local branches under refs/heads, safe for checkout and write targets. */
  branches: z.array(z.string()),
  branchesTruncated: z.boolean(),
  /** Remote-tracking branches under refs/remotes, for base/diff selection. */
  remoteBranches: z.array(z.string()),
  remoteBranchesTruncated: z.boolean(),
  selectedBranch: gitBranchRefClassificationSchema.nullable(),
});
export type EnvironmentDiffBranchesResponse = z.infer<
  typeof environmentDiffBranchesResponseSchema
>;

const mergeBaseBranchQuerySchema = z
  .string("A merge base branch is required")
  .pipe(gitBranchNameSchema);

export const environmentStatusQuerySchema = z.object({
  mergeBaseBranch: mergeBaseBranchQuerySchema.optional(),
});
export type EnvironmentStatusQuery = z.infer<
  typeof environmentStatusQuerySchema
>;

export const environmentDiffQuerySchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("uncommitted"),
  }),
  z.object({
    target: z.literal("branch_committed"),
    mergeBaseBranch: mergeBaseBranchQuerySchema,
  }),
  z.object({
    target: z.literal("all"),
    mergeBaseBranch: mergeBaseBranchQuerySchema,
  }),
  z.object({
    target: z.literal("commit"),
    sha: z.string().regex(/^[0-9a-f]{4,40}$/iu),
  }),
]);
export type EnvironmentDiffQuery = z.infer<typeof environmentDiffQuerySchema>;

const diffFileSideSchema = z.enum(["old", "new"]);

const mergeBaseRefQuerySchema = z.string().regex(/^[0-9a-f]{4,40}$/iu);

/**
 * Query for fetching a single file's contents at one side of a diff target.
 * Used by the diff card to populate `<FileDiff>`'s `oldFile`/`newFile` props
 * so `@pierre/diffs` can render expand-context buttons between hunks.
 *
 * For `branch_committed` / `all`, callers pass the resolved merge-base SHA
 * (`mergeBaseRef`, surfaced by `workspace.diff`) rather than the branch name
 * — the diff itself was computed against that SHA, so reading the old side
 * from the same SHA keeps the file content aligned with the hunk line
 * numbers. Reading from the branch tip is wrong whenever the branch has
 * moved past the merge-base since the file existed there.
 */
export const environmentDiffFileQuerySchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("uncommitted"),
    path: z.string().min(1),
    side: diffFileSideSchema,
  }),
  z.object({
    target: z.literal("branch_committed"),
    mergeBaseRef: mergeBaseRefQuerySchema,
    path: z.string().min(1),
    side: diffFileSideSchema,
  }),
  z.object({
    target: z.literal("all"),
    mergeBaseRef: mergeBaseRefQuerySchema,
    path: z.string().min(1),
    side: diffFileSideSchema,
  }),
  z.object({
    target: z.literal("commit"),
    sha: z.string().regex(/^[0-9a-f]{4,40}$/iu),
    path: z.string().min(1),
    side: diffFileSideSchema,
  }),
]);
export type EnvironmentDiffFileQuery = z.infer<
  typeof environmentDiffFileQuerySchema
>;

export const environmentDiffFileResponseSchema = z.object({
  path: z.string(),
  content: z.string(),
  contentEncoding: z.enum(["base64", "utf8"]),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative(),
});
export type EnvironmentDiffFileResponse = z.infer<
  typeof environmentDiffFileResponseSchema
>;

export const environmentArchiveThreadsResponseSchema = z.object({
  ok: z.literal(true),
  archivedThreadIds: z.array(z.string().min(1)),
});
export type EnvironmentArchiveThreadsResponse = z.infer<
  typeof environmentArchiveThreadsResponseSchema
>;

export const environmentActionTypeSchema = z.enum(["commit", "squash_merge"]);

export const squashMergeOptionsSchema = z
  .object({
    mergeBaseBranch: gitBranchNameSchema,
  })
  .strict();
export type SquashMergeOptions = z.infer<typeof squashMergeOptionsSchema>;

export const environmentActionRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("commit"),
    })
    .strict(),
  z
    .object({
      action: z.literal("squash_merge"),
      options: squashMergeOptionsSchema,
    })
    .strict(),
]);
export type EnvironmentActionRequest = z.infer<
  typeof environmentActionRequestSchema
>;

export const commitActionResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal("commit"),
  message: z.string().min(1),
  commitSha: z.string().min(1),
  commitSubject: z.string().min(1),
});
export type CommitActionResponse = z.infer<typeof commitActionResponseSchema>;

export const squashMergeActionResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal("squash_merge"),
  merged: z.boolean(),
  message: z.string().min(1),
  commitSha: z.string().min(1),
  commitSubject: z.string().min(1),
});
export type SquashMergeActionResponse = z.infer<
  typeof squashMergeActionResponseSchema
>;

export const environmentActionResponseSchema = z.discriminatedUnion("action", [
  commitActionResponseSchema,
  squashMergeActionResponseSchema,
]);
export type EnvironmentActionResponse = z.infer<
  typeof environmentActionResponseSchema
>;

export const environmentActionFailureDetailsSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("commit_failed"),
      errorMessage: z.string(),
    }),
    z.object({
      kind: z.literal("squash_merge_conflict"),
      conflictFiles: z.array(z.string()),
    }),
    z.object({
      kind: z.literal("squash_merge_commit_failed"),
      stage: z.enum(["prep_commit", "squash_commit"]),
      errorMessage: z.string(),
    }),
    z.object({
      kind: z.literal("workspace_unavailable"),
      failure: workspaceResolutionFailureSchema,
    }),
  ],
);
export type EnvironmentActionFailureDetails = z.infer<
  typeof environmentActionFailureDetailsSchema
>;

export const environmentActionApiErrorSchema = apiErrorSchema.extend({
  details: environmentActionFailureDetailsSchema.optional(),
});
export type EnvironmentActionApiError = z.infer<
  typeof environmentActionApiErrorSchema
>;

export const environmentWorkspaceNotApplicableReasonSchema = z.enum([
  "non_git_environment",
]);
export type EnvironmentWorkspaceNotApplicableReason = z.infer<
  typeof environmentWorkspaceNotApplicableReasonSchema
>;

const environmentWorkspaceNotApplicableOutcomeSchema = z
  .object({
    outcome: z.literal("not_applicable"),
    reason: environmentWorkspaceNotApplicableReasonSchema,
    message: z.string().min(1),
  })
  .strict();

export const environmentStatusResponseSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("available"),
      workspace: workspaceStatusSchema,
    })
    .strict(),
  environmentWorkspaceNotApplicableOutcomeSchema,
  z
    .object({
      outcome: z.literal("unavailable"),
      failure: workspaceResolutionFailureSchema,
    })
    .strict(),
]);

/**
 * `pullRequest` is required + nullable: `null` means "no PR for this branch"
 * (a real, distinct state), covering every detection failure the daemon folds
 * together. Non-git environments resolve to `null` without a daemon call.
 */
export const environmentPullRequestResponseSchema = z
  .object({
    pullRequest: threadPullRequestSchema.nullable(),
  })
  .strict();
export type EnvironmentPullRequestResponse = z.infer<
  typeof environmentPullRequestResponseSchema
>;

export const environmentDiffResponseSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("available"),
      diff: threadGitDiffResponseSchema,
    })
    .strict(),
  environmentWorkspaceNotApplicableOutcomeSchema,
  z
    .object({
      outcome: z.literal("unavailable"),
      failure: workspaceResolutionFailureSchema,
    })
    .strict(),
]);
export type EnvironmentDiffResponse = z.infer<
  typeof environmentDiffResponseSchema
>;

export type EnvironmentStatusResponse = z.infer<
  typeof environmentStatusResponseSchema
>;
