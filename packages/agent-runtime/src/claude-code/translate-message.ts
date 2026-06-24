import type {
  ProviderErrorInfo,
  ThreadEvent,
  ThreadEventItem,
  ThreadEventTokenUsageBreakdown,
} from "@bb/domain";
import { threadScope, turnScope } from "@bb/domain";
import {
  toOptionalRecord,
  withParentToolCallId,
} from "../shared/adapter-utils.js";
import type { AcceptedUserMessageState } from "../shared/accepted-user-messages.js";
import type {
  EnsureProviderTurnStartedArgs,
  ProviderTurnStateRegistry,
} from "../shared/turn-state.js";
import {
  getOrCreateScopedItemId,
  resolveCompletedScopedItemId,
} from "../shared/scoped-item-ids.js";
import { UNSTAMPED_THREAD_ID } from "../shared/unstamped-thread-id.js";
import type { ProviderTranslationContext } from "../provider-adapter.js";
import {
  claudeApiRetryMessageSchema,
  claudeAssistantMessageSchema,
  claudeCompactBoundarySystemMessageSchema,
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
  type ClaudeToolUseResult,
} from "./schemas.js";
import { buildClaudeProviderErrorInfo } from "./error-info.js";
import {
  translateClaudeTaskMessage,
  type ClaudeTaskMap,
} from "./task-translation.js";
import {
  extractAssistantText,
  extractClaudeContextWindowUsage,
  extractClaudeRequestContextTokens,
  extractStreamTextDelta,
  extractStreamThinkingDelta,
  extractThinkingBlocks,
  extractTokenUsage,
  extractToolResults,
  extractToolUses,
  getNestedMessageId,
} from "./sdk-extraction.js";

export interface ClaudeTurnState {
  assistantMessageCounter: number;
  counter: number;
  currentTurnId: string | undefined;
  cumulativeTokens: ThreadEventTokenUsageBreakdown;
  latestRequestContextTokens: number | undefined;
  openAssistantMessageIdsByScope: Map<string, string>;
  openReasoningItemIdsByScope: Map<string, string>;
  pendingAcceptedUserMessages: AcceptedUserMessageState["pendingAcceptedUserMessages"];
  reasoningItemCounter: number;
  selectedModelContextWindow: number | null;
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

interface ClaudeReasoningItemIdArgs {
  contentIndex: number;
  parentToolCallId?: string;
  state: ClaudeTurnState;
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

function buildClaudeCompactionItemId(turnId: string): string {
  return turnId.length > 0
    ? `claude-compaction-${turnId}`
    : "claude-compaction";
}

function createClaudeReasoningItemId(state: ClaudeTurnState): string {
  state.reasoningItemCounter += 1;
  return `claude-reasoning-${state.reasoningItemCounter}`;
}

function getOrCreateClaudeReasoningItemId(
  args: ClaudeReasoningItemIdArgs,
): string {
  return getOrCreateScopedItemId({
    createItemId: () => createClaudeReasoningItemId(args.state),
    openItemIdsByScope: args.state.openReasoningItemIdsByScope,
    parentToolCallId: args.parentToolCallId,
    scopeId: String(args.contentIndex),
  });
}

function resolveCompletedClaudeReasoningItemId(
  args: ClaudeReasoningItemIdArgs,
): string {
  return resolveCompletedScopedItemId({
    createItemId: () => createClaudeReasoningItemId(args.state),
    openItemIdsByScope: args.state.openReasoningItemIdsByScope,
    parentToolCallId: args.parentToolCallId,
    scopeId: String(args.contentIndex),
  });
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

function isHardClaudeRateLimitRejection(message: ClaudeRateLimitEvent): boolean {
  const info = message.rate_limit_info;
  if (info.status !== "rejected") {
    return false;
  }
  return (
    info.overageStatus !== "allowed" &&
    info.overageStatus !== "allowed_warning"
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

export function translateClaudeSdkMessage(
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
    case "system": {
      const parsedMessage = claudeSystemMessageSchema.safeParse(args.event);
      if (!parsedMessage.success) {
        return args.buildUnexpectedSdkEvent({
          event: args.event,
          context: args.context,
          turnId: fallbackTurnId,
        });
      }
      const apiRetryMessage = claudeApiRetryMessageSchema.safeParse(args.event);
      if (apiRetryMessage.success) {
        const turnId =
          state.currentTurnId ??
          args.ensureTurnStarted({
            events,
            state,
            threadId,
          });
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
      if (statusMessage.success && statusMessage.data.status === "compacting") {
        const turnId = args.ensureTurnStarted({
          events,
          state,
          threadId,
        });
        const compactionItemId = buildClaudeCompactionItemId(turnId);
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

      const taskEvents = translateClaudeTaskMessage({
        ensureTurnStarted: () =>
          args.ensureTurnStarted({ events, state, threadId }),
        event: args.event,
        now: Date.now(),
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
      const parsedMessage = claudeAssistantMessageSchema.safeParse(args.event);
      if (!parsedMessage.success) {
        return args.buildUnexpectedSdkEvent({
          event: args.event,
          context: args.context,
          turnId: fallbackTurnId,
        });
      }
      const message = parsedMessage.data;
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
        events.push({
          type: "turn/completed",
          threadId,
          providerThreadId: "",
          scope: turnScope(turnId),
          status: "completed",
        });
        args.turnState.finishTurn({ state, threadId: stateKey });
        return events;
      }
      const turnId = args.ensureTurnStarted({
        events,
        state,
        threadId,
      });
      const requestContextTokens = extractClaudeRequestContextTokens(message);
      if (requestContextTokens !== null) {
        state.latestRequestContextTokens = requestContextTokens;
      }
      const assistantMessageId = getNestedMessageId(message.message);

      const thinkingBlocks = extractThinkingBlocks(message);
      for (const thinkingBlock of thinkingBlocks) {
        const itemId = resolveCompletedClaudeReasoningItemId({
          state,
          parentToolCallId,
          contentIndex: thinkingBlock.contentIndex,
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
          assistantIdPrefix: "claude-assistant",
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
      const reasoningDelta = extractStreamThinkingDelta(message);
      if (reasoningDelta) {
        const turnId = args.ensureTurnStarted({
          events,
          state,
          threadId,
        });
        const itemId = getOrCreateClaudeReasoningItemId({
          state,
          parentToolCallId,
          contentIndex: reasoningDelta.contentIndex,
        });
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
        const itemId = args.turnState.getOrCreateAssistantMessageId({
          assistantIdPrefix: "claude-assistant",
          parentToolCallId,
          state,
        });
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
      if (state.currentTurnId) {
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
            scope: turnScope(state.currentTurnId),
            contextWindowUsage,
          });
        }
        if (tokenUsage) {
          events.push({
            type: "thread/tokenUsage/updated",
            threadId,
            providerThreadId: "",
            scope: turnScope(state.currentTurnId),
            tokenUsage,
          });
        }
        if (isClaudeResultFailure(message)) {
          events.push(
            buildClaudeProviderErrorEvent({
              detail: getClaudeResultErrorDetail(message),
              errorInfo: buildClaudeProviderErrorInfo({
                httpStatusCode: message.api_error_status,
                resultSubtype: message.subtype,
              }),
              threadId,
              turnId: state.currentTurnId,
            }),
          );
        }
        events.push({
          type: "turn/completed",
          threadId,
          providerThreadId: "",
          scope: turnScope(state.currentTurnId),
          status:
            message.is_error || message.subtype.startsWith("error")
              ? "failed"
              : "completed",
        });
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
      if (!isHardClaudeRateLimitRejection(message)) {
        return [];
      }
      const turnId = state.currentTurnId ?? null;
      events.push(
        buildClaudeProviderErrorEvent({
          detail: buildClaudeRateLimitEventDetail(message),
          errorInfo: {
            category: "rate-limit",
            providerCode: "rate_limit_event",
            httpStatusCode: null,
          },
          threadId,
          turnId,
        }),
      );
      return events;
    }
  }

  return events;
}
