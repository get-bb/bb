import { z } from "zod";
import {
  browserAutomationClientUnavailableReasonSchema,
  browserAutomationOpenFailureCodeSchema,
  environmentStatusSchema,
  hostStatusSchema,
  threadStatusSchema,
} from "@bb/domain";

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

export const threadEnvironmentUnavailableApiErrorSchema = apiErrorSchema.extend(
  {
    code: z.literal("thread_environment_unavailable"),
    details: threadEnvironmentUnavailableErrorDetailsSchema,
  },
);

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

export const browserClientUnavailableErrorDetailsSchema = z.object({
  reason: browserAutomationClientUnavailableReasonSchema,
});
export type BrowserClientUnavailableErrorDetails = z.infer<
  typeof browserClientUnavailableErrorDetailsSchema
>;

export const browserTargetLimitErrorDetailsSchema = z.object({
  limit: z.number().int().positive(),
});
export type BrowserTargetLimitErrorDetails = z.infer<
  typeof browserTargetLimitErrorDetailsSchema
>;

export const browserOpenTimeoutErrorDetailsSchema = z.object({
  timeoutMs: z.number().int().positive(),
});
export type BrowserOpenTimeoutErrorDetails = z.infer<
  typeof browserOpenTimeoutErrorDetailsSchema
>;

export const browserOpenFailedErrorDetailsSchema = z.object({
  reason: browserAutomationOpenFailureCodeSchema,
});
export type BrowserOpenFailedErrorDetails = z.infer<
  typeof browserOpenFailedErrorDetailsSchema
>;

export const browserClientUnavailableApiErrorSchema = apiErrorSchema.extend({
  code: z.literal("browser_client_unavailable"),
  details: browserClientUnavailableErrorDetailsSchema,
});

export const browserTargetLimitApiErrorSchema = apiErrorSchema.extend({
  code: z.literal("browser_target_limit"),
  details: browserTargetLimitErrorDetailsSchema,
});

export const browserTargetNotFoundApiErrorSchema = apiErrorSchema.extend({
  code: z.literal("browser_target_not_found"),
});

export const browserTargetClosedApiErrorSchema = apiErrorSchema.extend({
  code: z.literal("browser_target_closed"),
});

export const browserOpenTimeoutApiErrorSchema = apiErrorSchema.extend({
  code: z.literal("browser_open_timeout"),
  details: browserOpenTimeoutErrorDetailsSchema,
});

export const browserOpenFailedApiErrorSchema = apiErrorSchema.extend({
  code: z.literal("browser_open_failed"),
  details: browserOpenFailedErrorDetailsSchema,
});

export const browserTargetBusyApiErrorSchema = apiErrorSchema.extend({
  code: z.literal("browser_target_busy"),
});

export const browserCommandTimeoutApiErrorSchema = apiErrorSchema.extend({
  code: z.literal("browser_command_timeout"),
  details: browserOpenTimeoutErrorDetailsSchema,
});

export const browserCommandCancelledApiErrorSchema = apiErrorSchema.extend({
  code: z.literal("browser_command_cancelled"),
});

export const browserStaleRevisionApiErrorSchema = apiErrorSchema.extend({
  code: z.literal("browser_stale_revision"),
});

export const browserNativeOperationFailedApiErrorSchema = apiErrorSchema.extend({
  code: z.literal("browser_native_operation_failed"),
});

export const browserHostMismatchApiErrorSchema = apiErrorSchema.extend({
  code: z.literal("browser_host_mismatch"),
});

export const browserArtifactNotFoundApiErrorSchema = apiErrorSchema.extend({
  code: z.literal("browser_artifact_not_found"),
});

export const browserAutomationApiErrorSchema = z.discriminatedUnion("code", [
  browserClientUnavailableApiErrorSchema,
  browserTargetLimitApiErrorSchema,
  browserTargetNotFoundApiErrorSchema,
  browserTargetClosedApiErrorSchema,
  browserOpenTimeoutApiErrorSchema,
  browserOpenFailedApiErrorSchema,
  browserTargetBusyApiErrorSchema,
  browserCommandTimeoutApiErrorSchema,
  browserCommandCancelledApiErrorSchema,
  browserStaleRevisionApiErrorSchema,
  browserNativeOperationFailedApiErrorSchema,
  browserHostMismatchApiErrorSchema,
  browserArtifactNotFoundApiErrorSchema,
]);
export type BrowserAutomationApiError = z.infer<
  typeof browserAutomationApiErrorSchema
>;
