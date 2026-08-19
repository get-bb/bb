/**
 * Claude Code dialect parsing → narrow-grammar deltas.
 *
 * Translates claude-code bridge notifications (the `sdk/message` envelope
 * around raw Claude Agent SDK `SDKMessage`s plus the bridge's own runtime
 * notifications) into `thread/delta` semantic deltas. Everything
 * timeline-shaped — turn/item ids, accepted-input correlation, pairing,
 * settlement, stream accumulation, usage accumulation, progress throttling —
 * is the runtime delta assembler's job. This module owns the claude dialect:
 *
 * - schema narrowing and tool classification (Bash → command, Edit/Write →
 *   fileChange, WebSearch/WebFetch → web items, else tool);
 * - the started-tool shape cache (tool results arrive inside USER messages
 *   without the call's args, and `item.close` must carry the full terminal
 *   shape);
 * - the background-task machine (workflow fold, generations, opaque tasks,
 *   the completion-blocking rule that WITHHOLDS `turn.boundary` while
 *   blocking tasks are open, and the interruption drain);
 * - terminal-turn conclusions on `result` (context window, usage, the armed
 *   hard rate-limit rejection, the root-lineage checkpoint latch);
 * - model-fallback cross-message dedup and the compaction stale-turn guard.
 *
 * Because the bridge no longer holds bb turn ids, those per-turn decisions
 * key off a small deterministic MIRROR of the assembler's current-turn
 * machine: the bridge emits every turn-affecting delta itself (`turn.open`,
 * `turn.boundary`, `input.accepted`, settling errors), so it can replay the
 * assembler's open/close/pending-input transitions locally and number the
 * turn segments. `segment` identifies the current-or-last turn exactly where
 * the old translator compared bb turn ids.
 */

import {
  type DeltaItemShape,
  type DeltaNoTurnFallback,
  type JsonRpcMessage,
  type ProviderRateLimitState,
  type ProviderRateLimitStatus,
  type ProviderRuntimeEvent,
  type ThreadDelta,
  claudeTaskToolNameSchema,
  claudeTaskToolOutputSchema,
  type ClaudeTaskToolOutput,
  bashArgsSchema,
  errorEnvelopeSchema,
  extractResultText,
  jsonRpcEnvelopeSchema,
  providerRawEventSchema,
  sdkMessageEnvelopeSchema,
  threadIdentityEnvelopeSchema,
  toOptionalRecord,
  toOptionalString,
  type ClientTurnRequestId,
  type ProviderRawEvent,
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
  buildInterruptedClaudeTaskDeltas,
  translateClaudeTaskMessage,
  type ClaudeTaskMap,
} from "./task-translation.js";
import {
  extractAssistantText,
  extractClaudeCommandExecutionOutput,
  extractClaudeContextWindowUsage,
  extractClaudeRequestContextTokens,
  extractClaudeResultTokenUsage,
  extractStreamTextDelta,
  extractStreamThinkingDelta,
  extractThinkingBlocks,
  extractToolResults,
  extractToolUses,
  getNestedParentToolUseId,
  resolveClaudeModelContextWindowHint,
} from "./sdk-extraction.js";
import { claudeCodeVisibilityMetadata } from "./visibility.js";

/**
 * The per-event translation scope the bridge passes in (the bb thread id;
 * a parent tool-call id arrives from nested subagent traffic).
 */
export interface ClaudeDeltaTranslationContext {
  threadId?: string;
  parentToolCallId?: string;
}

const ASSISTANT_STREAM_KEY = "assistant";

// ---------------------------------------------------------------------------
// Claude tool classification (dialect → delta item shapes)
// ---------------------------------------------------------------------------

interface ClaudeBashCommand {
  command: string;
  cwd: string | null;
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
): { url: string; prompt: string | null } | null {
  const url = toOptionalString(args.url);
  if (!url) {
    return null;
  }
  return {
    url,
    prompt: toOptionalString(args.prompt) ?? null,
  };
}

const CLAUDE_COMMAND_TOOL_NAMES = new Set(["Bash"]);
const CLAUDE_FILE_CHANGE_TOOL_NAMES = new Set(["Edit", "Write"]);

function genericToolShape(toolName: string, args: unknown): DeltaItemShape {
  const toolArguments = toOptionalRecord(args);
  return {
    type: "tool",
    tool: toolName,
    ...(toolArguments ? { args: toolArguments } : {}),
  };
}

function classifyClaudeToolUse(
  toolName: string,
  args: unknown,
): DeltaItemShape {
  if (CLAUDE_COMMAND_TOOL_NAMES.has(toolName)) {
    const command = parseClaudeBashCommand(args);
    return command
      ? { type: "command", command: command.command, cwd: command.cwd ?? "" }
      : genericToolShape(toolName, args);
  }

  if (CLAUDE_FILE_CHANGE_TOOL_NAMES.has(toolName)) {
    const parsed = claudeFileEditArgsSchema.safeParse(args);
    if (!parsed.success) {
      return genericToolShape(toolName, args);
    }
    const path = getClaudeFileEditPath(parsed.data);
    if (!path) {
      return { type: "tool", tool: toolName, args: parsed.data };
    }
    const newText = parsed.data.new_string ?? parsed.data.content;
    return {
      type: "fileChange",
      changes: [
        {
          path,
          kind: parsed.data.old_string === undefined ? "add" : "update",
          ...(parsed.data.old_string === undefined
            ? {}
            : { oldText: parsed.data.old_string }),
          ...(newText === undefined ? {} : { newText }),
        },
      ],
    };
  }

  if (toolName === "WebSearch") {
    const parsed = claudeWebSearchArgsSchema.safeParse(args);
    const queries = parsed.success
      ? normalizeClaudeWebSearchArgs(parsed.data)
      : null;
    return queries
      ? { type: "webSearch", queries }
      : genericToolShape(toolName, args);
  }
  if (toolName === "WebFetch") {
    const parsed = claudeWebFetchArgsSchema.safeParse(args);
    const normalized = parsed.success
      ? normalizeClaudeWebFetchArgs(parsed.data)
      : null;
    return normalized
      ? {
          type: "webFetch",
          url: normalized.url,
          prompt: normalized.prompt,
          pattern: null,
        }
      : genericToolShape(toolName, args);
  }

  return genericToolShape(toolName, args);
}

/** Fallback classification for close-without-open (the old kit fallback). */
function classifyClaudeToolResultFallback(
  toolName: string | undefined,
): DeltaItemShape {
  if (toolName !== undefined && CLAUDE_COMMAND_TOOL_NAMES.has(toolName)) {
    return { type: "command", command: "", cwd: "" };
  }
  if (toolName !== undefined && CLAUDE_FILE_CHANGE_TOOL_NAMES.has(toolName)) {
    return { type: "fileChange", changes: [] };
  }
  return { type: "tool", tool: toolName ?? "unknown" };
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

function parseClaudeTaskToolOutput(args: {
  content: unknown;
  outputText: string | undefined;
  toolUseResult: ClaudeToolUseResult | null;
}): ClaudeTaskToolOutput | null {
  return (
    parseClaudeTaskToolOutputValue(args.content) ??
    parseClaudeTaskToolOutputValue(args.toolUseResult) ??
    parseClaudeTaskToolOutputValue(args.outputText)
  );
}

// ---------------------------------------------------------------------------
// Dialect message helpers (moved verbatim from the event translator)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// The turn mirror and per-thread dialect state
// ---------------------------------------------------------------------------

/**
 * A deterministic replay of the assembler's current-turn machine, driven by
 * the deltas this translator emits. `segment` counts opened turns and stands
 * in for the bb turn id in the dialect's per-turn comparisons (armed
 * rejection, fallback dedup, the compaction guard). It also decides the old
 * translator's implicit-turn questions (has an accepted input queued? is a
 * turn open?) without knowing any bb ids.
 */
interface ClaudeTurnMirror {
  turnOpen: boolean;
  pendingInputs: number;
  segment: number;
}

interface ClaudeThreadDialectState {
  mirror: ClaudeTurnMirror;
  latestRequestContextTokens: number | undefined;
  latestProviderCheckpointId: string | undefined;
  lastModelFallback:
    | (ClaudeModelFallbackTransition & { segment: number })
    | undefined;
  armedHardRateLimitRejection: { detail: string; segment: number } | undefined;
  selectedModelContextWindow: number | null;
  /**
   * Blocks unaccepted provider-only turn starts after a terminal failure.
   * Late SDK drain output (background tasks, sidechains, bridge errors) after
   * a failed result must not manufacture a turn nobody asked for; a real
   * accepted input or an actually opened turn clears the suppression (#1623).
   */
  suppressUnacceptedTurnStart: boolean;
  /**
   * Open context-compaction item for the segment it started in; a
   * non-compacting status completes it only inside the same open segment (the
   * stale-turn guard: a stale entry never completes under a later turn).
   */
  openCompaction: { segment: number } | undefined;
  /**
   * Started-tool shapes per call id: user-message tool results omit the
   * call's args, and `item.close` carries the full terminal shape, so the
   * shape classified at the tool_use is remembered until its result (and
   * dropped when the turn settles, like the old per-turn tool cache).
   */
  startedToolShapes: Map<string, DeltaItemShape>;
  /** Thread-lifetime background-task machine; outlives turns by design. */
  tasksById: ClaudeTaskMap;
  /** Live monitor and future task types that create no timeline rows. */
  opaqueTaskIds: Set<string>;
}

function createThreadState(): ClaudeThreadDialectState {
  return {
    mirror: { turnOpen: false, pendingInputs: 0, segment: 0 },
    latestRequestContextTokens: undefined,
    latestProviderCheckpointId: undefined,
    lastModelFallback: undefined,
    armedHardRateLimitRejection: undefined,
    selectedModelContextWindow: null,
    suppressUnacceptedTurnStart: false,
    openCompaction: undefined,
    startedToolShapes: new Map(),
    tasksById: new Map(),
    opaqueTaskIds: new Set(),
  };
}

// ---------------------------------------------------------------------------
// Translator factory
// ---------------------------------------------------------------------------

export function createClaudeDeltaTranslator() {
  const statesByThreadId = new Map<string, ClaudeThreadDialectState>();

  function stateFor(context: ClaudeDeltaTranslationContext | undefined) {
    const key = context?.threadId ?? "";
    const existing = statesByThreadId.get(key);
    if (existing) {
      return existing;
    }
    const created = createThreadState();
    statesByThreadId.set(key, created);
    return created;
  }

  // -- mirror transitions ----------------------------------------------------

  /** The old onTurnStart: per-segment latches reset when a turn opens. */
  function mirrorOpenTurn(state: ClaudeThreadDialectState): void {
    if (state.mirror.turnOpen) {
      return;
    }
    state.suppressUnacceptedTurnStart = false;
    state.mirror.turnOpen = true;
    state.mirror.segment += 1;
    state.mirror.pendingInputs = 0;
    state.latestRequestContextTokens = undefined;
    state.latestProviderCheckpointId = undefined;
    state.armedHardRateLimitRejection = undefined;
    state.startedToolShapes.clear();
  }

  /** The old finishTurn/onTurnFinish: turn-scoped dialect memory dies here. */
  function mirrorCloseTurn(state: ClaudeThreadDialectState): void {
    state.mirror.turnOpen = false;
    state.armedHardRateLimitRejection = undefined;
    state.startedToolShapes.clear();
  }

  /**
   * Replay a batch of emitted deltas onto the mirror. Every turn-affecting
   * delta the translator produces flows through here exactly once.
   */
  function withMirror(
    state: ClaudeThreadDialectState,
    deltas: ThreadDelta[],
  ): ThreadDelta[] {
    for (const delta of deltas) {
      switch (delta.kind) {
        case "input.accepted":
          if (!state.mirror.turnOpen) {
            state.mirror.pendingInputs += 1;
          }
          break;
        case "turn.open":
          mirrorOpenTurn(state);
          break;
        case "turn.boundary":
          if (
            state.mirror.turnOpen ||
            (delta.claimIfIdle === true && state.mirror.pendingInputs > 0)
          ) {
            mirrorOpenTurn(state);
            mirrorCloseTurn(state);
          }
          break;
        case "provider.error":
          if (delta.threadScoped === true) {
            break;
          }
          if (!state.mirror.turnOpen && state.mirror.pendingInputs > 0) {
            mirrorOpenTurn(state);
          }
          if (delta.settlesTurn === true && state.mirror.turnOpen) {
            mirrorCloseTurn(state);
          }
          break;
        case "session.ended":
          if (state.mirror.turnOpen || state.mirror.pendingInputs > 0) {
            mirrorOpenTurn(state);
            mirrorCloseTurn(state);
          }
          break;
        default:
          break;
      }
    }
    return deltas;
  }

  /**
   * The late-drain suppression predicate (#1623): a terminal failure set the
   * flag, no turn is open, and no accepted input is pending — so nothing may
   * open a provider-only turn.
   */
  function isTurnStartSuppressed(state: ClaudeThreadDialectState): boolean {
    return (
      state.suppressUnacceptedTurnStart &&
      !state.mirror.turnOpen &&
      state.mirror.pendingInputs === 0
    );
  }

  // -- fallback payloads (the old "no active turn" visibility guards) --------

  function toRawEvent(rawEvent: JsonRpcMessage): ProviderRawEvent {
    const parsed = providerRawEventSchema.safeParse(rawEvent);
    if (parsed.success) {
      return parsed.data;
    }
    return {
      jsonrpc: "2.0",
      ...(rawEvent.id !== undefined ? { id: rawEvent.id } : {}),
      method: rawEvent.method,
      params: {
        serializationError:
          "Provider raw event params were not JSON-serializable.",
      },
    };
  }

  function sdkEnvelopeFor(
    rawMessage: unknown,
    context: ClaudeDeltaTranslationContext | undefined,
  ): JsonRpcMessage {
    return {
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        ...(context?.threadId ? { threadId: context.threadId } : {}),
        message: rawMessage,
      },
    };
  }

  function noTurnFallbackFor(
    rawMessage: unknown,
    context: ClaudeDeltaTranslationContext | undefined,
  ): DeltaNoTurnFallback {
    const rawEvent = sdkEnvelopeFor(rawMessage, context);
    return {
      raw: toRawEvent(rawEvent),
      rawType: claudeCodeVisibilityMetadata.describeRawEvent(rawEvent).kind,
    };
  }

  /** A known event whose payload failed its schema: always surfaced. */
  function unexpectedSdkEventDeltas(
    rawMessage: unknown,
    context: ClaudeDeltaTranslationContext | undefined,
  ): ThreadDelta[] {
    const fallback = noTurnFallbackFor(rawMessage, context);
    return [
      {
        kind: "unhandled",
        raw: fallback.raw,
        rawType: fallback.rawType,
        vouchedTurn: true,
        ...(context?.parentToolCallId
          ? { parentRef: context.parentToolCallId }
          : {}),
      },
    ];
  }

  /** Visibility classification: only unknown coverage becomes an `unhandled`. */
  function unhandledDeltas(
    rawEvent: JsonRpcMessage,
    parentRef: string | undefined,
  ): ThreadDelta[] {
    const description = claudeCodeVisibilityMetadata.describeRawEvent(rawEvent);
    if (description.coverage !== "unknown") {
      return [];
    }
    return [
      {
        kind: "unhandled",
        raw: toRawEvent(rawEvent),
        rawType: description.kind,
        vouchedTurn: true,
        ...(parentRef ? { parentRef } : {}),
      },
    ];
  }

  // -- SDK message translation ------------------------------------------------

  function translateSystemMessage(
    event: unknown,
    state: ClaudeThreadDialectState,
    context: ClaudeDeltaTranslationContext | undefined,
  ): ThreadDelta[] {
    const apiRetryMessage = claudeApiRetryMessageSchema.safeParse(event);
    if (apiRetryMessage.success) {
      const errorInfo = buildClaudeProviderErrorInfo({
        code: apiRetryMessage.data.error,
        httpStatusCode: apiRetryMessage.data.error_status,
      });
      const retryError: ThreadDelta = {
        kind: "provider.error",
        message: "Provider error",
        detail: buildClaudeApiRetryDetail(apiRetryMessage.data),
        willRetry: true,
        ...(errorInfo === null ? {} : { errorInfo }),
      };
      // A retry notice during a suppressed late drain stays a thread-scoped
      // diagnostic instead of manufacturing a turn (#1623).
      if (isTurnStartSuppressed(state)) {
        return [{ ...retryError, threadScoped: true }];
      }
      // Opens a turn when none is open, exactly like the old ensureTurnStarted.
      return withMirror(state, [{ kind: "turn.open" }, retryError]);
    }

    const statusMessage = claudeStatusSystemMessageSchema.safeParse(event);
    if (statusMessage.success && statusMessage.data.status === "compacting") {
      if (isTurnStartSuppressed(state)) {
        return [];
      }
      const deltas = withMirror(state, [
        { kind: "turn.open" },
        {
          kind: "item.open",
          key: { channel: "compaction" },
          item: { type: "compaction" },
        },
      ]);
      state.openCompaction = { segment: state.mirror.segment };
      return deltas;
    }
    if (statusMessage.success) {
      // Any non-compacting status (null = cleared) ends an open compaction;
      // without this the contextCompaction item dangles as pending forever.
      // Guarded by segment: a stale entry never completes under a later turn.
      const openCompaction = state.openCompaction;
      state.openCompaction = undefined;
      if (
        openCompaction !== undefined &&
        state.mirror.turnOpen &&
        openCompaction.segment === state.mirror.segment
      ) {
        return [
          {
            kind: "item.close",
            key: { channel: "compaction" },
            status: "completed",
            item: { type: "compaction" },
          },
        ];
      }
      return [];
    }

    const compactBoundaryMessage =
      claudeCompactBoundarySystemMessageSchema.safeParse(event);
    if (compactBoundaryMessage.success) {
      // Attaches to the current-or-last turn; with no turn ever opened the
      // assembler surfaces the fallback exactly as the old unexpected path.
      return [
        {
          kind: "context.compacted",
          noTurnFallback: noTurnFallbackFor(event, context),
        },
      ];
    }

    const modelFallbackMessage =
      claudeModelFallbackSystemMessageSchema.safeParse(event);
    if (modelFallbackMessage.success) {
      const message = modelFallbackMessage.data;
      const transition = {
        originalModel: message.original_model,
        fallbackModel: message.fallback_model,
      };
      if (isDuplicateClaudeModelFallback(state, transition)) {
        return [];
      }
      rememberClaudeModelFallback(state, transition);
      return [
        {
          kind: "provider.modelFallback",
          originalModel: transition.originalModel,
          fallbackModel: transition.fallbackModel,
          reason:
            message.subtype === "model_refusal_fallback"
              ? "refusal"
              : "provider",
          message:
            message.content ??
            `Switched from ${message.original_model} to ${message.fallback_model}.`,
        },
      ];
    }

    const noFallbackMessage =
      claudeModelRefusalNoFallbackSystemMessageSchema.safeParse(event);
    if (noFallbackMessage.success) {
      return [
        {
          kind: "provider.warning",
          summary: "Model refused the request",
          details:
            noFallbackMessage.data.content ??
            "The selected model refused the request and no fallback model was available.",
          vouchedTurn: true,
        },
      ];
    }

    const permissionDeniedMessage =
      claudePermissionDeniedSystemMessageSchema.safeParse(event);
    if (permissionDeniedMessage.success) {
      const message = permissionDeniedMessage.data;
      const reason = message.decision_reason ?? message.message;
      return [
        {
          kind: "provider.warning",
          summary: `${message.tool_name} was denied automatically`,
          details: message.decision_reason_type
            ? `${reason} (${message.decision_reason_type})`
            : reason,
          vouchedTurn: true,
        },
      ];
    }

    const taskDeltas = translateClaudeTaskMessage({
      event,
      opaqueTaskIds: state.opaqueTaskIds,
      tasks: state.tasksById,
      turnStartSuppressed: isTurnStartSuppressed(state),
    });
    if (taskDeltas !== null) {
      return withMirror(state, taskDeltas);
    }

    return [];
  }

  /**
   * Dedup scope mirrors the old getCurrentOrLastTurnId comparison: the
   * fallback recorded in a segment suppresses duplicates until a NEW turn
   * opens, even after the segment's turn closed.
   */
  function isDuplicateClaudeModelFallback(
    state: ClaudeThreadDialectState,
    transition: ClaudeModelFallbackTransition,
  ): boolean {
    return (
      state.lastModelFallback !== undefined &&
      state.lastModelFallback.segment === state.mirror.segment &&
      state.lastModelFallback.originalModel === transition.originalModel &&
      state.lastModelFallback.fallbackModel === transition.fallbackModel
    );
  }

  function rememberClaudeModelFallback(
    state: ClaudeThreadDialectState,
    transition: ClaudeModelFallbackTransition,
  ): void {
    // The old translator recorded the dedup key only when some turn existed.
    if (state.mirror.segment === 0) {
      return;
    }
    state.lastModelFallback = { ...transition, segment: state.mirror.segment };
  }

  function translateAssistantMessage(
    event: unknown,
    state: ClaudeThreadDialectState,
    context: ClaudeDeltaTranslationContext | undefined,
  ): ThreadDelta[] {
    const parsedMessage = claudeAssistantMessageSchema.safeParse(event);
    if (!parsedMessage.success) {
      return unexpectedSdkEventDeltas(event, context);
    }
    const message = parsedMessage.data;
    // Late assistant drain (sidechain or root) after a terminal failure must
    // not manufacture an unaccepted provider-only turn (#1623).
    if (isTurnStartSuppressed(state)) {
      return [];
    }
    const parentToolCallId = context?.parentToolCallId;
    const parentRefField = parentToolCallId
      ? { parentRef: parentToolCallId }
      : {};
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
      const deltas = withMirror(state, [{ kind: "turn.open" }]);
      if (providerCheckpointId !== undefined) {
        state.latestProviderCheckpointId = providerCheckpointId;
      }
      if (!isDuplicateClaudeModelFallback(state, fallbackTransition)) {
        rememberClaudeModelFallback(state, fallbackTransition);
        deltas.push({
          kind: "provider.modelFallback",
          originalModel: fallbackTransition.originalModel,
          fallbackModel: fallbackTransition.fallbackModel,
          reason: "provider",
          message: `Switched from ${fallbackTransition.originalModel} to ${fallbackTransition.fallbackModel}.`,
        });
      }
      return deltas;
    }

    if (isClaudeNoResponseRequestedSyntheticMessage(message)) {
      if (!state.mirror.turnOpen && state.mirror.pendingInputs === 0) {
        return [];
      }
      const deltas = withMirror(state, [{ kind: "turn.open" }]);
      if (providerCheckpointId !== undefined) {
        state.latestProviderCheckpointId = providerCheckpointId;
      }
      if (hasCompletionBlockingClaudeTasks(state.tasksById)) {
        return deltas;
      }
      deltas.push(
        ...withMirror(state, [
          {
            kind: "turn.boundary",
            status: "completed",
            ...(state.latestProviderCheckpointId !== undefined
              ? { providerCheckpointId: state.latestProviderCheckpointId }
              : {}),
          },
        ]),
      );
      return deltas;
    }

    const deltas = withMirror(state, [{ kind: "turn.open" }]);
    if (providerCheckpointId !== undefined) {
      state.latestProviderCheckpointId = providerCheckpointId;
    }
    const requestContextTokens = extractClaudeRequestContextTokens(message);
    if (requestContextTokens !== null) {
      state.latestRequestContextTokens = requestContextTokens;
    }

    for (const thinkingBlock of extractThinkingBlocks(message)) {
      // Provider-final reasoning text: settles the streamed reasoning item
      // under the (parentRef, contentIndex) stream key, or mints one fresh.
      deltas.push({
        kind: "message.close",
        channel: "reasoning",
        streamKey: String(thinkingBlock.contentIndex),
        text: thinkingBlock.text,
        ...parentRefField,
      });
    }

    const text = extractAssistantText(message);
    if (text) {
      deltas.push({
        kind: "message.close",
        channel: "assistant",
        streamKey: ASSISTANT_STREAM_KEY,
        text,
        ...parentRefField,
      });
    }

    for (const toolUse of extractToolUses(message)) {
      const shape = classifyClaudeToolUse(toolUse.name, toolUse.input);
      state.startedToolShapes.set(toolUse.id, shape);
      deltas.push({
        kind: "item.open",
        key: { providerItemId: toolUse.id, ...parentRefField },
        item: shape,
      });
    }
    return deltas;
  }

  function translateStreamEvent(
    event: unknown,
    state: ClaudeThreadDialectState,
    context: ClaudeDeltaTranslationContext | undefined,
  ): ThreadDelta[] {
    const parsedMessage = claudeStreamEventMessageSchema.safeParse(event);
    if (!parsedMessage.success) {
      return unexpectedSdkEventDeltas(event, context);
    }
    const message = parsedMessage.data;
    if (isTurnStartSuppressed(state)) {
      return [];
    }
    const parentToolCallId = context?.parentToolCallId;
    const parentRefField = parentToolCallId
      ? { parentRef: parentToolCallId }
      : {};
    const deltas: ThreadDelta[] = [];

    const reasoningDelta = extractStreamThinkingDelta(message);
    if (reasoningDelta) {
      deltas.push({ kind: "turn.open" });
      deltas.push({
        kind: "message.delta",
        channel: "reasoning",
        streamKey: String(reasoningDelta.contentIndex),
        text: reasoningDelta.delta,
        ...parentRefField,
      });
    }

    const textDelta = extractStreamTextDelta(message);
    if (textDelta) {
      deltas.push({ kind: "turn.open" });
      deltas.push({
        kind: "message.delta",
        channel: "assistant",
        streamKey: ASSISTANT_STREAM_KEY,
        text: textDelta.delta,
        ...parentRefField,
      });
    }

    return withMirror(state, deltas);
  }

  function translateUserMessage(
    event: unknown,
    state: ClaudeThreadDialectState,
    context: ClaudeDeltaTranslationContext | undefined,
  ): ThreadDelta[] {
    const parsedMessage = claudeUserMessageSchema.safeParse(event);
    if (!parsedMessage.success) {
      return unexpectedSdkEventDeltas(event, context);
    }
    const toolResults = extractToolResults(parsedMessage.data);
    if (toolResults.length === 0) {
      return [];
    }
    if (!state.mirror.turnOpen) {
      // The turnless-result downgrade: a late tool result after the turn
      // settled surfaces as one thread-scoped provider/unhandled.
      return unexpectedSdkEventDeltas(event, context);
    }
    const parentToolCallId = context?.parentToolCallId;
    const parentRefField = parentToolCallId
      ? { parentRef: parentToolCallId }
      : {};
    const deltas: ThreadDelta[] = [];
    for (const result of toolResults) {
      const startedShape = state.startedToolShapes.get(result.toolUseId);
      state.startedToolShapes.delete(result.toolUseId);
      const isCommandResult =
        result.toolName === "Bash" || startedShape?.type === "command";
      const outputText = isCommandResult
        ? extractClaudeCommandExecutionOutput({
            content: result.content,
            toolUseResult: result.toolUseResult,
          })
        : extractResultText(result.content);
      const resultToolName =
        startedShape?.type === "tool" ? startedShape.tool : result.toolName;
      const taskToolResult =
        resultToolName !== undefined &&
        claudeTaskToolNameSchema.safeParse(resultToolName).success
          ? parseClaudeTaskToolOutput({
              content: result.content,
              outputText,
              toolUseResult: result.toolUseResult,
            })
          : null;
      const baseShape =
        startedShape ?? classifyClaudeToolResultFallback(result.toolName);
      // Task-tool results parse into structured output riding the terminal
      // tool shape; plain results ride the generic resultText close field.
      const terminalShape: DeltaItemShape =
        baseShape.type === "tool" && taskToolResult !== null
          ? { ...baseShape, result: taskToolResult }
          : baseShape;
      const status = result.isError ? "failed" : "completed";
      deltas.push({
        kind: "item.close",
        key: { providerItemId: result.toolUseId, ...parentRefField },
        status,
        ...(terminalShape.type === "command"
          ? {
              exitCode: result.isError ? 1 : 0,
              ...(outputText === undefined
                ? {}
                : { aggregatedOutput: outputText }),
            }
          : outputText === undefined
            ? {}
            : { resultText: outputText }),
        item: terminalShape,
      });
    }
    return deltas;
  }

  function translateResultMessage(
    event: unknown,
    state: ClaudeThreadDialectState,
    context: ClaudeDeltaTranslationContext | undefined,
  ): ThreadDelta[] {
    const parsedMessage = claudeResultMessageSchema.safeParse(event);
    if (!parsedMessage.success) {
      return unexpectedSdkEventDeltas(event, context);
    }
    const message = parsedMessage.data;
    // The terminal-turn rule: the result owns the open turn, or claims one
    // proven by pending accepted input; on an idle thread it emits nothing.
    if (!state.mirror.turnOpen && state.mirror.pendingInputs === 0) {
      return [];
    }
    // Claiming through pending input opens the turn first (clearing the
    // per-segment latches), exactly like resolveProviderTerminalTurn did.
    const deltas = withMirror(state, [{ kind: "turn.open" }]);

    const contextWindowUsage = extractClaudeContextWindowUsage({
      fallbackModelContextWindow: state.selectedModelContextWindow,
      latestRequestContextTokens: state.latestRequestContextTokens,
      message,
    });
    if (
      contextWindowUsage !== undefined &&
      contextWindowUsage.modelContextWindow !== null
    ) {
      state.selectedModelContextWindow = contextWindowUsage.modelContextWindow;
    }
    if (contextWindowUsage) {
      deltas.push({
        kind: "contextWindow",
        used: contextWindowUsage.usedTokens,
        size: contextWindowUsage.modelContextWindow,
        estimated: true,
        attach: "open",
      });
    }
    const tokenUsage = extractClaudeResultTokenUsage(message);
    if (tokenUsage !== undefined) {
      deltas.push({
        kind: "usage.turn",
        tokens: tokenUsage.last,
        modelContextWindow: tokenUsage.modelContextWindow,
      });
    }

    const pendingHardRateLimitRejection =
      state.armedHardRateLimitRejection?.segment === state.mirror.segment &&
      state.mirror.turnOpen
        ? state.armedHardRateLimitRejection
        : undefined;
    const resultFailed = isClaudeResultFailure(message);
    const failed = resultFailed || pendingHardRateLimitRejection !== undefined;
    if (failed) {
      const resultErrorInfo = buildClaudeProviderErrorInfo({
        httpStatusCode: message.api_error_status,
        resultSubtype: message.subtype,
      });
      const errorInfo =
        pendingHardRateLimitRejection === undefined
          ? resultErrorInfo
          : {
              category: "rate-limit" as const,
              providerCode: resultErrorInfo?.providerCode ?? "rate_limit_event",
              httpStatusCode: resultErrorInfo?.httpStatusCode ?? null,
            };
      deltas.push({
        kind: "provider.error",
        message: "Provider error",
        detail: resultFailed
          ? getClaudeResultErrorDetail(message)
          : (pendingHardRateLimitRejection?.detail ??
            getClaudeResultErrorDetail(message)),
        ...(errorInfo === null ? {} : { errorInfo }),
      });
    }
    state.armedHardRateLimitRejection = undefined;
    // Claude emits a successful result at the end of each SDK loop segment.
    // Background agents notify the CLI when they settle, which reinvokes the
    // parent model. WITHHOLD the boundary so the logical bb turn stays open
    // across those segments; failures still close immediately.
    if (!failed && hasCompletionBlockingClaudeTasks(state.tasksById)) {
      return deltas;
    }
    // Arm the late-drain suppression on terminal failure; a completed turn
    // clears it (#1623). The flag is read only after the boundary closes the
    // mirror's turn.
    state.suppressUnacceptedTurnStart = failed;
    deltas.push(
      ...withMirror(state, [
        {
          kind: "turn.boundary",
          status: failed ? "failed" : "completed",
          ...(state.latestProviderCheckpointId !== undefined
            ? { providerCheckpointId: state.latestProviderCheckpointId }
            : {}),
        },
      ]),
    );
    return deltas;
  }

  function translateRateLimitEvent(
    event: unknown,
    state: ClaudeThreadDialectState,
    context: ClaudeDeltaTranslationContext | undefined,
  ): ThreadDelta[] {
    const parsedMessage = claudeRateLimitEventSchema.safeParse(event);
    if (!parsedMessage.success) {
      return unexpectedSdkEventDeltas(event, context);
    }
    const message = parsedMessage.data;
    const rateLimits = normalizeClaudeRateLimits(message);
    if (!isHardClaudeRateLimitRejection(message)) {
      if (
        rateLimits.status === "allowed" &&
        state.mirror.turnOpen &&
        state.armedHardRateLimitRejection?.segment === state.mirror.segment
      ) {
        // The provider reversed the rejection: the eventual result must not
        // be reclassified as rate-limited.
        state.armedHardRateLimitRejection = undefined;
      }
      return [{ kind: "provider.rateLimits", rateLimits }];
    }
    // During a suppressed late drain the rate-limit snapshot still surfaces,
    // but no turn opens and no rejection is armed (#1623).
    if (isTurnStartSuppressed(state)) {
      return [{ kind: "provider.rateLimits", rateLimits }];
    }
    // Armed hard rejection: the terminal error is deferred onto the result so
    // exactly one error lands inside the failed turn (#1408).
    const deltas = withMirror(state, [{ kind: "turn.open" }]);
    deltas.push({ kind: "provider.rateLimits", rateLimits });
    state.armedHardRateLimitRejection = {
      detail: buildClaudeRateLimitEventDetail(message),
      segment: state.mirror.segment,
    };
    return deltas;
  }

  function translateSdkMessage(
    event: unknown,
    context: ClaudeDeltaTranslationContext | undefined,
  ): ThreadDelta[] {
    const messageType = claudeSdkMessageTypeSchema.safeParse(event);
    if (!messageType.success) {
      return [];
    }
    const state = stateFor(context);

    switch (messageType.data.type) {
      case "conversation_reset": {
        const parsedMessage =
          claudeConversationResetMessageSchema.safeParse(event);
        if (!parsedMessage.success) {
          return unexpectedSdkEventDeltas(event, context);
        }
        if (isTurnStartSuppressed(state)) {
          return [];
        }
        return withMirror(state, [
          { kind: "turn.open" },
          { kind: "context.cleared" },
        ]);
      }
      case "system": {
        const parsedMessage = claudeSystemMessageSchema.safeParse(event);
        if (!parsedMessage.success) {
          return unexpectedSdkEventDeltas(event, context);
        }
        return translateSystemMessage(event, state, context);
      }
      case "assistant":
        return translateAssistantMessage(event, state, context);
      case "stream_event":
        return translateStreamEvent(event, state, context);
      case "user":
        return translateUserMessage(event, state, context);
      case "result":
        return translateResultMessage(event, state, context);
      case "rate_limit_event":
        return translateRateLimitEvent(event, state, context);
    }
  }

  // -- envelope dispatch ------------------------------------------------------

  function translate(
    event: ProviderRuntimeEvent | unknown,
    context?: ClaudeDeltaTranslationContext,
  ): ThreadDelta[] {
    const sdkEnvelope = sdkMessageEnvelopeSchema.safeParse(event);
    if (sdkEnvelope.success) {
      const sdkMessage = sdkEnvelope.data.params.message;
      const nestedParentToolCallId = getNestedParentToolUseId(sdkMessage);
      const parentToolCallId = nestedParentToolCallId
        ? nestedParentToolCallId
        : (sdkEnvelope.data.params.parent_tool_use_id ??
          context?.parentToolCallId);
      const translated = translate(sdkMessage, {
        ...context,
        ...(parentToolCallId ? { parentToolCallId } : {}),
      });
      return translated.length > 0
        ? translated
        : unhandledDeltas(
            {
              jsonrpc: "2.0",
              method: sdkEnvelope.data.method,
              params: sdkEnvelope.data.params,
            },
            parentToolCallId,
          );
    }

    const identityEnvelope = threadIdentityEnvelopeSchema.safeParse(event);
    if (identityEnvelope.success) {
      const { providerThreadId } = identityEnvelope.data.params;
      return providerThreadId
        ? [{ kind: "thread.identity", providerThreadId }]
        : [];
    }

    const errorEnvelope = errorEnvelopeSchema.safeParse(event);
    if (errorEnvelope.success) {
      const detail = errorEnvelope.data.params?.message ?? "unknown error";
      if (!context?.threadId) {
        // No thread to settle: a thread-scoped diagnostic, exactly like the
        // old registry-less buildErrorEvents path.
        return [
          {
            kind: "provider.error",
            message: "Provider error",
            detail,
            threadScoped: true,
          },
        ];
      }
      const state = stateFor(context);
      // A bridge error draining after a terminal failure settles nothing new;
      // it must not fail a turn nobody opened (#1623).
      if (isTurnStartSuppressed(state)) {
        return [];
      }
      // The old buildErrorEvents opened a turn unconditionally and failed it;
      // the bridge gates this on an open translator turn, so in practice the
      // fabrication only reproduces the old translator-level behavior.
      return withMirror(state, [
        { kind: "turn.open" },
        {
          kind: "provider.error",
          message: "Provider error",
          detail,
          settlesTurn: true,
        },
      ]);
    }

    const envelope = jsonRpcEnvelopeSchema.safeParse(event);
    if (envelope.success) {
      return unhandledDeltas(
        {
          jsonrpc: "2.0",
          method: envelope.data.method,
          ...(envelope.data.params ? { params: envelope.data.params } : {}),
        },
        context?.parentToolCallId,
      );
    }

    return translateSdkMessage(event, context);
  }

  // -- bridge-facing command-plane hooks --------------------------------------

  /**
   * The bridge confirmed the provider consumed a turn input. Returns the
   * `input.accepted` delta and keeps the mirror's pending-input count in step
   * with the assembler's queue.
   */
  function acceptInput(
    threadId: string,
    clientRequestId: ClientTurnRequestId,
  ): ThreadDelta[] {
    const state = stateFor({ threadId });
    // A real accepted input ends the post-failure drain window (#1623).
    state.suppressUnacceptedTurnStart = false;
    return withMirror(state, [{ kind: "input.accepted", clientRequestId }]);
  }

  /**
   * Session-death settlement (interrupt, replacement, stream end): the open
   * turn settles as interrupted FIRST, then the background-task map drains
   * into explicit closes with last-known-finished-else-stopped statuses —
   * today's exact event order. Opaque tasks die silently with the session.
   */
  function buildSessionSettlementDeltas(threadId: string): ThreadDelta[] {
    const state = stateFor({ threadId });
    const deltas: ThreadDelta[] = [];
    if (state.mirror.turnOpen) {
      deltas.push(
        ...withMirror(state, [
          { kind: "session.ended" },
        ]),
      );
    }
    deltas.push(
      ...buildInterruptedClaudeTaskDeltas({ tasks: state.tasksById }),
    );
    state.opaqueTaskIds.clear();
    return deltas;
  }

  /** Whether the mirror believes a bb turn is open for the thread. */
  function hasOpenTurn(threadId: string): boolean {
    return statesByThreadId.get(threadId)?.mirror.turnOpen === true;
  }

  /**
   * Whether unsettled background work — visible or opaque — should keep the
   * thread's provider session pinned (the old isEvictable/open-work rule).
   */
  function hasOpenBackgroundWork(threadId: string): boolean {
    const state = statesByThreadId.get(threadId);
    return (
      state !== undefined &&
      (hasOpenClaudeBackgroundTasks(state.tasksById) ||
        state.opaqueTaskIds.size > 0)
    );
  }

  /**
   * Seed the context-window fallback from the selected model. Claude reports
   * `modelUsage.contextWindow` on some results and omits it on others; when
   * missing, capacity falls back to what the model id implies (notably the 1M
   * `[1m]` aliases). Called at session construction and live model changes.
   */
  function setClaudeModelContextWindowHint(
    threadId: string,
    model: string,
  ): void {
    stateFor({ threadId }).selectedModelContextWindow =
      resolveClaudeModelContextWindowHint(model);
  }

  return {
    acceptInput,
    buildSessionSettlementDeltas,
    hasOpenBackgroundWork,
    hasOpenTurn,
    setClaudeModelContextWindowHint,
    translate,
  };
}

export type ClaudeDeltaTranslator = ReturnType<
  typeof createClaudeDeltaTranslator
>;
