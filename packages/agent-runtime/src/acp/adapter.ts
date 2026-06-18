/**
 * ACP provider adapter.
 *
 * Maps between bb's ProviderAdapter contract and the generic ACP bridge
 * process; the adapter binds a profile's agent command (Cursor) into each
 * bridge session. The agent owns tool execution. Models and reasoning ride
 * the profile's CLI model surface (`modelCli`): the bridge groups the listed
 * ids into families with reasoning-effort variants, and the session's
 * (model, reasoningLevel) selection is pinned via the agent's launch flag —
 * applied per session, so a mid-thread change takes effect on the next
 * session spawn, not the next turn.
 */

import { getBuiltInAgentProviderInfo } from "@bb/agent-providers";
import type {
  PendingInteractionApprovalDecision,
  ThreadEvent,
  ThreadEventItem,
  ThreadEventPlanStep,
} from "@bb/domain";
import {
  isApprovalPendingInteractionPayload,
  isApprovalPendingInteractionResolution,
  threadScope,
  turnScope,
} from "@bb/domain";
import { z } from "zod";
import type {
  AdapterCommand,
  DecodedInteractiveRequest,
  DecodedToolCallRequest,
  ProviderAdapter,
  ProviderCommandPlan,
  ProviderExecutionContext,
  ProviderTranslationContext,
} from "../provider-adapter.js";
import { noPreparedProviderCommandDispatch } from "../provider-adapter.js";
import { ProviderResponseEncodeError } from "../runtime-json-rpc.js";
import type {
  ProviderInboundRequest,
  ProviderRuntimeEvent,
} from "../runtime-json-rpc.js";
import {
  buildAcceptedUserMessageEvent,
  drainAcceptedUserMessages,
  queueAcceptedUserMessage,
  type AcceptedUserMessageState,
} from "../shared/accepted-user-messages.js";
import {
  extractResultText,
  toOptionalString,
  withParentToolCallId,
} from "../shared/adapter-utils.js";
import { parseAvailableModelList } from "../shared/available-models.js";
import { resolveBridgeProcessArgs } from "../shared/bridge-path.js";
import {
  errorEnvelopeSchema,
  jsonRpcEnvelopeSchema,
  threadIdentityEnvelopeSchema,
} from "../shared/json-rpc-envelope.js";
import { buildScopedProviderErrorEvents } from "../shared/provider-error-events.js";
import { decodeNormalizedProviderToolCallRequest } from "../shared/provider-tool-call-contract.js";
import { buildUnhandledProviderEvents } from "../shared/provider-unhandled-event.js";
import {
  getOrCreateScopedItemId,
  resolveCompletedScopedItemId,
} from "../shared/scoped-item-ids.js";
import {
  createProviderTurnStateRegistry,
  finishOpenProviderTurn,
  type EnsureProviderTurnStartedArgs,
} from "../shared/turn-state.js";
import { UNSTAMPED_THREAD_ID } from "../shared/unstamped-thread-id.js";
import {
  ACP_FS_WRITE_METHOD,
  ACP_PERMISSION_REQUEST_METHOD,
  ACP_TURN_COMPLETED_METHOD,
  ACP_TURN_STARTED_METHOD,
  ACP_UPDATE_METHOD,
  ACP_WARNING_METHOD,
  acpFsWriteNotificationParamsSchema,
  acpPermissionRequestParamsSchema,
  acpTurnCompletedNotificationParamsSchema,
  acpTurnStartedNotificationParamsSchema,
  acpUpdateNotificationParamsSchema,
  acpWarningNotificationParamsSchema,
  ACP_DEFAULT_MODEL_ID,
  type AcpPermissionRequestParams,
  type AcpPermissionResponse,
} from "./bridge-protocol.js";
import type { AcpAgentProfile } from "./profiles.js";
import { acpVisibilityMetadata } from "./visibility.js";
import {
  acpAgentMessageChunkUpdateSchema,
  acpAgentThoughtChunkUpdateSchema,
  acpPlanUpdateSchema,
  acpToolCallUpdateEventSchema,
  extractAcpContentText,
  type AcpSessionUpdate,
  type AcpStopReason,
  type AcpToolCallUpdateEvent,
} from "./wire.js";

// ---------------------------------------------------------------------------
// Adapter factory options & per-thread state
// ---------------------------------------------------------------------------

export interface CreateAcpProviderAdapterOptions {
  profile: AcpAgentProfile;
  /** Extra roots (beyond the workspace) where client fs writes are allowed. */
  additionalWorkspaceWriteRoots: readonly string[];
  /** Override the directory containing bundled bridge files. */
  bridgeBundleDir?: string;
  /** Prefix for bb-owned turn ids emitted by this adapter instance. */
  turnIdPrefix?: string;
}

interface AcpTurnState extends AcceptedUserMessageState {
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
  openReasoningItemIdsByScope: Map<string, string>;
  reasoningItemCounter: number;
  thoughtTextsByItemId: Map<string, string>;
  toolCallEventsByCallId: Map<string, AcpToolCallUpdateEvent>;
  toolItemsByCallId: Map<string, ThreadEventItem>;
}

interface EnsureAcpTurnStartedArgs {
  events: ThreadEvent[];
  state: AcpTurnState;
  threadId: string;
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

const acpRawInputCommandSchema = z
  .object({ command: z.string() })
  .passthrough();

function extractAcpCommand(event: {
  rawInput?: unknown;
  title?: string;
}): string | undefined {
  const parsed = acpRawInputCommandSchema.safeParse(event.rawInput);
  if (parsed.success && parsed.data.command.trim().length > 0) {
    return parsed.data.command;
  }
  return toOptionalString(event.title);
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
): Extract<ThreadEventItem, { type: "fileChange" }>["changes"] {
  const changes: Extract<ThreadEventItem, { type: "fileChange" }>["changes"] =
    [];
  for (const entry of event.content ?? []) {
    if (entry.type !== "diff") {
      continue;
    }
    const oldText = entry.oldText ?? undefined;
    changes.push({
      path: entry.path,
      kind: oldText === undefined ? "add" : "update",
      diff: buildAcpUnifiedDiff(entry.path, oldText, entry.newText),
    });
  }
  return changes;
}

function buildAcpUnifiedDiff(
  filePath: string,
  oldText: string | undefined,
  newText: string,
): string {
  const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const removedLines = (oldText ?? "")
    .split("\n")
    .filter(
      (line, index, lines) => oldText !== undefined || index < lines.length,
    )
    .map((line) => `-${line}`);
  const addedLines = newText.split("\n").map((line) => `+${line}`);
  const header =
    oldText === undefined
      ? ["--- /dev/null", `+++ b/${normalizedPath}`]
      : [`--- a/${normalizedPath}`, `+++ b/${normalizedPath}`];
  const body =
    oldText === undefined ? addedLines : [...removedLines, ...addedLines];
  return [...header, ...body].join("\n") + "\n";
}

function translateAcpToolCallItem(
  event: AcpToolCallUpdateEvent,
  parentToolCallId: string | undefined,
): ThreadEventItem {
  const status = mapAcpToolCallStatus(event.status);

  if (event.kind === "execute") {
    const command = extractAcpCommand(event);
    if (command) {
      const outputText = extractAcpToolCallOutputText(event);
      return withParentToolCallId(
        {
          type: "commandExecution",
          id: event.toolCallId,
          command,
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
  }

  const fileChanges = buildAcpFileChangesFromToolCall(event);
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

function buildAcpApprovalDecisions(
  params: AcpPermissionRequestParams,
): PendingInteractionApprovalDecision[] {
  const kinds = new Set(params.options.map((option) => option.kind));
  const decisions: PendingInteractionApprovalDecision[] = [];
  if (kinds.has("allow_once")) {
    decisions.push("allow_once");
  }
  if (kinds.has("allow_always")) {
    decisions.push("allow_for_session");
  }
  if (kinds.has("reject_once") || kinds.has("reject_always")) {
    decisions.push("deny");
  }
  // An options list with a single odd kind still needs one decision; fall back
  // to deny so the runtime's auto-deny policy can always settle the request.
  return decisions.length > 0 ? decisions : ["deny"];
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

export function createAcpProviderAdapter(
  opts: CreateAcpProviderAdapterOptions,
): ProviderAdapter {
  const profile = opts.profile;
  const providerInfo = getBuiltInAgentProviderInfo(profile.providerId);
  const additionalWorkspaceWriteRoots = opts.additionalWorkspaceWriteRoots;

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
      openReasoningItemIdsByScope: new Map(),
      pendingAcceptedUserMessages: [],
      reasoningItemCounter: 0,
      thoughtTextsByItemId: new Map(),
      toolCallEventsByCallId: new Map(),
      toolItemsByCallId: new Map(),
    }),
    turnIdPrefix: opts.turnIdPrefix,
  });

  function ensureAcpTurnStarted(args: EnsureAcpTurnStartedArgs): string {
    const hadOpenTurn = args.state.currentTurnId !== undefined;
    const turnId = turnState.ensureTurnStarted({
      events: args.events,
      state: args.state,
      threadId: args.threadId,
    });
    if (!hadOpenTurn) {
      args.state.agentMessageTextsByItemId.clear();
      args.state.thoughtTextsByItemId.clear();
      args.state.toolCallEventsByCallId.clear();
      drainAcceptedUserMessages({
        events: args.events,
        providerThreadId: "",
        state: args.state,
        threadId: args.threadId,
        turnId,
      });
    }
    return turnId;
  }

  function ensureTurnStartedForUpdate(
    args: EnsureProviderTurnStartedArgs<AcpTurnState>,
  ): string {
    return ensureAcpTurnStarted(args);
  }

  function resolveState(context?: ProviderTranslationContext): AcpTurnState {
    return turnState.getOrCreate({ threadId: context?.threadId ?? "" });
  }

  function createReasoningItemId(state: AcpTurnState): string {
    state.reasoningItemCounter += 1;
    return `acp-reasoning-${state.reasoningItemCounter}`;
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
    const openItemId = state.openReasoningItemIdsByScope.get(scopeKey);
    if (!openItemId) {
      return;
    }
    const itemId = resolveCompletedScopedItemId({
      createItemId: () => createReasoningItemId(state),
      openItemIdsByScope: state.openReasoningItemIdsByScope,
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
      assistantIdPrefix: "acp-assistant",
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

  function translateAcpUpdate(
    update: AcpSessionUpdate,
    state: AcpTurnState,
    context?: ProviderTranslationContext,
  ): ThreadEvent[] {
    const events: ThreadEvent[] = [];
    const parentToolCallId = context?.parentToolCallId;

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const parsed = acpAgentMessageChunkUpdateSchema.safeParse(update);
        const text = parsed.success
          ? extractAcpContentText(parsed.data.content)
          : undefined;
        if (text === undefined) {
          return [];
        }
        const turnId = ensureAcpTurnStarted({
          events,
          state,
          threadId: UNSTAMPED_THREAD_ID,
        });
        flushOpenThoughtItem(events, state, parentToolCallId);
        const itemId = turnState.getOrCreateAssistantMessageId({
          assistantIdPrefix: "acp-assistant",
          parentToolCallId,
          state,
        });
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
        const turnId = ensureAcpTurnStarted({
          events,
          state,
          threadId: UNSTAMPED_THREAD_ID,
        });
        const itemId = getOrCreateScopedItemId({
          createItemId: () => createReasoningItemId(state),
          openItemIdsByScope: state.openReasoningItemIdsByScope,
          parentToolCallId,
          scopeId: "thought",
        });
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
        const turnId = ensureAcpTurnStarted({
          events,
          state,
          threadId: UNSTAMPED_THREAD_ID,
        });
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
          events.push({
            type: "item/completed",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(state.currentTurnId),
            item: mergedItem,
          });
          return events;
        }
        state.toolCallEventsByCallId.set(parsed.data.toolCallId, mergedEvent);
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
        const turnId = ensureAcpTurnStarted({
          events,
          state,
          threadId: UNSTAMPED_THREAD_ID,
        });
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

      default:
        return buildUnhandledProviderEvents({
          providerId: profile.providerId,
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
    const currentTurnId = state.currentTurnId;
    if (!currentTurnId) {
      return [];
    }
    const events: ThreadEvent[] = [];
    flushOpenThoughtItem(events, state, context?.parentToolCallId);
    flushOpenAgentMessageItem(events, state, context?.parentToolCallId);

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
      return buildScopedProviderErrorEvents({
        contextThreadId: context?.threadId,
        detail: errorEnvelope.data.params?.message ?? "unknown error",
        ensureTurnStarted: ensureTurnStartedForUpdate,
        registry: turnState,
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
        ensureAcpTurnStarted({
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
        const events: ThreadEvent[] = [];
        const turnId = ensureAcpTurnStarted({
          events,
          state,
          threadId: UNSTAMPED_THREAD_ID,
        });
        state.fsWriteCounter += 1;
        events.push({
          type: "item/completed",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          item: {
            type: "fileChange",
            id: `acp-fs-write-${state.fsWriteCounter}`,
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
          providerId: profile.providerId,
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

  function buildSessionParams(
    command: Extract<
      AdapterCommand,
      { type: "thread/start" | "thread/resume" }
    >,
  ): Record<string, unknown> {
    if (command.dynamicTools && command.dynamicTools.length > 0) {
      throw new Error(
        `Provider "${profile.providerId}" does not support dynamic tools.`,
      );
    }
    const instructions = command.options.instructions?.trim();
    return {
      threadId: command.threadId,
      cwd: command.cwd,
      agent: {
        command: profile.agentCommand.command,
        args: [...profile.agentCommand.args],
      },
      ...buildModelSelectionParam(command.options),
      permissionMode: command.options.permissionMode,
      permissionEscalation: command.options.permissionEscalation,
      workspaceWriteRoots: [command.cwd, ...additionalWorkspaceWriteRoots],
      ...(command.options.envVars &&
      Object.keys(command.options.envVars).length > 0
        ? { envVars: command.options.envVars }
        : {}),
      ...(instructions ? { instructions } : {}),
    };
  }

  /**
   * Session-level model pin for the bridge, which resolves (model,
   * reasoningLevel) to the exact agent model variant via the list command's
   * catalog. The synthetic "acp-default" id (persisted by threads started
   * before the bridge listed real models) is never forwarded.
   */
  function buildModelSelectionParam(
    options: ProviderExecutionContext,
  ): Record<string, unknown> {
    const model = options.model;
    if (!model || model === ACP_DEFAULT_MODEL_ID) {
      return {};
    }
    return {
      modelSelection: {
        listCommand: {
          command: profile.agentCommand.command,
          args: [...profile.modelCli.listArgs],
        },
        selectFlag: profile.modelCli.selectFlag,
        model,
        ...(options.reasoningLevel !== undefined
          ? { reasoningLevel: options.reasoningLevel }
          : {}),
      },
    };
  }

  return {
    // -- Identity & launch -------------------------------------------------

    id: providerInfo.id,
    displayName: providerInfo.displayName,
    capabilities: providerInfo.capabilities,
    process: {
      command: "node",
      args: resolveBridgeProcessArgs({
        bridgeBundleDir: opts.bridgeBundleDir,
        bundleFileName: "bb-acp-bridge.mjs",
        importMetaUrl: import.meta.url,
        bridgeRelativePath: "bridge/bridge.js",
      }),
    },

    // -- Unified command builder -------------------------------------------

    buildCommandPlan(command: AdapterCommand): ProviderCommandPlan {
      switch (command.type) {
        case "initialize":
          return {
            kind: "request",
            method: "initialize",
            params: { clientInfo: { name: "bb", version: "1.0.0" } },
          };
        case "model/list":
          return {
            kind: "request",
            method: "model/list",
            params: {
              listCommand: {
                command: profile.agentCommand.command,
                args: [...profile.modelCli.listArgs],
              },
              primaryModels: [...profile.modelCli.primaryModels],
            },
          };
        case "skills/configure":
          return {
            kind: "noop",
            reason: "ACP agents manage their own skills",
          };
        case "thread/start": {
          finishOpenProviderTurn({
            registry: turnState,
            threadId: command.threadId,
          });
          return {
            kind: "request",
            method: "thread/start",
            params: buildSessionParams(command),
          };
        }
        case "thread/resume": {
          finishOpenProviderTurn({
            registry: turnState,
            threadId: command.threadId,
          });
          return {
            kind: "request",
            method: "thread/resume",
            params: {
              ...buildSessionParams(command),
              providerThreadId: command.providerThreadId,
            },
          };
        }
        case "turn/start":
          return {
            kind: "request",
            method: "turn/start",
            params: {
              threadId: command.providerThreadId,
              input: command.input,
            },
          };
        case "turn/steer":
          return {
            kind: "request",
            method: "turn/steer",
            params: {
              threadId: command.providerThreadId,
              expectedTurnId: command.expectedTurnId,
              input: command.input,
            },
          };
        case "thread/stop":
          finishOpenProviderTurn({
            registry: turnState,
            threadId: command.threadId,
          });
          return {
            kind: "request",
            method: "thread/stop",
            params: { threadId: command.providerThreadId },
          };
        case "thread/name/set":
          return { kind: "noop", reason: "rename unsupported" };
        case "thread/archive":
        case "thread/unarchive":
          return { kind: "noop", reason: "archive unsupported" };
        case "thread/fork":
          // Unreachable: ACP declares supportsFork=false, so the server blocks
          // forks before they reach the adapter. ACP has no session-fork
          // primitive, so fail loudly if that guard is ever bypassed.
          throw new Error(
            `Provider "${profile.providerId}" does not support forking threads.`,
          );
      }
    },

    // -- Unified event translator ------------------------------------------

    translateEvent(
      event: ProviderRuntimeEvent,
      context?: ProviderTranslationContext,
    ): ThreadEvent[] {
      return translateAcpEvent(event, context);
    },

    prepareTurnStart: noPreparedProviderCommandDispatch,

    translateAcceptedCommand({ command }) {
      if (
        command.type === "thread/start" ||
        command.type === "thread/resume" ||
        command.type === "thread/stop"
      ) {
        const state = turnState.getOrCreate({ threadId: command.threadId });
        state.pendingAcceptedUserMessages = [];
        return [];
      }

      if (command.type === "turn/start") {
        const state = turnState.getOrCreate({ threadId: command.threadId });
        if (state.currentTurnId !== undefined) {
          return buildAcceptedUserMessageEvent({
            clientRequestId: command.clientRequestId,
            providerThreadId: command.providerThreadId,
            threadId: command.threadId,
            turnId: state.currentTurnId,
          });
        }
        queueAcceptedUserMessage({
          clientRequestId: command.clientRequestId,
          state,
        });
      }

      if (command.type === "turn/steer") {
        return buildAcceptedUserMessageEvent({
          clientRequestId: command.clientRequestId,
          providerThreadId: command.providerThreadId,
          threadId: command.threadId,
          turnId: command.expectedTurnId,
        });
      }

      return [];
    },

    parseModelListResult(result: unknown) {
      return parseAvailableModelList(result);
    },

    // -- Tool call & interactive codecs -------------------------------------

    decodeToolCallRequest(
      request: ProviderInboundRequest,
    ): DecodedToolCallRequest | null {
      if (typeof request.id !== "string" && typeof request.id !== "number") {
        return null;
      }
      return decodeNormalizedProviderToolCallRequest(
        request.id,
        request.method,
        request.params,
      );
    },

    decodeInteractiveRequest(
      request: ProviderInboundRequest,
    ): DecodedInteractiveRequest | null {
      if (typeof request.id !== "string" && typeof request.id !== "number") {
        return null;
      }
      if (request.method !== ACP_PERMISSION_REQUEST_METHOD) {
        return null;
      }
      const parsed = acpPermissionRequestParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return null;
      }
      const toolCall = parsed.data.toolCall;
      const command =
        toolCall?.kind === "execute"
          ? (toOptionalString(toolCall.command) ??
            toOptionalString(toolCall.title))
          : undefined;
      return {
        requestId: request.id,
        method: request.method,
        threadId: parsed.data.threadId,
        providerThreadId: parsed.data.providerThreadId,
        turnId: parsed.data.turnId,
        payload: {
          kind: "approval",
          subject:
            toolCall && command
              ? {
                  kind: "command",
                  itemId: toolCall.toolCallId,
                  command,
                  cwd: null,
                  actions: [{ type: "unknown", command }],
                  sessionGrant: null,
                }
              : {
                  kind: "permission_grant",
                  itemId: toolCall?.toolCallId ?? "acp-permission",
                  toolName:
                    toOptionalString(toolCall?.title) ?? toolCall?.kind ?? null,
                  permissions: { network: null, fileSystem: null },
                },
          reason: null,
          availableDecisions: buildAcpApprovalDecisions(parsed.data),
        },
      };
    },

    buildInteractiveResponse(args) {
      if (
        !isApprovalPendingInteractionPayload(args.request.payload) ||
        !isApprovalPendingInteractionResolution(args.resolution)
      ) {
        throw new ProviderResponseEncodeError(
          "ACP interactive response kind does not match the request payload",
        );
      }
      const response: AcpPermissionResponse = {
        decision: args.resolution.decision,
      };
      return response;
    },
  };
}
