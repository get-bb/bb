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
import { threadEventItemPresentationSchema } from "./item-presentation.js";
import { extensionKindSchema } from "./provider-extension-kind.js";

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

/**
 * Declarative presentation persisted with a provider-produced item (see
 * item-presentation.ts). Optional on every item while v2 deltas are accepted
 * beside v3; absent on every row persisted before the field existed.
 */
const itemPresentationField = {
  presentation: threadEventItemPresentationSchema.optional(),
};

const threadEventWebSearchItemSchema = z.object({
  type: z.literal("webSearch"),
  id: z.string(),
  queries: z.array(z.string()).min(1),
  resultText: z.string().nullable(),
  ...itemPresentationField,
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
  ...itemPresentationField,
  parentToolCallId: z.string().optional(),
});
export type ThreadEventWebFetchItem = z.infer<
  typeof threadEventWebFetchItemSchema
>;

const threadEventImageViewItemSchema = z.object({
  type: z.literal("imageView"),
  id: z.string(),
  path: z.string(),
  ...itemPresentationField,
  parentToolCallId: z.string().optional(),
});

/**
 * A file the agent read. The single most common generic tool in the
 * production corpus (Claude `Read`: 7,568 calls across 141 threads rendered
 * as an opaque `toolCall`), so it earns a core kind: clients show the path,
 * the permission matrix treats it as a read, and no tool-name table is
 * needed to recognise it. `cmd` carries the native shell form when the
 * provider read through a command (`cat`, `sed -n`) rather than a structured
 * tool, so the row can still show what actually ran.
 */
export const threadEventFileReadItemSchema = z.object({
  type: z.literal("fileRead"),
  id: z.string(),
  path: z.string(),
  cmd: z.string().optional(),
  status: threadEventItemStatusSchema,
  ...itemPresentationField,
  parentToolCallId: z.string().optional(),
});
export type ThreadEventFileReadItem = z.infer<
  typeof threadEventFileReadItemSchema
>;

/**
 * How a `search` item looked for things: `content` searches inside files
 * (grep, Claude `Grep`), `path` matches file names (Claude `Glob`, `fd`),
 * `list` enumerates a directory (`ls`, codex `list_dir`).
 */
export const threadEventSearchModeSchema = z.enum(["content", "path", "list"]);
export type ThreadEventSearchMode = z.infer<typeof threadEventSearchModeSchema>;

/**
 * One kind for every exploration tool that is not a file read: grep, glob,
 * and directory listing, discriminated by `mode`. Claude `Grep` + `Glob` and
 * the shell `rg`/`ls`/`find` commands bridges already classify into
 * `command` activity intents all fold into it. `query` is the pattern: text
 * or a regex for `content`, a glob for `path`, and an optional filter for
 * `list` (empty when the whole directory is listed). `path` is the root the
 * search ran under when the provider named one. `cmd` carries the native
 * shell form when the provider searched through a command.
 */
export const threadEventSearchItemSchema = z.object({
  type: z.literal("search"),
  id: z.string(),
  mode: threadEventSearchModeSchema,
  query: z.string(),
  path: z.string().optional(),
  cmd: z.string().optional(),
  status: threadEventItemStatusSchema,
  ...itemPresentationField,
  parentToolCallId: z.string().optional(),
});
export type ThreadEventSearchItem = z.infer<typeof threadEventSearchItemSchema>;

/**
 * The agent delegated work to a child agent. One kind replaces the three
 * encodings in the production data — codex `spawnAgent`/`wait` tool calls,
 * the Claude `Agent` tool call with nested child turns, and backgrounded
 * `local_agent` background tasks — and the `thread/openWork` notification:
 * an open delegation IS open work.
 *
 * `childRef` is the provider-native id of the child (a codex agent id, a
 * Claude subagent id, a bb child thread id when the delegation became a bb
 * thread); child turns link back through their `parentToolCallId`.
 * `background: true` marks a delegation that outlives its spawning turn, in
 * which case its progress and terminal state ride the thread-scoped
 * `item/delegation/progress` and `item/delegation/completed` events exactly
 * as `backgroundTask` does; a foreground delegation settles through the
 * ordinary turn-scoped `item/completed`.
 */
export const threadEventDelegationItemSchema = z.object({
  type: z.literal("delegation"),
  id: z.string(),
  childRef: z.string().min(1),
  /** Human label for the delegated work (the child's description). */
  label: z.string(),
  status: threadEventItemStatusSchema,
  background: z.boolean(),
  /** Terminal summary from the child; absent while it runs. */
  summary: z.string().optional(),
  ...itemPresentationField,
  parentToolCallId: z.string().optional(),
});
export type ThreadEventDelegationItem = z.infer<
  typeof threadEventDelegationItemSchema
>;

/**
 * A structured plan snapshot the agent maintains as an item: codex
 * `update_plan` (its `turn/plan/updated` notification reaches 295 threads in
 * the production corpus and the UI discards it today) and the Claude
 * `TaskCreate`/`TaskUpdate`/`TodoWrite` family. Each snapshot carries the
 * full step list; a later snapshot supersedes an earlier one. Distinct from
 * the `plan` item, which is the free-text plan-mode document.
 */
export const threadEventPlanStepsItemSchema = z.object({
  type: z.literal("planSteps"),
  id: z.string(),
  steps: z.array(threadEventPlanStepSchema),
  explanation: z.string().optional(),
  status: threadEventItemStatusSchema,
  ...itemPresentationField,
  parentToolCallId: z.string().optional(),
});
export type ThreadEventPlanStepsItem = z.infer<
  typeof threadEventPlanStepsItemSchema
>;

/**
 * A plugin-defined item kind outside the core vocabulary
 * (`"<pluginId>/<name>"`, see provider-extension-kind.ts). The payload is
 * opaque JSON here; the server validates it against the owning plugin's
 * declared schema at ingest. `presentation` is REQUIRED — an
 * extension item has no core renderer to fall back on, so the declarative
 * base is the only thing every client can show.
 */
export const threadEventExtensionItemSchema = z.object({
  type: z.literal("extension"),
  id: z.string(),
  kind: extensionKindSchema,
  payload: jsonValueSchema,
  status: threadEventItemStatusSchema,
  presentation: threadEventItemPresentationSchema,
  parentToolCallId: z.string().optional(),
});
export type ThreadEventExtensionItem = z.infer<
  typeof threadEventExtensionItemSchema
>;

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
  ...itemPresentationField,
  parentToolCallId: z.string().optional(),
});
export type ThreadEventBackgroundTaskItem = z.infer<
  typeof threadEventBackgroundTaskItemSchema
>;

export const threadEventItemSchema = z.discriminatedUnion("type", [
  // bb authors user messages itself, so they carry no bridge presentation.
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
    ...itemPresentationField,
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
    ...itemPresentationField,
    parentToolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal("fileChange"),
    id: z.string(),
    changes: z.array(threadEventFileChangeSchema),
    status: threadEventItemStatusSchema,
    approvalStatus: threadEventItemApprovalStatusSchema,
    ...itemPresentationField,
    parentToolCallId: z.string().optional(),
  }),
  threadEventWebSearchItemSchema,
  threadEventWebFetchItemSchema,
  threadEventImageViewItemSchema,
  threadEventFileReadItemSchema,
  threadEventSearchItemSchema,
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
    /**
     * The escape hatch for tools with no core kind: the bridge says how the
     * row reads. Supersedes the server-enriched `statusLabels` when both are
     * present (WS3 deletes `statusLabels`).
     */
    ...itemPresentationField,
    parentToolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal("reasoning"),
    id: z.string(),
    summary: z.array(z.string()),
    content: z.array(z.string()),
    ...itemPresentationField,
    parentToolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal("plan"),
    id: z.string(),
    text: z.string(),
    ...itemPresentationField,
    parentToolCallId: z.string().optional(),
  }),
  threadEventPlanStepsItemSchema,
  z.object({
    type: z.literal("contextCompaction"),
    id: z.string(),
    ...itemPresentationField,
    parentToolCallId: z.string().optional(),
  }),
  threadEventBackgroundTaskItemSchema,
  threadEventDelegationItemSchema,
  threadEventExtensionItemSchema,
]);
export type ThreadEventItem = z.infer<typeof threadEventItemSchema>;
export type ThreadEventItemType = ThreadEventItem["type"];

/**
 * The core item vocabulary: every persisted item kind core renders, acts on,
 * and applies policy to. Extension kinds (`type: "extension"`, namespaced
 * `"<pluginId>/<name>"`) are deliberately NOT here — they are open, plugin-
 * declared, and render through `presentation` alone.
 *
 * Listed as a value so clients can build exhaustive kind maps over it: the
 * mobile renderer map `satisfies Record<CoreItemKind | "extension", …>`, so
 * adding a kind here without a mobile rendering decision fails to typecheck
 * (guardrail G4). `CoreItemKindsAreExhaustive` below fails to compile when
 * this list and `threadEventItemSchema` drift apart in either direction.
 */
export const CORE_ITEM_KINDS = [
  "userMessage",
  "agentMessage",
  "commandExecution",
  "fileChange",
  "fileRead",
  "search",
  "webSearch",
  "webFetch",
  "imageView",
  "toolCall",
  "reasoning",
  "plan",
  "planSteps",
  "contextCompaction",
  "backgroundTask",
  "delegation",
] as const satisfies readonly Exclude<ThreadEventItemType, "extension">[];
export type CoreItemKind = (typeof CORE_ITEM_KINDS)[number];

type CoreItemKindsAreExhaustive =
  Exclude<ThreadEventItemType, "extension"> extends CoreItemKind
    ? CoreItemKind extends Exclude<ThreadEventItemType, "extension">
      ? true
      : never
    : never;
// A missing or extra core kind turns this annotation into `never`.
const coreItemKindsAreExhaustive: CoreItemKindsAreExhaustive = true;
void coreItemKindsAreExhaustive;

export function isCoreItemKind(value: string): value is CoreItemKind {
  return (CORE_ITEM_KINDS as readonly string[]).includes(value);
}

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
  /**
   * Superseding snapshot for an in-flight background delegation (`background:
   * true`). Thread-scoped for the same reason as `item/backgroundTask/
   * progress`: a background child outlives its spawning turn, and late events
   * must not interleave into later turns' sequence-contiguous windows. The
   * item is placed in the timeline by its turn-scoped `item/started`.
   */
  z.object({
    type: z.literal("item/delegation/progress"),
    threadId: z.string(),
    providerThreadId: z.string(),
    item: threadEventDelegationItemSchema,
  }),
  /**
   * Terminal state for a background delegation, carrying the full final item.
   * Dedicated event (instead of the turn-scoped `item/completed`) because it
   * may arrive turns after the `item/started`. Foreground delegations settle
   * through `item/completed`.
   */
  z.object({
    type: z.literal("item/delegation/completed"),
    threadId: z.string(),
    providerThreadId: z.string(),
    item: threadEventDelegationItemSchema,
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
  /**
   * Plugin-declared thread state (grammar v3): a `"<pluginId>/<name>"` kind
   * beside the core thread-state family (usage, context window, rate limits,
   * model fallback, context cleared). Latest snapshot wins per `kind`: a
   * bridge re-sends the whole state, never a diff, and a consumer keeps one
   * value per kind. The server validated `payload` against the owning
   * plugin's declared `state` schema at ingest; a payload that failed that
   * check was persisted as `provider/unhandled` instead, so every stored row
   * of this type carries a payload its plugin vouched for.
   */
  z.object({
    type: z.literal("thread/extensionState/updated"),
    threadId: z.string(),
    providerThreadId: z.string(),
    kind: extensionKindSchema,
    payload: jsonValueSchema,
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

function isEventPropertyBag(value: unknown): value is Record<string, unknown> {
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
