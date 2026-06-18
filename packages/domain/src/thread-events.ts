import { z } from "zod";
import {
  approvalPendingInteractionResolutionSchema,
  pendingInteractionPermissionGrantApprovalSubjectSchema,
  pendingInteractionStatusSchema,
  userQuestionPendingInteractionPayloadSchema,
  userQuestionPendingInteractionResolutionSchema,
} from "./pending-interactions.js";
import {
  promptInputSchema,
  resolvedThreadExecutionOptionsSchema,
} from "./shared-types.js";
import { jsonValueSchema } from "./json-value.js";
import { clientTurnRequestIdSchema } from "./protocol-ids.js";

export const systemEventTypeValues = [
  "client/thread/start",
  "client/turn/requested",
  "client/turn/start",
  "system/error",
  // Legacy persisted user-visible system event from a removed runtime path.
  // Retained for read/decode/render compatibility only.
  "system/manager/user_message",
  "system/thread/interrupted",
  "system/operation",
  "system/permissionGrant/lifecycle",
  "system/userQuestion/lifecycle",
  "system/thread-provisioning",
  // Legacy persisted watchdog diagnostic; retained for read/decode/render
  // only, with no current producer.
  "system/provider-turn-watchdog",
] as const;
export const systemEventTypeSchema = z.enum(systemEventTypeValues);
export type SystemEventType = z.infer<typeof systemEventTypeSchema>;

export const threadTurnInitiatorValues = ["user", "agent", "system"] as const;
export const threadTurnInitiatorSchema = z.enum(threadTurnInitiatorValues);
export type ThreadTurnInitiator = z.infer<typeof threadTurnInitiatorSchema>;

// One value per Family-B system-message action, plus an explicit `unlabeled`
// for legacy/pre-taxonomy messages (rendered generically). `unlabeled` beats a
// nullable field: its meaning is self-documenting and avoids `null`-as-default.
export const systemMessageKindValues = [
  "ownership-assigned",
  "ownership-removed",
  "child-needs-attention",
  "child-completed",
  "child-failed",
  "child-interrupted",
  "child-outcome-batch",
  "unlabeled",
] as const;
export const systemMessageKindSchema = z.enum(systemMessageKindValues);
export type SystemMessageKind = z.infer<typeof systemMessageKindSchema>;

// The subject a system message concerns: a single thread or a batch of threads
// (count only). Stamped at emit time because `senderThreadId` is null for
// `initiator: "system"` messages, so the subject is otherwise unrecoverable
// downstream. This schema is just the union of subject shapes; the
// required-but-nullable read-model contract is documented on the row field in
// `@bb/server-contract`'s `thread-timeline.ts`.
export const systemMessageSubjectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("thread"),
    threadId: z.string(),
    threadName: z.string(),
  }),
  z.object({
    kind: z.literal("thread-batch"),
    count: z.number(),
  }),
]);
export type SystemMessageSubject = z.infer<typeof systemMessageSubjectSchema>;

export const threadProvisioningReasonValues = [
  "thread-created",
  "boot-created-thread",
  "tell-after-provisioning-failure",
  "tell-after-missing-environment-attachment",
  "resume-missing-provider-thread",
] as const;
export const threadProvisioningReasonSchema = z.enum(
  threadProvisioningReasonValues,
);

export const threadEnvironmentStartReasonValues = [
  ...threadProvisioningReasonValues,
  "boot-active-resume",
  "resume-existing-provider-session",
] as const;
export const threadEnvironmentStartReasonSchema = z.enum(
  threadEnvironmentStartReasonValues,
);
export type ThreadEnvironmentStartReason = z.infer<
  typeof threadEnvironmentStartReasonSchema
>;

export const turnRequestOptionsSchema = resolvedThreadExecutionOptionsSchema;

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
  source: z.enum(["spawn", "tell"]),
  initiator: threadTurnInitiatorSchema,
  // Non-null only when initiator === "agent". The invariant is enforced by
  // writer typings rather than a schema refine so legacy persisted events
  // (initiator: "agent", senderThreadId: null from before the field
  // existed) still parse — the stored variant defaults both fields.
  senderThreadId: z.string().nullable(),
  // Family-B system-message taxonomy fields. Optional at the persisted-event
  // level: legacy events (pre-taxonomy) lack them and must still parse. The
  // projection defaults absent values to `unlabeled` / `null`.
  systemMessageKind: systemMessageKindSchema.optional(),
  systemMessageSubject: systemMessageSubjectSchema.nullable().optional(),
  input: z.array(promptInputSchema),
  target: turnRequestTargetSchema,
  request: z.object({
    method: z.enum(["thread/start", "turn/start"]),
    params: z.record(z.string(), z.unknown()),
  }),
  execution: turnRequestOptionsSchema,
});
export type TurnRequestEventData = z.infer<typeof turnRequestEventDataSchema>;

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

export const ownershipChangeOperationActionValues = [
  "assign",
  "release",
  "transfer",
] as const;
export const ownershipChangeOperationActionSchema = z.enum(
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
export type SystemOperationEventData = z.infer<
  typeof systemOperationEventDataSchema
>;

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
export type SystemPermissionGrantLifecycleEventData = z.infer<
  typeof systemPermissionGrantLifecycleEventDataSchema
>;

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
export type SystemUserQuestionLifecycleEventData = z.infer<
  typeof systemUserQuestionLifecycleEventDataSchema
>;

export const systemThreadInterruptedReasonValues = [
  "manual-stop",
  "host-daemon-restarted",
  // Legacy persisted watchdog interruption; retained for read/replay only,
  // with no current producer.
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
});
export type SystemThreadInterruptedEventData = z.infer<
  typeof systemThreadInterruptedEventDataSchema
>;

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

export const systemThreadProvisioningStatusValues = [
  "active",
  "completed",
  "failed",
  "cancelled",
] as const;
export const systemThreadProvisioningStatusSchema = z.enum(
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
export type SystemThreadProvisioningEventData = z.infer<
  typeof systemThreadProvisioningEventDataSchema
>;

export const systemLegacyUserMessageEventDataSchema = z.object({
  text: z.string(),
  toolCallId: z.string().optional(),
  turnId: z.string().optional(),
});
export type SystemLegacyUserMessageEventData = z.infer<
  typeof systemLegacyUserMessageEventDataSchema
>;

export const turnLifecycleEventDataSchema = z.object({
  turnId: z.string().optional(),
  input: z.array(promptInputSchema).optional(),
});

export const systemProviderTurnWatchdogEventDataSchema = z.object({
  reason: z.literal("provider-turn-idle"),
  thresholdMs: z.number().int().positive(),
  elapsedMs: z.number().int().nonnegative(),
  activeTurnId: z.string().min(1),
  activeTurnStartedAt: z.number().int().nonnegative(),
  lastActivityEventSequence: z.number().int().positive(),
  /**
   * Diagnostic label only (the UI interpolates it verbatim). A plain string —
   * not the activity enum — so editing event classifications never makes
   * previously persisted watchdog events unparseable.
   */
  lastActivityEventType: z.string().min(1),
  lastActivityEventAt: z.number().int().nonnegative(),
  providerId: z.string().min(1),
  providerThreadId: z.string().min(1).nullable(),
  firedAt: z.number().int().nonnegative(),
});
export type SystemProviderTurnWatchdogEventData = z.infer<
  typeof systemProviderTurnWatchdogEventDataSchema
>;

export type ThreadEventDataByType = {
  "client/thread/start": ClientTurnLifecycleEventData;
  "client/turn/requested": TurnRequestEventData;
  "client/turn/start": ClientTurnLifecycleEventData;
  "system/error": SystemErrorEventData;
  "system/manager/user_message": SystemLegacyUserMessageEventData;
  "system/thread/interrupted": SystemThreadInterruptedEventData;
  "system/operation": SystemOperationEventData;
  "system/permissionGrant/lifecycle": SystemPermissionGrantLifecycleEventData;
  "system/userQuestion/lifecycle": SystemUserQuestionLifecycleEventData;
  "system/thread-provisioning": SystemThreadProvisioningEventData;
  "system/provider-turn-watchdog": SystemProviderTurnWatchdogEventData;
};
