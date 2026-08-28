import { z } from "zod";
import {
  approvalPendingInteractionResolutionSchema,
  interactionLifecycleSchema,
  pendingInteractionPermissionGrantApprovalSubjectSchema,
  pendingInteractionStatusSchema,
  userQuestionPendingInteractionPayloadSchema,
  userQuestionPendingInteractionResolutionSchema,
} from "./pending-interactions.js";
import {
  promptInputSchema,
  recordedThreadExecutionOptionsSchema,
} from "./shared-types.js";
import { jsonValueSchema } from "./json-value.js";
import { clientTurnRequestIdSchema } from "./protocol-ids.js";
import { queuedMessageWaitingOnSchema } from "./queued-message.js";
import {
  systemMessageKindSchema,
  systemMessageSubjectSchema,
} from "./system-message.js";

export const systemEventTypeValues = [
  "client/thread/start",
  "client/turn/requested",
  "client/turn/rejected",
  "client/turn/start",
  "system/error",
  "system/manager/user_message",
  "system/thread/interrupted",
  "system/operation",
  "system/interaction/lifecycle",
  "system/permissionGrant/lifecycle",
  "system/userQuestion/lifecycle",
  "system/thread-provisioning",
  "system/dispatch-hold",
  "system/queue-state",
  "system/plugin-note",
  // Legacy persisted watchdog diagnostic; retained for read/decode/render
  // only, with no current producer.
  "system/provider-turn-watchdog",
] as const;

const threadTurnInitiatorValues = ["user", "agent", "system"] as const;
export const threadTurnInitiatorSchema = z.enum(threadTurnInitiatorValues);
export type ThreadTurnInitiator = z.infer<typeof threadTurnInitiatorSchema>;

/**
 * Execution values are historical facts once recorded in the event stream.
 * The stored-event boundary therefore accepts the two retired modes without
 * treating either as a current public preset.
 */
const turnRequestOptionsSchema = recordedThreadExecutionOptionsSchema;

export const turnRequestTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("thread-start") }),
  z.object({ kind: z.literal("new-turn") }),
  z.object({
    kind: z.literal("auto"),
    expectedTurnId: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("steer"),
    expectedTurnId: z.string().nullable(),
  }),
]);
export type TurnRequestTarget = z.infer<typeof turnRequestTargetSchema>;

export const clientTurnLifecycleEventDataSchema = z.object({
  direction: z.literal("outbound"),
  source: z.enum(["spawn", "tell"]),
  initiator: threadTurnInitiatorSchema,
  request: z.object({
    method: z.enum(["thread/start", "turn/start"]),
    params: z.record(z.string(), z.unknown()),
  }),
});
export type ClientTurnLifecycleEventData = z.infer<
  typeof clientTurnLifecycleEventDataSchema
>;

export const turnRequestEventDataSchema = z.object({
  direction: z.literal("outbound"),
  requestId: clientTurnRequestIdSchema,
  // Retry provenance, written only when a `turn.failed` gate's retry hold is
  // released. Both fields are present together or not at all: absence means
  // "this is an original dispatch", which is the overwhelmingly common case.
  // (Supersedes the pre-plugin `continuationOfRequestId` key, which the removed
  // core rate-limit recovery wrote and nothing ever read.)
  /** The original request this attempt re-submits, unchanged across attempts. */
  retryOfRequestId: clientTurnRequestIdSchema.optional(),
  /** Which attempt this is: 2 is the first retry of the original request. */
  retryAttempt: z.number().int().min(2).optional(),
  source: z.enum(["spawn", "tell"]),
  initiator: threadTurnInitiatorSchema,
  senderThreadId: z.string().nullable(),
  systemMessageKind: systemMessageKindSchema.optional(),
  systemMessageSubject: systemMessageSubjectSchema.nullable().optional(),
  input: z.array(promptInputSchema),
  inputGroups: z.array(z.array(promptInputSchema).min(1)).min(1).optional(),
  // Dispatch-gate provenance. Omitted means no gate amended this turn, which
  // is the overwhelmingly common case and the reason these are optional rather
  // than nullable: a null would claim "a gate ran and changed nothing".
  /** The plugin whose gate amended this turn's execution or input. */
  amendedByPluginId: z.string().min(1).optional(),
  /** The prompt blocks as the caller wrote them, kept only when a gate
   * replaced them — the audit trail for a silently rewriting plugin. */
  originalInput: z.array(promptInputSchema).optional(),
  target: turnRequestTargetSchema,
  request: z.object({
    method: z.enum(["thread/start", "turn/start"]),
    params: z.record(z.string(), z.unknown()),
  }),
  execution: turnRequestOptionsSchema,
});
export type TurnRequestEventData = z.infer<typeof turnRequestEventDataSchema>;

export const turnRequestRejectedEventDataSchema = z.object({
  requestId: clientTurnRequestIdSchema,
  reason: z.string().min(1),
  message: z.string().min(1),
});

export const systemErrorEventDataSchema = z
  .object({
    code: z.string().optional(),
    message: z.string(),
    detail: z.string().optional(),
    reconnectAttempt: z.number().int().positive().optional(),
    reconnectTotal: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    const hasReconnectAttempt = value.reconnectAttempt !== undefined;
    const hasReconnectTotal = value.reconnectTotal !== undefined;
    if (hasReconnectAttempt !== hasReconnectTotal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "system/error reconnectAttempt and reconnectTotal must be provided together",
      });
      return;
    }

    if (
      value.reconnectAttempt !== undefined &&
      value.reconnectTotal !== undefined &&
      value.reconnectAttempt > value.reconnectTotal
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "system/error reconnectAttempt cannot be greater than reconnectTotal",
      });
    }
  });
export type SystemErrorEventData = z.infer<typeof systemErrorEventDataSchema>;

const ownershipChangeOperationActionValues = [
  "assign",
  "release",
  "transfer",
] as const;
const ownershipChangeOperationActionSchema = z.enum(
  ownershipChangeOperationActionValues,
);
export type OwnershipChangeOperationAction = z.infer<
  typeof ownershipChangeOperationActionSchema
>;

export const ownershipChangeOperationMetadataSchema = z.object({
  action: ownershipChangeOperationActionSchema,
  nextParentThreadId: z.string().nullable(),
  nextParentThreadTitle: z.string().nullable(),
  previousParentThreadId: z.string().nullable(),
  previousParentThreadTitle: z.string().nullable(),
});
export type OwnershipChangeOperationMetadata = z.infer<
  typeof ownershipChangeOperationMetadataSchema
>;

export const systemOperationEventDataSchema = z.object({
  operation: z.string(),
  status: z.string(),
  message: z.string(),
  operationId: z.string(),
  metadata: z.record(z.string(), jsonValueSchema).optional(),
});

export const systemInteractionLifecycleEventDataSchema = z.object({
  interaction: interactionLifecycleSchema,
});

export const systemPermissionGrantLifecycleEventDataSchema = z.object({
  interactionId: z.string(),
  providerId: z.string(),
  providerRequestId: z.string(),
  status: pendingInteractionStatusSchema,
  resolution: approvalPendingInteractionResolutionSchema
    .nullable()
    .default(null),
  statusReason: z.string().nullable().default(null),
  subject: pendingInteractionPermissionGrantApprovalSubjectSchema,
});

export const systemUserQuestionLifecycleEventDataSchema = z.object({
  interactionId: z.string(),
  providerId: z.string(),
  providerRequestId: z.string(),
  status: pendingInteractionStatusSchema,
  resolution: userQuestionPendingInteractionResolutionSchema
    .nullable()
    .default(null),
  statusReason: z.string().nullable().default(null),
  payload: userQuestionPendingInteractionPayloadSchema,
});

const systemThreadInterruptedReasonValues = [
  "manual-stop",
  "host-daemon-restarted",
  "provider-turn-idle",
] as const;
export const systemThreadInterruptedReasonSchema = z.enum(
  systemThreadInterruptedReasonValues,
);
export type SystemThreadInterruptedReason = z.infer<
  typeof systemThreadInterruptedReasonSchema
>;

export const systemThreadInterruptedEventDataSchema = z.object({
  reason: systemThreadInterruptedReasonSchema,
  cause: z.literal("host-connection-lost").optional(),
});

export const provisioningTranscriptEntrySchema = z.object({
  type: z.enum(["step", "output"]),
  key: z.string(),
  text: z.string(),
  startedAt: z.number().optional(),
  status: z.enum(["started", "completed", "failed"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ProvisioningTranscriptEntry = z.infer<
  typeof provisioningTranscriptEntrySchema
>;

const systemThreadProvisioningStatusValues = [
  "active",
  "completed",
  "failed",
  "cancelled",
] as const;
const systemThreadProvisioningStatusSchema = z.enum(
  systemThreadProvisioningStatusValues,
);
export type SystemThreadProvisioningStatus = z.infer<
  typeof systemThreadProvisioningStatusSchema
>;

export const systemThreadProvisioningEventDataSchema = z.object({
  provisioningId: z.string(),
  status: systemThreadProvisioningStatusSchema,
  environmentId: z.string(),
  entries: z.array(provisioningTranscriptEntrySchema),
});

const systemDispatchHoldStatusValues = [
  "active",
  "released",
  "cancelled",
  "orphaned",
] as const;
const systemDispatchHoldStatusSchema = z.enum(systemDispatchHoldStatusValues);
export type SystemDispatchHoldStatus = z.infer<
  typeof systemDispatchHoldStatusSchema
>;

/**
 * Longest held-message preview carried on a legacy `system/dispatch-hold`
 * event. It answered "which message is waiting?" in a couple of wrapped lines
 * back when the event still had a row of its own. Kept because stored events
 * are validated against this schema on decode.
 */
export const DISPATCH_HOLD_INPUT_PREVIEW_MAX_LENGTH = 240;

/**
 * A LEGACY timeline row, retained for decode only.
 *
 * Dispatch holds were replaced by parked queue rows and `system/queue-state`;
 * nothing emits this event any more, and nothing renders it either — its
 * timeline row and projection were deleted. The arm stays purely so a stored
 * event still decodes: narrowing `threadEventSchema` would churn the daemon
 * protocol and make existing rows undecodable. A decoded hold contributes no
 * row, which is what a reader saw before the row shape ever existed.
 *
 * `holder` is a plain string here rather than the old parsed union: no code
 * dispatches on it now, and re-deriving a closed union just to validate dead
 * rows would keep the whole holder vocabulary alive for nothing.
 */
export const systemDispatchHoldEventDataSchema = z.object({
  holdId: z.string().min(1),
  holder: z.string().min(1),
  status: systemDispatchHoldStatusSchema,
  reason: z.string(),
  /**
   * Truncated plain text of the held message, when the hold carries one of its
   * own. Optional because omission is real: a retry hold references a turn that
   * is already persisted and already rendered further up the timeline, so it
   * has no message to preview, and an inline hold whose visible input is empty
   * (attachments only) has nothing to say either. Absent and empty must not be
   * confused, hence `min(1)` — a reader that sees the field can trust it.
   *
   * Rows written before this field existed simply lack it and render as they
   * always did.
   */
  inputPreview: z
    .string()
    .min(1)
    .max(DISPATCH_HOLD_INPUT_PREVIEW_MAX_LENGTH)
    .optional(),
  entries: z.array(provisioningTranscriptEntrySchema),
});
export type SystemDispatchHoldEventData = z.infer<
  typeof systemDispatchHoldEventDataSchema
>;

const systemQueueStateStatusValues = [
  "parked",
  "updated",
  "dispatched",
  "cancelled",
] as const;
const systemQueueStateStatusSchema = z.enum(systemQueueStateStatusValues);
export type SystemQueueStateStatus = z.infer<
  typeof systemQueueStateStatusSchema
>;

/**
 * Longest queued-message preview carried on a `system/queue-state` row. The
 * row says why a dispatch is waiting; the preview is only there to answer
 * "which message?", so it is sized for a couple of wrapped lines. The full
 * message is always one send-now away, and until then an `inline` row is
 * editable on the queued card.
 */
export const QUEUE_STATE_INPUT_PREVIEW_MAX_LENGTH = 240;

/**
 * The one timeline row a parked queued message owns, rewritten in place as the
 * row progresses (`parked` → `updated`… → `dispatched` | `cancelled`). It sits
 * where the parked turn will land and renders exactly like
 * `system/thread-provisioning` — hence the shared transcript entry shape,
 * which is what a waiting plugin's progress reports append to.
 *
 * There is no separate `reason` field: an authored reason exists only for a
 * `plugin` wait and lives in `waitingOn.reason`, and every core wait's display
 * string is derived by the renderer from `waitingOn.kind` plus `sendAt`. One
 * home for the reason, so a rewritten row can never contradict itself.
 */
export const systemQueueStateEventDataSchema = z.object({
  queuedMessageId: z.string().min(1),
  status: systemQueueStateStatusSchema,
  /**
   * The wait as of this write. Retained verbatim on `dispatched`/`cancelled`
   * so a settled row still says what it had been waiting for.
   */
  waitingOn: queuedMessageWaitingOnSchema,
  /**
   * Snapshot of the row's scheduled instant, so the row renders "Scheduled ·
   * 9:00" without a second read. Null when the row is eligible as soon as its
   * other waits clear.
   */
  sendAt: z.number().int().nonnegative().nullable(),
  /**
   * Truncated plain text of the parked message, when the row carries one of
   * its own. Optional because omission is real: a `retry` row references a
   * turn that is already persisted and already rendered further up the
   * timeline, so it has no message to preview, and an `inline` row whose
   * visible input is empty (attachments only) has nothing to say either.
   * Absent and empty must not be confused, hence `min(1)` — a reader that sees
   * the field can trust it.
   */
  inputPreview: z
    .string()
    .min(1)
    .max(QUEUE_STATE_INPUT_PREVIEW_MAX_LENGTH)
    .optional(),
  entries: z.array(provisioningTranscriptEntrySchema),
});
export type SystemQueueStateEventData = z.infer<
  typeof systemQueueStateEventDataSchema
>;

/**
 * Longest note a plugin may append. Deliberately short: a note is a one-line
 * annotation on the timeline ("Rate limited — retrying at 6:30"), and anything
 * that needs a paragraph is either a hold's transcript (`dispatch.report`) or
 * content for the agent, which goes through an attributed agent-only message.
 */
export const PLUGIN_NOTE_TEXT_MAX_LENGTH = 500;

const pluginNoteLevelValues = ["info", "warning"] as const;
export const pluginNoteLevelSchema = z.enum(pluginNoteLevelValues);
export type PluginNoteLevel = z.infer<typeof pluginNoteLevelSchema>;

/**
 * A plugin's one-line annotation on a thread's timeline.
 *
 * Display-only by construction, not by policy: nothing that builds a provider
 * request reads thread events (a turn command carries prompt blocks and the
 * provider resumes its own session by id), and the fork allowlist in
 * `thread-fork-history.ts` names the conversation types explicitly, so a note
 * cannot reach a model. Plugin content meant FOR the agent goes through an
 * attributed agent-only message instead.
 */
export const systemPluginNoteEventDataSchema = z.object({
  pluginId: z.string().min(1),
  text: z.string().min(1).max(PLUGIN_NOTE_TEXT_MAX_LENGTH),
  /**
   * A lucide-style icon name the client renders when it recognizes it. A plain
   * string rather than the client's `IconName` union so a note persisted by a
   * newer plugin never becomes unparseable to an older client.
   */
  iconName: z.string().min(1).optional(),
  level: pluginNoteLevelSchema,
});
export type SystemPluginNoteEventData = z.infer<
  typeof systemPluginNoteEventDataSchema
>;

export const systemLegacyUserMessageEventDataSchema = z.object({
  text: z.string(),
  toolCallId: z.string().optional(),
  turnId: z.string().optional(),
});

export const systemProviderTurnWatchdogEventDataSchema = z.object({
  reason: z.literal("provider-turn-idle"),
  thresholdMs: z.number().int().positive(),
  elapsedMs: z.number().int().nonnegative(),
  activeTurnId: z.string().min(1),
  activeTurnStartedAt: z.number().int().nonnegative(),
  lastActivityEventSequence: z.number().int().positive(),
  lastActivityEventType: z.string().min(1),
  lastActivityEventAt: z.number().int().nonnegative(),
  providerId: z.string().min(1),
  providerThreadId: z.string().min(1).nullable(),
  firedAt: z.number().int().nonnegative(),
});
