/**
 * ACP event-translation core.
 *
 * Translates ACP bridge notifications into bb thread events and owns the
 * per-thread turn state that translation accumulates. The adapter instantiates
 * one translator per adapter instance; the acp bridge (a separate process
 * entry) can instantiate the same translator.
 */

import {
  type ThreadEvent,
  type ThreadEventItem,
  type ThreadEventItemStatus,
  type ThreadEventPlanStep,
  threadScope,
  turnScope,
  UNSTAMPED_THREAD_ID,
  buildEditDiff,
  buildUnhandledProviderEvents,
  completeStartedToolItem,
  createProviderTurnStateRegistry,
  createScopedItemIdFactory,
  errorEnvelopeSchema,
  extractResultText,
  jsonRpcEnvelopeSchema,
  resolveProviderTerminalTurn,
  threadIdentityEnvelopeSchema,
  toOptionalString,
  withParentToolCallId,
  type AcceptedUserMessageState,
  type ProviderRuntimeEvent,
} from "@get-bb/plugin-sdk/provider-bridge";
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
  ACP_COMPACTION_COMPLETED_METHOD,
  ACP_COMPACTION_STARTED_METHOD,
  ACP_FS_WRITE_METHOD,
  ACP_TURN_COMPLETED_METHOD,
  ACP_TURN_STARTED_METHOD,
  ACP_UPDATE_METHOD,
  ACP_WARNING_METHOD,
  acpCompactionCompletedNotificationParamsSchema,
  acpFsWriteNotificationParamsSchema,
  acpTurnCompletedNotificationParamsSchema,
  acpTurnStartedNotificationParamsSchema,
  acpUpdateNotificationParamsSchema,
  acpWarningNotificationParamsSchema,
} from "./bridge-protocol.js";
import {
  type AcpToolCallOperation,
  classifyAcpToolCall,
} from "./tool-call-operation.js";
import { acpVisibilityMetadata } from "./visibility.js";
import {
  acpAgentMessageChunkUpdateSchema,
  acpAgentThoughtChunkUpdateSchema,
  acpPlanUpdateSchema,
  acpToolCallUpdateEventSchema,
  acpUsageUpdateSchema,
  extractAcpContentText,
  type AcpSessionUpdate,
  type AcpStopReason,
  type AcpToolCallUpdateEvent,
} from "./wire.js";

// ---------------------------------------------------------------------------
// Per-thread turn state & pure helpers
// ---------------------------------------------------------------------------

export interface AcpTurnState extends AcceptedUserMessageState {
  assistantMessageCounter: number;
  counter: number;
  currentTurnId: string | undefined;
  cumulativeTokens: {
    totalTokens: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
  };
  agentMessageTextsByItemId: Map<string, string>;
  fsWriteCounter: number;
  openAssistantMessageIdsByScope: Map<string, string>;
  openScopedItemIdsByScope: Map<string, string>;
  scopedItemCounter: number;
  thoughtTextsByItemId: Map<string, string>;
  toolCallEventsByCallId: Map<string, AcpToolCallUpdateEvent>;
  toolItemsByCallId: Map<string, ThreadEventItem>;
}

const ACP_PLAN_STEP_STATUS_BY_ENTRY_STATUS = {
  pending: "pending",
  in_progress: "active",
  completed: "completed",
} as const;

function mapAcpToolCallStatus(
  status: AcpToolCallUpdateEvent["status"],
): "pending" | "completed" | "failed" {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}

function extractAcpToolCallOutputText(
  event: AcpToolCallUpdateEvent,
): string | undefined {
  const chunks: string[] = [];
  for (const entry of event.content ?? []) {
    if (entry.type !== "content") {
      continue;
    }
    const text = extractAcpContentText(entry.content);
    if (text) {
      chunks.push(text);
    }
  }
  if (chunks.length > 0) {
    return chunks.join("\n");
  }
  if (event.rawOutput === undefined) {
    return undefined;
  }
  const rawOutputText = extractResultText(event.rawOutput).trim();
  return rawOutputText.length > 0 ? rawOutputText : undefined;
}

function buildAcpFileChangesFromToolCall(
  event: AcpToolCallUpdateEvent,
  operation: Extract<AcpToolCallOperation, { kind: "file_change" }>,
): Extract<ThreadEventItem, { type: "fileChange" }>["changes"] {
  const changes: Extract<ThreadEventItem, { type: "fileChange" }>["changes"] =
    [];
  for (const entry of event.content ?? []) {
    if (entry.type !== "diff") {
      continue;
    }
    const oldText = entry.oldText ?? undefined;
    const diff = buildEditDiff(entry.path, oldText, entry.newText);
    changes.push({
      path: entry.path,
      kind: oldText === undefined ? "add" : "update",
      ...(diff ? { diff } : {}),
    });
  }
  if (changes.length > 0) {
    return changes;
  }
  const [path] = operation.paths;
  return path === undefined ? [] : [{ path, kind: operation.changeKind }];
}

function translateAcpToolCallItem(
  event: AcpToolCallUpdateEvent,
  parentToolCallId: string | undefined,
): ThreadEventItem {
  const status = mapAcpToolCallStatus(event.status);
  const operation = classifyAcpToolCall(event);

  if (operation.kind === "command") {
    const outputText = extractAcpToolCallOutputText(event);
    return withParentToolCallId(
      {
        type: "commandExecution",
        id: event.toolCallId,
        command: operation.command,
        cwd: "",
        status,
        approvalStatus: null,
        ...(outputText === undefined ? {} : { aggregatedOutput: outputText }),
        ...(status === "completed" || status === "failed"
          ? { exitCode: status === "failed" ? 1 : 0 }
          : {}),
      },
      parentToolCallId,
    );
  }

  if (operation.kind === "file_change") {
    const fileChanges = buildAcpFileChangesFromToolCall(event, operation);
    if (fileChanges.length > 0) {
      return withParentToolCallId(
        {
          type: "fileChange",
          id: event.toolCallId,
          changes: fileChanges,
          status,
          approvalStatus: null,
        },
        parentToolCallId,
      );
    }
  }

  const outputText = extractAcpToolCallOutputText(event);
  return withParentToolCallId(
    {
      type: "toolCall",
      id: event.toolCallId,
      tool: toOptionalString(event.title) ?? event.kind ?? "tool",
      status,
      ...(outputText === undefined ? {} : { result: outputText }),
    },
    parentToolCallId,
  );
}

function completeAcpStartedToolItem(
  item: ThreadEventItem,
  event: AcpToolCallUpdateEvent | undefined,
  status: ThreadEventItemStatus,
  parentToolCallId: string | undefined,
): ThreadEventItem {
  const outputText = event ? extractAcpToolCallOutputText(event) : undefined;
  return (
    completeStartedToolItem({
      callId: item.id,
      commandOutputText: outputText,
      ...(status === "completed" || status === "failed"
        ? { exitCode: status === "failed" ? 1 : 0 }
        : {}),
      outputText,
      parentToolCallId,
      startedItem: item,
      status,
      toolCallResult: outputText,
    }) ?? item
  );
}

function buildAcpTerminalToolCallItems(args: {
  completedItem: ThreadEventItem;
  event: AcpToolCallUpdateEvent;
  parentToolCallId: string | undefined;
  startedItem: ThreadEventItem | undefined;
  status: ThreadEventItemStatus;
}): ThreadEventItem[] {
  if (!args.startedItem) {
    return [args.completedItem];
  }
  if (args.startedItem.type === args.completedItem.type) {
    return [args.completedItem];
  }
  return [
    completeAcpStartedToolItem(
      args.startedItem,
      args.event,
      args.status,
      args.parentToolCallId,
    ),
    args.completedItem,
  ];
}

/**
 * Merge a tool_call_update into the started tool_call event: updates carry
 * only changed fields, so absent fields keep the started event's values and
 * the merged event re-translates with the original classification intact.
 */
function mergeAcpToolCallEvents(
  started: AcpToolCallUpdateEvent | undefined,
  update: AcpToolCallUpdateEvent,
): AcpToolCallUpdateEvent {
  if (!started) {
    return update;
  }
  return {
    ...started,
    ...(update.title !== undefined ? { title: update.title } : {}),
    ...(update.kind !== undefined ? { kind: update.kind } : {}),
    ...(update.status !== undefined ? { status: update.status } : {}),
    ...(update.content !== undefined ? { content: update.content } : {}),
    ...(update.locations !== undefined ? { locations: update.locations } : {}),
    ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
    ...(update.rawOutput !== undefined ? { rawOutput: update.rawOutput } : {}),
  };
}

// ---------------------------------------------------------------------------
// Translator factory
// ---------------------------------------------------------------------------

export interface CreateAcpEventTranslatorOptions {
  /** Provider id stamped onto unhandled-event envelopes. */
  providerId: string;
  /** Prefix for bb-owned turn ids emitted by this translator instance. */
  turnIdPrefix?: string;
  /**
   * Prefix for bb-owned assistant/reasoning item ids. The legacy adapter keeps
   * one translator per thread for the process lifetime, so its per-session
   * counters ("acp-assistant-N") stay unique. A per-session translator (the
   * canonical bridge surface) restarts those counters on resume, so it must
   * inject per-session entropy here — a bare counter is the #1224 cross-resume
   * collision.
   */
  itemIdPrefix?: string;
  /**
   * Emit a synthetic `item/started` when an assistant-message or reasoning
   * item opens delta-first. ACP streams bare chunks; the canonical event
   * grammar requires every item's first event to be `item/started`, so the
   * protocol-pure surface opts in while the legacy adapter keeps its
   * delta-first shape (the projection backfill covers persisted history).
   */
  synthesizeItemStarted?: boolean;
}

export function createAcpEventTranslator(
  options: CreateAcpEventTranslatorOptions,
) {
  const assistantIdPrefix =
    options.itemIdPrefix === undefined
      ? "acp-assistant"
      : `${options.itemIdPrefix}assistant`;
  const acpReasoningItemIds = createScopedItemIdFactory({
    prefix:
      options.itemIdPrefix === undefined
        ? "acp-reasoning"
        : `${options.itemIdPrefix}reasoning`,
  });
  const acpCompactionItemIds = createScopedItemIdFactory({
    prefix:
      options.itemIdPrefix === undefined
        ? "acp-compaction"
        : `${options.itemIdPrefix}compaction`,
  });
  const turnState = createProviderTurnStateRegistry<AcpTurnState>({
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
      agentMessageTextsByItemId: new Map(),
      fsWriteCounter: 0,
      openAssistantMessageIdsByScope: new Map(),
      openScopedItemIdsByScope: new Map(),
      pendingAcceptedUserMessages: [],
      scopedItemCounter: 0,
      thoughtTextsByItemId: new Map(),
      toolCallEventsByCallId: new Map(),
      toolItemsByCallId: new Map(),
    }),
    onTurnStart: ({ state }) => {
      state.agentMessageTextsByItemId.clear();
      state.thoughtTextsByItemId.clear();
      state.toolCallEventsByCallId.clear();
    },
    turnIdPrefix: options.turnIdPrefix,
  });

  function resolveState(context?: ProviderTranslationContext): AcpTurnState {
    return turnState.getOrCreate({ threadId: context?.threadId ?? "" });
  }

  /** Close the open thought item (if any) with its accumulated content. */
  function flushOpenThoughtItem(
    events: ThreadEvent[],
    state: AcpTurnState,
    parentToolCallId: string | undefined,
  ): void {
    if (!state.currentTurnId) {
      return;
    }
    const scopeKey = `${parentToolCallId ?? "root"}:thought`;
    const openItemId = state.openScopedItemIdsByScope.get(scopeKey);
    if (!openItemId) {
      return;
    }
    const itemId = acpReasoningItemIds.resolveCompleted({
      state,
      parentToolCallId,
      scopeId: "thought",
    });
    const content = state.thoughtTextsByItemId.get(itemId) ?? "";
    state.thoughtTextsByItemId.delete(itemId);
    if (content.trim().length === 0) {
      return;
    }
    events.push({
      type: "item/completed",
      threadId: UNSTAMPED_THREAD_ID,
      providerThreadId: "",
      scope: turnScope(state.currentTurnId),
      item: withParentToolCallId(
        { type: "reasoning", id: itemId, summary: [], content: [content] },
        parentToolCallId,
      ),
    });
  }

  /** Close the open assistant message item with its accumulated text. */
  function flushOpenAgentMessageItem(
    events: ThreadEvent[],
    state: AcpTurnState,
    parentToolCallId: string | undefined,
  ): void {
    if (!state.currentTurnId) {
      return;
    }
    const scopeKey = `${parentToolCallId ?? "root"}:assistant`;
    const openItemId = state.openAssistantMessageIdsByScope.get(scopeKey);
    if (!openItemId) {
      return;
    }
    const itemId = turnState.resolveCompletedAssistantMessageId({
      assistantIdPrefix,
      parentToolCallId,
      state,
    });
    const text = state.agentMessageTextsByItemId.get(itemId) ?? "";
    state.agentMessageTextsByItemId.delete(itemId);
    if (text.trim().length === 0) {
      return;
    }
    events.push({
      type: "item/completed",
      threadId: UNSTAMPED_THREAD_ID,
      providerThreadId: "",
      scope: turnScope(state.currentTurnId),
      item: withParentToolCallId(
        { type: "agentMessage", id: itemId, text },
        parentToolCallId,
      ),
    });
  }

  function completeOpenToolCallItems(args: {
    events: ThreadEvent[];
    parentToolCallId: string | undefined;
    state: AcpTurnState;
    status: ThreadEventItemStatus;
    turnId: string;
  }): void {
    for (const [callId, startedItem] of args.state.toolItemsByCallId) {
      const latestEvent = args.state.toolCallEventsByCallId.get(callId);
      const latestItem = latestEvent
        ? translateAcpToolCallItem(latestEvent, args.parentToolCallId)
        : startedItem;
      const completedItems =
        latestItem.type === startedItem.type
          ? [
              completeAcpStartedToolItem(
                latestItem,
                latestEvent,
                args.status,
                args.parentToolCallId,
              ),
            ]
          : [
              completeAcpStartedToolItem(
                startedItem,
                latestEvent,
                args.status,
                args.parentToolCallId,
              ),
              completeAcpStartedToolItem(
                latestItem,
                latestEvent,
                args.status,
                args.parentToolCallId,
              ),
            ];
      for (const item of completedItems) {
        args.events.push({
          type: "item/completed",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(args.turnId),
          item,
        });
      }
    }
    args.state.toolItemsByCallId.clear();
    args.state.toolCallEventsByCallId.clear();
  }

  function flushOpenTurnItems(args: {
    events: ThreadEvent[];
    parentToolCallId: string | undefined;
    state: AcpTurnState;
    status: ThreadEventItemStatus;
    turnId: string;
  }): void {
    flushOpenThoughtItem(args.events, args.state, args.parentToolCallId);
    flushOpenAgentMessageItem(args.events, args.state, args.parentToolCallId);
    completeOpenToolCallItems(args);
  }

  function translateAcpUpdate(
    update: AcpSessionUpdate,
    state: AcpTurnState,
    context?: ProviderTranslationContext,
  ): ThreadEvent[] {
    const events: ThreadEvent[] = [];
    const parentToolCallId = context?.parentToolCallId;
    if (!state.currentTurnId) {
      switch (update.sessionUpdate) {
        case "agent_message_chunk":
        case "agent_thought_chunk":
        case "tool_call":
        case "tool_call_update":
        case "plan":
          return buildUnhandledProviderEvents({
            includeKnown: true,
            providerId: options.providerId,
            rawEvent: {
              jsonrpc: "2.0",
              method: ACP_UPDATE_METHOD,
              params: { update },
            },
            visibilityMetadata: acpVisibilityMetadata,
            ...(parentToolCallId ? { parentToolCallId } : {}),
          });
      }
    }

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const parsed = acpAgentMessageChunkUpdateSchema.safeParse(update);
        const text = parsed.success
          ? extractAcpContentText(parsed.data.content)
          : undefined;
        if (text === undefined) {
          return [];
        }
        const turnId = state.currentTurnId;
        if (!turnId) return [];
        flushOpenThoughtItem(events, state, parentToolCallId);
        const opensItem = !state.openAssistantMessageIdsByScope.has(
          `${parentToolCallId ?? "root"}:assistant`,
        );
        const itemId = turnState.getOrCreateAssistantMessageId({
          assistantIdPrefix,
          parentToolCallId,
          state,
        });
        if (opensItem && options.synthesizeItemStarted === true) {
          events.push({
            type: "item/started",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            item: withParentToolCallId(
              { type: "agentMessage", id: itemId, text: "" },
              parentToolCallId,
            ),
          });
        }
        state.agentMessageTextsByItemId.set(
          itemId,
          (state.agentMessageTextsByItemId.get(itemId) ?? "") + text,
        );
        events.push({
          type: "item/agentMessage/delta",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          itemId,
          delta: text,
          ...(parentToolCallId ? { parentToolCallId } : {}),
        });
        return events;
      }

      case "agent_thought_chunk": {
        const parsed = acpAgentThoughtChunkUpdateSchema.safeParse(update);
        const text = parsed.success
          ? extractAcpContentText(parsed.data.content)
          : undefined;
        if (text === undefined) {
          return [];
        }
        const turnId = state.currentTurnId;
        if (!turnId) return [];
        const opensItem = !state.openScopedItemIdsByScope.has(
          `${parentToolCallId ?? "root"}:thought`,
        );
        const itemId = acpReasoningItemIds.getOrCreate({
          state,
          parentToolCallId,
          scopeId: "thought",
        });
        if (opensItem && options.synthesizeItemStarted === true) {
          events.push({
            type: "item/started",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            item: withParentToolCallId(
              { type: "reasoning", id: itemId, summary: [], content: [] },
              parentToolCallId,
            ),
          });
        }
        state.thoughtTextsByItemId.set(
          itemId,
          (state.thoughtTextsByItemId.get(itemId) ?? "") + text,
        );
        events.push({
          type: "item/reasoning/textDelta",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          itemId,
          delta: text,
          ...(parentToolCallId ? { parentToolCallId } : {}),
        });
        return events;
      }

      case "tool_call": {
        const parsed = acpToolCallUpdateEventSchema.safeParse(update);
        if (!parsed.success) {
          return [];
        }
        const turnId = state.currentTurnId;
        if (!turnId) return [];
        flushOpenThoughtItem(events, state, parentToolCallId);
        flushOpenAgentMessageItem(events, state, parentToolCallId);
        const item = translateAcpToolCallItem(parsed.data, parentToolCallId);
        const isTerminal =
          item.type !== "agentMessage" && "status" in item
            ? item.status === "completed" || item.status === "failed"
            : false;
        if (isTerminal) {
          events.push({
            type: "item/completed",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            item,
          });
          return events;
        }
        state.toolCallEventsByCallId.set(parsed.data.toolCallId, parsed.data);
        state.toolItemsByCallId.set(parsed.data.toolCallId, item);
        events.push({
          type: "item/started",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          item,
        });
        return events;
      }

      case "tool_call_update": {
        const parsed = acpToolCallUpdateEventSchema.safeParse(update);
        if (!parsed.success || !state.currentTurnId) {
          return [];
        }
        const startedEvent = state.toolCallEventsByCallId.get(
          parsed.data.toolCallId,
        );
        const startedItem = state.toolItemsByCallId.get(parsed.data.toolCallId);
        const mergedEvent = mergeAcpToolCallEvents(startedEvent, parsed.data);
        const mergedItem = translateAcpToolCallItem(
          mergedEvent,
          parentToolCallId,
        );
        if (
          mergedEvent.status === "completed" ||
          mergedEvent.status === "failed"
        ) {
          state.toolCallEventsByCallId.delete(parsed.data.toolCallId);
          state.toolItemsByCallId.delete(parsed.data.toolCallId);
          const terminalStatus = mapAcpToolCallStatus(mergedEvent.status);
          for (const item of buildAcpTerminalToolCallItems({
            completedItem: mergedItem,
            event: mergedEvent,
            parentToolCallId,
            startedItem,
            status: terminalStatus,
          })) {
            events.push({
              type: "item/completed",
              threadId: UNSTAMPED_THREAD_ID,
              providerThreadId: "",
              scope: turnScope(state.currentTurnId),
              item,
            });
          }
          return events;
        }
        state.toolCallEventsByCallId.set(parsed.data.toolCallId, mergedEvent);
        if (!startedItem || startedItem.type === mergedItem.type) {
          state.toolItemsByCallId.set(parsed.data.toolCallId, mergedItem);
        }
        const progressText = extractAcpToolCallOutputText(parsed.data);
        if (progressText && mergedItem.type === "toolCall") {
          events.push({
            type: "item/toolCall/progress",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(state.currentTurnId),
            itemId: parsed.data.toolCallId,
            message: progressText,
            ...(parentToolCallId ? { parentToolCallId } : {}),
          });
        }
        return events;
      }

      case "plan": {
        const parsed = acpPlanUpdateSchema.safeParse(update);
        if (!parsed.success) {
          return [];
        }
        const turnId = state.currentTurnId;
        if (!turnId) return [];
        const plan: ThreadEventPlanStep[] = parsed.data.entries.map(
          (entry) => ({
            step: entry.content,
            ...(entry.status
              ? { status: ACP_PLAN_STEP_STATUS_BY_ENTRY_STATUS[entry.status] }
              : {}),
          }),
        );
        events.push({
          type: "turn/plan/updated",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          plan,
        });
        return events;
      }

      case "usage_update": {
        const parsed = acpUsageUpdateSchema.safeParse(update);
        if (!parsed.success) {
          return [];
        }
        return [
          {
            type: "thread/contextWindowUsage/updated",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: state.currentTurnId
              ? turnScope(state.currentTurnId)
              : threadScope(),
            contextWindowUsage: {
              usedTokens: parsed.data.used,
              modelContextWindow: parsed.data.size,
              estimated: false,
            },
          },
        ];
      }

      default:
        return buildUnhandledProviderEvents({
          providerId: options.providerId,
          rawEvent: {
            jsonrpc: "2.0",
            method: ACP_UPDATE_METHOD,
            params: { update },
          },
          visibilityMetadata: acpVisibilityMetadata,
          ...(state.currentTurnId ? { turnId: state.currentTurnId } : {}),
          ...(parentToolCallId ? { parentToolCallId } : {}),
        });
    }
  }

  function translateTurnCompleted(
    stopReason: AcpStopReason,
    state: AcpTurnState,
    context?: ProviderTranslationContext,
  ): ThreadEvent[] {
    const events: ThreadEvent[] = [];
    const currentTurnId = resolveProviderTerminalTurn({
      events,
      registry: turnState,
      state,
      threadId: UNSTAMPED_THREAD_ID,
    });
    if (currentTurnId === undefined) {
      return [];
    }
    const openToolCallStatus: ThreadEventItemStatus =
      stopReason === "end_turn"
        ? "completed"
        : stopReason === "cancelled"
          ? "interrupted"
          : "failed";
    flushOpenTurnItems({
      events,
      parentToolCallId: context?.parentToolCallId,
      state,
      status: openToolCallStatus,
      turnId: currentTurnId,
    });

    if (stopReason === "cancelled") {
      events.push({
        type: "turn/completed",
        threadId: UNSTAMPED_THREAD_ID,
        providerThreadId: "",
        scope: turnScope(currentTurnId),
        status: "interrupted",
      });
    } else if (stopReason === "end_turn") {
      events.push({
        type: "turn/completed",
        threadId: UNSTAMPED_THREAD_ID,
        providerThreadId: "",
        scope: turnScope(currentTurnId),
        status: "completed",
      });
    } else {
      events.push({
        type: "turn/completed",
        threadId: UNSTAMPED_THREAD_ID,
        providerThreadId: "",
        scope: turnScope(currentTurnId),
        status: "failed",
        error: { message: `Agent stopped the turn: ${stopReason}` },
      });
    }
    turnState.finishTurn({
      state,
      threadId: context?.threadId ?? "",
    });
    return events;
  }

  function translateAcpEvent(
    event: ProviderRuntimeEvent,
    context?: ProviderTranslationContext,
  ): ThreadEvent[] {
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
      return turnState.buildErrorEvents({
        contextThreadId: context?.threadId,
        detail: errorEnvelope.data.params?.message ?? "unknown error",
      });
    }

    const envelope = jsonRpcEnvelopeSchema.safeParse(event);
    if (!envelope.success) {
      return [];
    }

    switch (envelope.data.method) {
      case ACP_TURN_STARTED_METHOD: {
        const params = acpTurnStartedNotificationParamsSchema.safeParse(
          envelope.data.params,
        );
        if (!params.success) {
          return [];
        }
        const events: ThreadEvent[] = [];
        turnState.ensureTurnStarted({
          events,
          state: resolveState(context),
          threadId: UNSTAMPED_THREAD_ID,
        });
        return events;
      }

      case ACP_TURN_COMPLETED_METHOD: {
        const params = acpTurnCompletedNotificationParamsSchema.safeParse(
          envelope.data.params,
        );
        if (!params.success) {
          return [];
        }
        return translateTurnCompleted(
          params.data.stopReason,
          resolveState(context),
          context,
        );
      }

      case ACP_COMPACTION_STARTED_METHOD: {
        const params = acpTurnStartedNotificationParamsSchema.safeParse(
          envelope.data.params,
        );
        if (!params.success) {
          return [];
        }
        const events: ThreadEvent[] = [];
        const turnId = turnState.ensureTurnStarted({
          events,
          state: resolveState(context),
          threadId: UNSTAMPED_THREAD_ID,
        });
        events.push({
          type: "item/started",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          item: {
            type: "contextCompaction",
            id: acpCompactionItemIds.createId(turnId),
          },
        });
        return events;
      }

      case ACP_COMPACTION_COMPLETED_METHOD: {
        const params = acpCompactionCompletedNotificationParamsSchema.safeParse(
          envelope.data.params,
        );
        if (!params.success) {
          return [];
        }
        const state = resolveState(context);
        const turnId = state.currentTurnId;
        if (!turnId) {
          return [];
        }
        const events: ThreadEvent[] = [];
        flushOpenTurnItems({
          events,
          parentToolCallId: context?.parentToolCallId,
          state,
          status: params.data.status,
          turnId,
        });
        // Only a completed maintenance prompt actually shrank the context; a
        // failed or interrupted one must never report `thread/compacted`.
        if (params.data.status === "completed") {
          events.push({
            type: "thread/compacted",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
          });
        }
        events.push({
          type: "turn/completed",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          status: params.data.status,
          ...(params.data.status === "failed"
            ? { error: { message: params.data.error } }
            : {}),
        });
        turnState.finishTurn({
          state,
          threadId: context?.threadId ?? "",
        });
        return events;
      }

      case ACP_UPDATE_METHOD: {
        const params = acpUpdateNotificationParamsSchema.safeParse(
          envelope.data.params,
        );
        if (!params.success) {
          return [];
        }
        return translateAcpUpdate(
          params.data.update,
          resolveState(context),
          context,
        );
      }

      case ACP_FS_WRITE_METHOD: {
        const params = acpFsWriteNotificationParamsSchema.safeParse(
          envelope.data.params,
        );
        if (!params.success) {
          return [];
        }
        const state = resolveState(context);
        if (!state.currentTurnId) {
          return buildUnhandledProviderEvents({
            includeKnown: true,
            providerId: options.providerId,
            rawEvent: {
              jsonrpc: "2.0",
              method: ACP_FS_WRITE_METHOD,
              params: params.data,
            },
            visibilityMetadata: acpVisibilityMetadata,
          });
        }
        const events: ThreadEvent[] = [];
        const turnId = state.currentTurnId;
        state.fsWriteCounter += 1;
        events.push({
          type: "item/completed",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          item: {
            type: "fileChange",
            // Include the turn id: resumed sessions restart the counter, so a
            // bare counter would reuse ids already persisted in earlier turns.
            id: `acp-fs-write-${turnId}-${state.fsWriteCounter}`,
            changes: [
              {
                path: params.data.path,
                kind: params.data.kind,
                ...(params.data.diff ? { diff: params.data.diff } : {}),
              },
            ],
            status: "completed",
            approvalStatus: null,
          },
        });
        return events;
      }

      case ACP_WARNING_METHOD: {
        const params = acpWarningNotificationParamsSchema.safeParse(
          envelope.data.params,
        );
        if (!params.success) {
          return [];
        }
        const state = resolveState(context);
        return [
          {
            type: "provider/warning",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: state.currentTurnId
              ? turnScope(state.currentTurnId)
              : threadScope(),
            category: "general",
            summary: params.data.summary,
            ...(params.data.details ? { details: params.data.details } : {}),
          },
        ];
      }

      default: {
        const state = resolveState(context);
        return buildUnhandledProviderEvents({
          providerId: options.providerId,
          rawEvent: {
            jsonrpc: "2.0",
            method: envelope.data.method,
            ...(envelope.data.params ? { params: envelope.data.params } : {}),
          },
          visibilityMetadata: acpVisibilityMetadata,
          ...(state.currentTurnId ? { turnId: state.currentTurnId } : {}),
          ...(context?.parentToolCallId
            ? { parentToolCallId: context.parentToolCallId }
            : {}),
        });
      }
    }
  }

  return { resolveState, translateAcpEvent, turnState };
}

export type AcpEventTranslator = ReturnType<typeof createAcpEventTranslator>;
