/**
 * Pi event-translation core.
 *
 * Translates pi bridge notifications (the `sdk/message` envelope around raw
 * Pi SDK `AgentSessionEvent`s plus the bridge's own runtime notifications)
 * into bb thread events, and owns the per-thread turn state that translation
 * accumulates. The adapter instantiates one translator per adapter instance;
 * the pi bridge (a separate process entry) instantiates the same translator
 * per canonical session.
 */

import {
  getBuiltinModels,
  getBuiltinProviders,
} from "@earendil-works/pi-ai/providers/all";
import { z } from "zod";
import type {
  ThreadEvent,
  ThreadEventContextWindowUsage,
  ThreadEventItem,
  ThreadEventTokenUsage,
  ThreadEventTokenUsageBreakdown,
} from "@bb/domain";
import { threadScope, toPositiveNumber, turnScope } from "@bb/domain";
import {
  UNSTAMPED_THREAD_ID,
  bashArgsSchema,
  buildFileChangeItem,
  buildGenericToolCallItem,
  buildToolResultItem,
  buildUnhandledProviderEvents,
  createProviderTurnStateRegistry,
  createScopedItemIdFactory,
  createUnhandledProviderEvent,
  errorEnvelopeSchema,
  extractResultText,
  jsonRpcEnvelopeSchema,
  normalizeProviderCommandOutput,
  resolveProviderTerminalTurn,
  sdkMessageEnvelopeSchema,
  textBlockSchema,
  threadContextWindowUsageEnvelopeSchema,
  threadIdentityEnvelopeSchema,
  toNonNegativeNumber,
  toOptionalString,
  withParentToolCallId,
} from "@bb/provider-bridge-protocol/bridge-kit";
import type {
  AcceptedUserMessageState,
  JsonRpcMessage,
} from "@bb/provider-bridge-protocol/bridge-kit";
import type { ProviderTranslationContext } from "../provider-adapter.js";
import { diffCumulativeText } from "./diff-cumulative-text.js";
import { toCanonicalPiModelId } from "./model-list.js";
import { piVisibilityMetadata } from "./visibility.js";

// ---------------------------------------------------------------------------
// Pi event types
// ---------------------------------------------------------------------------

interface PiUnhandledEventArgs {
  rawEvent: JsonRpcMessage;
  turnId?: string;
  parentToolCallId?: string;
}

interface BuildUnexpectedPiSdkEventArgs {
  context?: ProviderTranslationContext;
  rawMessage: unknown;
  turnId?: string;
}

function normalizePiContextWindowUsage(
  usage: ThreadEventContextWindowUsage,
): ThreadEventContextWindowUsage {
  return {
    usedTokens:
      typeof usage.usedTokens === "number" &&
      Number.isFinite(usage.usedTokens) &&
      usage.usedTokens >= 0
        ? usage.usedTokens
        : null,
    modelContextWindow:
      typeof usage.modelContextWindow === "number" &&
      Number.isFinite(usage.modelContextWindow) &&
      usage.modelContextWindow > 0
        ? usage.modelContextWindow
        : null,
    estimated: usage.estimated,
  };
}

interface PiContextWindowModel {
  contextWindow?: number;
  id: string;
  provider: string;
}

// Keep Pi's SDK-level turn_start/turn_end outside the translated event union
// until replay proves they represent bb turn boundaries rather than internal
// provider subturns.
const piEventTypeSchema = z
  .object({
    type: z.enum([
      "agent_end",
      "agent_start",
      "compaction_end",
      "compaction_start",
      "message_update",
      "tool_execution_end",
      "tool_execution_start",
      "tool_execution_update",
    ]),
  })
  .passthrough();

const piPromptSettledEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("pi/prompt/settled"),
  params: z.object({
    threadId: z.string().min(1),
    status: z.enum(["completed", "failed"]),
    error: z.string().optional(),
  }),
});

// Pi events we deliberately drop rather than translate. Without this the
// fallback treats them as unknown and emits a `provider/unhandled` event, which
// renders as "Unhandled Pi event" in the transcript.
//
// `agent_settled` fires after every agent run completes (Pi's
// AgentSession._emitAgentSettled). BB already derives turn completion from
// `agent_end` plus its `willRetry` flag, so the settle signal carries nothing
// extra for us.
const PI_IGNORED_EVENT_TYPES = new Set(["agent_settled"]);

const piIgnoredEventSchema = z
  .object({ type: z.string() })
  .passthrough()
  .refine((event) => PI_IGNORED_EVENT_TYPES.has(event.type));

const piMessageContentBlockSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const piAssistantUsageSchema = z
  .object({
    input: z.number().optional(),
    output: z.number().optional(),
    cacheRead: z.number().optional(),
    cacheWrite: z.number().optional(),
    totalTokens: z.number().optional(),
  })
  .passthrough();

const piAssistantMessageSchema = z
  .object({
    role: z.literal("assistant"),
    content: z.array(piMessageContentBlockSchema),
    stopReason: z.string().optional(),
    errorMessage: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    usage: piAssistantUsageSchema.optional(),
  })
  .passthrough();

const piConversationMessageSchema = z
  .object({
    role: z.string(),
    content: z
      .union([z.string(), z.array(piMessageContentBlockSchema)])
      .optional(),
    stopReason: z.string().optional(),
    errorMessage: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    usage: piAssistantUsageSchema.optional(),
  })
  .passthrough();

const piAgentStartEventSchema = z
  .object({
    type: z.literal("agent_start"),
  })
  .passthrough();

const piAgentEndEventSchema = z
  .object({
    type: z.literal("agent_end"),
    messages: z.array(piConversationMessageSchema),
    providerCheckpointId: z.string().min(1).optional(),
    willRetry: z.boolean().default(false),
  })
  .passthrough();

const piCompactionStartEventSchema = z
  .object({
    type: z.literal("compaction_start"),
    reason: z.enum(["manual", "threshold", "overflow"]),
  })
  .passthrough();

const piCompactionEndEventSchema = z
  .object({
    type: z.literal("compaction_end"),
    reason: z.enum(["manual", "threshold", "overflow"]),
    aborted: z.boolean(),
    errorMessage: z.string().optional(),
  })
  .passthrough();

/**
 * Pi refuses a manual compaction before it calls the model when the session
 * has nothing to summarize. Pi reports the refusal through the same
 * `compaction_end.errorMessage` field as a real failure, so bb must tell them
 * apart: a refusal is a no-op, not a failed turn.
 */
const piCompactionNoopMessages = new Set([
  "Compaction failed: Nothing to compact (session too small)",
  "Compaction failed: Already compacted",
]);

function isPiCompactionNoop(errorMessage: string): boolean {
  return piCompactionNoopMessages.has(errorMessage.trim());
}

const piMessageUpdateEventSchema = z
  .object({
    type: z.literal("message_update"),
    assistantMessageEvent: z
      .object({
        type: z.string(),
        content: z.string().optional(),
        contentIndex: z.number().optional(),
        delta: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const piToolExecutionStartEventSchema = z
  .object({
    type: z.literal("tool_execution_start"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.unknown(),
  })
  .passthrough();

const piToolExecutionEndEventSchema = z
  .object({
    type: z.literal("tool_execution_end"),
    toolCallId: z.string(),
    toolName: z.string(),
    result: z.unknown(),
    isError: z.boolean(),
  })
  .passthrough();

const piToolExecutionUpdateEventSchema = z
  .object({
    type: z.literal("tool_execution_update"),
    toolCallId: z.string(),
    toolName: z.string(),
    partialResult: z.unknown(),
  })
  .passthrough();

const piFileEditArgsSchema = z
  .object({
    path: z.string().optional(),
    oldText: z.string().optional(),
    newText: z.string().optional(),
    content: z.string().optional(),
  })
  .passthrough();

type PiAssistantMessage = z.infer<typeof piAssistantMessageSchema>;
type PiAssistantErrorMessage = PiAssistantMessage & {
  errorMessage: string;
  stopReason: "error";
};
type PiConversationMessage = z.infer<typeof piConversationMessageSchema>;
type PiToolExecutionUpdateEvent = z.infer<
  typeof piToolExecutionUpdateEventSchema
>;

interface PiToolResultTranslationInput {
  callId: string;
  toolName?: string;
  content: unknown;
  isError: boolean;
  parentToolCallId?: string;
  startedItem?: ThreadEventItem;
}

interface PiCommandExecutionOutputDeltaArgs {
  event: PiToolExecutionUpdateEvent;
  previousOutput?: string;
}

interface PiCommandExecutionOutputDelta {
  delta: string;
  reset: boolean;
  snapshot: string;
}

const PI_EMPTY_BASH_OUTPUT_PLACEHOLDERS = ["(no output)"] as const;
const PI_COMMAND_TOOL_NAMES = new Set(["bash"]);
const PI_FILE_CHANGE_TOOL_NAMES = new Set(["edit", "write"]);

interface PiToolUseTranslationInput {
  args: unknown;
  callId: string;
  parentToolCallId?: string;
  toolName: string;
}

function translatePiToolUseItem(
  input: PiToolUseTranslationInput,
): ThreadEventItem {
  const withParent = (item: ThreadEventItem): ThreadEventItem =>
    withParentToolCallId(item, input.parentToolCallId);
  const genericToolCall = (): ThreadEventItem =>
    withParent(buildGenericToolCallItem(input));

  if (PI_COMMAND_TOOL_NAMES.has(input.toolName)) {
    const parsed = bashArgsSchema.safeParse(input.args);
    const command = parsed.success
      ? toOptionalString(parsed.data.command)
      : undefined;
    if (!command) {
      return genericToolCall();
    }
    return withParent({
      type: "commandExecution",
      id: input.callId,
      command,
      cwd: toOptionalString(parsed.success ? parsed.data.cwd : undefined) ?? "",
      status: "pending",
      approvalStatus: null,
    });
  }

  if (PI_FILE_CHANGE_TOOL_NAMES.has(input.toolName)) {
    const parsed = piFileEditArgsSchema.safeParse(input.args);
    if (!parsed.success) {
      return genericToolCall();
    }
    if (!parsed.data.path) {
      return withParent({
        ...buildGenericToolCallItem(input),
        arguments: parsed.data,
      });
    }
    return withParent(
      buildFileChangeItem({
        callId: input.callId,
        path: parsed.data.path,
        oldText: parsed.data.oldText,
        newText: parsed.data.newText ?? parsed.data.content,
      }),
    );
  }

  return genericToolCall();
}

function translatePiToolResultItem(
  input: PiToolResultTranslationInput,
): ThreadEventItem {
  const outputText = extractResultText(input.content);
  const startedItem = input.startedItem;
  const commandOutputText =
    input.toolName === "bash" || startedItem?.type === "commandExecution"
      ? extractPiCommandExecutionOutput(input.content)
      : undefined;
  return buildToolResultItem({
    ...input,
    commandOutputText,
    commandToolNames: PI_COMMAND_TOOL_NAMES,
    fileChangeToolNames: PI_FILE_CHANGE_TOOL_NAMES,
    outputText,
    toolCallResult: outputText,
  });
}

interface PiModelContextWindowLookup {
  byCanonicalId: ReadonlyMap<string, number>;
  byModelId: ReadonlyMap<string, number>;
}

export type PiModelContextWindowResolver = (
  lastAssistant: PiAssistantMessage | undefined,
) => number | null;

function buildPiModelContextWindowLookup(
  models: readonly PiContextWindowModel[],
): PiModelContextWindowLookup {
  const byCanonicalId = new Map<string, number>();
  const byModelId = new Map<string, number>();
  for (const model of models) {
    const contextWindow = toPositiveNumber(model.contextWindow);
    if (contextWindow === undefined) {
      continue;
    }
    byCanonicalId.set(
      toCanonicalPiModelId(model.provider, model.id),
      contextWindow,
    );
    // Aggregator providers share model ids, so this map is ambiguous. It only
    // serves messages that report no provider.
    byModelId.set(model.id, contextWindow);
  }
  return { byCanonicalId, byModelId };
}

function createPiModelContextWindowResolver(): PiModelContextWindowResolver {
  const models = getBuiltinProviders().flatMap((provider) =>
    getBuiltinModels(provider),
  );
  return createPiModelContextWindowResolverFrom(models);
}

/** @internal Test seam: resolve against an explicit catalog. */
export function createPiModelContextWindowResolverFrom(
  models: readonly PiContextWindowModel[],
): PiModelContextWindowResolver {
  const modelContextWindowLookup = buildPiModelContextWindowLookup(models);
  return (lastAssistant) =>
    resolvePiModelContextWindow(lastAssistant, modelContextWindowLookup);
}

// ---------------------------------------------------------------------------
// Per-thread turn state
// ---------------------------------------------------------------------------

export interface PiTurnState {
  assistantMessageCounter: number;
  commandOutputSnapshotsByCallId: Map<string, string>;
  counter: number;
  currentTurnId: string | undefined;
  cumulativeTokens: ThreadEventTokenUsageBreakdown;
  openAssistantMessageIdsByScope: Map<string, string>;
  openScopedItemIdsByScope: Map<string, string>;
  pendingAcceptedUserMessages: AcceptedUserMessageState["pendingAcceptedUserMessages"];
  scopedItemCounter: number;
  toolItemsByCallId: Map<string, ThreadEventItem>;
}

const piCompactionItemIds = createScopedItemIdFactory({
  prefix: "pi-compaction",
});

function resetPiCommandOutputSnapshots(state: PiTurnState): void {
  state.commandOutputSnapshotsByCallId.clear();
}

// ---------------------------------------------------------------------------
// Translator factory
// ---------------------------------------------------------------------------

export interface CreatePiEventTranslatorOptions {
  /** Provider id stamped onto unhandled-event envelopes. */
  providerId: string;
  /** Prefix for bb-owned turn ids emitted by this translator instance. */
  turnIdPrefix?: string;
  /**
   * Prefix for bb-owned assistant/reasoning item ids. The bridge builds one
   * translator per session, which restarts the "pi-assistant-N" counters on
   * resume, so it injects per-session entropy here — a bare counter is the
   * #1224 cross-resume collision.
   */
  itemIdPrefix?: string;
  /**
   * Emit a synthetic `item/started` when an assistant-message or reasoning
   * item opens delta-first. Pi streams bare `message_update` deltas; the
   * canonical event grammar requires every item's first event to be
   * `item/started`, so the bridge opts in (the projection backfill covers
   * persisted history recorded before it did).
   */
  synthesizeItemStarted?: boolean;
  /** Override context-window resolution. Used by unit tests to avoid real catalogs. */
  resolveModelContextWindow?: PiModelContextWindowResolver;
}

export function createPiEventTranslator(
  options: CreatePiEventTranslatorOptions,
) {
  const assistantIdPrefix =
    options.itemIdPrefix === undefined
      ? "pi-assistant"
      : `${options.itemIdPrefix}assistant`;
  const piReasoningItemIds = createScopedItemIdFactory({
    prefix:
      options.itemIdPrefix === undefined
        ? "pi-reasoning"
        : `${options.itemIdPrefix}reasoning`,
  });
  const resolveModelContextWindow =
    options.resolveModelContextWindow ?? createPiModelContextWindowResolver();

  const turnState = createProviderTurnStateRegistry<PiTurnState>({
    createState: () => ({
      assistantMessageCounter: 0,
      commandOutputSnapshotsByCallId: new Map(),
      counter: 0,
      currentTurnId: undefined,
      cumulativeTokens: {
        totalTokens: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      openAssistantMessageIdsByScope: new Map(),
      openScopedItemIdsByScope: new Map(),
      pendingAcceptedUserMessages: [],
      scopedItemCounter: 0,
      toolItemsByCallId: new Map(),
    }),
    onTurnStart: ({ state }) => {
      resetPiCommandOutputSnapshots(state);
    },
    turnIdPrefix: options.turnIdPrefix,
  });

  function resolveState(context?: ProviderTranslationContext): PiTurnState {
    return turnState.getOrCreate({ threadId: context?.threadId ?? "" });
  }

  function buildUnhandledPiEvent(args: PiUnhandledEventArgs): ThreadEvent[] {
    return buildUnhandledProviderEvents({
      providerId: options.providerId,
      rawEvent: args.rawEvent,
      visibilityMetadata: piVisibilityMetadata,
      ...(args.turnId ? { turnId: args.turnId } : {}),
      ...(args.parentToolCallId
        ? { parentToolCallId: args.parentToolCallId }
        : {}),
    });
  }

  function buildUnexpectedPiSdkEvent(
    args: BuildUnexpectedPiSdkEventArgs,
  ): ThreadEvent[] {
    const rawEvent: JsonRpcMessage = {
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        ...(args.context?.threadId ? { threadId: args.context.threadId } : {}),
        message: args.rawMessage,
      },
    };
    return [
      createUnhandledProviderEvent({
        providerId: options.providerId,
        rawEvent,
        rawType: piVisibilityMetadata.describeRawEvent(rawEvent).kind,
        ...(args.turnId ? { turnId: args.turnId } : {}),
        ...(args.context?.parentToolCallId
          ? { parentToolCallId: args.context.parentToolCallId }
          : {}),
      }),
    ];
  }

  function resolvePiActiveTurnId(
    context?: ProviderTranslationContext,
  ): string | undefined {
    if (!context?.threadId) {
      return undefined;
    }
    return turnState.get({ threadId: context.threadId })?.currentTurnId;
  }

  function translatePiEvent(
    event: unknown,
    context?: ProviderTranslationContext,
  ): ThreadEvent[] {
    const sdkEnvelope = sdkMessageEnvelopeSchema.safeParse(event);
    if (sdkEnvelope.success) {
      // Checked here rather than in the recursive call because an empty
      // translation is what triggers the unhandled fallback below.
      if (
        piIgnoredEventSchema.safeParse(sdkEnvelope.data.params.message).success
      ) {
        return [];
      }
      const parentToolCallId =
        sdkEnvelope.data.params.parent_tool_use_id ?? context?.parentToolCallId;
      const translated = translatePiEvent(sdkEnvelope.data.params.message, {
        ...context,
        ...(parentToolCallId ? { parentToolCallId } : {}),
      });
      const fallbackTurnId = resolvePiActiveTurnId(context);
      return translated.length > 0
        ? translated
        : buildUnhandledPiEvent({
            rawEvent: {
              jsonrpc: "2.0",
              method: sdkEnvelope.data.method,
              params: sdkEnvelope.data.params,
            },
            ...(fallbackTurnId ? { turnId: fallbackTurnId } : {}),
            ...(parentToolCallId ? { parentToolCallId } : {}),
          });
    }

    const promptSettledEnvelope =
      piPromptSettledEnvelopeSchema.safeParse(event);
    if (promptSettledEnvelope.success) {
      const stateThreadId =
        context?.threadId ?? promptSettledEnvelope.data.params.threadId;
      const state = turnState.getOrCreate({ threadId: stateThreadId });
      const events: ThreadEvent[] = [];
      const turnId = resolveProviderTerminalTurn({
        events,
        registry: turnState,
        state,
        threadId: UNSTAMPED_THREAD_ID,
      });
      if (turnId === undefined) {
        return events;
      }
      events.push({
        type: "turn/completed",
        threadId: UNSTAMPED_THREAD_ID,
        providerThreadId: "",
        scope: turnScope(turnId),
        status: promptSettledEnvelope.data.params.status,
        ...(promptSettledEnvelope.data.params.error !== undefined
          ? { error: { message: promptSettledEnvelope.data.params.error } }
          : {}),
      });
      turnState.finishTurn({ state, threadId: stateThreadId });
      return events;
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

    const contextWindowUsageEnvelope =
      threadContextWindowUsageEnvelopeSchema.safeParse(event);
    if (contextWindowUsageEnvelope.success) {
      const { threadId = UNSTAMPED_THREAD_ID, contextWindowUsage } =
        contextWindowUsageEnvelope.data.params;
      const state = turnState.getOrCreate({ threadId });
      const turnId = turnState.getCurrentOrLastTurnId({ state });
      return [
        {
          type: "thread/contextWindowUsage/updated",
          threadId,
          providerThreadId: threadId,
          scope: turnScope(turnId),
          contextWindowUsage: normalizePiContextWindowUsage(contextWindowUsage),
        },
      ];
    }

    const errorEnvelope = errorEnvelopeSchema.safeParse(event);
    if (errorEnvelope.success) {
      return turnState.buildErrorEvents({
        contextThreadId: context?.threadId,
        detail: errorEnvelope.data.params?.message ?? "unknown error",
      });
    }

    const envelope = jsonRpcEnvelopeSchema.safeParse(event);
    if (envelope.success) {
      const fallbackTurnId = resolvePiActiveTurnId(context);
      return buildUnhandledPiEvent({
        rawEvent: {
          jsonrpc: "2.0",
          method: envelope.data.method,
          ...(envelope.data.params ? { params: envelope.data.params } : {}),
        },
        ...(fallbackTurnId ? { turnId: fallbackTurnId } : {}),
        parentToolCallId: context?.parentToolCallId,
      });
    }

    const eventType = piEventTypeSchema.safeParse(event);
    if (!eventType.success) {
      return [];
    }
    const threadId = UNSTAMPED_THREAD_ID;
    const events: ThreadEvent[] = [];

    // Resolve per-thread turn state using the context threadId.
    const stateKey = context?.threadId ?? "";
    const state = turnState.getOrCreate({ threadId: stateKey });
    const fallbackTurnId = state.currentTurnId;
    const buildUnexpectedEvent = (rawMessage: unknown): ThreadEvent[] =>
      buildUnexpectedPiSdkEvent({
        rawMessage,
        context,
        ...(fallbackTurnId ? { turnId: fallbackTurnId } : {}),
      });

    switch (eventType.data.type) {
      case "agent_start": {
        const piEvent = piAgentStartEventSchema.safeParse(event);
        if (!piEvent.success) {
          return buildUnexpectedEvent(event);
        }
        turnState.ensureTurnStarted({
          events,
          state,
          threadId,
        });
        break;
      }

      case "compaction_start": {
        const parsed = piCompactionStartEventSchema.safeParse(event);
        if (!parsed.success) {
          return buildUnexpectedEvent(event);
        }
        const turnId =
          parsed.data.reason === "manual"
            ? turnState.ensureTurnStarted({ events, state, threadId })
            : turnState.getCurrentOrLastTurnId({ state });
        if (turnId.length === 0) {
          return buildUnexpectedEvent(event);
        }
        events.push({
          type: "item/started",
          threadId,
          providerThreadId: "",
          scope: turnScope(turnId),
          item: {
            type: "contextCompaction",
            id: piCompactionItemIds.createId(turnId),
          },
        });
        break;
      }

      case "compaction_end": {
        const parsed = piCompactionEndEventSchema.safeParse(event);
        if (!parsed.success) {
          return buildUnexpectedEvent(event);
        }
        const turnId = turnState.getCurrentOrLastTurnId({ state });
        if (turnId.length === 0) {
          return buildUnexpectedEvent(event);
        }
        const compactionNoopDetail =
          parsed.data.reason === "manual" &&
          !parsed.data.aborted &&
          parsed.data.errorMessage !== undefined &&
          isPiCompactionNoop(parsed.data.errorMessage)
            ? parsed.data.errorMessage
            : undefined;
        if (!parsed.data.aborted && !parsed.data.errorMessage) {
          events.push({
            type: "thread/compacted",
            threadId,
            providerThreadId: "",
            scope: turnScope(turnId),
          });
        } else if (compactionNoopDetail !== undefined) {
          events.push({
            type: "provider/warning",
            threadId,
            providerThreadId: "",
            scope: turnScope(turnId),
            category: "compaction-skipped",
            summary: "Context compaction skipped",
            details: compactionNoopDetail,
          });
        } else if (parsed.data.reason !== "manual") {
          events.push({
            type: "provider/error",
            threadId,
            providerThreadId: "",
            scope: turnScope(turnId),
            message: parsed.data.aborted
              ? "Context compaction interrupted"
              : "Context compaction failed",
            detail:
              parsed.data.errorMessage ??
              "Automatic context compaction was interrupted",
          });
        }
        if (parsed.data.reason === "manual" && state.currentTurnId === turnId) {
          events.push({
            type: "turn/completed",
            threadId,
            providerThreadId: "",
            scope: turnScope(turnId),
            status: parsed.data.aborted
              ? "interrupted"
              : parsed.data.errorMessage && compactionNoopDetail === undefined
                ? "failed"
                : "completed",
            ...(parsed.data.errorMessage && compactionNoopDetail === undefined
              ? { error: { message: parsed.data.errorMessage } }
              : {}),
          });
          turnState.finishTurn({ state, threadId: stateKey });
        }
        break;
      }

      case "agent_end": {
        const piEvent = piAgentEndEventSchema.safeParse(event);
        if (!piEvent.success) {
          return buildUnexpectedEvent(event);
        }
        const currentTurnId = resolveProviderTerminalTurn({
          events,
          registry: turnState,
          state,
          threadId,
        });
        if (currentTurnId === undefined) {
          return events;
        }
        const lastAssistant = findLastAssistantMessage(piEvent.data.messages);
        if (piEvent.data.willRetry) {
          if (lastAssistant && isPiAssistantError(lastAssistant)) {
            events.push({
              type: "provider/error",
              threadId,
              providerThreadId: "",
              scope: turnScope(currentTurnId),
              message: "Provider error",
              detail: lastAssistant.errorMessage,
              willRetry: true,
            });
          }
          return events;
        }
        if (lastAssistant && isPiAssistantError(lastAssistant)) {
          resetPiCommandOutputSnapshots(state);
          return [
            ...events,
            ...turnState.buildErrorEvents({
              contextThreadId: context?.threadId,
              detail: lastAssistant.errorMessage,
            }),
          ];
        }
        if (lastAssistant) {
          const text = extractAssistantText(lastAssistant);
          if (text) {
            const itemId = turnState.resolveCompletedAssistantMessageId({
              assistantIdPrefix,
              parentToolCallId: context?.parentToolCallId,
              state,
            });
            events.push({
              type: "item/completed",
              threadId,
              providerThreadId: "",
              scope: turnScope(currentTurnId),
              item: { type: "agentMessage", id: itemId, text },
            });
          }
        }
        const tokenUsage = extractPiTokenUsage(
          lastAssistant,
          state.cumulativeTokens,
          resolveModelContextWindow,
        );
        if (tokenUsage) {
          events.push({
            type: "thread/tokenUsage/updated",
            threadId,
            providerThreadId: "",
            scope: turnScope(currentTurnId),
            tokenUsage,
          });
        }
        events.push({
          type: "turn/completed",
          threadId,
          providerThreadId: "",
          scope: turnScope(currentTurnId),
          status: "completed",
          ...(piEvent.data.providerCheckpointId !== undefined
            ? {
                providerCheckpointId: piEvent.data.providerCheckpointId,
              }
            : {}),
        });
        resetPiCommandOutputSnapshots(state);
        turnState.finishTurn({ state, threadId: stateKey });
        break;
      }

      case "message_update": {
        const piEvent = piMessageUpdateEventSchema.safeParse(event);
        if (!piEvent.success) {
          return buildUnexpectedEvent(event);
        }
        const assistantEvent = piEvent.data.assistantMessageEvent;
        if (assistantEvent.type === "text_delta" && state.currentTurnId) {
          const delta = assistantEvent.delta;
          if (delta) {
            const opensItem = !state.openAssistantMessageIdsByScope.has(
              `${context?.parentToolCallId ?? "root"}:assistant`,
            );
            const itemId = turnState.getOrCreateAssistantMessageId({
              assistantIdPrefix,
              parentToolCallId: context?.parentToolCallId,
              state,
            });
            if (opensItem && options.synthesizeItemStarted === true) {
              events.push({
                type: "item/started",
                threadId,
                providerThreadId: "",
                scope: turnScope(state.currentTurnId),
                item: withParentToolCallId(
                  { type: "agentMessage", id: itemId, text: "" },
                  context?.parentToolCallId,
                ),
              });
            }
            events.push({
              type: "item/agentMessage/delta",
              threadId,
              providerThreadId: "",
              scope: turnScope(state.currentTurnId),
              itemId,
              delta,
            });
          }
        }
        if (assistantEvent.type === "thinking_delta" && state.currentTurnId) {
          const delta = assistantEvent.delta;
          if (delta) {
            if (typeof assistantEvent.contentIndex !== "number") {
              return buildUnexpectedEvent(event);
            }
            const opensItem = !state.openScopedItemIdsByScope.has(
              `${context?.parentToolCallId ?? "root"}:${assistantEvent.contentIndex}`,
            );
            const itemId = piReasoningItemIds.getOrCreate({
              state,
              parentToolCallId: context?.parentToolCallId,
              scopeId: assistantEvent.contentIndex,
            });
            if (opensItem && options.synthesizeItemStarted === true) {
              events.push({
                type: "item/started",
                threadId,
                providerThreadId: "",
                scope: turnScope(state.currentTurnId),
                item: withParentToolCallId(
                  { type: "reasoning", id: itemId, summary: [], content: [] },
                  context?.parentToolCallId,
                ),
              });
            }
            events.push({
              type: "item/reasoning/textDelta",
              threadId,
              providerThreadId: "",
              scope: turnScope(state.currentTurnId),
              itemId,
              delta,
              ...(context?.parentToolCallId
                ? { parentToolCallId: context.parentToolCallId }
                : {}),
            });
          }
        }
        if (assistantEvent.type === "thinking_end" && state.currentTurnId) {
          const content = assistantEvent.content;
          if (content) {
            if (typeof assistantEvent.contentIndex !== "number") {
              return buildUnexpectedEvent(event);
            }
            const itemId = piReasoningItemIds.resolveCompleted({
              state,
              parentToolCallId: context?.parentToolCallId,
              scopeId: assistantEvent.contentIndex,
            });
            events.push({
              type: "item/completed",
              threadId,
              providerThreadId: "",
              scope: turnScope(state.currentTurnId),
              item: withParentToolCallId(
                {
                  type: "reasoning",
                  id: itemId,
                  summary: [],
                  content: [content],
                },
                context?.parentToolCallId,
              ),
            });
          }
        }
        break;
      }

      case "tool_execution_start": {
        const piEvent = piToolExecutionStartEventSchema.safeParse(event);
        if (!piEvent.success) {
          return buildUnexpectedEvent(event);
        }
        if (!state.currentTurnId) {
          return buildUnexpectedEvent(piEvent.data);
        }
        // Close any open assistant message scope so the final assistant
        // text at agent_end gets a fresh ID and doesn't overwrite
        // earlier streamed content.
        turnState.resolveCompletedAssistantMessageId({
          assistantIdPrefix,
          parentToolCallId: context?.parentToolCallId,
          state,
        });
        const item = translatePiToolUseItem({
          callId: piEvent.data.toolCallId,
          toolName: piEvent.data.toolName,
          args: piEvent.data.args,
          parentToolCallId: context?.parentToolCallId,
        });
        state.toolItemsByCallId.set(piEvent.data.toolCallId, item);
        events.push({
          type: "item/started",
          threadId,
          providerThreadId: "",
          scope: turnScope(state.currentTurnId),
          item,
        });
        break;
      }

      case "tool_execution_end": {
        const piEvent = piToolExecutionEndEventSchema.safeParse(event);
        if (!piEvent.success) {
          return buildUnexpectedEvent(event);
        }
        if (!state.currentTurnId) {
          return buildUnexpectedEvent(piEvent.data);
        }
        const startedItem = state.toolItemsByCallId.get(
          piEvent.data.toolCallId,
        );
        events.push({
          type: "item/completed",
          threadId,
          providerThreadId: "",
          scope: turnScope(state.currentTurnId),
          item: translatePiToolResultItem({
            callId: piEvent.data.toolCallId,
            toolName: piEvent.data.toolName,
            content: piEvent.data.result,
            isError: piEvent.data.isError,
            startedItem,
            parentToolCallId: context?.parentToolCallId,
          }),
        });
        state.toolItemsByCallId.delete(piEvent.data.toolCallId);
        state.commandOutputSnapshotsByCallId.delete(piEvent.data.toolCallId);
        break;
      }

      case "tool_execution_update": {
        const piEvent = piToolExecutionUpdateEventSchema.safeParse(event);
        if (!piEvent.success) {
          return buildUnexpectedEvent(event);
        }
        if (!state.currentTurnId) {
          return buildUnexpectedEvent(piEvent.data);
        }
        if (piEvent.data.toolName === "bash") {
          const outputDelta = extractPiCommandExecutionOutputDelta({
            event: piEvent.data,
            previousOutput: state.commandOutputSnapshotsByCallId.get(
              piEvent.data.toolCallId,
            ),
          });
          if (outputDelta) {
            state.commandOutputSnapshotsByCallId.set(
              piEvent.data.toolCallId,
              outputDelta.snapshot,
            );
            events.push({
              type: "item/commandExecution/outputDelta",
              threadId,
              providerThreadId: "",
              scope: turnScope(state.currentTurnId),
              itemId: piEvent.data.toolCallId,
              delta: outputDelta.delta,
              ...(outputDelta.reset ? { reset: true } : {}),
              ...(context?.parentToolCallId
                ? { parentToolCallId: context.parentToolCallId }
                : {}),
            });
          }
          break;
        }
        const progressMessage = extractPiToolProgressText(piEvent.data);
        if (progressMessage) {
          events.push({
            type: "item/toolCall/progress",
            threadId,
            providerThreadId: "",
            scope: turnScope(state.currentTurnId),
            itemId: piEvent.data.toolCallId,
            message: progressMessage,
            ...(context?.parentToolCallId
              ? { parentToolCallId: context.parentToolCallId }
              : {}),
          });
        }
        break;
      }

      default:
        break;
    }

    return events;
  }

  return { resolveState, translatePiEvent, turnState };
}

export type PiEventTranslator = ReturnType<typeof createPiEventTranslator>;

// ---------------------------------------------------------------------------
// Pi SDK event extraction helpers
// ---------------------------------------------------------------------------

function findLastAssistantMessage(
  messages: PiConversationMessage[],
): PiAssistantMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const parsedMessage = piAssistantMessageSchema.safeParse(message);
    if (parsedMessage.success) {
      return parsedMessage.data;
    }
  }
  return undefined;
}

function extractAssistantText(message: PiAssistantMessage): string | undefined {
  const content = message.content;
  const chunks: string[] = [];
  for (const block of content) {
    const parsedBlock = textBlockSchema.safeParse(block);
    if (parsedBlock.success) {
      chunks.push(parsedBlock.data.text);
    }
  }
  const text = chunks.join("\n").trim();
  return text.length > 0 ? text : undefined;
}

function isPiAssistantError(
  message: PiAssistantMessage,
): message is PiAssistantErrorMessage {
  return (
    message.stopReason === "error" &&
    typeof message.errorMessage === "string" &&
    message.errorMessage.trim().length > 0
  );
}

function extractPiTokenUsage(
  lastAssistant: PiAssistantMessage | undefined,
  cumulativeTokens: ThreadEventTokenUsageBreakdown,
  resolveModelContextWindow: PiModelContextWindowResolver,
): ThreadEventTokenUsage | undefined {
  const last = toAssistantUsageBreakdown(lastAssistant);
  if (!last) {
    return undefined;
  }
  const modelContextWindow = resolveModelContextWindow(lastAssistant);

  // Accumulate into the per-thread cumulative total
  cumulativeTokens.totalTokens += last.totalTokens;
  cumulativeTokens.inputTokens += last.inputTokens;
  cumulativeTokens.cachedInputTokens += last.cachedInputTokens;
  cumulativeTokens.outputTokens += last.outputTokens;
  cumulativeTokens.reasoningOutputTokens += last.reasoningOutputTokens;

  return {
    total: { ...cumulativeTokens },
    last,
    modelContextWindow,
  };
}

function resolvePiModelContextWindow(
  lastAssistant: PiAssistantMessage | undefined,
  modelContextWindowLookup: PiModelContextWindowLookup,
): number | null {
  const modelId = toOptionalString(lastAssistant?.model);
  if (!modelId) {
    return null;
  }

  // Pi reports the provider and the provider-native model id separately, and an
  // aggregator model id such as "deepseek/deepseek-v4-flash" also names a
  // direct provider's model. A known provider therefore decides the answer on
  // its own. Falling back to the id alone would hand a model another provider's
  // window whenever the catalog lacks the pair, which happens for models the
  // network refresh added and for custom models.
  const providerId = toOptionalString(lastAssistant?.provider);
  if (providerId) {
    return (
      modelContextWindowLookup.byCanonicalId.get(
        toCanonicalPiModelId(providerId, modelId),
      ) ?? null
    );
  }

  return modelContextWindowLookup.byModelId.get(modelId) ?? null;
}

function extractPiCommandExecutionOutput(content: unknown): string | undefined {
  return normalizeProviderCommandOutput({
    text: extractResultText(content),
    emptyPlaceholders: PI_EMPTY_BASH_OUTPUT_PLACEHOLDERS,
  });
}

function extractPiCommandExecutionOutputDelta(
  args: PiCommandExecutionOutputDeltaArgs,
): PiCommandExecutionOutputDelta | null {
  const nextOutput = extractPiCommandExecutionOutput(args.event.partialResult);
  if (nextOutput === undefined) {
    return null;
  }
  const delta = diffCumulativeText({
    previousText: args.previousOutput,
    nextText: nextOutput,
  });
  return delta
    ? {
        delta: delta.delta,
        reset: delta.reset,
        snapshot: delta.nextText,
      }
    : null;
}

function extractPiToolProgressText(event: PiToolExecutionUpdateEvent): string {
  const text = extractResultText(event.partialResult).trim();
  return text.length > 0 ? text : `${event.toolName} progress update`;
}

function toAssistantUsageBreakdown(
  lastAssistant: PiAssistantMessage | undefined,
): ThreadEventTokenUsageBreakdown | undefined {
  const typedUsage = lastAssistant?.usage;
  if (!typedUsage) return undefined;

  const inputTokens = toNonNegativeNumber(typedUsage.input);
  const outputTokens = toNonNegativeNumber(typedUsage.output);
  const cachedInputTokens =
    toNonNegativeNumber(typedUsage.cacheRead) +
    toNonNegativeNumber(typedUsage.cacheWrite);
  const totalTokens = toNonNegativeNumber(typedUsage.totalTokens);

  return {
    totalTokens:
      totalTokens > 0
        ? totalTokens
        : inputTokens + outputTokens + cachedInputTokens,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens: 0,
  };
}
