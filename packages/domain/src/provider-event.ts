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
  turnRequestRejectedEventDataSchema,
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
import { threadTimelineGoalStatusSchema } from "./thread-timeline-goal.js";

export const threadEventItemStatusSchema = z.enum([
  "pending",
  "completed",
  "failed",
  "interrupted",
]);
export type ThreadEventItemStatus = z.infer<typeof threadEventItemStatusSchema>;

const threadEventItemApprovalStatusSchema = z
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

const providerErrorCategoryValues = [
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

const providerRateLimitStatusSchema = z.enum([
  "allowed",
  "warning",
  "blocked",
  "unknown",
]);
export type ProviderRateLimitStatus = z.infer<
  typeof providerRateLimitStatusSchema
>;

const providerRateLimitWindowSchema = z.object({
  /** Opaque provider-issued key. New provider windows must not break parsing. */
  providerKey: z.string().min(1).nullable(),
  label: z.string().min(1).nullable(),
  status: providerRateLimitStatusSchema,
  resetsAtMs: z.number().int().nonnegative().nullable(),
});
export type ProviderRateLimitWindow = z.infer<
  typeof providerRateLimitWindowSchema
>;

export const providerRateLimitStateSchema = z.object({
  providerId: z.string().min(1),
  status: providerRateLimitStatusSchema,
  kind: z.enum(["subscription-window", "credits", "spend-control", "unknown"]),
  windows: z.array(providerRateLimitWindowSchema),
  reachedReason: z.string().min(1).nullable(),
  overageStatus: z
    .enum(["allowed", "warning", "rejected", "unavailable"])
    .nullable(),
  overageReason: z.string().min(1).nullable(),
});
export type ProviderRateLimitState = z.infer<
  typeof providerRateLimitStateSchema
>;

const threadEventFileChangeKindSchema = z.enum(["add", "delete", "update"]);

const threadEventFileChangeSchema = z.object({
  path: z.string(),
  kind: threadEventFileChangeKindSchema,
  movePath: z.string().optional(),
  diff: z.string().optional(),
});
export type ThreadEventFileChange = z.infer<typeof threadEventFileChangeSchema>;

const threadEventPlanStepStatusSchema = z.enum([
  "pending",
  "active",
  "completed",
  "failed",
]);

export const threadEventPlanStepSchema = z.object({
  step: z.string(),
  status: threadEventPlanStepStatusSchema.optional(),
});
export type ThreadEventPlanStep = z.infer<typeof threadEventPlanStepSchema>;

const threadEventWebSearchItemSchema = z.object({
  type: z.literal("webSearch"),
  id: z.string(),
  queries: z.array(z.string()).min(1),
  resultText: z.string().nullable(),
  parentToolCallId: z.string().optional(),
});
export type ThreadEventWebSearchItem = z.infer<
  typeof threadEventWebSearchItemSchema
>;

const threadEventWebFetchItemSchema = z.object({
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

const threadEventImageViewItemSchema = z.object({
  type: z.literal("imageView"),
  id: z.string(),
  path: z.string(),
  parentToolCallId: z.string().optional(),
});

const threadEventTextTruncationSchema = z.object({
  originalLength: z.number(),
  retainedHeadLength: z.number(),
  retainedTailLength: z.number(),
  truncatedAt: z.number(),
});

const threadEventItemTruncationSchema = z.object({
  aggregatedOutput: threadEventTextTruncationSchema.optional(),
  result: threadEventTextTruncationSchema.optional(),
  resultText: threadEventTextTruncationSchema.optional(),
});

const threadEventUserContentSchema = z.discriminatedUnion("type", [
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

const threadEventContextWindowUsageSchema = z.object({
  usedTokens: z.number().nullable(),
  modelContextWindow: z.number().nullable(),
  estimated: z.boolean(),
});
export type ThreadEventContextWindowUsage = z.infer<
  typeof threadEventContextWindowUsageSchema
>;

const threadEventTokenUsageSchema = z.object({
  total: threadEventTokenUsageBreakdownSchema,
  last: threadEventTokenUsageBreakdownSchema,
  modelContextWindow: z.number().nullable(),
});

export const threadEventWarningCategorySchema = z.enum([
  "deprecation",
  "config",
  "general",
  /**
   * The provider declined a compaction that bb asked for because there was
   * nothing to compact. The warning settles the pending compaction row.
   */
  "compaction-skipped",
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

const providerUnhandledEventSchema = z.object({
  type: z.literal("provider/unhandled"),
  threadId: z.string(),
  providerThreadId: z.string(),
  providerId: z.string(),
  rawType: z.string(),
  rawEvent: providerRawEventSchema,
  parentToolCallId: z.string().optional(),
});

const toolCallProgressEventSchema = z.object({
  type: z.literal("item/toolCall/progress"),
  threadId: z.string(),
  providerThreadId: z.string(),
  itemId: z.string(),
  message: z.string().optional(),
  parentToolCallId: z.string().optional(),
});

/**
 * A materialized provider background task. Dynamic workflows (taskType
 * "local_workflow"), backgrounded shell commands (taskType "local_bash"), and
 * backgrounded subagents (taskType "local_agent" / "local_subagent") become
 * items. The item id is derived from the provider task id and stays stable
 * across the started → progress* → completed lifecycle.
 */
export const threadEventBackgroundTaskItemSchema = z.object({
  type: z.literal("backgroundTask"),
  id: z.string(),
  /**
   * The provider's stable task id, shared by every generation (restart) of
   * the same task; consumers use it to correlate a restarted task with its
   * earlier generations. Absent only on events persisted before the field
   * existed — those encoded the family in the item id's legacy `#N`
   * generation suffix instead.
   */
  familyId: z.string().optional(),
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
    /** Server-enriched labels for a native plugin tool's timeline row. */
    statusLabels: z
      .object({ pending: z.string(), completed: z.string() })
      .optional(),
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
    parentToolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal("turn/completed"),
    threadId: z.string(),
    // Server reconciliation can synthesize interrupted completions when the
    // original provider thread id was never persisted.
    providerThreadId: z.string().nullable(),
    status: threadEventTurnStatusSchema,
    error: z.object({ message: z.string() }).optional(),
    /** Provider-native point through which a replacement branch should retain history. */
    providerCheckpointId: z.string().min(1).optional(),
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
    type: z.literal("thread/context/cleared"),
    threadId: z.string(),
    providerThreadId: z.string(),
  }),
  z.object({
    type: z.literal("thread/goal/updated"),
    threadId: z.string(),
    providerThreadId: z.string(),
    objective: z.string(),
    status: threadTimelineGoalStatusSchema,
    tokenBudget: z.number().nullable(),
    tokensUsed: z.number(),
    timeUsedSeconds: z.number(),
  }),
  z.object({
    type: z.literal("thread/goal/cleared"),
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
    type: z.literal("provider/rateLimits/updated"),
    threadId: z.string(),
    providerThreadId: z.string(),
    rateLimits: providerRateLimitStateSchema,
  }),
  z.object({
    type: z.literal("provider/warning"),
    threadId: z.string(),
    providerThreadId: z.string(),
    category: threadEventWarningCategorySchema,
    summary: z.string().optional(),
    details: z.string().optional(),
  }),
  z.object({
    type: z.literal("provider/modelFallback"),
    threadId: z.string(),
    providerThreadId: z.string(),
    originalModel: z.string().min(1),
    fallbackModel: z.string().min(1),
    reason: z.enum(["refusal", "provider"]),
    message: z.string(),
  }),
  providerUnhandledEventSchema,
]);
const scopedEventDataSchema = z.object({
  scope: threadEventScopeSchema,
});
const providerEventSchema = unscopedProviderEventSchema.and(
  scopedEventDataSchema,
);
type ProviderEvent = z.infer<typeof providerEventSchema>;
export type ProviderUnhandledEvent = Extract<
  ProviderEvent,
  { type: "provider/unhandled" }
>;
const providerEventTypeValues = unscopedProviderEventSchema.options.map(
  (option) => option.shape.type.value,
);

/**
 * Events originating from the server/system layer (not from a provider process).
 * These do NOT carry `providerThreadId`.
 */
const unscopedSystemEventSchema = z.discriminatedUnion("type", [
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
      type: z.literal("client/turn/rejected"),
      threadId: z.string(),
    })
    .merge(turnRequestRejectedEventDataSchema),
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
const systemEventSchema = unscopedSystemEventSchema.and(scopedEventDataSchema);

const legacyClientRequestKey = ["clientRequest", "Sequence"].join("");

function isEventPropertyBag(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const rejectLegacyClientRequestSequenceSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    if (!isEventPropertyBag(value)) {
      return;
    }

    if (Object.hasOwn(value, legacyClientRequestKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "legacy request sequence field is no longer accepted",
        path: [legacyClientRequestKey],
      });
    }

    const item = value.item;
    if (
      isEventPropertyBag(item) &&
      item.type === "userMessage" &&
      Object.hasOwn(item, legacyClientRequestKey)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "legacy user-message request sequence field is no longer accepted",
        path: ["item", legacyClientRequestKey],
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
