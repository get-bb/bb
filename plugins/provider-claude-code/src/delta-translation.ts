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
 * - schema narrowing and tool classification (`tool-classification.ts`:
 *   Bash → command, Read → fileRead, Grep/Glob → search, Edit/Write →
 *   fileChange, Agent/Task → delegation, WebSearch/WebFetch → web items,
 *   else tool) with a presentation on every item.open/close
 *   (`presentation.ts`), and the plan-steps snapshots TodoWrite and the
 *   task-list tools produce (`plan-fold.ts`);
 * - the started-tool cache (tool results arrive inside USER messages
 *   without the call's args, and `item.close` must carry the full terminal
 *   shape and re-state the presentation);
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
  type ThreadEventPlanStep,
  type ThreadEventTokenUsageBreakdown,
  ZERO_TOKEN_USAGE,
  addTokenUsage,
  errorEnvelopeSchema,
  extractResultText,
  jsonRpcEnvelopeSchema,
  providerRawEventSchema,
  sdkMessageEnvelopeSchema,
  threadIdentityEnvelopeSchema,
  toOptionalRecord,
  type ClientTurnRequestId,
  type ProviderRawEvent,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  claudeApiRetryMessageSchema,
  claudeAssistantMessageSchema,
  claudeCompactBoundarySystemMessageSchema,
  claudeConversationResetMessageSchema,
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
  type ClaudeApiRetryMessage,
  type ClaudeAssistantMessage,
  type ClaudeRateLimitEvent,
  type ClaudeResultMessage,
} from "./schemas.js";
import { buildClaudeProviderErrorInfo } from "./error-info.js";
import {
  COMPACTION_PRESENTATION,
  planStepsPresentation,
} from "./presentation.js";
import {
  foldClaudeTaskToolResult,
  type ClaudeTaskPlanState,
} from "./plan-fold.js";
import {
  classifyClaudeToolResultFallback,
  classifyClaudeToolUse,
  stripClaudeAgentOutputMetadata,
  type ClaudeClassifiedTool,
  type ClaudeInjectedTool,
} from "./tool-classification.js";
import {
  hasCompletionBlockingClaudeTasks,
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

/**
 * One anonymous stream per thinking block, keyed by its content index so the
 * streamed deltas and the block's final text settle the same reasoning item.
 * Prefixed so a thinking stream can never share a key with the assistant
 * stream or another channel-keyed family.
 */
function thinkingStreamChannel(contentIndex: number): string {
  return `thinking-${contentIndex}`;
}

/** Provider-anonymous key for the plan-steps snapshots of a thread. */
const PLAN_STEPS_CHANNEL = "planSteps";

/**
 * The full terminal shape for a tool result. A delegation's result is the
 * child's summary (without Claude's internal metadata lines); every other
 * shape closes as it opened and the result rides the generic close fields.
 */
function terminalToolShape(
  shape: DeltaItemShape,
  outputText: string | undefined,
): DeltaItemShape {
  if (shape.type === "delegation" && outputText !== undefined) {
    const summary = stripClaudeAgentOutputMetadata(outputText);
    return summary.length > 0 ? { ...shape, summary } : shape;
  }
  return shape;
}

/**
 * The generic close fields per shape: a command's exit code and aggregated
 * output; the result text for tools, file changes and web items. A file
 * read, a search and a delegation carry no output on the canonical item (the
 * file contents, match list and child transcript are not row data).
 */
function terminalCloseFields(
  shape: DeltaItemShape,
  outputText: string | undefined,
  isError: boolean,
): Pick<
  Extract<ThreadDelta, { kind: "item.close" }>,
  "exitCode" | "aggregatedOutput" | "resultText"
> {
  switch (shape.type) {
    case "command":
      return {
        exitCode: isError ? 1 : 0,
        ...(outputText === undefined ? {} : { aggregatedOutput: outputText }),
      };
    case "fileRead":
    case "search":
    case "delegation":
      return {};
    default:
      return outputText === undefined ? {} : { resultText: outputText };
  }
}

/**
 * A settled plan-steps snapshot (TodoWrite's list, or the folded task list):
 * a channel-keyed close mints a fresh item per snapshot and the latest
 * supersedes the rest — the same shape codex's update_plan produces.
 */
function planStepsSnapshotDelta(
  steps: ThreadEventPlanStep[],
  parentRefField: { parentRef?: string },
): ThreadDelta {
  return {
    kind: "item.close",
    key: { channel: PLAN_STEPS_CHANNEL, ...parentRefField },
    status: "completed",
    item: { type: "planSteps", steps },
    presentation: planStepsPresentation(steps),
  };
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
  /**
   * Running session token total for the `usage` delta: the SDK reports per
   * result (per turn), and one translator lives per session, so this resets
   * exactly where the bridge sends `session.reset`.
   */
  cumulativeTokens: ThreadEventTokenUsageBreakdown;
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
   * Started tools per call id: user-message tool results omit the call's
   * args, and `item.close` carries the full terminal shape and re-states the
   * presentation, so the classification made at the tool_use is remembered
   * until its result (and dropped when the turn settles, like the old
   * per-turn tool cache).
   */
  startedTools: Map<string, ClaudeClassifiedTool>;
  /** Thread-lifetime background-task machine; outlives turns by design. */
  tasksById: ClaudeTaskMap;
  /**
   * Thread-lifetime task list the TaskCreate/TaskUpdate/TaskList/TaskGet
   * calls fold into; each successful call emits the list as a planSteps
   * snapshot.
   */
  taskPlan: ClaudeTaskPlanState;
}

function createThreadState(): ClaudeThreadDialectState {
  return {
    mirror: { turnOpen: false, pendingInputs: 0, segment: 0 },
    cumulativeTokens: ZERO_TOKEN_USAGE,
    latestRequestContextTokens: undefined,
    latestProviderCheckpointId: undefined,
    lastModelFallback: undefined,
    armedHardRateLimitRejection: undefined,
    selectedModelContextWindow: null,
    suppressUnacceptedTurnStart: false,
    openCompaction: undefined,
    startedTools: new Map(),
    tasksById: new Map(),
    taskPlan: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Translator factory
// ---------------------------------------------------------------------------

export function createClaudeDeltaTranslator() {
  const statesByThreadId = new Map<string, ClaudeThreadDialectState>();
  /**
   * The bb-injected tools of the session, by bare name. A call to
   * `mcp__bb-bridge__<name>` is a bb tool (`server: "bb"`) and reads the way
   * its definition says. One translator lives per session, so the set is
   * session-wide.
   */
  let injectedToolsByName = new Map<string, ClaudeInjectedTool>();

  function configureInjectedTools(tools: readonly ClaudeInjectedTool[]): void {
    injectedToolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  }

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
    state.startedTools.clear();
  }

  /** The old finishTurn/onTurnFinish: turn-scoped dialect memory dies here. */
  function mirrorCloseTurn(state: ClaudeThreadDialectState): void {
    state.mirror.turnOpen = false;
    state.armedHardRateLimitRejection = undefined;
    state.startedTools.clear();
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
          presentation: COMPACTION_PRESENTATION,
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
            presentation: COMPACTION_PRESENTATION,
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
        kind: "item.textClose",
        key: {
          channel: thinkingStreamChannel(thinkingBlock.contentIndex),
          ...parentRefField,
        },
        channel: "reasoningText",
        text: thinkingBlock.text,
      });
    }

    const text = extractAssistantText(message);
    if (text) {
      deltas.push({
        kind: "item.textClose",
        key: { channel: ASSISTANT_STREAM_KEY, ...parentRefField },
        channel: "agentMessage",
        text,
      });
    }

    for (const toolUse of extractToolUses(message)) {
      const classified = classifyClaudeToolUse({
        toolName: toolUse.name,
        toolUseId: toolUse.id,
        input: toolUse.input,
        injectedTools: injectedToolsByName,
      });
      state.startedTools.set(toolUse.id, classified);
      deltas.push({
        kind: "item.open",
        key: { providerItemId: toolUse.id, ...parentRefField },
        item: classified.shape,
        presentation: classified.presentation,
      });
      if (classified.planSteps !== undefined) {
        // TodoWrite carries the whole plan in its arguments: the snapshot
        // settles beside the (collapsed) call row as soon as the call opens.
        deltas.push(
          planStepsSnapshotDelta(classified.planSteps, parentRefField),
        );
      }
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
        kind: "item.textDelta",
        key: {
          channel: thinkingStreamChannel(reasoningDelta.contentIndex),
          ...parentRefField,
        },
        channel: "reasoningText",
        text: reasoningDelta.delta,
      });
    }

    const textDelta = extractStreamTextDelta(message);
    if (textDelta) {
      deltas.push({ kind: "turn.open" });
      deltas.push({
        kind: "item.textDelta",
        key: { channel: ASSISTANT_STREAM_KEY, ...parentRefField },
        channel: "agentMessage",
        text: textDelta.delta,
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
    // The SDK puts the tool's structured result on the user-message envelope
    // (`tool_use_result`), one message per result. The task-list tools are
    // the only ones whose structured form the bridge reads — for the plan
    // fold: the created task's id, a patch's success flag, a listing's
    // tasks. The item itself carries the text result like any tool.
    const envelopeToolUseResult =
      toolResults.length === 1
        ? (toOptionalRecord(parsedMessage.data)?.tool_use_result ?? undefined)
        : undefined;
    const deltas: ThreadDelta[] = [];
    for (const result of toolResults) {
      const started = state.startedTools.get(result.toolUseId);
      state.startedTools.delete(result.toolUseId);
      const startedShape = started?.shape;
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
      const base = started ?? classifyClaudeToolResultFallback(result.toolName);
      const status = result.isError ? "failed" : "completed";
      deltas.push({
        kind: "item.close",
        key: { providerItemId: result.toolUseId, ...parentRefField },
        status,
        ...terminalCloseFields(base.shape, outputText, result.isError),
        item: terminalToolShape(base.shape, outputText),
        presentation: base.presentation,
      });
      // A settled task-list call re-emits the folded list as a plan snapshot.
      if (resultToolName !== undefined) {
        const planSteps = foldClaudeTaskToolResult({
          state: state.taskPlan,
          toolName: resultToolName,
          input: startedShape?.type === "tool" ? startedShape.args : undefined,
          output: envelopeToolUseResult ?? result.toolUseResult ?? outputText,
          failed: result.isError,
        });
        if (planSteps !== null) {
          deltas.push(planStepsSnapshotDelta(planSteps, parentRefField));
        }
      }
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
    // The terminal-turn rule: the result owns the open turn, or a human result
    // claims one proven by pending accepted input. On resume, Claude can drain
    // a recovered task notification immediately before the queued human
    // prompt. Its result belongs to a provider-owned root segment and must not
    // steal that prompt's pending input. The SDK defines absent origin as
    // human, preserving local zero-work commands such as /clear.
    const resultCanClaimPendingInput =
      message.origin === undefined || message.origin.kind === "human";
    if (
      !state.mirror.turnOpen &&
      (state.mirror.pendingInputs === 0 || !resultCanClaimPendingInput)
    ) {
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
      state.cumulativeTokens = addTokenUsage(
        state.cumulativeTokens,
        tokenUsage.last,
      );
      deltas.push({
        kind: "usage",
        total: state.cumulativeTokens,
        last: tokenUsage.last,
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
      deltas.push(...withMirror(state, [{ kind: "session.ended" }]));
    }
    deltas.push(
      ...buildInterruptedClaudeTaskDeltas({ tasks: state.tasksById }),
    );
    return deltas;
  }

  /** Whether the mirror believes a bb turn is open for the thread. */
  function hasOpenTurn(threadId: string): boolean {
    return statesByThreadId.get(threadId)?.mirror.turnOpen === true;
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
    configureInjectedTools,
    hasOpenTurn,
    setClaudeModelContextWindowHint,
    translate,
  };
}

export type ClaudeDeltaTranslator = ReturnType<
  typeof createClaudeDeltaTranslator
>;
