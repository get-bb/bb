import { z } from "zod";
import {
  systemErrorEventDataSchema,
  systemPermissionGrantLifecycleEventDataSchema,
  systemLegacyUserMessageEventDataSchema,
  systemOperationEventDataSchema,
  systemProviderTurnWatchdogEventDataSchema,
  systemThreadProvisioningEventDataSchema,
  systemUserQuestionLifecycleEventDataSchema,
  systemEventTypeValues,
  systemThreadInterruptedEventDataSchema,
  clientTurnLifecycleEventDataSchema,
  turnRequestEventDataSchema,
} from "./thread-events.js";
import { jsonValueSchema } from "./json-value.js";
import {
  threadEventScopeSchema,
  validateThreadEventScope,
} from "./thread-event-scope.js";
import { clientTurnRequestIdSchema } from "./protocol-ids.js";
import {
  backgroundTaskStatusSchema,
  backgroundTaskUsageSchema,
  workflowProgressSnapshotSchema,
} from "./background-task.js";
import { findLegacyClientRequestSequenceIssues } from "./thread-event-legacy.js";

export const threadEventItemStatusSchema = z.enum([
  "pending",
  "completed",
  "failed",
  "interrupted",
]);
export type ThreadEventItemStatus = z.infer<typeof threadEventItemStatusSchema>;

export const threadEventItemApprovalStatusSchema = z
  .enum(["waiting_for_approval", "denied"])
  .nullable();
export type ThreadEventItemApprovalStatus = z.infer<
  typeof threadEventItemApprovalStatusSchema
>;

export const threadEventTurnStatusSchema = z.enum([
  "completed",
  "failed",
  "interrupted",
]);
export type ThreadEventTurnStatus = z.infer<typeof threadEventTurnStatusSchema>;

export const providerErrorCategoryValues = [
  "active-turn-not-steerable",
  "bad-request",
  "connection-failed",
  "context-window-exceeded",
  "billing",
  "budget-exceeded",
  "internal",
  "max-output-tokens",
  "max-turns",
  "overloaded",
  "policy",
  "rate-limit",
  "sandbox",
  "stream-disconnected",
  "structured-output-retries",
  "thread-rollback-failed",
  "too-many-failed-attempts",
  "unauthorized",
  "unknown",
] as const;
export const providerErrorCategorySchema = z.enum(providerErrorCategoryValues);
export type ProviderErrorCategory = z.infer<typeof providerErrorCategorySchema>;

export const providerErrorInfoSchema = z.object({
  category: providerErrorCategorySchema,
  providerCode: z.string().nullable(),
  httpStatusCode: z.number().nullable(),
});
export type ProviderErrorInfo = z.infer<typeof providerErrorInfoSchema>;

export const threadEventFileChangeKindSchema = z.enum([
  "add",
  "delete",
  "update",
]);

export const threadEventFileChangeSchema = z.object({
  path: z.string(),
  kind: threadEventFileChangeKindSchema,
  movePath: z.string().optional(),
  diff: z.string().optional(),
});
export type ThreadEventFileChange = z.infer<typeof threadEventFileChangeSchema>;

export const threadEventPlanStepStatusSchema = z.enum([
  "pending",
  "active",
  "completed",
  "failed",
]);
export type ThreadEventPlanStepStatus = z.infer<
  typeof threadEventPlanStepStatusSchema
>;

export const threadEventPlanStepSchema = z.object({
  step: z.string(),
  status: threadEventPlanStepStatusSchema.optional(),
});
export type ThreadEventPlanStep = z.infer<typeof threadEventPlanStepSchema>;

export const threadEventWebSearchItemSchema = z.object({
  type: z.literal("webSearch"),
  id: z.string(),
  queries: z.array(z.string()).min(1),
  resultText: z.string().nullable(),
  parentToolCallId: z.string().optional(),
});
export type ThreadEventWebSearchItem = z.infer<
  typeof threadEventWebSearchItemSchema
>;

export const threadEventWebFetchItemSchema = z.object({
  type: z.literal("webFetch"),
  id: z.string(),
  url: z.string(),
  prompt: z.string().nullable(),
  pattern: z.string().nullable(),
  resultText: z.string().nullable(),
  parentToolCallId: z.string().optional(),
});
export type ThreadEventWebFetchItem = z.infer<
  typeof threadEventWebFetchItemSchema
>;

export const threadEventImageViewItemSchema = z.object({
  type: z.literal("imageView"),
  id: z.string(),
  path: z.string(),
  parentToolCallId: z.string().optional(),
});
export type ThreadEventImageViewItem = z.infer<
  typeof threadEventImageViewItemSchema
>;

export const threadEventTextTruncationSchema = z.object({
  originalLength: z.number(),
  retainedHeadLength: z.number(),
  retainedTailLength: z.number(),
  truncatedAt: z.number(),
});

export const threadEventItemTruncationSchema = z.object({
  aggregatedOutput: threadEventTextTruncationSchema.optional(),
  result: threadEventTextTruncationSchema.optional(),
  resultText: threadEventTextTruncationSchema.optional(),
});

export const threadEventUserContentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image"), url: z.string() }),
  z.object({ type: z.literal("localImage"), path: z.string() }),
  z.object({ type: z.literal("localFile"), path: z.string() }),
]);
export type ThreadEventUserContent = z.infer<
  typeof threadEventUserContentSchema
>;

export const threadEventTokenUsageBreakdownSchema = z.object({
  totalTokens: z.number(),
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  outputTokens: z.number(),
  reasoningOutputTokens: z.number(),
});
export type ThreadEventTokenUsageBreakdown = z.infer<
  typeof threadEventTokenUsageBreakdownSchema
>;

export const threadEventContextWindowUsageSchema = z.object({
  usedTokens: z.number().nullable(),
  modelContextWindow: z.number().nullable(),
  estimated: z.boolean(),
});
export type ThreadEventContextWindowUsage = z.infer<
  typeof threadEventContextWindowUsageSchema
>;

export const threadEventTokenUsageSchema = z.object({
  total: threadEventTokenUsageBreakdownSchema,
  last: threadEventTokenUsageBreakdownSchema,
  modelContextWindow: z.number().nullable(),
});
export type ThreadEventTokenUsage = z.infer<typeof threadEventTokenUsageSchema>;

export const threadEventWarningCategorySchema = z.enum([
  "deprecation",
  "config",
  "general",
]);
export type ThreadEventWarningCategory = z.infer<
  typeof threadEventWarningCategorySchema
>;

export const providerRawEventSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: jsonValueSchema.optional(),
});
export type ProviderRawEvent = z.infer<typeof providerRawEventSchema>;

export const providerUnhandledEventSchema = z.object({
  type: z.literal("provider/unhandled"),
  threadId: z.string(),
  providerThreadId: z.string(),
  providerId: z.string(),
  rawType: z.string(),
  rawEvent: providerRawEventSchema,
  parentToolCallId: z.string().optional(),
});

export const toolCallProgressEventSchema = z.object({
  type: z.literal("item/toolCall/progress"),
  threadId: z.string(),
  providerThreadId: z.string(),
  itemId: z.string(),
  message: z.string().optional(),
  parentToolCallId: z.string().optional(),
});

/**
 * A provider-managed background task (dynamic workflow, backgrounded shell,
 * background subagent). Currently only dynamic workflows
 * (taskType "local_workflow") are materialized as items; foreground subagents
 * share the same provider event family but stay on the delegation rendering
 * path. The item id is derived from the provider task id and stays stable
 * across the started → progress* → completed lifecycle.
 */
export const threadEventBackgroundTaskItemSchema = z.object({
  type: z.literal("backgroundTask"),
  id: z.string(),
  /** Raw SDK task discriminant (e.g. "local_workflow"); "unknown" when the provider omitted it. */
  taskType: z.string(),
  description: z.string(),
  status: threadEventItemStatusSchema,
  taskStatus: backgroundTaskStatusSchema,
  /** Ambient/housekeeping task; consumers hide it from the inline transcript. */
  skipTranscript: z.boolean(),
  /** meta.name of the workflow script; only present for workflow tasks. */
  workflowName: z.string().optional(),
  /** Merged workflow tree; absent until the provider reports progress records. */
  workflow: workflowProgressSnapshotSchema.optional(),
  /** Absent until the provider reports usage. */
  usage: backgroundTaskUsageSchema.optional(),
  /** Terminal summary from the provider; absent while the task runs. */
  summary: z.string().optional(),
  error: z.string().optional(),
  outputFile: z.string().optional(),
  parentToolCallId: z.string().optional(),
});
export type ThreadEventBackgroundTaskItem = z.infer<
  typeof threadEventBackgroundTaskItemSchema
>;

export const threadEventItemSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("userMessage"),
      id: z.string(),
      content: z.array(threadEventUserContentSchema),
      clientRequestId: clientTurnRequestIdSchema.optional(),
      parentToolCallId: z.string().optional(),
    })
    .strict(),
  z.object({
    type: z.literal("agentMessage"),
    id: z.string(),
    text: z.string(),
    parentToolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal("commandExecution"),
    id: z.string(),
    command: z.string(),
    cwd: z.string(),
    status: threadEventItemStatusSchema,
    approvalStatus: threadEventItemApprovalStatusSchema,
    /**
     * Omitted when the process produced no stdout/stderr. Adapters should omit
     * this field instead of emitting an empty string placeholder.
     */
    aggregatedOutput: z.string().optional(),
    exitCode: z.number().optional(),
    durationMs: z.number().optional(),
    truncation: threadEventItemTruncationSchema.optional(),
    parentToolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal("fileChange"),
    id: z.string(),
    changes: z.array(threadEventFileChangeSchema),
    status: threadEventItemStatusSchema,
    approvalStatus: threadEventItemApprovalStatusSchema,
    parentToolCallId: z.string().optional(),
  }),
  threadEventWebSearchItemSchema,
  threadEventWebFetchItemSchema,
  threadEventImageViewItemSchema,
  z.object({
    type: z.literal("toolCall"),
    id: z.string(),
    server: z.string().optional(),
    tool: z.string(),
    arguments: z.record(z.string(), z.unknown()).optional(),
    status: threadEventItemStatusSchema,
    result: z.unknown().optional(),
    error: z.string().optional(),
    durationMs: z.number().optional(),
    truncation: threadEventItemTruncationSchema.optional(),
    parentToolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal("reasoning"),
    id: z.string(),
    summary: z.array(z.string()),
    content: z.array(z.string()),
    parentToolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal("plan"),
    id: z.string(),
    text: z.string(),
    parentToolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal("contextCompaction"),
    id: z.string(),
    parentToolCallId: z.string().optional(),
  }),
  threadEventBackgroundTaskItemSchema,
]);
export type ThreadEventItem = z.infer<typeof threadEventItemSchema>;
export type ThreadEventItemType = ThreadEventItem["type"];

/**
 * Events originating from a provider process via the agent runtime.
 * These carry `providerThreadId` — the provider's internal session/thread ID.
 */
const unscopedProviderEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("thread/started"),
    threadId: z.string(),
  }),
  z.object({
    type: z.literal("thread/identity"),
    threadId: z.string(),
    providerThreadId: z.string(),
  }),
  z.object({
    type: z.literal("turn/started"),
    threadId: z.string(),
    providerThreadId: z.string(),
  }),
  z.object({
    type: z.literal("turn/completed"),
    threadId: z.string(),
    // Server reconciliation can synthesize interrupted completions when the
    // original provider thread id was never persisted.
    providerThreadId: z.string().nullable(),
    status: threadEventTurnStatusSchema,
    error: z.object({ message: z.string() }).optional(),
  }),
  z
    .object({
      type: z.literal("turn/input/accepted"),
      threadId: z.string(),
      providerThreadId: z.string(),
      clientRequestId: clientTurnRequestIdSchema,
      scope: threadEventScopeSchema,
    })
    .strict(),
  z.object({
    type: z.literal("thread/name/updated"),
    threadId: z.string(),
    providerThreadId: z.string(),
    threadName: z.string(),
  }),
  z.object({
    type: z.literal("thread/compacted"),
    threadId: z.string(),
    providerThreadId: z.string(),
  }),
  z.object({
    type: z.literal("item/started"),
    threadId: z.string(),
    providerThreadId: z.string(),
    item: threadEventItemSchema,
  }),
  z.object({
    type: z.literal("item/completed"),
    threadId: z.string(),
    providerThreadId: z.string(),
    item: threadEventItemSchema,
  }),
  z.object({
    type: z.literal("item/agentMessage/delta"),
    threadId: z.string(),
    providerThreadId: z.string(),
    itemId: z.string(),
    delta: z.string(),
    parentToolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal("item/commandExecution/outputDelta"),
    threadId: z.string(),
    providerThreadId: z.string(),
    itemId: z.string(),
    delta: z.string(),
    /**
     * When true, this delta replaces previously accumulated command output
     * instead of appending to it. Omission means the delta appends.
     */
    reset: z.boolean().optional(),
    parentToolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal("item/fileChange/outputDelta"),
    threadId: z.string(),
    providerThreadId: z.string(),
    itemId: z.string(),
    delta: z.string(),
    parentToolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal("item/reasoning/summaryTextDelta"),
    threadId: z.string(),
    providerThreadId: z.string(),
    itemId: z.string(),
    delta: z.string(),
    parentToolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal("item/reasoning/textDelta"),
    threadId: z.string(),
    providerThreadId: z.string(),
    itemId: z.string(),
    delta: z.string(),
    parentToolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal("item/plan/delta"),
    threadId: z.string(),
    providerThreadId: z.string(),
    itemId: z.string(),
    delta: z.string(),
    parentToolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal("item/mcpToolCall/progress"),
    threadId: z.string(),
    providerThreadId: z.string(),
    itemId: z.string(),
    message: z.string().optional(),
    parentToolCallId: z.string().optional(),
  }),
  toolCallProgressEventSchema,
  /**
   * Superseding state snapshot for an in-flight background task. Thread-scoped
   * (not turn-scoped) because tasks outlive their spawning turn: late events
   * must not interleave into later turns' sequence-contiguous windows. Each
   * progress event carries the full current item state; consumers replace, not
   * merge. The item is placed in the timeline by its turn-scoped item/started.
   */
  z.object({
    type: z.literal("item/backgroundTask/progress"),
    threadId: z.string(),
    providerThreadId: z.string(),
    item: threadEventBackgroundTaskItemSchema,
  }),
  /**
   * Terminal state for a background task, carrying the full final item
   * payload. Dedicated event (instead of the generic turn-scoped
   * item/completed) because it may arrive turns after the item/started.
   */
  z.object({
    type: z.literal("item/backgroundTask/completed"),
    threadId: z.string(),
    providerThreadId: z.string(),
    item: threadEventBackgroundTaskItemSchema,
  }),
  z.object({
    type: z.literal("thread/tokenUsage/updated"),
    threadId: z.string(),
    providerThreadId: z.string(),
    tokenUsage: threadEventTokenUsageSchema,
  }),
  z.object({
    type: z.literal("thread/contextWindowUsage/updated"),
    threadId: z.string(),
    providerThreadId: z.string(),
    contextWindowUsage: threadEventContextWindowUsageSchema,
  }),
  z.object({
    type: z.literal("turn/plan/updated"),
    threadId: z.string(),
    providerThreadId: z.string(),
    plan: z.array(threadEventPlanStepSchema),
    explanation: z.string().optional(),
  }),
  z.object({
    type: z.literal("turn/diff/updated"),
    threadId: z.string(),
    providerThreadId: z.string(),
    diff: z.string().optional(),
  }),
  z.object({
    type: z.literal("provider/error"),
    threadId: z.string(),
    providerThreadId: z.string(),
    message: z.string(),
    detail: z.string().optional(),
    willRetry: z.boolean().optional(),
    errorInfo: providerErrorInfoSchema.optional(),
  }),
  z.object({
    type: z.literal("provider/warning"),
    threadId: z.string(),
    providerThreadId: z.string(),
    category: threadEventWarningCategorySchema,
    summary: z.string().optional(),
    details: z.string().optional(),
  }),
  providerUnhandledEventSchema,
]);
const scopedEventDataSchema = z.object({
  scope: threadEventScopeSchema,
});
export const providerEventSchema = unscopedProviderEventSchema.and(
  scopedEventDataSchema,
);
export type ProviderEvent = z.infer<typeof providerEventSchema>;
export type ProviderUnhandledEvent = Extract<
  ProviderEvent,
  { type: "provider/unhandled" }
>;
export const providerEventTypeValues = unscopedProviderEventSchema.options.map(
  (option) => option.shape.type.value,
);

/**
 * Events originating from the server/system layer (not from a provider process).
 * These do NOT carry `providerThreadId`.
 */
const unscopedSystemEventSchema = z.union([
  z
    .object({
      type: z.literal("client/thread/start"),
      threadId: z.string(),
    })
    .merge(clientTurnLifecycleEventDataSchema),
  z
    .object({
      type: z.literal("client/turn/requested"),
      threadId: z.string(),
    })
    .merge(turnRequestEventDataSchema),
  z
    .object({
      type: z.literal("client/turn/start"),
      threadId: z.string(),
    })
    .merge(clientTurnLifecycleEventDataSchema),
  z
    .object({
      type: z.literal("system/error"),
      threadId: z.string(),
    })
    .merge(systemErrorEventDataSchema),
  z
    .object({
      type: z.literal("system/manager/user_message"),
      threadId: z.string(),
    })
    .merge(systemLegacyUserMessageEventDataSchema),
  z
    .object({
      type: z.literal("system/thread/interrupted"),
      threadId: z.string(),
    })
    .merge(systemThreadInterruptedEventDataSchema),
  z
    .object({
      type: z.literal("system/operation"),
      threadId: z.string(),
    })
    .merge(systemOperationEventDataSchema),
  z
    .object({
      type: z.literal("system/permissionGrant/lifecycle"),
      threadId: z.string(),
    })
    .merge(systemPermissionGrantLifecycleEventDataSchema),
  z
    .object({
      type: z.literal("system/userQuestion/lifecycle"),
      threadId: z.string(),
    })
    .merge(systemUserQuestionLifecycleEventDataSchema),
  z
    .object({
      type: z.literal("system/thread-provisioning"),
      threadId: z.string(),
    })
    .merge(systemThreadProvisioningEventDataSchema),
  z
    .object({
      type: z.literal("system/provider-turn-watchdog"),
      threadId: z.string(),
    })
    .merge(systemProviderTurnWatchdogEventDataSchema),
]);
export const systemEventSchema = unscopedSystemEventSchema.and(
  scopedEventDataSchema,
);

const rejectLegacyClientRequestSequenceSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    for (const issue of findLegacyClientRequestSequenceIssues(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: issue.message,
        path: issue.path,
      });
    }
  });

/** All thread events — provider-originated or system-originated. */
export const threadEventSchema = rejectLegacyClientRequestSequenceSchema.pipe(
  z
    .union([providerEventSchema, systemEventSchema])
    .superRefine((event, ctx) => {
      const result = validateThreadEventScope({
        type: event.type,
        scope: event.scope,
      });
      if (!result.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: result.message ?? "Invalid thread event scope",
          path: ["scope"],
        });
        return;
      }
    }),
);
export type ThreadEvent = z.infer<typeof threadEventSchema>;
export type ThreadEventType = ThreadEvent["type"];
export const threadEventTypeValues = [
  ...providerEventTypeValues,
  ...systemEventTypeValues,
] as const;
const threadEventTypeSet = new Set<string>(threadEventTypeValues);
export const threadEventTypeSchema = z
  .string()
  .refine(
    (value): value is ThreadEventType => threadEventTypeSet.has(value),
    "Invalid thread event type",
  );
