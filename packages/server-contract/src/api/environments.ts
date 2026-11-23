import { z } from "zod";
import {
  environmentHolderSchema,
  environmentStatusSchema,
  FILE_LIST_QUERY_MAX_LENGTH,
  gitBranchNameSchema,
  jsonValueSchema,
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

export const createEnvironmentRequestSchema = z
  .object({
    projectId: z.string().min(1),
    hostId: z.string().min(1).optional(),
    provider: z
      .object({
        id: z.string().min(1),
        inputs: jsonValueSchema.optional(),
      })
      .strict()
      .optional(),
    name: environmentNameSchema.optional(),
    heldBy: environmentHolderSchema,
  })
  .strict();
export type CreateEnvironmentRequest = z.infer<
  typeof createEnvironmentRequestSchema
>;

export const listEnvironmentsQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  environmentProviderId: z.string().min(1).optional(),
  heldBy: environmentHolderSchema.optional(),
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

export const environmentRepoSchema = z
  .object({
    rootPath: z.string().min(1),
    path: z.string().min(1),
    label: z.string(),
    source: z.enum(["main", "folder", "discovered"]),
  })
  .strict();
export type EnvironmentRepo = z.infer<typeof environmentRepoSchema>;

export const environmentReposResponseSchema = z
  .object({
    repos: z.array(environmentRepoSchema),
    truncated: z.boolean(),
  })
  .strict();
export type EnvironmentReposResponse = z.infer<
  typeof environmentReposResponseSchema
>;


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

