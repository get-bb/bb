import { z } from "zod";
import {
  backgroundTaskStatusSchema,
  backgroundTaskUsageSchema,
  jsonValueSchema,
  pendingInteractionUserAnswerSchema,
  pendingInteractionUserQuestionQuestionSchema,
  promptTextMentionSchema,
  systemMessageKindSchema,
  systemMessageSubjectSchema,
  threadTurnInitiatorSchema,
  workflowProgressSnapshotSchema,
  type JsonObject,
} from "@bb/domain";

export const timelineRowStatusValues = [
  "pending",
  "completed",
  "error",
  "interrupted",
] as const;
export const timelineRowStatusSchema = z.enum(timelineRowStatusValues);
export type TimelineRowStatus = z.infer<typeof timelineRowStatusSchema>;

export const timelineApprovalStatusValues = [
  "waiting_for_approval",
  "denied",
] as const;
export const timelineApprovalStatusSchema = z
  .enum(timelineApprovalStatusValues)
  .nullable();
export type TimelineApprovalStatus = z.infer<
  typeof timelineApprovalStatusSchema
>;

export const timelineActivityIntentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("read"),
    command: z.string(),
    name: z.string(),
    path: z.string().nullable(),
  }),
  z.object({
    type: z.literal("list_files"),
    command: z.string(),
    path: z.string().nullable(),
  }),
  z.object({
    type: z.literal("search"),
    command: z.string(),
    query: z.string().nullable(),
    path: z.string().nullable(),
  }),
  z.object({
    type: z.literal("unknown"),
    command: z.string(),
  }),
]);
export type TimelineActivityIntent = z.infer<
  typeof timelineActivityIntentSchema
>;

export const timelineRowBaseSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  turnId: z.string().nullable(),
  sourceSeqStart: z.number().int(),
  sourceSeqEnd: z.number().int(),
  startedAt: z.number(),
  createdAt: z.number(),
});
export type TimelineRowBase = z.infer<typeof timelineRowBaseSchema>;

export const timelineConversationAttachmentsSchema = z.object({
  webImages: z.number().int().nonnegative(),
  localImages: z.number().int().nonnegative(),
  localFiles: z.number().int().nonnegative(),
  imageUrls: z.array(z.string()),
  localImagePaths: z.array(z.string()),
  localFilePaths: z.array(z.string()),
});
export type TimelineConversationAttachments = z.infer<
  typeof timelineConversationAttachmentsSchema
>;

export const timelineConversationTurnRequestKindValues = [
  "message",
  "steer",
] as const;
export const timelineConversationTurnRequestStatusValues = [
  "pending",
  "accepted",
] as const;
export const timelineConversationTurnRequestSchema = z.object({
  kind: z.enum(timelineConversationTurnRequestKindValues),
  status: z.enum(timelineConversationTurnRequestStatusValues),
});
export type TimelineConversationTurnRequest = z.infer<
  typeof timelineConversationTurnRequestSchema
>;

const timelineConversationRowBaseSchema = timelineRowBaseSchema.extend({
  kind: z.literal("conversation"),
  text: z.string(),
  attachments: timelineConversationAttachmentsSchema.nullable(),
});

export const timelineUserConversationRowSchema =
  timelineConversationRowBaseSchema.extend({
    role: z.literal("user"),
    initiator: threadTurnInitiatorSchema,
    senderThreadId: z.string().nullable(),
    // Family-B taxonomy fields, required on the read model. `systemMessageKind`
    // is non-nullable (legacy rows project to `unlabeled`); `systemMessageSubject`
    // is nullable (null = no thread subject, e.g. an `unlabeled` legacy row).
    systemMessageKind: systemMessageKindSchema,
    systemMessageSubject: systemMessageSubjectSchema.nullable(),
    turnRequest: timelineConversationTurnRequestSchema,
    mentions: z.array(promptTextMentionSchema),
  });
export type TimelineUserConversationRow = z.infer<
  typeof timelineUserConversationRowSchema
>;

export const timelineAssistantConversationRowSchema =
  timelineConversationRowBaseSchema.extend({
    role: z.literal("assistant"),
    turnRequest: z.null(),
  });

export const timelineConversationRowSchema = z.discriminatedUnion("role", [
  timelineUserConversationRowSchema,
  timelineAssistantConversationRowSchema,
]);
export type TimelineConversationRow = z.infer<
  typeof timelineConversationRowSchema
>;

export const timelineSystemOperationKindValues = [
  "generic",
  "compaction",
  "parent-change",
  "thread-provisioning",
  "thread-interrupted",
  "provider-unhandled",
  "warning",
  "deprecation",
] as const;
export const timelineSystemOperationKindSchema = z.enum(
  timelineSystemOperationKindValues,
);
export type TimelineSystemOperationKind = z.infer<
  typeof timelineSystemOperationKindSchema
>;
const timelineGenericSystemOperationKindSchema = z.enum([
  "generic",
  "compaction",
  "thread-provisioning",
  "thread-interrupted",
  "provider-unhandled",
  "warning",
  "deprecation",
] as const);

export const timelineParentChangeActionValues = [
  "assign",
  "release",
  "transfer",
] as const;
export const timelineParentChangeActionSchema = z.enum(
  timelineParentChangeActionValues,
);

export const timelineParentChangeSchema = z.object({
  action: timelineParentChangeActionSchema,
  previousParentThreadId: z.string().nullable(),
  previousParentThreadTitle: z.string().nullable(),
  nextParentThreadId: z.string().nullable(),
  nextParentThreadTitle: z.string().nullable(),
});
export type TimelineParentChange = z.infer<typeof timelineParentChangeSchema>;

const timelineSystemRowBaseSchema = timelineRowBaseSchema.extend({
  kind: z.literal("system"),
  title: z.string(),
  detail: z.string().nullable(),
  status: timelineRowStatusSchema.nullable(),
});

export const timelineNonOperationSystemRowSchema =
  timelineSystemRowBaseSchema.extend({
    systemKind: z.enum(["debug", "error", "reconnect"]),
  });
export type TimelineNonOperationSystemRow = z.infer<
  typeof timelineNonOperationSystemRowSchema
>;

export const timelineGenericOperationSystemRowSchema =
  timelineSystemRowBaseSchema.extend({
    systemKind: z.literal("operation"),
    operationKind: timelineGenericSystemOperationKindSchema,
    completedAt: z.number().nullable(),
  });

export const timelineParentChangeSystemRowSchema =
  timelineSystemRowBaseSchema.extend({
    systemKind: z.literal("operation"),
    operationKind: z.literal("parent-change"),
    status: timelineRowStatusSchema,
    parentChange: timelineParentChangeSchema,
    completedAt: z.number().nullable(),
  });
export type TimelineParentChangeSystemRow = z.infer<
  typeof timelineParentChangeSystemRowSchema
>;

export const timelineOperationSystemRowSchema = z.discriminatedUnion(
  "operationKind",
  [
    timelineGenericOperationSystemRowSchema,
    timelineParentChangeSystemRowSchema,
  ],
);

export const timelineSystemRowSchema = z.union([
  timelineNonOperationSystemRowSchema,
  timelineOperationSystemRowSchema,
]);
export type TimelineSystemRow = z.infer<typeof timelineSystemRowSchema>;

export const timelineDiffStatsSchema = z.object({
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
});
export type TimelineDiffStats = z.infer<typeof timelineDiffStatsSchema>;

export const timelineFileChangeSchema = z.object({
  path: z.string(),
  kind: z.string().nullable(),
  movePath: z.string().nullable(),
  diff: z.string().nullable(),
  diffStats: timelineDiffStatsSchema,
});
export type TimelineFileChange = z.infer<typeof timelineFileChangeSchema>;

const timelineWorkRowBaseSchema = timelineRowBaseSchema.extend({
  kind: z.literal("work"),
  status: timelineRowStatusSchema,
});

interface TimelineWorkRowBase extends TimelineRowBase {
  kind: "work";
  status: TimelineRowStatus;
}

export const timelineCommandWorkRowSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("command"),
  callId: z.string(),
  command: z.string(),
  cwd: z.string().nullable(),
  source: z.string().nullable(),
  output: z.string(),
  exitCode: z.number().nullable(),
  completedAt: z.number().nullable(),
  approvalStatus: timelineApprovalStatusSchema,
  activityIntents: z.array(timelineActivityIntentSchema),
});
export type TimelineCommandWorkRow = z.infer<
  typeof timelineCommandWorkRowSchema
>;

export const timelineToolWorkRowSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("tool"),
  callId: z.string(),
  toolName: z.string(),
  toolArgs: z.record(z.string(), jsonValueSchema).nullable(),
  output: z.string(),
  completedAt: z.number().nullable(),
  approvalStatus: timelineApprovalStatusSchema,
  activityIntents: z.array(timelineActivityIntentSchema),
});
export type TimelineToolWorkRow = z.infer<typeof timelineToolWorkRowSchema>;

export const timelineFileChangeWorkRowSchema = timelineWorkRowBaseSchema.extend(
  {
    workKind: z.literal("file-change"),
    callId: z.string(),
    change: timelineFileChangeSchema,
    stdout: z.string().nullable(),
    stderr: z.string().nullable(),
    approvalStatus: timelineApprovalStatusSchema,
  },
);
export type TimelineFileChangeWorkRow = z.infer<
  typeof timelineFileChangeWorkRowSchema
>;

export const timelineWebSearchWorkRowSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("web-search"),
  callId: z.string(),
  queries: z.array(z.string()),
  completedAt: z.number().nullable(),
});
export type TimelineWebSearchWorkRow = z.infer<
  typeof timelineWebSearchWorkRowSchema
>;

export const timelineWebFetchWorkRowSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("web-fetch"),
  callId: z.string(),
  url: z.string(),
  prompt: z.string().nullable(),
  pattern: z.string().nullable(),
  completedAt: z.number().nullable(),
});
export type TimelineWebFetchWorkRow = z.infer<
  typeof timelineWebFetchWorkRowSchema
>;

export const timelineImageViewWorkRowSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("image-view"),
  callId: z.string(),
  path: z.string(),
  completedAt: z.number().nullable(),
});
export type TimelineImageViewWorkRow = z.infer<
  typeof timelineImageViewWorkRowSchema
>;

export const timelineFileEditApprovalLifecycleValues = [
  "waiting",
  "denied",
] as const;
export const timelinePermissionGrantApprovalLifecycleValues = [
  "pending",
  "resolving",
  "granted",
  "denied",
  "interrupted",
] as const;
export const timelineQuestionLifecycleValues = [
  "pending",
  "resolving",
  "answered",
  "interrupted",
] as const;
export const timelinePermissionGrantApprovalGrantScopeValues = [
  "turn",
  "session",
] as const;
export const timelinePermissionGrantApprovalGrantScopeSchema = z.enum(
  timelinePermissionGrantApprovalGrantScopeValues,
);
export type TimelinePermissionGrantApprovalGrantScope = z.infer<
  typeof timelinePermissionGrantApprovalGrantScopeSchema
>;

const timelineApprovalTargetSchema = z.object({
  itemId: z.string(),
  toolName: z.string().nullable(),
});

const timelineApprovalWorkRowBaseSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("approval"),
  interactionId: z.string(),
  target: timelineApprovalTargetSchema,
});

export const timelineFileEditApprovalWorkRowSchema =
  timelineApprovalWorkRowBaseSchema.extend({
    approvalKind: z.literal("file-edit"),
    lifecycle: z.enum(timelineFileEditApprovalLifecycleValues),
  });

export const timelinePermissionGrantApprovalWorkRowSchema =
  timelineApprovalWorkRowBaseSchema.extend({
    approvalKind: z.literal("permission-grant"),
    lifecycle: z.enum(timelinePermissionGrantApprovalLifecycleValues),
    grantScope: timelinePermissionGrantApprovalGrantScopeSchema.nullable(),
    statusReason: z.string().nullable(),
  });

export const timelineApprovalWorkRowSchema = z.discriminatedUnion(
  "approvalKind",
  [
    timelineFileEditApprovalWorkRowSchema,
    timelinePermissionGrantApprovalWorkRowSchema,
  ],
);
export type TimelineApprovalWorkRow = z.infer<
  typeof timelineApprovalWorkRowSchema
>;

export const timelineQuestionWorkRowSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("question"),
  interactionId: z.string(),
  lifecycle: z.enum(timelineQuestionLifecycleValues),
  questions: z.array(pendingInteractionUserQuestionQuestionSchema),
  answers: z.record(z.string(), pendingInteractionUserAnswerSchema).nullable(),
  statusReason: z.string().nullable(),
});
export type TimelineQuestionWorkRow = z.infer<
  typeof timelineQuestionWorkRowSchema
>;

export interface TimelineDelegationWorkRow extends TimelineWorkRowBase {
  workKind: "delegation";
  callId: string;
  toolName: string;
  subagentType: string | null;
  description: string | null;
  output: string;
  completedAt: number | null;
  childRows: TimelineRow[];
}

export const timelineDelegationWorkRowSchema: z.ZodType<TimelineDelegationWorkRow> =
  timelineWorkRowBaseSchema.extend({
    workKind: z.literal("delegation"),
    callId: z.string(),
    toolName: z.string(),
    subagentType: z.string().nullable(),
    description: z.string().nullable(),
    output: z.string(),
    completedAt: z.number().nullable(),
    childRows: z.array(z.lazy(() => timelineRowSchema)),
  });

/**
 * A provider background task — a dynamic workflow (Claude Code Workflow tool)
 * or a backgrounded shell command (Bash run_in_background), discriminated by
 * `taskType`. The row outlives its spawning turn: progress and terminal state
 * arrive via thread-scoped events folded into this single row. `workflow` is
 * the merged phase/agent tree, present only for workflows; null for shell
 * commands and for workflows the provider reported no progress records for
 * (degraded rendering falls back to description + summary).
 */
export const timelineWorkflowWorkRowSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("workflow"),
  itemId: z.string(),
  taskType: z.string(),
  workflowName: z.string().nullable(),
  description: z.string(),
  taskStatus: backgroundTaskStatusSchema,
  workflow: workflowProgressSnapshotSchema.nullable(),
  usage: backgroundTaskUsageSchema.nullable(),
  summary: z.string().nullable(),
  error: z.string().nullable(),
  completedAt: z.number().nullable(),
});
export type TimelineWorkflowWorkRow = z.infer<
  typeof timelineWorkflowWorkRowSchema
>;

export type TimelineWorkRow =
  | TimelineCommandWorkRow
  | TimelineToolWorkRow
  | TimelineFileChangeWorkRow
  | TimelineWebSearchWorkRow
  | TimelineWebFetchWorkRow
  | TimelineImageViewWorkRow
  | TimelineApprovalWorkRow
  | TimelineQuestionWorkRow
  | TimelineDelegationWorkRow
  | TimelineWorkflowWorkRow;

export const timelineWorkRowSchema: z.ZodType<TimelineWorkRow> = z.union([
  timelineCommandWorkRowSchema,
  timelineToolWorkRowSchema,
  timelineFileChangeWorkRowSchema,
  timelineWebSearchWorkRowSchema,
  timelineWebFetchWorkRowSchema,
  timelineImageViewWorkRowSchema,
  timelineApprovalWorkRowSchema,
  timelineQuestionWorkRowSchema,
  timelineDelegationWorkRowSchema,
  timelineWorkflowWorkRowSchema,
]);

export interface TimelineTurnRow extends TimelineRowBase {
  kind: "turn";
  turnId: string;
  status: TimelineRowStatus;
  summaryCount: number;
  completedAt: number | null;
  children: TimelineRow[] | null;
}

export const timelineTurnRowSchema: z.ZodType<TimelineTurnRow> = z.lazy(() =>
  timelineRowBaseSchema.extend({
    kind: z.literal("turn"),
    turnId: z.string().min(1),
    status: timelineRowStatusSchema,
    summaryCount: z.number().int().nonnegative(),
    completedAt: z.number().nullable(),
    children: z.array(timelineRowSchema).nullable(),
  }),
);

export type TimelineSourceRow =
  | TimelineConversationRow
  | TimelineWorkRow
  | TimelineSystemRow;

export type TimelineRow = TimelineSourceRow | TimelineTurnRow;

export const timelineRowSchema: z.ZodType<TimelineRow> = z.lazy(() =>
  z.union([
    timelineConversationRowSchema,
    timelineWorkRowSchema,
    timelineSystemRowSchema,
    timelineTurnRowSchema,
  ]),
);

export type TimelineToolArgs = JsonObject | null;

/**
 * Incremental update to a previously-fetched timeline window. The server
 * computes it by reprojecting the full window (correct by construction — all
 * turn-collapse / window-eviction / finalize / background-task-fold semantics
 * are preserved) and diffing it against the rows the client last received.
 *
 * `upsertRows` carries the full body of every row that was added or changed.
 * `rowOrder` is the complete, ordered id list of the current window, so the
 * client reconstructs the exact row order and membership without guessing —
 * any id present in `rowOrder` but absent from `upsertRows` is an unchanged row
 * the client already holds. See {@link applyTimelineDelta}.
 */
export const timelineDeltaSchema = z.object({
  upsertRows: z.array(timelineRowSchema),
  rowOrder: z.array(z.string()),
});
export type TimelineDelta = z.infer<typeof timelineDeltaSchema>;

/**
 * Diff a freshly-projected window against the rows the client last held. Pure;
 * used by the server to build a {@link TimelineDelta}.
 */
export function computeTimelineRowDelta(
  prevRows: readonly TimelineRow[],
  currentRows: readonly TimelineRow[],
): TimelineDelta {
  const prevById = new Map<string, string>();
  for (const row of prevRows) {
    prevById.set(row.id, JSON.stringify(row));
  }
  const upsertRows: TimelineRow[] = [];
  const rowOrder: string[] = [];
  for (const row of currentRows) {
    rowOrder.push(row.id);
    if (prevById.get(row.id) !== JSON.stringify(row)) {
      upsertRows.push(row);
    }
  }
  return { upsertRows, rowOrder };
}

/**
 * Apply a {@link TimelineDelta} to the rows the client currently holds,
 * yielding the new full window. Returns `null` when the delta references a row
 * the client neither holds nor was sent (a stale/mismatched base) — the caller
 * should fall back to a full fetch.
 */
export function applyTimelineDelta(
  prevRows: readonly TimelineRow[],
  delta: TimelineDelta,
): TimelineRow[] | null {
  const byId = new Map<string, TimelineRow>();
  for (const row of prevRows) {
    byId.set(row.id, row);
  }
  for (const row of delta.upsertRows) {
    byId.set(row.id, row);
  }
  const result: TimelineRow[] = [];
  for (const id of delta.rowOrder) {
    const row = byId.get(id);
    if (row === undefined) {
      return null;
    }
    result.push(row);
  }
  return result;
}
