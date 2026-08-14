/**
 * Claude Code event-translation core.
 *
 * Translates claude-code bridge notifications (the `sdk/message` envelope
 * around raw Claude Agent SDK `SDKMessage`s plus the bridge's own runtime
 * notifications) into bb thread events, and owns the per-thread turn state
 * that translation accumulates. The adapter instantiates one translator per
 * adapter instance; the claude-code bridge (a separate process entry)
 * instantiates the same translator per canonical session.
 */

/**
 * The per-event translation scope the runtime's generic adapter passes in. Its
 * `ProviderTranslationContext` satisfies this structurally; stated here so the
 * plugin does not depend on `@bb/agent-runtime`.
 */
export interface ProviderTranslationContext {
  threadId?: string;
  parentToolCallId?: string;
}
import {
  type ClaudeTaskToolOutput,
  type ProviderErrorInfo,
  type ProviderRateLimitState,
  type ProviderRateLimitStatus,
  type ThreadEvent,
  type ThreadEventItem,
  type ThreadEventTokenUsageBreakdown,
  claudeTaskToolNameSchema,
  claudeTaskToolOutputSchema,
  threadScope,
  turnScope,
  UNSTAMPED_THREAD_ID,
  bashArgsSchema,
  buildFileChangeItem,
  buildGenericToolCallItem,
  buildToolResultItem,
  buildUnhandledProviderEvents,
  completeStartedToolItem,
  createProviderTurnStateRegistry,
  createScopedItemIdFactory,
  createUnhandledProviderEvent,
  errorEnvelopeSchema,
  extractResultText,
  jsonRpcEnvelopeSchema,
  resolveProviderTerminalTurn,
  sdkMessageEnvelopeSchema,
  threadIdentityEnvelopeSchema,
  toOptionalRecord,
  toOptionalString,
  withParentToolCallId,
  type AcceptedUserMessageState,
  type EnsureProviderTurnStartedArgs,
  type JsonRpcMessage,
  type ProviderTurnStateRegistry,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  claudeApiRetryMessageSchema,
  claudeAssistantMessageSchema,
  claudeCompactBoundarySystemMessageSchema,
  claudeConversationResetMessageSchema,
  claudeFileEditArgsSchema,
  claudeModelFallbackSystemMessageSchema,
  claudeModelRefusalNoFallbackSystemMessageSchema,
  claudePermissionDeniedSystemMessageSchema,
  claudeRateLimitEventSchema,
  claudeResultMessageSchema,
  claudeSdkMessageTypeSchema,
  claudeStatusSystemMessageSchema,
  claudeStreamEventMessageSchema,
  claudeSystemMessageSchema,
  claudeUserMessageSchema,
  claudeWebFetchArgsSchema,
  claudeWebSearchArgsSchema,
  type ClaudeApiRetryMessage,
  type ClaudeAssistantMessage,
  type ClaudeFileEditArgs,
  type ClaudeRateLimitEvent,
  type ClaudeResultMessage,
  type ClaudeToolUseResult,
  type ClaudeWebFetchArgs,
  type ClaudeWebSearchArgs,
} from "./schemas.js";
import { buildClaudeProviderErrorInfo } from "./error-info.js";
import {
  hasCompletionBlockingClaudeTasks,
  hasOpenClaudeBackgroundTasks,
  translateClaudeTaskMessage,
  type ClaudeTaskMap,
} from "./task-translation.js";
import {
  extractAssistantText,
  extractClaudeCommandExecutionOutput,
  extractClaudeContextWindowUsage,
  extractClaudeRequestContextTokens,
  extractStreamTextDelta,
  extractStreamThinkingDelta,
  extractThinkingBlocks,
  extractTokenUsage,
  extractToolResults,
  extractToolUses,
  getNestedMessageId,
  getNestedParentToolUseId,
  resolveClaudeModelContextWindowHint,
} from "./sdk-extraction.js";
import { claudeCodeVisibilityMetadata } from "./visibility.js";

// ---------------------------------------------------------------------------
// Claude tool-item translation (moved verbatim from the adapter)
// ---------------------------------------------------------------------------

interface ClaudeBashCommand {
  command: string;
  cwd: string | null;
}

interface ClaudeNormalizedWebFetch {
  url: string;
  prompt: string | null;
}

export function parseClaudeBashCommand(
  input: unknown,
): ClaudeBashCommand | null {
  const parsed = bashArgsSchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }
  const command = toOptionalString(parsed.data.command);
  if (!command) {
    return null;
  }
  return {
    command,
    cwd: toOptionalString(parsed.data.cwd) ?? null,
  };
}

export function getClaudeFileEditPath(args: ClaudeFileEditArgs): string | null {
  return args.file_path ?? args.path ?? null;
}

function normalizeClaudeWebSearchArgs(
  args: ClaudeWebSearchArgs,
): string[] | null {
  const query = toOptionalString(args.query);
  if (!query) {
    return null;
  }
  return [query];
}

function normalizeClaudeWebFetchArgs(
  args: ClaudeWebFetchArgs,
): ClaudeNormalizedWebFetch | null {
  const url = toOptionalString(args.url);
  if (!url) {
    return null;
  }
  return {
    url,
    prompt: toOptionalString(args.prompt) ?? null,
  };
}

function translateClaudeToolUseItem(
  input: ClaudeToolUseTranslationInput,
): ThreadEventItem {
  const withParent = (item: ThreadEventItem): ThreadEventItem =>
    withParentToolCallId(item, input.parentToolCallId);
  const genericToolCall = (): ThreadEventItem =>
    withParent(buildGenericToolCallItem(input));

  if (CLAUDE_COMMAND_TOOL_NAMES.has(input.toolName)) {
    const command = parseClaudeBashCommand(input.args);
    return command
      ? withParent({
          type: "commandExecution",
          id: input.callId,
          command: command.command,
          cwd: command.cwd ?? "",
          status: "pending",
          approvalStatus: null,
        })
      : genericToolCall();
  }

  if (CLAUDE_FILE_CHANGE_TOOL_NAMES.has(input.toolName)) {
    const parsed = claudeFileEditArgsSchema.safeParse(input.args);
    if (!parsed.success) {
      return genericToolCall();
    }
    const path = getClaudeFileEditPath(parsed.data);
    if (!path) {
      return withParent({
        ...buildGenericToolCallItem(input),
        arguments: parsed.data,
      });
    }
    return withParent(
      buildFileChangeItem({
        callId: input.callId,
        path,
        oldText: parsed.data.old_string,
        newText: parsed.data.new_string ?? parsed.data.content,
      }),
    );
  }

  return withParent(
    translateClaudeWebToolUse(input) ?? buildGenericToolCallItem(input),
  );
}

const CLAUDE_COMMAND_TOOL_NAMES = new Set(["Bash"]);
const CLAUDE_FILE_CHANGE_TOOL_NAMES = new Set(["Edit", "Write"]);

function translateClaudeWebToolUse(
  input: ClaudeToolUseTranslationInput,
): ThreadEventItem | null {
  if (input.toolName === "WebSearch") {
    const parsed = claudeWebSearchArgsSchema.safeParse(input.args);
    const queries = parsed.success
      ? normalizeClaudeWebSearchArgs(parsed.data)
      : null;
    return queries
      ? {
          type: "webSearch",
          id: input.callId,
          queries,
          resultText: null,
        }
      : null;
  }
  if (input.toolName !== "WebFetch") {
    return null;
  }
  const parsed = claudeWebFetchArgsSchema.safeParse(input.args);
  const normalized = parsed.success
    ? normalizeClaudeWebFetchArgs(parsed.data)
    : null;
  return normalized
    ? {
        type: "webFetch",
        id: input.callId,
        url: normalized.url,
        prompt: normalized.prompt,
        pattern: null,
        resultText: null,
      }
    : null;
}

function parseClaudeTaskToolOutputValue(
  value: unknown,
): ClaudeTaskToolOutput | null {
  const parsed = claudeTaskToolOutputSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (typeof value !== "string") return null;
  try {
    const json: unknown = JSON.parse(value);
    const parsedJson = claudeTaskToolOutputSchema.safeParse(json);
    return parsedJson.success ? parsedJson.data : null;
  } catch {
    return null;
  }
}

function parseClaudeTaskToolOutput(
  args: ParseClaudeTaskToolOutputArgs,
): ClaudeTaskToolOutput | null {
  return (
    parseClaudeTaskToolOutputValue(args.content) ??
    parseClaudeTaskToolOutputValue(args.toolUseResult) ??
    parseClaudeTaskToolOutputValue(args.outputText)
  );
}

function translateClaudeToolResultItem(
  input: ClaudeToolResultTranslationInput,
): ThreadEventItem {
  const outputText =
    input.toolName === "Bash" || input.startedItem?.type === "commandExecution"
      ? extractClaudeCommandExecutionOutput({
          content: input.content,
          toolUseResult: input.toolUseResult,
        })
      : extractResultText(input.content);
  const resultToolName =
    input.startedItem?.type === "toolCall"
      ? input.startedItem.tool
      : input.toolName;
  const taskToolResult =
    resultToolName && claudeTaskToolNameSchema.safeParse(resultToolName).success
      ? parseClaudeTaskToolOutput({
          content: input.content,
          outputText,
          toolUseResult: input.toolUseResult,
        })
      : null;
  // Claude web items resolve on their tool result, so a started
  // webSearch/webFetch item is completed here rather than left open.
  if (
    input.startedItem?.type === "webSearch" ||
    input.startedItem?.type === "webFetch"
  ) {
    const completed = completeStartedToolItem({
      callId: input.callId,
      outputText,
      parentToolCallId: input.parentToolCallId,
      startedItem: input.startedItem,
      status: input.isError ? "failed" : "completed",
    });
    if (completed) {
      return completed;
    }
  }
  return buildToolResultItem({
    ...input,
    commandOutputText: outputText,
    commandToolNames: CLAUDE_COMMAND_TOOL_NAMES,
    fileChangeToolNames: CLAUDE_FILE_CHANGE_TOOL_NAMES,
    outputText,
    toolCallResult: taskToolResult ?? outputText,
  });
}

interface ParseClaudeTaskToolOutputArgs {
  content: unknown;
  outputText: string | undefined;
  toolUseResult: ClaudeToolUseResult | null;
}

interface ResolveClaudeInteractiveRequestTurnIdArgs {
  threadId: string;
  turnId: string | null;
}

// ---------------------------------------------------------------------------
// Turn state and message translation (moved verbatim from translate-message)
// ---------------------------------------------------------------------------

export interface ClaudeTurnState {
  assistantMessageCounter: number;
  counter: number;
  currentTurnId: string | undefined;
  cumulativeTokens: ThreadEventTokenUsageBreakdown;
  latestRequestContextTokens: number | undefined;
  latestProviderCheckpointId: string | undefined;
  lastModelFallback:
    | {
        fallbackModel: string;
        originalModel: string;
        turnId: string;
      }
    | undefined;
  openAssistantMessageIdsByScope: Map<string, string>;
  openScopedItemIdsByScope: Map<string, string>;
  /** Live monitor and future task types that do not create timeline rows. */
  opaqueTaskIds: Set<string>;
  pendingAcceptedUserMessages: AcceptedUserMessageState["pendingAcceptedUserMessages"];
  pendingHardRateLimitRejection:
    | {
        detail: string;
        turnId: string;
      }
    | undefined;
  scopedItemCounter: number;
  selectedModelContextWindow: number | null;
  /** Blocks unaccepted provider-only turn starts after a terminal failure. */
  suppressUnacceptedTurnStart: boolean;
  /**
   * Open context-compaction item for the turn it started in; status: null
   * (compaction finished) completes it. Cleared on use and guarded by turn id
   * so a stale entry can never complete under a later turn.
   */
  openCompaction: { itemId: string; turnId: string } | undefined;
  /**
   * Thread-lifetime background-task state. Deliberately NOT cleared by
   * clearTransientTurnState — tasks outlive turns — and it pins the thread's
   * registry entry against LRU eviction while any task is open.
   */
  tasksById: ClaudeTaskMap;
  toolItemsByCallId: Map<string, ThreadEventItem>;
}

export interface ClaudeToolUseTranslationInput {
  callId: string;
  toolName: string;
  args: unknown;
  parentToolCallId?: string;
}

export interface ClaudeToolResultTranslationInput {
  callId: string;
  toolName?: string;
  content: unknown;
  isError: boolean;
  parentToolCallId?: string;
  startedItem?: ThreadEventItem;
  toolUseResult: ClaudeToolUseResult | null;
}

export interface ClaudeUnexpectedSdkEventArgs {
  event: unknown;
  context?: ProviderTranslationContext;
  turnId?: string;
}

export interface TranslateClaudeSdkMessageArgs {
  buildUnexpectedSdkEvent: (
    args: ClaudeUnexpectedSdkEventArgs,
  ) => ThreadEvent[];
  context?: ProviderTranslationContext;
  ensureTurnStarted: (
    args: EnsureProviderTurnStartedArgs<ClaudeTurnState>,
  ) => string;
  event: unknown;
  translateToolResultItem: (
    input: ClaudeToolResultTranslationInput,
  ) => ThreadEventItem;
  translateToolUseItem: (
    input: ClaudeToolUseTranslationInput,
  ) => ThreadEventItem;
  turnState: ProviderTurnStateRegistry<ClaudeTurnState>;
}

interface BuildClaudeCompactedEventArgs {
  threadId: string;
  turnId: string;
}

interface BuildClaudeProviderErrorEventArgs {
  detail: string;
  errorInfo: ProviderErrorInfo | null;
  threadId: string;
  turnId: string | null;
  willRetry?: boolean;
}

const claudeResultFallbackErrorDetails: Record<string, string> = {
  error_during_execution: "Claude Code failed during execution.",
  error_max_budget_usd: "Claude Code exceeded the configured budget.",
  error_max_structured_output_retries:
    "Claude Code exhausted structured output retries.",
  error_max_turns: "Claude Code reached the maximum number of turns.",
};

const CLAUDE_SYNTHETIC_MODEL = "<synthetic>";
const CLAUDE_NO_RESPONSE_REQUESTED_TEXT = "No response requested.";
const CLAUDE_SYNTHETIC_ZERO_USAGE_KEYS = [
  "input_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
  "output_tokens",
] as const;

function hasClaudeAssistantErrorMarker(
  message: ClaudeAssistantMessage,
): boolean {
  const messageRecord = toOptionalRecord(message);
  return (
    messageRecord?.error !== undefined ||
    messageRecord?.isApiErrorMessage === true ||
    messageRecord?.apiErrorStatus !== undefined
  );
}

function hasClaudeZeroUsage(usage: unknown): boolean {
  const usageRecord = toOptionalRecord(usage);
  return (
    usageRecord !== undefined &&
    CLAUDE_SYNTHETIC_ZERO_USAGE_KEYS.every((key) => usageRecord[key] === 0)
  );
}

function isClaudeNoResponseRequestedSyntheticMessage(
  message: ClaudeAssistantMessage,
): boolean {
  const nestedMessage = toOptionalRecord(message.message);
  return (
    nestedMessage?.model === CLAUDE_SYNTHETIC_MODEL &&
    nestedMessage.role === "assistant" &&
    nestedMessage.stop_reason === "stop_sequence" &&
    nestedMessage.stop_sequence === "" &&
    !hasClaudeAssistantErrorMarker(message) &&
    hasClaudeZeroUsage(nestedMessage.usage) &&
    extractAssistantText(message) === CLAUDE_NO_RESPONSE_REQUESTED_TEXT
  );
}

interface ClaudeModelFallbackTransition {
  fallbackModel: string;
  originalModel: string;
}

function extractClaudeFallbackOnlyAssistantMessage(
  message: ClaudeAssistantMessage,
): ClaudeModelFallbackTransition | null {
  const nestedMessage = toOptionalRecord(message.message);
  const content = nestedMessage?.content;
  if (
    !Array.isArray(content) ||
    content.length === 0 ||
    !content.every((block) => toOptionalRecord(block)?.type === "fallback")
  ) {
    return null;
  }
  const block = toOptionalRecord(content[0]);
  const from = toOptionalRecord(block?.from);
  const to = toOptionalRecord(block?.to);
  const originalModel = from?.model;
  const fallbackModel = to?.model;
  if (
    typeof originalModel !== "string" ||
    originalModel.length === 0 ||
    typeof fallbackModel !== "string" ||
    fallbackModel.length === 0
  ) {
    return null;
  }
  return { fallbackModel, originalModel };
}

function isDuplicateClaudeModelFallback(
  state: ClaudeTurnState,
  transition: ClaudeModelFallbackTransition,
  turnId: string,
): boolean {
  return (
    state.lastModelFallback?.turnId === turnId &&
    state.lastModelFallback.originalModel === transition.originalModel &&
    state.lastModelFallback.fallbackModel === transition.fallbackModel
  );
}

function buildClaudeProviderErrorEvent(
  args: BuildClaudeProviderErrorEventArgs,
): ThreadEvent {
  return {
    type: "provider/error",
    threadId: args.threadId,
    providerThreadId: "",
    scope: args.turnId ? turnScope(args.turnId) : threadScope(),
    message: "Provider error",
    detail: args.detail,
    ...(args.errorInfo ? { errorInfo: args.errorInfo } : {}),
    ...(args.willRetry !== undefined ? { willRetry: args.willRetry } : {}),
  };
}

function buildClaudeCompactedEvent(
  args: BuildClaudeCompactedEventArgs,
): ThreadEvent {
  return {
    type: "thread/compacted",
    threadId: args.threadId,
    providerThreadId: "",
    scope: turnScope(args.turnId),
  };
}

function buildClaudeApiRetryDetail(message: ClaudeApiRetryMessage): string {
  const status =
    message.error_status !== null ? ` HTTP ${message.error_status}` : "";
  return `Claude Code API retry ${message.attempt}/${message.max_retries} after ${message.retry_delay_ms}ms:${status} ${message.error}`;
}

function buildClaudeRateLimitEventDetail(
  message: ClaudeRateLimitEvent,
): string {
  const info = message.rate_limit_info;
  const details: string[] = ["Claude Code rate limit rejected"];
  if (info.rateLimitType) {
    details.push(`type ${info.rateLimitType}`);
  }
  if (info.resetsAt !== undefined) {
    details.push(`resetsAt ${info.resetsAt}`);
  }
  if (info.overageStatus) {
    details.push(`overage ${info.overageStatus}`);
  }
  if (info.overageDisabledReason) {
    details.push(`overage disabled: ${info.overageDisabledReason}`);
  }
  return details.join("; ");
}

function normalizeClaudeRateLimitStatus(
  status: string,
): ProviderRateLimitStatus {
  switch (status) {
    case "allowed":
      return "allowed";
    case "allowed_warning":
      return "warning";
    case "rejected":
      return "blocked";
    default:
      return "unknown";
  }
}

function claudeRateLimitLabel(providerKey: string | undefined): string | null {
  switch (providerKey) {
    case "five_hour":
      return "Five-hour limit";
    case "seven_day":
      return "Weekly limit";
    case "seven_day_opus":
      return "Weekly Opus limit";
    case "seven_day_sonnet":
      return "Weekly Sonnet limit";
    case "seven_day_overage_included":
      return "Weekly included overage";
    case "overage":
      return "Overage";
    default:
      return null;
  }
}

function normalizeClaudeOverageStatus(
  status: string | undefined,
): ProviderRateLimitState["overageStatus"] {
  switch (status) {
    case undefined:
      return null;
    case "allowed":
      return "allowed";
    case "allowed_warning":
      return "warning";
    case "rejected":
      return "rejected";
    default:
      return "unavailable";
  }
}

function normalizeClaudeRateLimits(
  message: ClaudeRateLimitEvent,
): ProviderRateLimitState {
  const info = message.rate_limit_info;
  const windowStatus = normalizeClaudeRateLimitStatus(info.status);
  const overageStatus = normalizeClaudeOverageStatus(info.overageStatus);
  const status =
    windowStatus === "blocked" && overageStatus === "allowed"
      ? "allowed"
      : windowStatus === "blocked" && overageStatus === "warning"
        ? "warning"
        : windowStatus;
  const providerKey = info.rateLimitType ?? null;

  return {
    providerId: "claude-code",
    status,
    kind:
      providerKey === "overage"
        ? "credits"
        : providerKey === null
          ? "unknown"
          : "subscription-window",
    windows: [
      {
        providerKey,
        label: claudeRateLimitLabel(info.rateLimitType),
        status: windowStatus,
        resetsAtMs: info.resetsAt === undefined ? null : info.resetsAt * 1_000,
      },
    ],
    reachedReason:
      windowStatus === "blocked"
        ? (info.rateLimitType ?? "rate_limit_rejected")
        : null,
    overageStatus,
    overageReason: info.overageDisabledReason ?? null,
  };
}

function isHardClaudeRateLimitRejection(
  message: ClaudeRateLimitEvent,
): boolean {
  const info = message.rate_limit_info;
  if (info.status !== "rejected") {
    return false;
  }
  return (
    info.overageStatus !== "allowed" && info.overageStatus !== "allowed_warning"
  );
}

function isClaudeResultFailure(message: ClaudeResultMessage): boolean {
  return message.is_error === true || message.subtype.startsWith("error");
}

function getClaudeResultErrorDetail(message: ClaudeResultMessage): string {
  if (message.is_error && typeof message.result === "string") {
    return message.result;
  }

  const errors = (message.errors ?? [])
    .map((error) => error.trim())
    .filter((error) => error.length > 0);
  if (errors.length > 0) {
    return errors.join("\n");
  }

  return (
    claudeResultFallbackErrorDetails[message.subtype] ??
    `Claude Code result failed: ${message.subtype}`
  );
}

function resolveClaudeActiveTurnId(
  args: Pick<TranslateClaudeSdkMessageArgs, "context" | "turnState">,
): string | undefined {
  if (!args.context?.threadId) {
    return undefined;
  }
  return args.turnState.get({ threadId: args.context.threadId })?.currentTurnId;
}

// ---------------------------------------------------------------------------
// Translator factory
// ---------------------------------------------------------------------------

export interface CreateClaudeEventTranslatorOptions {
  /** Provider id stamped onto unhandled-event envelopes. */
  providerId: string;
  /** Prefix for bb-owned turn ids emitted by this translator instance. */
  turnIdPrefix?: string;
  /**
   * Prefix for bb-owned assistant/reasoning/compaction item ids. The bridge
   * builds one translator per session, which restarts the
   * "claude-assistant-N" counters on resume, so it injects per-session
   * entropy here — a bare counter is the #1224 cross-resume collision.
   */
  itemIdPrefix?: string;
  /**
   * Emit a synthetic `item/started` when an assistant-message or reasoning
   * item opens delta-first. Claude streams bare `stream_event` deltas; the
   * canonical event grammar requires every item's first event to be
   * `item/started`, so the bridge opts in (the projection backfill covers
   * persisted history recorded before it did).
   */
  synthesizeItemStarted?: boolean;
}

export function createClaudeEventTranslator(
  options: CreateClaudeEventTranslatorOptions,
) {
  const assistantIdPrefix =
    options.itemIdPrefix === undefined
      ? "claude-assistant"
      : `${options.itemIdPrefix}assistant`;
  const claudeCompactionItemIds = createScopedItemIdFactory({
    prefix:
      options.itemIdPrefix === undefined
        ? "claude-compaction"
        : `${options.itemIdPrefix}compaction`,
  });
  const claudeReasoningItemIds = createScopedItemIdFactory({
    prefix:
      options.itemIdPrefix === undefined
        ? "claude-reasoning"
        : `${options.itemIdPrefix}reasoning`,
  });

  const turnState = createProviderTurnStateRegistry<ClaudeTurnState>({
    createState: () => ({
      assistantMessageCounter: 0,
      counter: 0,
      currentTurnId: undefined,
      cumulativeTokens: {
        totalTokens: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      latestRequestContextTokens: undefined,
      latestProviderCheckpointId: undefined,
      lastModelFallback: undefined,
      openAssistantMessageIdsByScope: new Map(),
      openCompaction: undefined,
      openScopedItemIdsByScope: new Map(),
      opaqueTaskIds: new Set(),
      pendingAcceptedUserMessages: [],
      pendingHardRateLimitRejection: undefined,
      scopedItemCounter: 0,
      selectedModelContextWindow: null,
      suppressUnacceptedTurnStart: false,
      tasksById: new Map(),
      toolItemsByCallId: new Map(),
    }),
    // An idle thread with a running workflow must keep its task state — LRU
    // eviction would orphan the open backgroundTask items.
    isEvictable: (state) =>
      !hasOpenClaudeBackgroundTasks(state.tasksById) &&
      state.opaqueTaskIds.size === 0,
    onTurnStart: ({ state }) => {
      state.suppressUnacceptedTurnStart = false;
      state.latestRequestContextTokens = undefined;
      state.latestProviderCheckpointId = undefined;
      state.pendingHardRateLimitRejection = undefined;
    },
    onTurnFinish: ({ state }) => {
      state.pendingHardRateLimitRejection = undefined;
    },
    turnIdPrefix: options.turnIdPrefix,
  });

  function setClaudeModelContextWindowHint(
    threadId: string,
    model: string,
  ): void {
    const state = turnState.getOrCreate({ threadId });
    state.selectedModelContextWindow =
      resolveClaudeModelContextWindowHint(model);
  }

  function resolveClaudeInteractiveRequestTurnId(
    args: ResolveClaudeInteractiveRequestTurnIdArgs,
  ): string | null {
    if (args.turnId !== null) {
      return args.turnId;
    }

    const state = turnState.get({ threadId: args.threadId });
    if (state === null) {
      return null;
    }
    const currentTurnId = turnState.getCurrentOrLastTurnId({ state });
    return currentTurnId.length > 0 ? currentTurnId : null;
  }

  function resolveClaudeActiveTurnIdForContext(
    context?: ProviderTranslationContext,
  ): string | undefined {
    if (!context?.threadId) {
      return undefined;
    }
    return turnState.get({ threadId: context.threadId })?.currentTurnId;
  }

  function isClaudeProviderTurnStartSuppressed(
    state: ClaudeTurnState,
  ): boolean {
    return (
      state.suppressUnacceptedTurnStart &&
      state.currentTurnId === undefined &&
      state.pendingAcceptedUserMessages.length === 0
    );
  }

  function buildUnexpectedClaudeSdkEvent(
    args: ClaudeUnexpectedSdkEventArgs,
  ): ThreadEvent[] {
    const rawEvent: JsonRpcMessage = {
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        ...(args.context?.threadId ? { threadId: args.context.threadId } : {}),
        message: args.event,
      },
    };
    return [
      createUnhandledProviderEvent({
        providerId: options.providerId,
        rawEvent,
        rawType: claudeCodeVisibilityMetadata.describeRawEvent(rawEvent).kind,
        ...(args.turnId ? { turnId: args.turnId } : {}),
        ...(args.context?.parentToolCallId
          ? { parentToolCallId: args.context.parentToolCallId }
          : {}),
      }),
    ];
  }

  function translateClaudeSdkMessage(
    args: TranslateClaudeSdkMessageArgs,
  ): ThreadEvent[] {
    const messageType = claudeSdkMessageTypeSchema.safeParse(args.event);
    if (!messageType.success) {
      return [];
    }

    const threadId = UNSTAMPED_THREAD_ID;
    const events: ThreadEvent[] = [];
    const stateKey = args.context?.threadId ?? "";
    const state = args.turnState.getOrCreate({ threadId: stateKey });
    const parentToolCallId = args.context?.parentToolCallId;
    const fallbackTurnId = resolveClaudeActiveTurnId(args);

    switch (messageType.data.type) {
      case "conversation_reset": {
        const parsedMessage = claudeConversationResetMessageSchema.safeParse(
          args.event,
        );
        if (!parsedMessage.success) {
          return args.buildUnexpectedSdkEvent({
            event: args.event,
            context: args.context,
            turnId: fallbackTurnId,
          });
        }
        if (isClaudeProviderTurnStartSuppressed(state)) {
          return [];
        }
        const turnId = args.ensureTurnStarted({
          events,
          state,
          threadId,
        });
        events.push({
          type: "thread/context/cleared",
          threadId,
          providerThreadId: "",
          scope: turnScope(turnId),
        });
        return events;
      }

      case "system": {
        const parsedMessage = claudeSystemMessageSchema.safeParse(args.event);
        if (!parsedMessage.success) {
          return args.buildUnexpectedSdkEvent({
            event: args.event,
            context: args.context,
            turnId: fallbackTurnId,
          });
        }
        const apiRetryMessage = claudeApiRetryMessageSchema.safeParse(
          args.event,
        );
        if (apiRetryMessage.success) {
          const turnStartSuppressed =
            isClaudeProviderTurnStartSuppressed(state);
          const turnId =
            state.currentTurnId ??
            (turnStartSuppressed
              ? null
              : args.ensureTurnStarted({
                  events,
                  state,
                  threadId,
                }));
          events.push(
            buildClaudeProviderErrorEvent({
              detail: buildClaudeApiRetryDetail(apiRetryMessage.data),
              errorInfo: buildClaudeProviderErrorInfo({
                code: apiRetryMessage.data.error,
                httpStatusCode: apiRetryMessage.data.error_status,
              }),
              threadId,
              turnId,
              willRetry: true,
            }),
          );
          return events;
        }
        const statusMessage = claudeStatusSystemMessageSchema.safeParse(
          args.event,
        );
        if (
          statusMessage.success &&
          statusMessage.data.status === "compacting"
        ) {
          if (isClaudeProviderTurnStartSuppressed(state)) {
            return [];
          }
          const turnId = args.ensureTurnStarted({
            events,
            state,
            threadId,
          });
          const compactionItemId = claudeCompactionItemIds.createId(turnId);
          state.openCompaction = { itemId: compactionItemId, turnId };
          events.push({
            type: "item/started",
            threadId,
            providerThreadId: "",
            scope: turnScope(turnId),
            item: {
              type: "contextCompaction",
              id: compactionItemId,
            },
          });
          return events;
        }
        if (statusMessage.success) {
          // Any non-compacting status (null = cleared) ends an open compaction;
          // without this the contextCompaction item dangles as pending forever.
          const openCompaction = state.openCompaction;
          state.openCompaction = undefined;
          if (openCompaction && state.currentTurnId === openCompaction.turnId) {
            events.push({
              type: "item/completed",
              threadId,
              providerThreadId: "",
              scope: turnScope(openCompaction.turnId),
              item: {
                type: "contextCompaction",
                id: openCompaction.itemId,
              },
            });
          }
          return events;
        }

        const compactBoundaryMessage =
          claudeCompactBoundarySystemMessageSchema.safeParse(args.event);
        if (compactBoundaryMessage.success) {
          const turnId = args.turnState.getCurrentOrLastTurnId({ state });
          if (turnId.length === 0) {
            return args.buildUnexpectedSdkEvent({
              event: args.event,
              context: args.context,
              turnId: fallbackTurnId,
            });
          }
          events.push(buildClaudeCompactedEvent({ threadId, turnId }));
          return events;
        }

        const modelFallbackMessage =
          claudeModelFallbackSystemMessageSchema.safeParse(args.event);
        if (modelFallbackMessage.success) {
          const message = modelFallbackMessage.data;
          const turnId = args.turnState.getCurrentOrLastTurnId({ state });
          const transition = {
            originalModel: message.original_model,
            fallbackModel: message.fallback_model,
          };
          if (
            turnId.length > 0 &&
            isDuplicateClaudeModelFallback(state, transition, turnId)
          ) {
            return events;
          }
          if (turnId.length > 0) {
            state.lastModelFallback = { ...transition, turnId };
          }
          events.push({
            type: "provider/modelFallback",
            threadId,
            providerThreadId: "",
            scope: turnId.length > 0 ? turnScope(turnId) : threadScope(),
            originalModel: transition.originalModel,
            fallbackModel: transition.fallbackModel,
            reason:
              message.subtype === "model_refusal_fallback"
                ? "refusal"
                : "provider",
            message:
              message.content ??
              `Switched from ${message.original_model} to ${message.fallback_model}.`,
          });
          return events;
        }

        const noFallbackMessage =
          claudeModelRefusalNoFallbackSystemMessageSchema.safeParse(args.event);
        if (noFallbackMessage.success) {
          events.push({
            type: "provider/warning",
            threadId,
            providerThreadId: "",
            scope: state.currentTurnId
              ? turnScope(state.currentTurnId)
              : threadScope(),
            category: "general",
            summary: "Model refused the request",
            details:
              noFallbackMessage.data.content ??
              "The selected model refused the request and no fallback model was available.",
          });
          return events;
        }

        const permissionDeniedMessage =
          claudePermissionDeniedSystemMessageSchema.safeParse(args.event);
        if (permissionDeniedMessage.success) {
          const message = permissionDeniedMessage.data;
          const reason = message.decision_reason ?? message.message;
          events.push({
            type: "provider/warning",
            threadId,
            providerThreadId: "",
            scope: state.currentTurnId
              ? turnScope(state.currentTurnId)
              : threadScope(),
            category: "general",
            summary: `${message.tool_name} was denied automatically`,
            details: message.decision_reason_type
              ? `${reason} (${message.decision_reason_type})`
              : reason,
          });
          return events;
        }

        const taskEvents = translateClaudeTaskMessage({
          ensureTurnStarted: () =>
            isClaudeProviderTurnStartSuppressed(state)
              ? undefined
              : args.ensureTurnStarted({ events, state, threadId }),
          event: args.event,
          now: Date.now(),
          opaqueTaskIds: state.opaqueTaskIds,
          tasks: state.tasksById,
          threadId,
        });
        if (taskEvents !== null) {
          events.push(...taskEvents);
          return events;
        }

        return [];
      }

      case "assistant": {
        const parsedMessage = claudeAssistantMessageSchema.safeParse(
          args.event,
        );
        if (!parsedMessage.success) {
          return args.buildUnexpectedSdkEvent({
            event: args.event,
            context: args.context,
            turnId: fallbackTurnId,
          });
        }
        const message = parsedMessage.data;
        if (isClaudeProviderTurnStartSuppressed(state)) {
          return [];
        }
        // Sidechain assistant messages belong to subagents/tools, not the root
        // conversation lineage that thread/fork can retain through.
        const providerCheckpointId =
          parentToolCallId === undefined ? message.uuid : undefined;
        // Claude sends this model transition before it begins streaming from the
        // fallback model. Its richer system/model_* duplicate arrives only after
        // the response, so emit now and deduplicate that later event.
        const fallbackTransition =
          extractClaudeFallbackOnlyAssistantMessage(message);
        if (fallbackTransition !== null) {
          const turnId = args.ensureTurnStarted({ events, state, threadId });
          if (providerCheckpointId !== undefined) {
            state.latestProviderCheckpointId = providerCheckpointId;
          }
          if (
            !isDuplicateClaudeModelFallback(state, fallbackTransition, turnId)
          ) {
            state.lastModelFallback = { ...fallbackTransition, turnId };
            events.push({
              type: "provider/modelFallback",
              threadId,
              providerThreadId: "",
              scope: turnScope(turnId),
              originalModel: fallbackTransition.originalModel,
              fallbackModel: fallbackTransition.fallbackModel,
              reason: "provider",
              message: `Switched from ${fallbackTransition.originalModel} to ${fallbackTransition.fallbackModel}.`,
            });
          }
          return events;
        }
        if (isClaudeNoResponseRequestedSyntheticMessage(message)) {
          const turnId =
            state.currentTurnId ??
            (state.pendingAcceptedUserMessages.length > 0
              ? args.ensureTurnStarted({
                  events,
                  state,
                  threadId,
                })
              : undefined);
          if (!turnId) {
            return [];
          }
          if (providerCheckpointId !== undefined) {
            state.latestProviderCheckpointId = providerCheckpointId;
          }
          if (hasCompletionBlockingClaudeTasks(state.tasksById)) {
            return events;
          }
          events.push({
            type: "turn/completed",
            threadId,
            providerThreadId: "",
            scope: turnScope(turnId),
            status: "completed",
            ...(state.latestProviderCheckpointId !== undefined
              ? {
                  providerCheckpointId: state.latestProviderCheckpointId,
                }
              : {}),
          });
          args.turnState.finishTurn({ state, threadId: stateKey });
          return events;
        }
        const turnId = args.ensureTurnStarted({
          events,
          state,
          threadId,
        });
        if (providerCheckpointId !== undefined) {
          state.latestProviderCheckpointId = providerCheckpointId;
        }
        const requestContextTokens = extractClaudeRequestContextTokens(message);
        if (requestContextTokens !== null) {
          state.latestRequestContextTokens = requestContextTokens;
        }
        const assistantMessageId = getNestedMessageId(message.message);

        const thinkingBlocks = extractThinkingBlocks(message);
        for (const thinkingBlock of thinkingBlocks) {
          const itemId = claudeReasoningItemIds.resolveCompleted({
            state,
            parentToolCallId,
            scopeId: thinkingBlock.contentIndex,
          });
          events.push({
            type: "item/completed",
            threadId,
            providerThreadId: "",
            scope: turnScope(turnId),
            item: withParentToolCallId(
              {
                type: "reasoning",
                id: itemId,
                summary: [],
                content: [thinkingBlock.text],
              },
              parentToolCallId,
            ),
          });
        }

        const text = extractAssistantText(message);
        if (text) {
          const itemId = args.turnState.resolveCompletedAssistantMessageId({
            assistantIdPrefix,
            state,
            parentToolCallId,
            providerMessageId: assistantMessageId,
          });
          events.push({
            type: "item/completed",
            threadId,
            providerThreadId: "",
            scope: turnScope(turnId),
            item: {
              type: "agentMessage",
              id: itemId,
              text,
              ...(parentToolCallId ? { parentToolCallId } : {}),
            },
          });
        }

        const toolUses = extractToolUses(message);
        for (const toolUse of toolUses) {
          const item = args.translateToolUseItem({
            callId: toolUse.id,
            toolName: toolUse.name,
            args: toolUse.input,
            parentToolCallId,
          });
          state.toolItemsByCallId.set(toolUse.id, item);
          events.push({
            type: "item/started",
            threadId,
            providerThreadId: "",
            scope: turnScope(turnId),
            item,
          });
        }
        break;
      }

      case "stream_event": {
        const parsedMessage = claudeStreamEventMessageSchema.safeParse(
          args.event,
        );
        if (!parsedMessage.success) {
          return args.buildUnexpectedSdkEvent({
            event: args.event,
            context: args.context,
            turnId: fallbackTurnId,
          });
        }
        const message = parsedMessage.data;
        if (isClaudeProviderTurnStartSuppressed(state)) {
          return [];
        }
        const reasoningDelta = extractStreamThinkingDelta(message);
        if (reasoningDelta) {
          const turnId = args.ensureTurnStarted({
            events,
            state,
            threadId,
          });
          const opensItem = !state.openScopedItemIdsByScope.has(
            `${parentToolCallId ?? "root"}:${reasoningDelta.contentIndex}`,
          );
          const itemId = claudeReasoningItemIds.getOrCreate({
            state,
            parentToolCallId,
            scopeId: reasoningDelta.contentIndex,
          });
          if (opensItem && options.synthesizeItemStarted === true) {
            events.push({
              type: "item/started",
              threadId,
              providerThreadId: "",
              scope: turnScope(turnId),
              item: withParentToolCallId(
                { type: "reasoning", id: itemId, summary: [], content: [] },
                parentToolCallId,
              ),
            });
          }
          events.push({
            type: "item/reasoning/textDelta",
            threadId,
            providerThreadId: "",
            scope: turnScope(turnId),
            itemId,
            delta: reasoningDelta.delta,
            ...(parentToolCallId ? { parentToolCallId } : {}),
          });
        }

        const textDelta = extractStreamTextDelta(message);
        if (textDelta) {
          const turnId = args.ensureTurnStarted({
            events,
            state,
            threadId,
          });
          const opensItem = !state.openAssistantMessageIdsByScope.has(
            `${parentToolCallId ?? "root"}:assistant`,
          );
          const itemId = args.turnState.getOrCreateAssistantMessageId({
            assistantIdPrefix,
            parentToolCallId,
            state,
          });
          if (opensItem && options.synthesizeItemStarted === true) {
            events.push({
              type: "item/started",
              threadId,
              providerThreadId: "",
              scope: turnScope(turnId),
              item: withParentToolCallId(
                { type: "agentMessage", id: itemId, text: "" },
                parentToolCallId,
              ),
            });
          }
          events.push({
            type: "item/agentMessage/delta",
            threadId,
            providerThreadId: "",
            scope: turnScope(turnId),
            itemId,
            delta: textDelta.delta,
            ...(parentToolCallId ? { parentToolCallId } : {}),
          });
        }
        break;
      }

      case "user": {
        const parsedMessage = claudeUserMessageSchema.safeParse(args.event);
        if (!parsedMessage.success) {
          return args.buildUnexpectedSdkEvent({
            event: args.event,
            context: args.context,
            turnId: fallbackTurnId,
          });
        }
        const message = parsedMessage.data;
        const toolResults = extractToolResults(message);
        if (toolResults.length === 0) {
          break;
        }
        const toolResultTurnId = state.currentTurnId;
        if (!toolResultTurnId) {
          return args.buildUnexpectedSdkEvent({
            event: args.event,
            context: args.context,
            turnId: fallbackTurnId,
          });
        }
        for (const result of toolResults) {
          const startedItem = state.toolItemsByCallId.get(result.toolUseId);
          events.push({
            type: "item/completed",
            threadId,
            providerThreadId: "",
            scope: turnScope(toolResultTurnId),
            item: args.translateToolResultItem({
              callId: result.toolUseId,
              content: result.content,
              isError: result.isError,
              toolName: result.toolName,
              toolUseResult: result.toolUseResult,
              startedItem,
              parentToolCallId,
            }),
          });
          state.toolItemsByCallId.delete(result.toolUseId);
        }
        break;
      }

      case "result": {
        const parsedMessage = claudeResultMessageSchema.safeParse(args.event);
        if (!parsedMessage.success) {
          return args.buildUnexpectedSdkEvent({
            event: args.event,
            context: args.context,
            turnId: fallbackTurnId,
          });
        }
        const message = parsedMessage.data;
        const turnId = resolveProviderTerminalTurn({
          events,
          registry: args.turnState,
          state,
          threadId,
        });
        if (turnId) {
          const contextWindowUsage = extractClaudeContextWindowUsage({
            fallbackModelContextWindow: state.selectedModelContextWindow,
            latestRequestContextTokens: state.latestRequestContextTokens,
            message,
          });
          if (
            contextWindowUsage !== undefined &&
            contextWindowUsage.modelContextWindow !== null
          ) {
            state.selectedModelContextWindow =
              contextWindowUsage.modelContextWindow;
          }
          const tokenUsage = extractTokenUsage(message, state.cumulativeTokens);
          if (contextWindowUsage) {
            events.push({
              type: "thread/contextWindowUsage/updated",
              threadId,
              providerThreadId: "",
              scope: turnScope(turnId),
              contextWindowUsage,
            });
          }
          if (tokenUsage) {
            events.push({
              type: "thread/tokenUsage/updated",
              threadId,
              providerThreadId: "",
              scope: turnScope(turnId),
              tokenUsage,
            });
          }
          const pendingHardRateLimitRejection =
            state.pendingHardRateLimitRejection?.turnId === state.currentTurnId
              ? state.pendingHardRateLimitRejection
              : undefined;
          const resultFailed = isClaudeResultFailure(message);
          const failed =
            resultFailed || pendingHardRateLimitRejection !== undefined;
          if (failed) {
            const resultErrorInfo = buildClaudeProviderErrorInfo({
              httpStatusCode: message.api_error_status,
              resultSubtype: message.subtype,
            });
            events.push(
              buildClaudeProviderErrorEvent({
                detail: resultFailed
                  ? getClaudeResultErrorDetail(message)
                  : (pendingHardRateLimitRejection?.detail ??
                    getClaudeResultErrorDetail(message)),
                errorInfo:
                  pendingHardRateLimitRejection === undefined
                    ? resultErrorInfo
                    : {
                        category: "rate-limit",
                        providerCode:
                          resultErrorInfo?.providerCode ?? "rate_limit_event",
                        httpStatusCode: resultErrorInfo?.httpStatusCode ?? null,
                      },
                threadId,
                turnId,
              }),
            );
          }
          state.pendingHardRateLimitRejection = undefined;
          // Claude emits a successful result at the end of each SDK loop
          // segment. Background agents and workflows notify the CLI when they
          // settle, which reinvokes the parent model. Keep the logical bb turn
          // open across those segments so idle status, waiters, queued messages,
          // pruning, and parent completion notifications only observe the final
          // result. Failures still close immediately.
          if (!failed && hasCompletionBlockingClaudeTasks(state.tasksById)) {
            break;
          }
          events.push({
            type: "turn/completed",
            threadId,
            providerThreadId: "",
            scope: turnScope(turnId),
            status: failed ? "failed" : "completed",
            ...(state.latestProviderCheckpointId !== undefined
              ? {
                  providerCheckpointId: state.latestProviderCheckpointId,
                }
              : {}),
          });
          state.suppressUnacceptedTurnStart = failed;
          args.turnState.finishTurn({ state, threadId: stateKey });
        }
        break;
      }

      case "rate_limit_event": {
        const parsedMessage = claudeRateLimitEventSchema.safeParse(args.event);
        if (!parsedMessage.success) {
          return args.buildUnexpectedSdkEvent({
            event: args.event,
            context: args.context,
            turnId: fallbackTurnId,
          });
        }
        const message = parsedMessage.data;
        const rateLimitsEvent: ThreadEvent = {
          type: "provider/rateLimits/updated",
          threadId,
          providerThreadId: "",
          scope: threadScope(),
          rateLimits: normalizeClaudeRateLimits(message),
        };
        if (!isHardClaudeRateLimitRejection(message)) {
          events.push(rateLimitsEvent);
          if (
            rateLimitsEvent.rateLimits.status === "allowed" &&
            state.pendingHardRateLimitRejection?.turnId === state.currentTurnId
          ) {
            state.pendingHardRateLimitRejection = undefined;
          }
          return events;
        }
        if (isClaudeProviderTurnStartSuppressed(state)) {
          events.push(rateLimitsEvent);
          return events;
        }
        const turnId = args.ensureTurnStarted({ events, state, threadId });
        events.push(rateLimitsEvent);
        state.pendingHardRateLimitRejection = {
          detail: buildClaudeRateLimitEventDetail(message),
          turnId,
        };
        return events;
      }
    }

    return events;
  }

  function translateClaudeEvent(
    event: unknown,
    context?: ProviderTranslationContext,
  ): ThreadEvent[] {
    const sdkEnvelope = sdkMessageEnvelopeSchema.safeParse(event);
    if (sdkEnvelope.success) {
      const sdkMessage = sdkEnvelope.data.params.message;
      const nestedParentToolCallId = getNestedParentToolUseId(sdkMessage);
      const parentToolCallId = nestedParentToolCallId
        ? nestedParentToolCallId
        : (sdkEnvelope.data.params.parent_tool_use_id ??
          context?.parentToolCallId);
      const translated = translateClaudeEvent(sdkMessage, {
        ...context,
        ...(parentToolCallId ? { parentToolCallId } : {}),
      });
      const fallbackTurnId = resolveClaudeActiveTurnIdForContext(context);
      return translated.length > 0
        ? translated
        : buildUnhandledProviderEvents({
            providerId: options.providerId,
            rawEvent: {
              jsonrpc: "2.0",
              method: sdkEnvelope.data.method,
              params: sdkEnvelope.data.params,
            },
            visibilityMetadata: claudeCodeVisibilityMetadata,
            ...(fallbackTurnId ? { turnId: fallbackTurnId } : {}),
            ...(parentToolCallId ? { parentToolCallId } : {}),
          });
    }

    const identityEnvelope = threadIdentityEnvelopeSchema.safeParse(event);
    if (identityEnvelope.success) {
      const { threadId = UNSTAMPED_THREAD_ID, providerThreadId } =
        identityEnvelope.data.params;
      return providerThreadId
        ? [
            {
              type: "thread/identity",
              threadId,
              providerThreadId,
              scope: threadScope(),
            },
          ]
        : [];
    }

    const errorEnvelope = errorEnvelopeSchema.safeParse(event);
    if (errorEnvelope.success) {
      const state = context?.threadId
        ? turnState.get({ threadId: context.threadId })
        : null;
      if (state && isClaudeProviderTurnStartSuppressed(state)) {
        return [];
      }
      return turnState.buildErrorEvents({
        contextThreadId: context?.threadId,
        detail: errorEnvelope.data.params?.message ?? "unknown error",
      });
    }

    const envelope = jsonRpcEnvelopeSchema.safeParse(event);
    if (envelope.success) {
      const fallbackTurnId = resolveClaudeActiveTurnIdForContext(context);
      return buildUnhandledProviderEvents({
        providerId: options.providerId,
        rawEvent: {
          jsonrpc: "2.0",
          method: envelope.data.method,
          ...(envelope.data.params ? { params: envelope.data.params } : {}),
        },
        visibilityMetadata: claudeCodeVisibilityMetadata,
        ...(fallbackTurnId ? { turnId: fallbackTurnId } : {}),
        ...(context?.parentToolCallId
          ? { parentToolCallId: context.parentToolCallId }
          : {}),
      });
    }

    return translateClaudeSdkMessage({
      buildUnexpectedSdkEvent: buildUnexpectedClaudeSdkEvent,
      context,
      ensureTurnStarted: turnState.ensureTurnStarted,
      event,
      translateToolResultItem: translateClaudeToolResultItem,
      translateToolUseItem: translateClaudeToolUseItem,
      turnState,
    });
  }

  function resolveState(context?: ProviderTranslationContext): ClaudeTurnState {
    return turnState.getOrCreate({ threadId: context?.threadId ?? "" });
  }

  return {
    resolveClaudeInteractiveRequestTurnId,
    resolveState,
    setClaudeModelContextWindowHint,
    translateClaudeEvent,
    turnState,
  };
}

export type ClaudeEventTranslator = ReturnType<
  typeof createClaudeEventTranslator
>;
