import { z } from "zod";
import {
  environmentStatusSchema,
  hostStatusSchema,
  threadStatusSchema,
} from "@bb/domain";

/** Closed set of well-known error codes emitted by server-side logic.
 *  The base public ApiError envelope keeps `code` open as a string so routes
 *  can return additional route-specific values without widening this enum. */
export const domainErrorCodeSchema = z.enum([
  "invalid_request",
  "invalid_manifest",
  "awaiting_user_interaction",
  "thread_not_found",
  "project_not_found",
  "thread_archived",
  "inactive_session",
  "provider_unavailable",
  "provider_timeout",
  "provider_rpc_error",
  "unsupported_operation",
  "no_active_turn",
  "internal_error",
  "environment_not_ready",
  "thread_not_writable",
  "thread_environment_unavailable",
  "host_unavailable",
  "project_unavailable",
  "parent_thread_invalid",
]);

/** Base public error envelope shared by server routes. Route-specific schemas
 *  may extend this with typed fields such as structured `details` while
 *  preserving the common top-level `code` / `message` / `retryable` shape. */
export const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  details: z.unknown().optional(),
  retryable: z.boolean().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const environmentNotReadyErrorDetailsSchema = z.object({
  environmentStatus: environmentStatusSchema,
  hasPath: z.boolean(),
  cleanupRequestedAt: z.number().int().nonnegative().nullable(),
});
export type EnvironmentNotReadyErrorDetails = z.infer<
  typeof environmentNotReadyErrorDetailsSchema
>;

export const threadNotWritableReasonSchema = z.enum([
  "archived",
  "stopping",
  "deleted",
  "not_started",
  "not_active",
  "errored",
  "already_active",
  "still_starting",
]);
export type ThreadNotWritableReason = z.infer<
  typeof threadNotWritableReasonSchema
>;

export const threadNotWritableErrorDetailsSchema = z.object({
  reason: threadNotWritableReasonSchema,
  archivedAt: z.number().int().nonnegative().nullable(),
  stopRequestedAt: z.number().int().nonnegative().nullable(),
  threadStatus: threadStatusSchema,
});
export type ThreadNotWritableErrorDetails = z.infer<
  typeof threadNotWritableErrorDetailsSchema
>;

export const threadEnvironmentUnavailableReasonSchema = z.enum([
  "never_attached",
  "destroyed",
  "destroying",
  "provisioning",
  "errored",
]);

export const threadEnvironmentUnavailableErrorDetailsSchema = z.object({
  reason: threadEnvironmentUnavailableReasonSchema,
  environmentStatus: environmentStatusSchema.nullable(),
});
export type ThreadEnvironmentUnavailableErrorDetails = z.infer<
  typeof threadEnvironmentUnavailableErrorDetailsSchema
>;

export const hostUnavailableReasonSchema = z.enum([
  "suspended",
  "disconnected",
  "destroyed",
]);

export const hostUnavailableErrorDetailsSchema = z.object({
  reason: hostUnavailableReasonSchema,
  hostStatus: hostStatusSchema.nullable(),
  suspendedAt: z.number().int().nonnegative().nullable(),
  destroyedAt: z.number().int().nonnegative().nullable(),
});
export type HostUnavailableErrorDetails = z.infer<
  typeof hostUnavailableErrorDetailsSchema
>;

export const projectUnavailableReasonSchema = z.enum([
  "deleted",
  "pending_deletion",
]);

export const projectUnavailableErrorDetailsSchema = z.object({
  reason: projectUnavailableReasonSchema,
  deletedAt: z.number().int().nonnegative().nullable(),
});
export type ProjectUnavailableErrorDetails = z.infer<
  typeof projectUnavailableErrorDetailsSchema
>;

export const parentThreadInvalidReasonSchema = z.enum([
  "not_found",
  "archived",
  "deleted",
  "wrong_project",
  "self",
  "cycle",
  "too_deep",
]);
export type ParentThreadInvalidReason = z.infer<
  typeof parentThreadInvalidReasonSchema
>;

export const parentThreadInvalidSubjectSchema = z.enum(["parent", "sender"]);
export type ParentThreadInvalidSubject = z.infer<
  typeof parentThreadInvalidSubjectSchema
>;

export const parentThreadInvalidErrorDetailsSchema = z.object({
  reason: parentThreadInvalidReasonSchema,
  subject: parentThreadInvalidSubjectSchema,
});
export type ParentThreadInvalidErrorDetails = z.infer<
  typeof parentThreadInvalidErrorDetailsSchema
>;

export const environmentNotReadyApiErrorSchema = apiErrorSchema.extend({
  code: z.literal("environment_not_ready"),
  details: environmentNotReadyErrorDetailsSchema,
});

export const threadNotWritableApiErrorSchema = apiErrorSchema.extend({
  code: z.literal("thread_not_writable"),
  details: threadNotWritableErrorDetailsSchema,
});

export const threadEnvironmentUnavailableApiErrorSchema =
  apiErrorSchema.extend({
    code: z.literal("thread_environment_unavailable"),
    details: threadEnvironmentUnavailableErrorDetailsSchema,
  });

export const hostUnavailableApiErrorSchema = apiErrorSchema.extend({
  code: z.literal("host_unavailable"),
  details: hostUnavailableErrorDetailsSchema,
});

export const projectUnavailableApiErrorSchema = apiErrorSchema.extend({
  code: z.literal("project_unavailable"),
  details: projectUnavailableErrorDetailsSchema,
});

export const parentThreadInvalidApiErrorSchema = apiErrorSchema.extend({
  code: z.literal("parent_thread_invalid"),
  details: parentThreadInvalidErrorDetailsSchema,
});

export const lifecycleApiErrorSchema = z.discriminatedUnion("code", [
  environmentNotReadyApiErrorSchema,
  threadNotWritableApiErrorSchema,
  threadEnvironmentUnavailableApiErrorSchema,
  hostUnavailableApiErrorSchema,
  projectUnavailableApiErrorSchema,
  parentThreadInvalidApiErrorSchema,
]);
export type LifecycleApiError = z.infer<typeof lifecycleApiErrorSchema>;
