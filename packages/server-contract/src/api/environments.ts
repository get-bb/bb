import { z } from "zod";
import {
  environmentStatusSchema,
  FILE_LIST_QUERY_MAX_LENGTH,
  gitBranchNameSchema,
  workspaceDiffTargetSchema,
} from "@bb/domain";
import { apiErrorSchema } from "../errors.js";
import {
  environmentProviderInstanceKeySchema,
  pathListIncludeQueryValueSchema,
} from "./shared.js";
import { workspaceResolutionFailureSchema } from "@bb/host-daemon-contract/workspace";

export const environmentCleanupQuerySchema = z.object({
  recover: z.enum(["true", "false"]).default("false"),
});
export type EnvironmentCleanupQuery = z.input<
  typeof environmentCleanupQuerySchema
>;

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

const mergeBaseBranchQuerySchema = z
  .string("A merge base branch is required")
  .pipe(gitBranchNameSchema);

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

export const environmentArchiveThreadsResponseSchema = z.object({
  ok: z.literal(true),
  archivedThreadIds: z.array(z.string().min(1)),
});
export type EnvironmentArchiveThreadsResponse = z.infer<
  typeof environmentArchiveThreadsResponseSchema
>;

export const environmentActionRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("commit"),
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

export const environmentActionResponseSchema = z.discriminatedUnion("action", [
  commitActionResponseSchema,
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

export const diffViewedFileSchema = z
  .object({
    path: z.string().min(1),
    revision: z.string().min(1),
  })
  .strict();
export type DiffViewedFile = z.infer<typeof diffViewedFileSchema>;

export const environmentDiffViewedResponseSchema = z
  .object({
    files: z.array(diffViewedFileSchema),
  })
  .strict();
export type EnvironmentDiffViewedResponse = z.infer<
  typeof environmentDiffViewedResponseSchema
>;

export const environmentDiffViewedQueryRequestSchema =
  environmentDiffQuerySchema.and(
    z.object({ paths: z.array(z.string().min(1).max(4096)).max(500) }),
  );
export type EnvironmentDiffViewedQueryRequest = z.infer<
  typeof environmentDiffViewedQueryRequestSchema
>;

export const environmentDiffViewedMarkRequestSchema = z
  .object({
    target: workspaceDiffTargetSchema,
    path: z.string().min(1).max(4096),
    revision: z.string().min(1).max(1024),
  })
  .strict();
export type EnvironmentDiffViewedMarkRequest = z.infer<
  typeof environmentDiffViewedMarkRequestSchema
>;

export const environmentDiffViewedClearRequestSchema = z
  .object({
    target: workspaceDiffTargetSchema,
    path: z.string().min(1).max(4096).optional(),
  })
  .strict();
export type EnvironmentDiffViewedClearRequest = z.infer<
  typeof environmentDiffViewedClearRequestSchema
>;

