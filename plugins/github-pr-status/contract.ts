import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  PULL_REQUESTS_MAX_KEYS,
  environmentPullRequestTag,
} from "./read-contract.js";

export const SHOW_PULL_REQUEST_SETTING = "showPullRequest";
export const HOST_VIEWS_MAX_READS = 200;

const checkStatusSchema = z.enum([
  "queued",
  "in_progress",
  "completed",
  "unknown",
]);

const checkConclusionSchema = z.enum([
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

const checkSchema = z
  .object({
    name: z.string().min(1),
    status: checkStatusSchema,
    conclusion: checkConclusionSchema.nullable(),
    url: z.string().url().nullable(),
    startedAt: z.string().datetime().nullable(),
  })
  .strict();
export type GitHubPullRequestCheck = z.infer<typeof checkSchema>;

const reviewDecisionSchema = z.enum([
  "APPROVED",
  "CHANGES_REQUESTED",
  "REVIEW_REQUIRED",
]);
export type GitHubPullRequestReviewDecision = z.infer<
  typeof reviewDecisionSchema
>;

const mergeStateStatusSchema = z.enum([
  "BEHIND",
  "BLOCKED",
  "CLEAN",
  "DIRTY",
  "DRAFT",
  "HAS_HOOKS",
  "UNKNOWN",
  "UNSTABLE",
]);
export type GitHubPullRequestMergeStateStatus = z.infer<
  typeof mergeStateStatusSchema
>;

const mergeableSchema = z.enum(["CONFLICTING", "MERGEABLE", "UNKNOWN"]);
export type GitHubPullRequestMergeable = z.infer<typeof mergeableSchema>;

export const gitHubPullRequestViewSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    state: z.enum(["OPEN", "CLOSED", "MERGED"]),
    url: z.string().url(),
    isDraft: z.boolean(),
    autoMerge: z.boolean(),
    inMergeQueue: z.boolean().nullable(),
    baseRefName: z.string(),
    headRefName: z.string(),
    headRefOid: z.string().nullable(),
    updatedAt: z.string().datetime(),
    checks: z.array(checkSchema),
    reviewDecision: reviewDecisionSchema.nullable(),
    reviewRequestCount: z.number().int().nonnegative(),
    mergeStateStatus: mergeStateStatusSchema.nullable(),
    mergeable: mergeableSchema.nullable(),
  })
  .strict();
export type GitHubPullRequestView = z.infer<typeof gitHubPullRequestViewSchema>;

const pullRequestStateSchema = z.enum(["draft", "open", "merged", "closed"]);
export type PullRequestState = z.infer<typeof pullRequestStateSchema>;

const checksStateSchema = z.enum([
  "passing",
  "failing",
  "pending",
  "no_checks",
  "unknown",
]);
export type PullRequestChecksState = z.infer<typeof checksStateSchema>;

const checksSchema = z
  .object({
    state: checksStateSchema,
    totalCount: z.number().int().nonnegative(),
    passedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
  })
  .strict();
export type PullRequestChecks = z.infer<typeof checksSchema>;

const reviewStateSchema = z.enum([
  "approved",
  "changes_requested",
  "review_required",
  "review_requested",
  "none",
]);
export type PullRequestReviewState = z.infer<typeof reviewStateSchema>;

const reviewSchema = z
  .object({
    state: reviewStateSchema,
    reviewRequestCount: z.number().int().nonnegative(),
  })
  .strict();
export type PullRequestReview = z.infer<typeof reviewSchema>;

const mergeabilityStateSchema = z.enum([
  "mergeable",
  "conflicts",
  "blocked",
  "draft",
  "unknown",
]);
export type PullRequestMergeabilityState = z.infer<
  typeof mergeabilityStateSchema
>;

const mergeabilitySchema = z
  .object({
    state: mergeabilityStateSchema,
    mergeStateStatus: mergeStateStatusSchema.nullable(),
    mergeable: mergeableSchema.nullable(),
  })
  .strict();
export type PullRequestMergeability = z.infer<typeof mergeabilitySchema>;

const attentionStateSchema = z.enum([
  "checks_failed",
  "checks_pending",
  "changes_requested",
  "review_requested",
  "conflicts",
  "blocked",
  "draft",
  "queued",
  "ready_to_merge",
  "merged",
  "closed",
  "none",
]);
export type PullRequestAttentionState = z.infer<typeof attentionStateSchema>;

export const pullRequestSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    state: pullRequestStateSchema,
    url: z.string().url(),
    baseRefName: z.string(),
    headRefName: z.string(),
    updatedAt: z.string().datetime(),
    autoMerge: z.boolean(),
    inMergeQueue: z.boolean().nullable(),
    checks: checksSchema,
    review: reviewSchema,
    mergeability: mergeabilitySchema,
    attention: attentionStateSchema,
  })
  .strict();
export type PullRequest = z.infer<typeof pullRequestSchema>;

export const environmentPullRequestSchema = z.discriminatedUnion("outcome", [
  z
    .object({ outcome: z.literal("available"), pullRequest: pullRequestSchema })
    .strict(),
  z.object({ outcome: z.literal("absent") }).strict(),
  z
    .object({ outcome: z.literal("unavailable"), message: z.string().min(1) })
    .strict(),
]);
export type EnvironmentPullRequest = z.infer<
  typeof environmentPullRequestSchema
>;

export const pullRequestMergeMethodSchema = z.enum([
  "merge",
  "squash",
  "rebase",
]);
export type PullRequestMergeMethod = z.infer<
  typeof pullRequestMergeMethodSchema
>;

const environmentActionInputSchema = z
  .object({ environmentId: z.string().min(1) })
  .strict();
const actionOutputSchema = z.object({ message: z.string() }).strict();

export const githubPrStatusRpcContract = defineRpcContract({
  pullRequests: {
    experimental_description:
      "The GitHub pull request for each environment's current branch, keyed by environment id.",
    input: z
      .object({
        keys: z.array(z.string().min(1)).min(1).max(PULL_REQUESTS_MAX_KEYS),
      })
      .strict(),
    output: z.record(z.string(), environmentPullRequestSchema),
    keyTags: (key) => [environmentPullRequestTag(key)],
  },
  refresh: {
    experimental_description:
      "Re-check the environment's pull request on GitHub now, whatever the age of the saved row, and resolve once the row is current.",
    input: environmentActionInputSchema,
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  markReady: {
    experimental_description:
      "Mark the environment's draft pull request ready for review.",
    input: environmentActionInputSchema,
    output: actionOutputSchema,
  },
  markDraft: {
    experimental_description:
      "Convert the environment's open pull request back to a draft.",
    input: environmentActionInputSchema,
    output: actionOutputSchema,
  },
  merge: {
    experimental_description:
      "Merge the environment's pull request with the given method.",
    input: environmentActionInputSchema
      .extend({ method: pullRequestMergeMethodSchema })
      .strict(),
    output: actionOutputSchema,
  },
});

const hostPullRequestActionSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("ready") }).strict(),
  z.object({ operation: z.literal("draft") }).strict(),
  z
    .object({
      operation: z.literal("merge"),
      method: pullRequestMergeMethodSchema,
    })
    .strict(),
]);
export type HostPullRequestAction = z.infer<typeof hostPullRequestActionSchema>;

export const hostPullRequestLookupSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("found"),
      pullRequest: gitHubPullRequestViewSchema,
    })
    .strict(),
  z.object({ outcome: z.literal("none") }).strict(),
  z
    .object({ outcome: z.literal("unavailable"), message: z.string().min(1) })
    .strict(),
]);
export type HostPullRequestLookup = z.infer<typeof hostPullRequestLookupSchema>;

const hostPullRequestActionResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ ok: z.literal(false), message: z.string().min(1) }).strict(),
]);

export const githubPrStatusHostContract = defineRpcContract({
  views: {
    experimental_retryable: true,
    input: z
      .object({
        reads: z
          .array(
            z
              .object({
                path: z.string().min(1),
                url: z.string().url().nullable(),
                refresh: z.boolean(),
              })
              .strict(),
          )
          .min(1)
          .max(HOST_VIEWS_MAX_READS),
      })
      .strict(),
    output: z.array(hostPullRequestLookupSchema),
  },
  upstream: {
    input: z.object({ path: z.string().min(1) }).strict(),
    output: z
      .object({ oid: z.string().nullable(), branchName: z.string().nullable() })
      .strict(),
  },
  act: {
    input: z
      .object({ path: z.string().min(1), action: hostPullRequestActionSchema })
      .strict(),
    output: hostPullRequestActionResultSchema,
  },
});
