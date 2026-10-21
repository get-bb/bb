import { z } from "zod";
import {
  environmentStatusSchema,
  FILE_LIST_QUERY_MAX_LENGTH,
  gitBranchNameSchema,
  threadPullRequestSchema,
} from "@bb/domain";
import { workspaceResolutionFailureSchema } from "@bb/host-daemon-contract/workspace";
import { apiErrorSchema } from "../errors.js";
import {
  environmentProviderInstanceKeySchema,
  pathListIncludeQueryValueSchema,
} from "./shared.js";

export const environmentNameSchema = z.string().trim().min(1).max(80);

export const updateEnvironmentRequestSchema = z
  .object({
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

export const listEnvironmentsQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  environmentProviderId: z.string().min(1).optional(),
  hostId: z.string().min(1).optional(),
  instanceKey: environmentProviderInstanceKeySchema.optional(),
  path: z.string().min(1).optional(),
  status: environmentStatusSchema.optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});
export type ListEnvironmentsQuery = z.infer<typeof listEnvironmentsQuerySchema>;

export const environmentPathsQuerySchema = z.object({
  query: z.string().min(1).max(FILE_LIST_QUERY_MAX_LENGTH).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  includeFiles: pathListIncludeQueryValueSchema,
  includeDirectories: pathListIncludeQueryValueSchema,
});
export type EnvironmentPathsQuery = z.infer<typeof environmentPathsQuerySchema>;

export const environmentArchiveThreadsResponseSchema = z.object({
  ok: z.literal(true),
  archivedThreadIds: z.array(z.string().min(1)),
});
export type EnvironmentArchiveThreadsResponse = z.infer<
  typeof environmentArchiveThreadsResponseSchema
>;

export const pullRequestMergeMethodSchema = z.enum([
  "merge",
  "squash",
  "rebase",
]);
export type PullRequestMergeMethod = z.infer<
  typeof pullRequestMergeMethodSchema
>;

export const pullRequestMergeOptionsSchema = z
  .object({
    method: pullRequestMergeMethodSchema,
  })
  .strict();

export const environmentActionRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("commit"),
    })
    .strict(),
  z
    .object({
      action: z.literal("pull_request_ready"),
    })
    .strict(),
  z
    .object({
      action: z.literal("pull_request_merge"),
      options: pullRequestMergeOptionsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("pull_request_draft"),
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

export const pullRequestReadyActionResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal("pull_request_ready"),
  message: z.string().min(1),
});
export type PullRequestReadyActionResponse = z.infer<
  typeof pullRequestReadyActionResponseSchema
>;

export const pullRequestMergeActionResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal("pull_request_merge"),
  method: pullRequestMergeMethodSchema,
  message: z.string().min(1),
});
export type PullRequestMergeActionResponse = z.infer<
  typeof pullRequestMergeActionResponseSchema
>;

export const pullRequestDraftActionResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal("pull_request_draft"),
  message: z.string().min(1),
});
export type PullRequestDraftActionResponse = z.infer<
  typeof pullRequestDraftActionResponseSchema
>;

export const environmentActionResponseSchema = z.discriminatedUnion("action", [
  commitActionResponseSchema,
  pullRequestReadyActionResponseSchema,
  pullRequestMergeActionResponseSchema,
  pullRequestDraftActionResponseSchema,
]);
export type EnvironmentActionResponse = z.infer<
  typeof environmentActionResponseSchema
>;

export const environmentActionFailureDetailsSchema = z.object({
  kind: z.literal("workspace_unavailable"),
  failure: workspaceResolutionFailureSchema,
});

export const environmentActionApiErrorSchema = apiErrorSchema.extend({
  details: environmentActionFailureDetailsSchema.optional(),
});
export type EnvironmentActionApiError = z.infer<
  typeof environmentActionApiErrorSchema
>;

export const environmentWorkspaceNotApplicableReasonSchema = z.enum([
  "non_git_environment",
]);

export const environmentPullRequestResponseSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("available"),
        pullRequest: threadPullRequestSchema,
      })
      .strict(),
    z.object({ outcome: z.literal("absent") }).strict(),
    z
      .object({
        outcome: z.literal("unavailable"),
        message: z.string().min(1),
      })
      .strict(),
  ],
);
export type EnvironmentPullRequestResponse = z.infer<
  typeof environmentPullRequestResponseSchema
>;
