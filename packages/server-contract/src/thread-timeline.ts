import { z } from "zod";
import {
  backgroundTaskStatusSchema,
  backgroundTaskUsageSchema,
  jsonValueSchema,
  pendingInteractionUserAnswerSchema,
  pendingInteractionUserQuestionQuestionSchema,
  promptTextMentionSchema,
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

const timelineWorkOutputDetailSchema = z
  .object({
    fullLength: z.number().int().nonnegative(),
    previewLength: z.number().int().nonnegative(),
  })
  .strict();
export type TimelineWorkOutputDetail = z.infer<
  typeof timelineWorkOutputDetailSchema
>;

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
  outputDetail: timelineWorkOutputDetailSchema.optional(),
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
  outputDetail: timelineWorkOutputDetailSchema.optional(),
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
  outputDetail?: TimelineWorkOutputDetail;
  completedAt: number | null;
  /**
   * True when `childRows` is intentionally incomplete and must be loaded from
   * the row detail endpoint. Omitted means the row carries all available
   * children.
   */
  childRowsOmitted?: true;
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
    outputDetail: timelineWorkOutputDetailSchema.optional(),
    completedAt: z.number().nullable(),
    childRowsOmitted: z.literal(true).optional(),
    childRows: z.array(z.lazy(() => timelineRowSchema)),
  });

/**
 * A dynamic workflow run (Claude Code Workflow tool). The row outlives its
 * spawning turn: progress and terminal state arrive via thread-scoped events
 * folded into this single row. `workflow` is the merged phase/agent tree;
 * null when the provider reported no progress records (degraded rendering
 * falls back to description + usage).
 */
export const timelineWorkflowWorkRowSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("workflow"),
  itemId: z.string(),
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

export const timelineFeedDetailPartValues = [
  "text",
  "output",
  "system-detail",
  "file-diff",
  "stdout",
  "stderr",
  "children",
  "workflow",
] as const;
export const timelineFeedDetailPartSchema = z.enum(
  timelineFeedDetailPartValues,
);
export type TimelineFeedDetailPart = z.infer<
  typeof timelineFeedDetailPartSchema
>;

export const timelineTextPreviewSchema = z
  .object({
    text: z.string(),
    fullLength: z.number().int().nonnegative(),
    complete: z.boolean(),
  })
  .strict();
export type TimelineTextPreview = z.infer<typeof timelineTextPreviewSchema>;

const timelineFeedSourceRangeSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .strict();
export type TimelineFeedSourceRange = z.infer<
  typeof timelineFeedSourceRangeSchema
>;

const timelineFeedDetailRefSchema = z
  .object({
    rowKey: z.string().min(1),
    source: timelineFeedSourceRangeSchema,
    parts: z.array(timelineFeedDetailPartSchema),
  })
  .strict();
export type TimelineFeedDetailRef = z.infer<typeof timelineFeedDetailRefSchema>;

const timelineFeedRowBaseSchema = z
  .object({
    key: z.string().min(1),
    kind: z.enum([
      "bundle-summary",
      "conversation",
      "step-summary",
      "system",
      "turn",
      "work",
    ]),
    turnId: z.string().nullable(),
    source: timelineFeedSourceRangeSchema,
    startedAt: z.number(),
    createdAt: z.number(),
    detail: timelineFeedDetailRefSchema.nullable(),
  })
  .strict();

const timelineFeedConversationAttachmentsSchema =
  timelineConversationAttachmentsSchema;

const timelineFeedConversationRowBaseSchema = timelineFeedRowBaseSchema.extend({
  kind: z.literal("conversation"),
  textPreview: timelineTextPreviewSchema,
  attachments: timelineFeedConversationAttachmentsSchema.nullable(),
});

export const timelineFeedUserConversationRowSchema =
  timelineFeedConversationRowBaseSchema.extend({
    role: z.literal("user"),
    initiator: threadTurnInitiatorSchema,
    senderThreadId: z.string().nullable(),
    turnRequest: timelineConversationTurnRequestSchema,
    mentions: z.array(promptTextMentionSchema),
  });

export const timelineFeedAssistantConversationRowSchema =
  timelineFeedConversationRowBaseSchema.extend({
    role: z.literal("assistant"),
    turnRequest: z.null(),
  });

export const timelineFeedConversationRowSchema = z.discriminatedUnion("role", [
  timelineFeedUserConversationRowSchema,
  timelineFeedAssistantConversationRowSchema,
]);
export type TimelineFeedConversationRow = z.infer<
  typeof timelineFeedConversationRowSchema
>;

const timelineFeedSystemRowBaseSchema = timelineFeedRowBaseSchema.extend({
  kind: z.literal("system"),
  title: z.string(),
  detailPreview: timelineTextPreviewSchema.nullable(),
  status: timelineRowStatusSchema.nullable(),
});

export const timelineFeedNonOperationSystemRowSchema =
  timelineFeedSystemRowBaseSchema.extend({
    systemKind: z.enum(["debug", "error", "reconnect"]),
  });

export const timelineFeedGenericOperationSystemRowSchema =
  timelineFeedSystemRowBaseSchema.extend({
    systemKind: z.literal("operation"),
    operationKind: timelineGenericSystemOperationKindSchema,
    completedAt: z.number().nullable(),
  });

export const timelineFeedParentChangeSystemRowSchema =
  timelineFeedSystemRowBaseSchema.extend({
    systemKind: z.literal("operation"),
    operationKind: z.literal("parent-change"),
    status: timelineRowStatusSchema,
    parentChange: timelineParentChangeSchema,
    completedAt: z.number().nullable(),
  });

export const timelineFeedOperationSystemRowSchema = z.discriminatedUnion(
  "operationKind",
  [
    timelineFeedGenericOperationSystemRowSchema,
    timelineFeedParentChangeSystemRowSchema,
  ],
);

export const timelineFeedSystemRowSchema = z.union([
  timelineFeedNonOperationSystemRowSchema,
  timelineFeedOperationSystemRowSchema,
]);
export type TimelineFeedSystemRow = z.infer<typeof timelineFeedSystemRowSchema>;

export const timelineFeedFileChangeSchema = z
  .object({
    path: z.string(),
    kind: z.string().nullable(),
    movePath: z.string().nullable(),
    diffPreview: timelineTextPreviewSchema.nullable(),
    diffStats: timelineDiffStatsSchema,
  })
  .strict();
export type TimelineFeedFileChange = z.infer<
  typeof timelineFeedFileChangeSchema
>;

const timelineFeedWorkRowBaseSchema = timelineFeedRowBaseSchema.extend({
  kind: z.literal("work"),
  status: timelineRowStatusSchema,
});

export const timelineFeedCommandWorkRowSchema =
  timelineFeedWorkRowBaseSchema.extend({
    workKind: z.literal("command"),
    callId: z.string(),
    command: z.string(),
    cwd: z.string().nullable(),
    sourceLabel: z.string().nullable(),
    outputPreview: timelineTextPreviewSchema,
    exitCode: z.number().nullable(),
    completedAt: z.number().nullable(),
    approvalStatus: timelineApprovalStatusSchema,
    activityIntents: z.array(timelineActivityIntentSchema),
  });
export type TimelineFeedCommandWorkRow = z.infer<
  typeof timelineFeedCommandWorkRowSchema
>;

export const timelineFeedToolWorkRowSchema =
  timelineFeedWorkRowBaseSchema.extend({
    workKind: z.literal("tool"),
    callId: z.string(),
    toolName: z.string(),
    toolArgs: z.record(z.string(), jsonValueSchema).nullable(),
    outputPreview: timelineTextPreviewSchema,
    completedAt: z.number().nullable(),
    approvalStatus: timelineApprovalStatusSchema,
    activityIntents: z.array(timelineActivityIntentSchema),
  });
export type TimelineFeedToolWorkRow = z.infer<
  typeof timelineFeedToolWorkRowSchema
>;

export const timelineFeedFileChangeWorkRowSchema =
  timelineFeedWorkRowBaseSchema.extend({
    workKind: z.literal("file-change"),
    callId: z.string(),
    change: timelineFeedFileChangeSchema,
    stdoutPreview: timelineTextPreviewSchema.nullable(),
    stderrPreview: timelineTextPreviewSchema.nullable(),
    approvalStatus: timelineApprovalStatusSchema,
  });
export type TimelineFeedFileChangeWorkRow = z.infer<
  typeof timelineFeedFileChangeWorkRowSchema
>;

export const timelineFeedWebSearchWorkRowSchema =
  timelineFeedWorkRowBaseSchema.extend({
    workKind: z.literal("web-search"),
    callId: z.string(),
    queries: z.array(z.string()),
    completedAt: z.number().nullable(),
  });

export const timelineFeedWebFetchWorkRowSchema =
  timelineFeedWorkRowBaseSchema.extend({
    workKind: z.literal("web-fetch"),
    callId: z.string(),
    url: z.string(),
    prompt: z.string().nullable(),
    pattern: z.string().nullable(),
    completedAt: z.number().nullable(),
  });

export const timelineFeedImageViewWorkRowSchema =
  timelineFeedWorkRowBaseSchema.extend({
    workKind: z.literal("image-view"),
    callId: z.string(),
    path: z.string(),
    completedAt: z.number().nullable(),
  });

export const timelineFeedApprovalWorkRowSchema = z.discriminatedUnion(
  "approvalKind",
  [
    timelineFeedWorkRowBaseSchema.extend({
      workKind: z.literal("approval"),
      interactionId: z.string(),
      target: timelineApprovalTargetSchema,
      approvalKind: z.literal("file-edit"),
      lifecycle: z.enum(timelineFileEditApprovalLifecycleValues),
    }),
    timelineFeedWorkRowBaseSchema.extend({
      workKind: z.literal("approval"),
      interactionId: z.string(),
      target: timelineApprovalTargetSchema,
      approvalKind: z.literal("permission-grant"),
      lifecycle: z.enum(timelinePermissionGrantApprovalLifecycleValues),
      grantScope: timelinePermissionGrantApprovalGrantScopeSchema.nullable(),
      statusReason: z.string().nullable(),
    }),
  ],
);

export const timelineFeedQuestionWorkRowSchema =
  timelineFeedWorkRowBaseSchema.extend({
    workKind: z.literal("question"),
    interactionId: z.string(),
    lifecycle: z.enum(timelineQuestionLifecycleValues),
    questions: z.array(pendingInteractionUserQuestionQuestionSchema),
    answers: z
      .record(z.string(), pendingInteractionUserAnswerSchema)
      .nullable(),
    statusReason: z.string().nullable(),
  });

export interface TimelineFeedDelegationWorkRow extends z.infer<
  typeof timelineFeedWorkRowBaseSchema
> {
  workKind: "delegation";
  callId: string;
  toolName: string;
  subagentType: string | null;
  description: string | null;
  outputPreview: TimelineTextPreview;
  completedAt: number | null;
  childCount: number;
  childRows: TimelineFeedRow[];
}

export const timelineFeedDelegationWorkRowSchema: z.ZodType<TimelineFeedDelegationWorkRow> =
  timelineFeedWorkRowBaseSchema.extend({
    workKind: z.literal("delegation"),
    callId: z.string(),
    toolName: z.string(),
    subagentType: z.string().nullable(),
    description: z.string().nullable(),
    outputPreview: timelineTextPreviewSchema,
    completedAt: z.number().nullable(),
    childCount: z.number().int().nonnegative(),
    childRows: z.array(z.lazy(() => timelineFeedRowSchema)),
  });

export const timelineFeedWorkflowWorkRowSchema =
  timelineFeedWorkRowBaseSchema.extend({
    workKind: z.literal("workflow"),
    itemId: z.string(),
    taskType: z.string(),
    workflowName: z.string().nullable(),
    description: z.string(),
    taskStatus: backgroundTaskStatusSchema,
    workflowSummary: z
      .object({
        agentCount: z.number().int().nonnegative(),
        phaseCount: z.number().int().nonnegative(),
        settledAgentCount: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
    usage: backgroundTaskUsageSchema.nullable(),
    summaryPreview: timelineTextPreviewSchema.nullable(),
    errorPreview: timelineTextPreviewSchema.nullable(),
    completedAt: z.number().nullable(),
  });

export type TimelineFeedWorkRow =
  | TimelineFeedCommandWorkRow
  | TimelineFeedToolWorkRow
  | TimelineFeedFileChangeWorkRow
  | z.infer<typeof timelineFeedWebSearchWorkRowSchema>
  | z.infer<typeof timelineFeedWebFetchWorkRowSchema>
  | z.infer<typeof timelineFeedImageViewWorkRowSchema>
  | z.infer<typeof timelineFeedApprovalWorkRowSchema>
  | z.infer<typeof timelineFeedQuestionWorkRowSchema>
  | TimelineFeedDelegationWorkRow
  | z.infer<typeof timelineFeedWorkflowWorkRowSchema>;

export const timelineFeedWorkRowSchema: z.ZodType<TimelineFeedWorkRow> =
  z.union([
    timelineFeedCommandWorkRowSchema,
    timelineFeedToolWorkRowSchema,
    timelineFeedFileChangeWorkRowSchema,
    timelineFeedWebSearchWorkRowSchema,
    timelineFeedWebFetchWorkRowSchema,
    timelineFeedImageViewWorkRowSchema,
    timelineFeedApprovalWorkRowSchema,
    timelineFeedQuestionWorkRowSchema,
    timelineFeedDelegationWorkRowSchema,
    timelineFeedWorkflowWorkRowSchema,
  ]);

export interface TimelineFeedTurnRow extends z.infer<
  typeof timelineFeedRowBaseSchema
> {
  kind: "turn";
  turnId: string;
  status: TimelineRowStatus;
  summaryCount: number;
  completedAt: number | null;
  children: TimelineFeedRow[] | null;
}

export const timelineFeedTurnRowSchema: z.ZodType<TimelineFeedTurnRow> = z.lazy(
  () =>
    timelineFeedRowBaseSchema.extend({
      kind: z.literal("turn"),
      turnId: z.string().min(1),
      status: timelineRowStatusSchema,
      summaryCount: z.number().int().nonnegative(),
      completedAt: z.number().nullable(),
      children: z.array(timelineFeedRowSchema).nullable(),
    }),
);

export const timelineFeedWorkSummaryRowSchema =
  timelineFeedRowBaseSchema.extend({
    kind: z.enum(["bundle-summary", "step-summary"]),
    status: timelineRowStatusSchema,
    title: z.string(),
    childCount: z.number().int().nonnegative(),
  });
export type TimelineFeedWorkSummaryRow = z.infer<
  typeof timelineFeedWorkSummaryRowSchema
>;

export type TimelineFeedRow =
  | TimelineFeedConversationRow
  | TimelineFeedSystemRow
  | TimelineFeedWorkRow
  | TimelineFeedTurnRow
  | TimelineFeedWorkSummaryRow;

export const timelineFeedRowSchema: z.ZodType<TimelineFeedRow> = z.lazy(() =>
  z.union([
    timelineFeedWorkSummaryRowSchema,
    timelineFeedConversationRowSchema,
    timelineFeedSystemRowSchema,
    timelineFeedWorkRowSchema,
    timelineFeedTurnRowSchema,
  ]),
);

export type TimelineToolArgs = JsonObject | null;
