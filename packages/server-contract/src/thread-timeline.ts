import { z } from "zod";
import {
  backgroundTaskStatusSchema,
  backgroundTaskUsageSchema,
  extensionKindSchema,
  jsonValueSchema,
  pendingInteractionUserAnswerSchema,
  pendingInteractionUserQuestionQuestionSchema,
  promptTextMentionSchema,
  systemMessageKindSchema,
  systemMessageSubjectSchema,
  threadEventItemPresentationSchema,
  threadEventPlanStepSchema,
  threadEventSearchModeSchema,
  threadTurnInitiatorSchema,
  workflowProgressSnapshotSchema,
  type JsonObject,
  type ThreadEventItemPresentation,
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
  "rejected",
] as const;
export const timelineConversationTurnRequestSchema = z.object({
  isGrouped: z.boolean(),
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
  "context-clear",
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
  "context-clear",
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

/**
 * The declarative presentation the provider bridge attached to the item a
 * work row projects from (`ThreadEventItemPresentation`, persisted with the
 * item). Clients render the row's label, icon, headline and detail from it;
 * core kinds keep their core renderer and use it for customization only.
 *
 * Absent on rows projected from events persisted before presentation existed
 * (grammar v2) and on rows bb authors itself (approvals, questions); those
 * render through the legacy per-kind derivation.
 */
export const timelineRowPresentationSchema = threadEventItemPresentationSchema;
export type TimelineRowPresentation = ThreadEventItemPresentation;

const timelineRowPresentationField = {
  presentation: timelineRowPresentationSchema.optional(),
};

/**
 * Marks a command/tool row whose `output` the server replaced with a head+tail
 * preview. The latest window caps the inline outputs of its running turn so a
 * long tool session does not ship hundreds of kilobytes on every poll; the
 * preview keeps the first and last lines readable. `totalChars` is the length
 * of the output the preview stands in for. Clients read the whole output on
 * demand from `timelineTurnSummaryDetails` scoped to the row's `turnId` and
 * `sourceSeqStart..sourceSeqEnd`. Absent when `output` is complete.
 */
export const timelineOutputPreviewSchema = z.object({
  totalChars: z.number().int().nonnegative(),
});

export const timelineCommandWorkRowSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("command"),
  callId: z.string(),
  command: z.string(),
  cwd: z.string().nullable(),
  source: z.string().nullable(),
  output: z.string(),
  outputPreview: timelineOutputPreviewSchema.optional(),
  exitCode: z.number().nullable(),
  completedAt: z.number().nullable(),
  approvalStatus: timelineApprovalStatusSchema,
  activityIntents: z.array(timelineActivityIntentSchema),
  ...timelineRowPresentationField,
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
  outputPreview: timelineOutputPreviewSchema.optional(),
  completedAt: z.number().nullable(),
  approvalStatus: timelineApprovalStatusSchema,
  ...timelineRowPresentationField,
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
    ...timelineRowPresentationField,
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
  ...timelineRowPresentationField,
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
  ...timelineRowPresentationField,
});
export type TimelineWebFetchWorkRow = z.infer<
  typeof timelineWebFetchWorkRowSchema
>;

export const timelineImageViewWorkRowSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("image-view"),
  callId: z.string(),
  path: z.string(),
  completedAt: z.number().nullable(),
  ...timelineRowPresentationField,
});
export type TimelineImageViewWorkRow = z.infer<
  typeof timelineImageViewWorkRowSchema
>;

/**
 * A file the agent read (grammar v3 `fileRead`). `cmd` is the native shell
 * form when the provider read through a command rather than a structured
 * tool; null for a structured read.
 */
export const timelineFileReadWorkRowSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("file-read"),
  callId: z.string(),
  path: z.string(),
  cmd: z.string().nullable(),
  completedAt: z.number().nullable(),
  ...timelineRowPresentationField,
});
export type TimelineFileReadWorkRow = z.infer<
  typeof timelineFileReadWorkRowSchema
>;

/**
 * An exploration search (grammar v3 `search`): `content` searches inside
 * files, `path` matches file names, `list` enumerates a directory. `query`
 * is the pattern (empty for a whole-directory listing); `path` is the root
 * the search ran under when the provider named one.
 */
export const timelineSearchWorkRowSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("search"),
  callId: z.string(),
  mode: threadEventSearchModeSchema,
  query: z.string(),
  path: z.string().nullable(),
  cmd: z.string().nullable(),
  completedAt: z.number().nullable(),
  ...timelineRowPresentationField,
});
export type TimelineSearchWorkRow = z.infer<typeof timelineSearchWorkRowSchema>;

/**
 * A structured plan snapshot the agent maintains (grammar v3 `planSteps`:
 * codex `update_plan`, the Claude TodoWrite/Task family). Each row carries
 * the full step list of one snapshot; the todo banner reads the latest.
 */
export const timelinePlanStepsWorkRowSchema = timelineWorkRowBaseSchema.extend(
  {
    workKind: z.literal("plan-steps"),
    callId: z.string(),
    steps: z.array(threadEventPlanStepSchema),
    explanation: z.string().nullable(),
    completedAt: z.number().nullable(),
    ...timelineRowPresentationField,
  },
);
export type TimelinePlanStepsWorkRow = z.infer<
  typeof timelinePlanStepsWorkRowSchema
>;

/**
 * A plugin-defined item kind outside the core vocabulary
 * (`extensionKind` is `"<pluginId>/<name>"`). The payload is the plugin's
 * declared shape, validated at ingest and opaque here. `presentation` is
 * required: the declarative base is the only thing every client can render,
 * and a plugin web renderer registered for the kind is an upgrade on top.
 */
export const timelineExtensionWorkRowSchema = timelineWorkRowBaseSchema.extend(
  {
    workKind: z.literal("extension"),
    callId: z.string(),
    extensionKind: extensionKindSchema,
    payload: jsonValueSchema,
    completedAt: z.number().nullable(),
    presentation: timelineRowPresentationSchema,
  },
);
export type TimelineExtensionWorkRow = z.infer<
  typeof timelineExtensionWorkRowSchema
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

/**
 * Work the agent delegated to a child agent. `childRef` is the provider-
 * native id of the child (grammar v3 `delegation`); null for rows projected
 * from a legacy delegation tool call, whose child is linked by turn parentage
 * alone. `background` marks a delegation that outlives its spawning turn.
 */
export interface TimelineDelegationWorkRow extends TimelineWorkRowBase {
  workKind: "delegation";
  callId: string;
  toolName: string;
  childRef: string | null;
  background: boolean;
  subagentType: string | null;
  description: string | null;
  output: string;
  completedAt: number | null;
  childRows: TimelineRow[];
  presentation?: TimelineRowPresentation;
}

export const timelineDelegationWorkRowSchema: z.ZodType<TimelineDelegationWorkRow> =
  timelineWorkRowBaseSchema.extend({
    workKind: z.literal("delegation"),
    callId: z.string(),
    toolName: z.string(),
    childRef: z.string().nullable(),
    background: z.boolean(),
    subagentType: z.string().nullable(),
    description: z.string().nullable(),
    output: z.string(),
    completedAt: z.number().nullable(),
    childRows: z.array(z.lazy(() => timelineRowSchema)),
    ...timelineRowPresentationField,
  });

/**
 * A provider background task — a dynamic workflow (Claude Code Workflow tool)
 * or a backgrounded shell command (Bash run_in_background), discriminated by
 * `taskType`. The row outlives its spawning turn: progress and terminal state
 * arrive via thread-scoped events folded into this single row. `workflow` is
 * the merged phase/agent tree, present only for workflows; null for shell
 * commands and for workflows the provider reported no progress records for
 * (degraded rendering falls back to description + summary). `model` is the
 * spawning delegation's requested model for background agents; null for
 * commands, workflows, legacy events, and providers that do not expose it.
 */
export const timelineWorkflowWorkRowSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("workflow"),
  itemId: z.string(),
  taskType: z.string(),
  workflowName: z.string().nullable(),
  description: z.string(),
  model: z.string().nullable(),
  taskStatus: backgroundTaskStatusSchema,
  workflow: workflowProgressSnapshotSchema.nullable(),
  usage: backgroundTaskUsageSchema.nullable(),
  summary: z.string().nullable(),
  error: z.string().nullable(),
  completedAt: z.number().nullable(),
  ...timelineRowPresentationField,
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
  | TimelineFileReadWorkRow
  | TimelineSearchWorkRow
  | TimelinePlanStepsWorkRow
  | TimelineExtensionWorkRow
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
  timelineFileReadWorkRowSchema,
  timelineSearchWorkRowSchema,
  timelinePlanStepsWorkRowSchema,
  timelineExtensionWorkRowSchema,
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
 * `rowOrder`, when present, is the complete, ordered id list of the current
 * window, so the client reconstructs exact ordering and membership. It is
 * omitted when both are unchanged, which avoids repeatedly sending every row
 * id while an active row is merely streaming new content.
 */
export const timelineDeltaSchema = z.object({
  upsertRows: z.array(timelineRowSchema),
  rowOrder: z.array(z.string()).optional(),
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
  let orderChanged = prevRows.length !== currentRows.length;
  for (const row of currentRows) {
    rowOrder.push(row.id);
    if (prevRows[rowOrder.length - 1]?.id !== row.id) {
      orderChanged = true;
    }
    if (prevById.get(row.id) !== JSON.stringify(row)) {
      upsertRows.push(row);
    }
  }
  return orderChanged ? { upsertRows, rowOrder } : { upsertRows };
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
  const rowOrder = delta.rowOrder ?? prevRows.map((row) => row.id);
  for (const id of rowOrder) {
    const row = byId.get(id);
    if (row === undefined) {
      return null;
    }
    result.push(row);
  }
  return result;
}
