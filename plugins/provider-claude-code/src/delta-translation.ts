import {
  type DeltaNoTurnFallback,
  type JsonRpcMessage,
  type ProviderRateLimitState,
  type ProviderRateLimitStatus,
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
  toOptionalString,
  type ClientTurnRequestId,
  type ProviderRawEvent,
  experimental_COMPACTION_PRESENTATION as COMPACTION_PRESENTATION,
  experimental_planStepsPresentation as planStepsPresentation,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  claudeApiRetryMessageSchema,
  claudeAssistantMessageSchema,
  claudeAssistantUsageMessageSchema,
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
  type ClaudeSdkUsage,
  type ClaudeRateLimitEvent,
  type ClaudeResultMessage,
  type ClaudeStreamEventMessage,
  type ClaudeUserMessage,
} from "./schemas.js";
import { buildClaudeProviderErrorInfo } from "./error-info.js";
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
import { z } from "zod";

export interface ClaudeDeltaTranslationContext {
  threadId?: string;
  parentToolCallId?: string;
}

type ClaudeDeltaItem = Extract<ThreadDelta, { kind: "item.open" }>["item"];
type ClaudeProviderErrorDelta = Extract<
  ThreadDelta,
  { kind: "provider.error" }
>;
type ClaudeUnhandledDelta = Extract<ThreadDelta, { kind: "unhandled" }>;
type ClaudeTurnBoundaryDelta = Extract<ThreadDelta, { kind: "turn.boundary" }>;
type ClaudeRawSdkMessage = JsonRpcMessage["params"];
type ClaudeSystemMessage = ReturnType<typeof claudeSystemMessageSchema.parse>;
type ClaudeJsonRpcValue =
  | boolean
  | number
  | string
  | null
  | ClaudeJsonRpcValue[]
  | ClaudeJsonRpcObject;
type ClaudeJsonRpcObject = {
  [key: string]: ClaudeJsonRpcValue | undefined;
};

interface ClaudeSdkEnvelopeParams extends ClaudeJsonRpcObject {
  message: ClaudeRawSdkMessage;
  threadId?: string;
}

const claudeJsonRpcValueSchema: z.ZodType<ClaudeJsonRpcValue> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.number(),
    z.string(),
    z.null(),
    z.array(claudeJsonRpcValueSchema),
    z.record(z.string(), claudeJsonRpcValueSchema),
  ]),
);
const claudeJsonRpcObjectSchema: z.ZodType<ClaudeJsonRpcObject> = z.record(
  z.string(),
  claudeJsonRpcValueSchema,
);

function parseClaudeJsonRpcObject<T>(
  value: T,
): ClaudeJsonRpcObject | undefined {
  const parsed = claudeJsonRpcObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const ASSISTANT_STREAM_KEY = "assistant";

function thinkingStreamChannel(contentIndex: number): string {
  return `thinking-${contentIndex}`;
}

const PLAN_STEPS_CHANNEL = "planSteps";

function terminalToolItem(
  item: ClaudeDeltaItem,
  outputText: string | undefined,
): ClaudeDeltaItem {
  if (item.type === "delegation" && outputText !== undefined) {
    const summary = stripClaudeAgentOutputMetadata(outputText);
    return summary.length > 0 ? { ...item, summary } : item;
  }
  return item;
}

function terminalCloseFields(
  item: ClaudeDeltaItem,
  outputText: string | undefined,
  isError: boolean,
): Pick<
  Extract<ThreadDelta, { kind: "item.close" }>,
  "exitCode" | "aggregatedOutput" | "resultText"
> {
  switch (item.type) {
    case "command":
      const commandFields: Pick<
        Extract<ThreadDelta, { kind: "item.close" }>,
        "exitCode" | "aggregatedOutput" | "resultText"
      > = {
        exitCode: isError ? 1 : 0,
      };
      if (outputText !== undefined) {
        commandFields.aggregatedOutput = outputText;
      }
      return commandFields;
    case "fileRead":
    case "search":
    case "delegation":
      return {};
    default:
      if (outputText === undefined) {
        return {};
      }
      return { resultText: outputText };
  }
}

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

const claudeResultFallbackErrorDetails = new Map<string, string>([
  ["error_during_execution", "Claude Code failed during execution."],
  ["error_max_budget_usd", "Claude Code exceeded the configured budget."],
  [
    "error_max_structured_output_retries",
    "Claude Code exhausted structured output retries.",
  ],
  ["error_max_turns", "Claude Code reached the maximum number of turns."],
]);

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

function hasClaudeZeroUsage(usage: ClaudeSdkUsage | undefined): boolean {
  return (
    usage !== undefined &&
    CLAUDE_SYNTHETIC_ZERO_USAGE_KEYS.every((key) => usage[key] === 0)
  );
}

function isClaudeNoResponseRequestedSyntheticMessage(
  message: ClaudeAssistantMessage,
): boolean {
  const nestedMessage = toOptionalRecord(message.message);
  const parsedUsageMessage = claudeAssistantUsageMessageSchema.safeParse(
    message.message,
  );
  return (
    nestedMessage?.model === CLAUDE_SYNTHETIC_MODEL &&
    nestedMessage.role === "assistant" &&
    nestedMessage.stop_reason === "stop_sequence" &&
    nestedMessage.stop_sequence === "" &&
    !hasClaudeAssistantErrorMarker(message) &&
    hasClaudeZeroUsage(
      parsedUsageMessage.success ? parsedUsageMessage.data.usage : undefined,
    ) &&
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
  const originalModelName = toOptionalString(originalModel);
  const fallbackModelName = toOptionalString(fallbackModel);
  if (
    originalModelName === undefined ||
    originalModelName.length === 0 ||
    fallbackModelName === undefined ||
    fallbackModelName.length === 0
  ) {
    return null;
  }
  return { fallbackModel: fallbackModelName, originalModel: originalModelName };
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
  const result = toOptionalString(message.result);
  if (message.is_error && result !== undefined) {
    return result;
  }

  const errors = (message.errors ?? [])
    .map((error) => error.trim())
    .filter((error) => error.length > 0);
  if (errors.length > 0) {
    return errors.join("\n");
  }

  return (
    claudeResultFallbackErrorDetails.get(message.subtype) ??
    `Claude Code result failed: ${message.subtype}`
  );
}

interface ClaudeTurnMirror {
  turnOpen: boolean;
  pendingInputs: number;
  segment: number;
}

interface ClaudeThreadDialectState {
  mirror: ClaudeTurnMirror;
  cumulativeTokens: ThreadEventTokenUsageBreakdown;
  latestRequestContextTokens: number | undefined;
  latestProviderCheckpointId: string | undefined;
  lastModelFallback:
    | (ClaudeModelFallbackTransition & { segment: number })
    | undefined;
  armedHardRateLimitRejection: { detail: string; segment: number } | undefined;
  selectedModelContextWindow: number | null;
  suppressUnacceptedTurnStart: boolean;
  openCompaction: { segment: number } | undefined;
  startedTools: Map<string, ClaudeClassifiedTool>;
  tasksById: ClaudeTaskMap;
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

export interface ClaudeDeltaTranslatorOptions {
  cwd?: string | undefined;
}

export function createClaudeDeltaTranslator(
  options: ClaudeDeltaTranslatorOptions = {},
) {
  const sessionCwd = options.cwd;
  const statesByThreadId = new Map<string, ClaudeThreadDialectState>();
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

  function mirrorCloseTurn(state: ClaudeThreadDialectState): void {
    state.mirror.turnOpen = false;
    state.armedHardRateLimitRejection = undefined;
    state.startedTools.clear();
  }

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

  function isTurnStartSuppressed(state: ClaudeThreadDialectState): boolean {
    return (
      state.suppressUnacceptedTurnStart &&
      !state.mirror.turnOpen &&
      state.mirror.pendingInputs === 0
    );
  }

  function toRawEvent(rawEvent: JsonRpcMessage): ProviderRawEvent {
    const parsed = providerRawEventSchema.safeParse(rawEvent);
    if (parsed.success) {
      return parsed.data;
    }
    const fallbackEvent: JsonRpcMessage = {
      jsonrpc: "2.0",
      method: rawEvent.method,
      params: {
        serializationError:
          "Provider raw event params were not JSON-serializable.",
      },
    };
    if (rawEvent.id !== undefined) {
      fallbackEvent.id = rawEvent.id;
    }
    return providerRawEventSchema.parse(fallbackEvent);
  }

  function sdkEnvelopeFor(
    rawMessage: ClaudeRawSdkMessage,
    context: ClaudeDeltaTranslationContext | undefined,
  ): JsonRpcMessage {
    const params: ClaudeSdkEnvelopeParams = { message: rawMessage };
    if (context?.threadId !== undefined && context.threadId.length > 0) {
      params.threadId = context.threadId;
    }
    return {
      jsonrpc: "2.0",
      method: "sdk/message",
      params,
    };
  }

  function noTurnFallbackFor(
    rawMessage: ClaudeRawSdkMessage,
    context: ClaudeDeltaTranslationContext | undefined,
  ): DeltaNoTurnFallback {
    const rawEvent = sdkEnvelopeFor(rawMessage, context);
    return {
      raw: toRawEvent(rawEvent),
      rawType: claudeCodeVisibilityMetadata.describeRawEvent(rawEvent).kind,
    };
  }

  function unexpectedSdkEventDeltas(
    rawMessage: ClaudeRawSdkMessage,
    context: ClaudeDeltaTranslationContext | undefined,
  ): ThreadDelta[] {
    const fallback = noTurnFallbackFor(rawMessage, context);
    const delta: ClaudeUnhandledDelta = {
      kind: "unhandled",
      raw: fallback.raw,
      rawType: fallback.rawType,
      vouchedTurn: true,
    };
    if (context?.parentToolCallId) {
      delta.parentRef = context.parentToolCallId;
    }
    return [delta];
  }

  function unhandledDeltas(
    rawEvent: JsonRpcMessage,
    parentRef: string | undefined,
  ): ThreadDelta[] {
    const description = claudeCodeVisibilityMetadata.describeRawEvent(rawEvent);
    if (description.coverage !== "unknown") {
      return [];
    }
    const delta: ClaudeUnhandledDelta = {
      kind: "unhandled",
      raw: toRawEvent(rawEvent),
      rawType: description.kind,
      vouchedTurn: true,
    };
    if (parentRef) {
      delta.parentRef = parentRef;
    }
    return [delta];
  }

  function translateSystemMessage(
    event: ClaudeSystemMessage,
    state: ClaudeThreadDialectState,
    context: ClaudeDeltaTranslationContext | undefined,
  ): ThreadDelta[] {
    const apiRetryMessage = claudeApiRetryMessageSchema.safeParse(event);
    if (apiRetryMessage.success) {
      const errorInfo = buildClaudeProviderErrorInfo({
        code: apiRetryMessage.data.error,
        httpStatusCode: apiRetryMessage.data.error_status,
      });
      const retryError: ClaudeProviderErrorDelta = {
        kind: "provider.error",
        message: "Provider error",
        detail: buildClaudeApiRetryDetail(apiRetryMessage.data),
        willRetry: true,
      };
      if (errorInfo !== null) {
        retryError.errorInfo = errorInfo;
      }
      if (isTurnStartSuppressed(state)) {
        return [{ ...retryError, threadScoped: true }];
      }
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
      return [
        {
          kind: "context.compacted",
          noTurnFallback: noTurnFallbackFor(
            parseClaudeJsonRpcObject(event) ?? null,
            context,
          ),
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
      hasForwardedToolUse: (toolUseId) => state.startedTools.has(toolUseId),
    });
    if (taskDeltas !== null) {
      return withMirror(state, taskDeltas);
    }

    return [];
  }

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
    if (state.mirror.segment === 0) {
      return;
    }
    state.lastModelFallback = { ...transition, segment: state.mirror.segment };
  }

  function translateAssistantMessage(
    message: ClaudeAssistantMessage,
    state: ClaudeThreadDialectState,
    context: ClaudeDeltaTranslationContext | undefined,
  ): ThreadDelta[] {
    if (isTurnStartSuppressed(state)) {
      return [];
    }
    const parentToolCallId = context?.parentToolCallId;
    const parentRefField = parentToolCallId
      ? { parentRef: parentToolCallId }
      : {};
    const providerCheckpointId =
      parentToolCallId === undefined ? message.uuid : undefined;

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
      const boundary: ClaudeTurnBoundaryDelta = {
        kind: "turn.boundary",
        status: "completed",
      };
      if (state.latestProviderCheckpointId !== undefined) {
        boundary.providerCheckpointId = state.latestProviderCheckpointId;
      }
      deltas.push(...withMirror(state, [boundary]));
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
        item: classified["shape"],
        presentation: classified.presentation,
      });
      if (classified.planSteps !== undefined) {
        deltas.push(
          planStepsSnapshotDelta(classified.planSteps, parentRefField),
        );
      }
    }
    return deltas;
  }

  function translateStreamEvent(
    message: ClaudeStreamEventMessage,
    state: ClaudeThreadDialectState,
    context: ClaudeDeltaTranslationContext | undefined,
  ): ThreadDelta[] {
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
    message: ClaudeUserMessage,
    state: ClaudeThreadDialectState,
    context: ClaudeDeltaTranslationContext | undefined,
  ): ThreadDelta[] {
    const toolResults = extractToolResults(message);
    if (toolResults.length === 0) {
      return [];
    }
    if (!state.mirror.turnOpen) {
      return unexpectedSdkEventDeltas(
        parseClaudeJsonRpcObject(message) ?? null,
        context,
      );
    }
    const parentToolCallId = context?.parentToolCallId;
    const parentRefField = parentToolCallId
      ? { parentRef: parentToolCallId }
      : {};
    const envelopeToolUseResult =
      toolResults.length === 1
        ? (toOptionalRecord(message)?.tool_use_result ?? undefined)
        : undefined;
    const deltas: ThreadDelta[] = [];
    for (const result of toolResults) {
      const started = state.startedTools.get(result.toolUseId);
      state.startedTools.delete(result.toolUseId);
      const startedItem = started?.["shape"];
      const isCommandResult =
        result.toolName === "Bash" || startedItem?.type === "command";
      const outputText = isCommandResult
        ? extractClaudeCommandExecutionOutput({
            content: result.content,
            toolUseResult: result.toolUseResult,
          })
        : extractResultText(result.content);
      const resultToolName =
        startedItem?.type === "tool" ? startedItem.tool : result.toolName;
      const base =
        started ??
        classifyClaudeToolResultFallback(result.toolName, sessionCwd);
      const status = result.isError ? "failed" : "completed";
      deltas.push({
        kind: "item.close",
        key: { providerItemId: result.toolUseId, ...parentRefField },
        status,
        ...terminalCloseFields(base["shape"], outputText, result.isError),
        item: terminalToolItem(base["shape"], outputText),
        presentation: base.presentation,
      });
      if (resultToolName !== undefined) {
        const planSteps = foldClaudeTaskToolResult({
          state: state.taskPlan,
          toolName: resultToolName,
          input: startedItem?.type === "tool" ? startedItem.args : undefined,
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
    message: ClaudeResultMessage,
    state: ClaudeThreadDialectState,
    context: ClaudeDeltaTranslationContext | undefined,
  ): ThreadDelta[] {
    const resultCanClaimPendingInput =
      message.origin === undefined || message.origin.kind === "human";
    if (
      !state.mirror.turnOpen &&
      (state.mirror.pendingInputs === 0 || !resultCanClaimPendingInput)
    ) {
      return [];
    }
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
      const resultError: ClaudeProviderErrorDelta = {
        kind: "provider.error",
        message: "Provider error",
        detail: resultFailed
          ? getClaudeResultErrorDetail(message)
          : (pendingHardRateLimitRejection?.detail ??
            getClaudeResultErrorDetail(message)),
      };
      if (errorInfo !== null) {
        resultError.errorInfo = errorInfo;
      }
      deltas.push(resultError);
    }
    state.armedHardRateLimitRejection = undefined;
    if (!failed && hasCompletionBlockingClaudeTasks(state.tasksById)) {
      return deltas;
    }
    state.suppressUnacceptedTurnStart = failed;
    const boundary: ClaudeTurnBoundaryDelta = {
      kind: "turn.boundary",
      status: failed ? "failed" : "completed",
    };
    if (state.latestProviderCheckpointId !== undefined) {
      boundary.providerCheckpointId = state.latestProviderCheckpointId;
    }
    deltas.push(...withMirror(state, [boundary]));
    return deltas;
  }

  function translateRateLimitEvent(
    message: ClaudeRateLimitEvent,
    state: ClaudeThreadDialectState,
    context: ClaudeDeltaTranslationContext | undefined,
  ): ThreadDelta[] {
    const rateLimits = normalizeClaudeRateLimits(message);
    if (!isHardClaudeRateLimitRejection(message)) {
      if (
        rateLimits.status === "allowed" &&
        state.mirror.turnOpen &&
        state.armedHardRateLimitRejection?.segment === state.mirror.segment
      ) {
        state.armedHardRateLimitRejection = undefined;
      }
      return [{ kind: "provider.rateLimits", rateLimits }];
    }
    if (isTurnStartSuppressed(state)) {
      return [{ kind: "provider.rateLimits", rateLimits }];
    }
    const deltas = withMirror(state, [{ kind: "turn.open" }]);
    deltas.push({ kind: "provider.rateLimits", rateLimits });
    state.armedHardRateLimitRejection = {
      detail: buildClaudeRateLimitEventDetail(message),
      segment: state.mirror.segment,
    };
    return deltas;
  }

  function translateSdkMessage(
    event: ClaudeRawSdkMessage,
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
        return translateSystemMessage(parsedMessage.data, state, context);
      }
      case "assistant": {
        const parsedMessage = claudeAssistantMessageSchema.safeParse(event);
        if (!parsedMessage.success) {
          return unexpectedSdkEventDeltas(event, context);
        }
        return translateAssistantMessage(parsedMessage.data, state, context);
      }
      case "stream_event": {
        const parsedMessage = claudeStreamEventMessageSchema.safeParse(event);
        if (!parsedMessage.success) {
          return unexpectedSdkEventDeltas(event, context);
        }
        return translateStreamEvent(parsedMessage.data, state, context);
      }
      case "user": {
        const parsedMessage = claudeUserMessageSchema.safeParse(event);
        if (!parsedMessage.success) {
          return unexpectedSdkEventDeltas(event, context);
        }
        return translateUserMessage(parsedMessage.data, state, context);
      }
      case "result": {
        const parsedMessage = claudeResultMessageSchema.safeParse(event);
        if (!parsedMessage.success) {
          return unexpectedSdkEventDeltas(event, context);
        }
        return translateResultMessage(parsedMessage.data, state, context);
      }
      case "rate_limit_event": {
        const parsedMessage = claudeRateLimitEventSchema.safeParse(event);
        if (!parsedMessage.success) {
          return unexpectedSdkEventDeltas(event, context);
        }
        return translateRateLimitEvent(parsedMessage.data, state, context);
      }
    }
  }

  function translate(
    event: ClaudeRawSdkMessage,
    context?: ClaudeDeltaTranslationContext,
  ): ThreadDelta[] {
    const sdkEnvelope = sdkMessageEnvelopeSchema.safeParse(event);
    if (sdkEnvelope.success) {
      const sdkMessage =
        parseClaudeJsonRpcObject(sdkEnvelope.data.params.message) ?? null;
      const nestedParentToolCallId = getNestedParentToolUseId(sdkMessage);
      const parentToolCallId = nestedParentToolCallId
        ? nestedParentToolCallId
        : (sdkEnvelope.data.params.parent_tool_use_id ??
          context?.parentToolCallId);
      const childContext: ClaudeDeltaTranslationContext =
        context === undefined ? {} : { ...context };
      if (parentToolCallId) {
        childContext.parentToolCallId = parentToolCallId;
      }
      const translated = translate(sdkMessage, childContext);
      const rawParams = parseClaudeJsonRpcObject(sdkEnvelope.data.params);
      const rawEvent: JsonRpcMessage = {
        jsonrpc: "2.0",
        method: sdkEnvelope.data.method,
      };
      if (rawParams !== undefined) {
        rawEvent.params = rawParams;
      }
      return translated.length > 0
        ? translated
        : unhandledDeltas(rawEvent, parentToolCallId);
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
      if (isTurnStartSuppressed(state)) {
        return [];
      }
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
      const rawEvent: JsonRpcMessage = {
        jsonrpc: "2.0",
        method: envelope.data.method,
      };
      const params = parseClaudeJsonRpcObject(envelope.data.params);
      if (params !== undefined) {
        rawEvent.params = params;
      }
      return unhandledDeltas(rawEvent, context?.parentToolCallId);
    }

    return translateSdkMessage(event, context);
  }

  function acceptInput(
    threadId: string,
    clientRequestId: ClientTurnRequestId,
  ): ThreadDelta[] {
    const state = stateFor({ threadId });
    state.suppressUnacceptedTurnStart = false;
    return withMirror(state, [{ kind: "input.accepted", clientRequestId }]);
  }

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

  function hasOpenTurn(threadId: string): boolean {
    return statesByThreadId.get(threadId)?.mirror.turnOpen === true;
  }

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
