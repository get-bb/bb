import { z } from "zod";
import { environmentWorkspaceDisplayKindSchema } from "./environment.js";
import { gitCheckoutRefSchema } from "./git-checkout.js";
import {
  promptInputSchema,
  permissionModeSchema,
  reasoningLevelSchema,
  serviceTierSchema,
} from "./shared-types.js";
import { threadStatusSchema, threadStatusValues } from "./thread-status.js";
import { threadOriginKindSchema } from "./thread-origin-kind.js";
import { threadVisibilitySchema } from "./thread-visibility.js";
export { threadStatusSchema, threadStatusValues } from "./thread-status.js";
export type { ThreadStatus } from "./thread-status.js";
export {
  threadOriginKindSchema,
  threadOriginKindValues,
} from "./thread-origin-kind.js";
export type { ThreadOriginKind } from "./thread-origin-kind.js";

const threadRuntimeDisplayStatusValues = [
  ...threadStatusValues,
  "provisioning",
  "host-reconnecting",
  "waiting-for-host",
] as const;
const threadRuntimeDisplayStatusSchema = z.enum(
  threadRuntimeDisplayStatusValues,
);
export type ThreadRuntimeDisplayStatus = z.infer<
  typeof threadRuntimeDisplayStatusSchema
>;

export const threadRuntimeStateSchema = z.object({
  displayStatus: threadRuntimeDisplayStatusSchema,
  hostReconnectGraceExpiresAt: z.number().nullable(),
});
export type ThreadRuntimeState = z.infer<typeof threadRuntimeStateSchema>;

export const threadActivityStateSchema = z.object({
  activeWorkflowCount: z.number().int().nonnegative(),
  activeBackgroundAgentCount: z.number().int().nonnegative(),
  activeBackgroundCommandCount: z.number().int().nonnegative(),
  activePlanModeCount: z.number().int().nonnegative(),
  activeGoalCount: z.number().int().nonnegative(),
});
export type ThreadActivityState = z.infer<typeof threadActivityStateSchema>;

const workspaceStateValues = [
  "clean",
  "untracked",
  "dirty_uncommitted",
  "committed_unmerged",
  "dirty_and_committed_unmerged",
] as const;
const workspaceStateSchema = z.enum(workspaceStateValues);

const workspaceFileStatusKindSchema = z.enum([
  "M",
  "A",
  "D",
  "R",
  "C",
  "U",
  "??",
  /**
   * Fallback for git status letters we don't recognize. Kept distinct from
   * "M" so UI and consumers can surface the ambiguity rather than silently
   * mislabeling the change.
   */
  "?",
]);
export type WorkspaceFileStatusKind = z.infer<
  typeof workspaceFileStatusKindSchema
>;

const workspaceFileStatusSchema = z.object({
  path: z.string(),
  status: workspaceFileStatusKindSchema,
  /**
   * Per-file line counts from `git diff --numstat`. Null when the count is
   * unknown — binary files (numstat reports `-`) and untracked files (numstat
   * does not include them).
   */
  insertions: z.number().nullable(),
  deletions: z.number().nullable(),
});
export type WorkspaceFileStatus = z.infer<typeof workspaceFileStatusSchema>;

const workspaceCommitSummarySchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  subject: z.string(),
  authorName: z.string(),
  authoredAt: z.number(),
});
export type WorkspaceCommitSummary = z.infer<
  typeof workspaceCommitSummarySchema
>;

/**
 * Fields shared by any surface that reports changed files plus the line totals
 * Git computed for them. `lineStatsComplete` distinguishes exact totals from
 * tracked-only totals that intentionally omit untracked file contents.
 */
const workspaceChangeStatsSchema = z.object({
  insertions: z.number(),
  deletions: z.number(),
  /** False when line totals omit files whose contents were intentionally not read. */
  lineStatsComplete: z.boolean(),
  files: z.array(workspaceFileStatusSchema),
});
export type WorkspaceChangeStats = z.infer<typeof workspaceChangeStatsSchema>;

const workspaceWorkingTreeSchema = workspaceChangeStatsSchema.extend({
  hasUncommittedChanges: z.boolean(),
  state: workspaceStateSchema,
});
export type WorkspaceWorkingTree = z.infer<typeof workspaceWorkingTreeSchema>;

const workspaceBranchSchema = z.object({
  currentBranch: z.string().nullable(),
  defaultBranch: z.string(),
});

/**
 * Stats and file list are relative to the merge-base-to-HEAD range
 * (committed, unmerged) via `workspaceChangeStatsSchema`.
 */
const workspaceMergeBaseSchema = workspaceChangeStatsSchema.extend({
  mergeBaseBranch: z.string(),
  baseRef: z.string().nullable(),
  aheadCount: z.number(),
  behindCount: z.number(),
  hasCommittedUnmergedChanges: z.boolean(),
  commits: z.array(workspaceCommitSummarySchema),
});
export type WorkspaceMergeBase = z.infer<typeof workspaceMergeBaseSchema>;

export const workspaceStatusSchema = z.object({
  workingTree: workspaceWorkingTreeSchema,
  checkout: gitCheckoutRefSchema,
  branch: workspaceBranchSchema,
  mergeBase: workspaceMergeBaseSchema.nullable(),
});
export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>;

const gitHostPullRequestCheckStatusSchema = z.enum([
  "queued",
  "in_progress",
  "completed",
  "unknown",
]);
export type GitHostPullRequestCheckStatus = z.infer<
  typeof gitHostPullRequestCheckStatusSchema
>;

const gitHostPullRequestCheckConclusionSchema = z.enum([
  "success",
  "failure",
  "cancelled",
  "skipped",
  "neutral",
  "timed_out",
  "action_required",
  "startup_failure",
  "stale",
  "unknown",
]);
export type GitHostPullRequestCheckConclusion = z.infer<
  typeof gitHostPullRequestCheckConclusionSchema
>;

const gitHostPullRequestCheckSchema = z
  .object({
    name: z.string().min(1),
    status: gitHostPullRequestCheckStatusSchema,
    conclusion: gitHostPullRequestCheckConclusionSchema.nullable(),
    url: z.string().url().nullable(),
    startedAt: z.string().datetime().nullable(),
  })
  .strict();
export type GitHostPullRequestCheck = z.infer<
  typeof gitHostPullRequestCheckSchema
>;

const gitHostPullRequestReviewDecisionSchema = z.enum([
  "APPROVED",
  "CHANGES_REQUESTED",
  "REVIEW_REQUIRED",
]);
export type GitHostPullRequestReviewDecision = z.infer<
  typeof gitHostPullRequestReviewDecisionSchema
>;

const gitHostPullRequestMergeStateStatusSchema = z.enum([
  "BEHIND",
  "BLOCKED",
  "CLEAN",
  "DIRTY",
  "DRAFT",
  "HAS_HOOKS",
  "UNKNOWN",
  "UNSTABLE",
]);
export type GitHostPullRequestMergeStateStatus = z.infer<
  typeof gitHostPullRequestMergeStateStatusSchema
>;

const gitHostPullRequestMergeableSchema = z.enum([
  "CONFLICTING",
  "MERGEABLE",
  "UNKNOWN",
]);
export type GitHostPullRequestMergeable = z.infer<
  typeof gitHostPullRequestMergeableSchema
>;

/**
 * Pull request data normalized from the host git-host CLI (`gh pr view`).
 * The host daemon returns this verbatim; the server maps it onto the
 * product-facing `ThreadPullRequest`.
 */
export const gitHostPullRequestSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    state: z.enum(["OPEN", "CLOSED", "MERGED"]),
    url: z.string().url(),
    isDraft: z.boolean(),
    baseRefName: z.string(),
    headRefName: z.string(),
    updatedAt: z.string().datetime(),
    checks: z.array(gitHostPullRequestCheckSchema),
    reviewDecision: gitHostPullRequestReviewDecisionSchema.nullable(),
    reviewRequestCount: z.number().int().nonnegative(),
    mergeStateStatus: gitHostPullRequestMergeStateStatusSchema.nullable(),
    mergeable: gitHostPullRequestMergeableSchema.nullable(),
  })
  .strict();
export type GitHostPullRequest = z.infer<typeof gitHostPullRequestSchema>;

const pullRequestStateSchema = z.enum(["draft", "open", "merged", "closed"]);
export type PullRequestState = z.infer<typeof pullRequestStateSchema>;

const threadPullRequestChecksStateSchema = z.enum([
  "passing",
  "failing",
  "pending",
  "no_checks",
  "unknown",
]);
export type ThreadPullRequestChecksState = z.infer<
  typeof threadPullRequestChecksStateSchema
>;

const threadPullRequestChecksSchema = z
  .object({
    state: threadPullRequestChecksStateSchema,
    totalCount: z.number().int().nonnegative(),
    passedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
  })
  .strict();
export type ThreadPullRequestChecks = z.infer<
  typeof threadPullRequestChecksSchema
>;

const threadPullRequestReviewStateSchema = z.enum([
  "approved",
  "changes_requested",
  "review_required",
  "review_requested",
  "none",
]);
export type ThreadPullRequestReviewState = z.infer<
  typeof threadPullRequestReviewStateSchema
>;

const threadPullRequestReviewSchema = z
  .object({
    state: threadPullRequestReviewStateSchema,
    reviewRequestCount: z.number().int().nonnegative(),
  })
  .strict();
export type ThreadPullRequestReview = z.infer<
  typeof threadPullRequestReviewSchema
>;

const threadPullRequestMergeabilityStateSchema = z.enum([
  "mergeable",
  "conflicts",
  "blocked",
  "draft",
  "unknown",
]);
export type ThreadPullRequestMergeabilityState = z.infer<
  typeof threadPullRequestMergeabilityStateSchema
>;

const threadPullRequestMergeabilitySchema = z
  .object({
    state: threadPullRequestMergeabilityStateSchema,
    mergeStateStatus: gitHostPullRequestMergeStateStatusSchema.nullable(),
    mergeable: gitHostPullRequestMergeableSchema.nullable(),
  })
  .strict();
export type ThreadPullRequestMergeability = z.infer<
  typeof threadPullRequestMergeabilitySchema
>;

const threadPullRequestAttentionStateSchema = z.enum([
  "checks_failed",
  "checks_pending",
  "changes_requested",
  "review_requested",
  "conflicts",
  "blocked",
  "draft",
  "ready_to_merge",
  "merged",
  "closed",
  "none",
]);
export type ThreadPullRequestAttentionState = z.infer<
  typeof threadPullRequestAttentionStateSchema
>;

/**
 * A pull request associated with a thread's branch, assembled by the server
 * from {@link gitHostPullRequestSchema} (the server folds `isDraft` into the
 * product-facing {@link pullRequestStateSchema}).
 */
export const threadPullRequestSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    state: pullRequestStateSchema,
    url: z.string().url(),
    baseRefName: z.string(),
    headRefName: z.string(),
    updatedAt: z.string().datetime(),
    checks: threadPullRequestChecksSchema,
    review: threadPullRequestReviewSchema,
    mergeability: threadPullRequestMergeabilitySchema,
    attention: threadPullRequestAttentionStateSchema,
  })
  .strict();
export type ThreadPullRequest = z.infer<typeof threadPullRequestSchema>;

export const threadQueuedMessageSchema = z.object({
  id: z.string(),
  content: z.array(promptInputSchema).min(1),
  model: z.string().min(1),
  reasoningLevel: reasoningLevelSchema,
  permissionMode: permissionModeSchema,
  serviceTier: serviceTierSchema,
  groupWithNext: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ThreadQueuedMessage = z.infer<typeof threadQueuedMessageSchema>;

export const threadSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  environmentId: z.string().nullable(),
  providerId: z.string(),
  title: z.string().nullable(),
  titleFallback: z.string().nullable(),
  sectionId: z.string().nullable(),
  status: threadStatusSchema,
  parentThreadId: z.string().nullable(),
  sourceThreadId: z.string().nullable(),
  originKind: threadOriginKindSchema.nullable(),
  /** Id of the plugin that spawned this thread; null for non-plugin origins. */
  originPluginId: z.string().nullable(),
  visibility: threadVisibilitySchema,
  archivedAt: z.number().nullable(),
  pinnedAt: z.number().nullable(),
  deletedAt: z.number().nullable(),
  lastReadAt: z.number().nullable(),
  latestAttentionAt: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Thread = z.infer<typeof threadSchema>;

export const threadWithRuntimeSchema = threadSchema.extend({
  runtime: threadRuntimeStateSchema,
});
export type ThreadWithRuntime = z.infer<typeof threadWithRuntimeSchema>;

export const threadListEntrySchema = threadWithRuntimeSchema.extend({
  activity: threadActivityStateSchema,
  pinSortKey: z.string().nullable(),
  hasPendingInteraction: z.boolean(),
  environmentHostId: z.string().nullable(),
  environmentName: z.string().nullable(),
  environmentBranchName: z.string().nullable(),
  environmentWorkspaceDisplayKind: environmentWorkspaceDisplayKindSchema,
});
export type ThreadListEntry = z.infer<typeof threadListEntrySchema>;
