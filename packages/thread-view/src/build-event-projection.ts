import type { ThreadEvent } from "@bb/domain";
import {
  LOCAL_WORKFLOW_TASK_TYPE,
  requireThreadEventScopeTurnId,
} from "@bb/domain";
import { parseCompactionLifecycleEvent } from "./compaction-lifecycle.js";
import {
  parseBackgroundTaskLifecycleEvent,
  upsertBackgroundTaskMessage,
} from "./background-task-projection.js";
import {
  getEventParentToolCallId,
  getEventProviderThreadId,
  getEventTurnId,
} from "./event-decode.js";
import {
  parseExecLifecycleEvent,
  parseToolCallLifecycleEvent,
} from "./exec-lifecycle.js";
import { parseFileEditFromItemEvent } from "./file-edit-parsing.js";
import { parseWebActivityLifecycleEvent } from "./web-activity-lifecycle.js";
import { parseOperationMessage } from "./parse-operation-message.js";
import {
  parseErrorMessage,
  isDuplicateEventType,
  isIgnoredItemStartEvent,
  isIgnoredItemCompletedEvent,
  appendDebugEvent,
} from "./parse-error-message.js";
import { isIgnoredNoiseType } from "./timeline-noise-events.js";
import {
  normalizeEventProjection,
  sortEventProjectionMessagesBySource,
} from "./normalize-event-projection.js";
import { applyProjectionTurnMessageDetail } from "./apply-turn-message-detail.js";
import {
  groupEventProjectionTurns,
  getOrderedThreadEvents,
  type ThreadEventWithMeta,
} from "./group-event-projection-turns.js";
export type { ThreadEventWithMeta } from "./group-event-projection-turns.js";
import { shouldSuppressLowValueToolCall } from "./tool-call-suppression.js";
import {
  buildAcceptedClientRequestById,
  EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
  type AcceptedClientRequest,
  type AcceptedClientRequestContext,
} from "./accepted-client-request-context.js";
import {
  parseAcceptedSteersFromClientRequest,
  parseUsersFromClientRequest,
  parseLegacyUserMessage,
} from "./user-message-parsing.js";
import { isTerminalBufferedTextFlushEvent } from "./assistant-buffering.js";
import {
  flushToolActivityBeforeNonToolMessage,
  onExecBegin,
  onExecEnd,
  onExecOutput,
  onWebActivityBegin,
  onWebActivityEnd,
} from "./tool-activity-projection.js";
import {
  finalizeOpenCompactionsForTurn,
  onCompactionBegin,
  onCompactionEnd,
  upsertPermissionGrantLifecycleMessage,
  upsertUserQuestionLifecycleMessage,
  upsertFileEdit,
  upsertProvisioningOperation,
  upsertThreadOperationMessage,
} from "./operation-projection.js";
import type { ActiveThinking } from "@bb/domain";
import type {
  BuildEventProjectionMessagesOptions,
  BuildEventProjectionOptions,
  EventProjectionMessage,
  EventProjectionWorkflowMessage,
  EventProjection,
} from "./event-projection-types.js";
import { getMessageStartedAt } from "./format-helpers.js";
import {
  createProjectionState,
  finalizeProjectionState,
  flushProjectionBufferedOutputs,
  onThreadInterrupted,
  onTurnCompleted,
  onTurnStarted,
  type CompactionTurnFinalization,
  type PendingDelegationTurnLink,
  type ProjectionState,
} from "./event-projection-state.js";
import { buildProjectionActiveThinking } from "./reasoning-lifecycle-projection.js";
import { projectAssistantAndReasoningEvent } from "./assistant-event-projection.js";

// --- Projection state machine ---

type ProjectedUserMessage = Extract<EventProjectionMessage, { kind: "user" }>;
interface ClientTurnRequestedWithMeta {
  event: Extract<ThreadEvent, { type: "client/turn/requested" }>;
  meta: ThreadEventWithMeta["meta"];
}

type ClientTurnRequestedEvent = Extract<
  ThreadEvent,
  { type: "client/turn/requested" }
>;

interface BuildFlatProjectionDataArgs {
  acceptedClientRequestContext: AcceptedClientRequestContext;
  events: ThreadEventWithMeta[];
  includeActiveThinking: boolean;
  options?: BuildEventProjectionMessagesOptions;
}

interface BuildFlatProjectionDataResult {
  activeThinking: ActiveThinking | null;
  activeWorkflow: EventProjectionWorkflowMessage | null;
  activeBackgroundCommands: EventProjectionWorkflowMessage[];
  messages: EventProjectionMessage[];
}

interface BuildDetailedProjectionArgs {
  activeThinking: ActiveThinking | null;
  activeWorkflow: EventProjectionWorkflowMessage | null;
  activeBackgroundCommands: EventProjectionWorkflowMessage[];
  events: ThreadEventWithMeta[];
  messages: EventProjectionMessage[];
  turnMessageDetail: BuildEventProjectionOptions["turnMessageDetail"];
}

const PROVIDER_THREAD_DELEGATION_TOOL_NAMES = new Set([
  "spawnAgent",
  "resumeAgent",
]);
const PROVIDER_THREAD_CHILD_INTERACTION_TOOL_NAMES = new Set([
  "sendInput",
  "wait",
  "closeAgent",
]);

function selectActiveWorkflowMessage(
  messages: readonly EventProjectionMessage[],
): EventProjectionWorkflowMessage | null {
  let best: EventProjectionWorkflowMessage | null = null;
  for (const message of messages) {
    if (
      message.kind !== "workflow" ||
      // The prompt-box active banner is workflow-only; backgrounded shell
      // commands surface inline in the timeline, not in the banner.
      message.taskType !== LOCAL_WORKFLOW_TASK_TYPE ||
      message.status !== "pending" ||
      message.skipTranscript
    ) {
      continue;
    }
    if (
      best === null ||
      getMessageStartedAt(message) > getMessageStartedAt(best)
    ) {
      best = message;
    }
  }
  return best;
}

function selectActiveBackgroundCommandMessages(
  messages: readonly EventProjectionMessage[],
): EventProjectionWorkflowMessage[] {
  // Running backgrounded shell commands, most recently started first. Feeds the
  // background-commands prompt-box card, which is independent of the
  // workflow-only banner driven by selectActiveWorkflowMessage.
  const running: EventProjectionWorkflowMessage[] = [];
  for (const message of messages) {
    if (
      message.kind !== "workflow" ||
      message.taskType === LOCAL_WORKFLOW_TASK_TYPE ||
      message.status !== "pending" ||
      message.skipTranscript
    ) {
      continue;
    }
    running.push(message);
  }
  return running.sort(
    (a, b) => getMessageStartedAt(b) - getMessageStartedAt(a),
  );
}

function buildClientTurnRequestById(
  events: ThreadEventWithMeta[],
): Map<string, ClientTurnRequestedWithMeta> {
  const requestById = new Map<string, ClientTurnRequestedWithMeta>();
  for (const eventWithMeta of events) {
    if (eventWithMeta.event.type !== "client/turn/requested") {
      continue;
    }
    requestById.set(eventWithMeta.event.requestId, {
      event: eventWithMeta.event,
      meta: eventWithMeta.meta,
    });
  }
  return requestById;
}

function buildSelectedStartedTurnIds(
  events: ThreadEventWithMeta[],
): ReadonlySet<string> {
  const turnIds = new Set<string>();
  for (const { event } of events) {
    if (event.type !== "turn/started") {
      continue;
    }
    turnIds.add(
      requireThreadEventScopeTurnId({
        type: event.type,
        scope: event.scope,
      }),
    );
  }
  return turnIds;
}

function buildAcceptedRootClientTurnIds(
  events: ThreadEventWithMeta[],
  clientRequestById: ReadonlyMap<string, ClientTurnRequestedWithMeta>,
): ReadonlySet<string> {
  const turnIds = new Set<string>();
  for (const { event } of events) {
    if (event.type !== "turn/input/accepted") {
      continue;
    }
    const request = clientRequestById.get(event.clientRequestId);
    if (
      request?.event.target.kind !== "new-turn" &&
      request?.event.target.kind !== "thread-start"
    ) {
      continue;
    }
    turnIds.add(
      requireThreadEventScopeTurnId({
        type: event.type,
        scope: event.scope,
      }),
    );
  }
  return turnIds;
}

function canUseAcceptedClientRequestForVisibleProjection(
  acceptedClientRequest: AcceptedClientRequest,
  decoded: ClientTurnRequestedEvent,
  selectedStartedTurnIds: ReadonlySet<string>,
): boolean {
  // Context-only accepted rows can point at turns outside the selected page.
  // Use them to classify fallback messages only when that turn root is already
  // visible; otherwise pending-steer suppression handles the correlation.
  switch (decoded.target.kind) {
    case "auto":
    case "steer":
      if (decoded.target.expectedTurnId === null) {
        return true;
      }
      if (acceptedClientRequest.turnId === decoded.target.expectedTurnId) {
        return true;
      }
      return selectedStartedTurnIds.has(acceptedClientRequest.turnId);
    case "new-turn":
    case "thread-start":
      return true;
  }
}

function appendProjectedUserMessage(
  state: ProjectionState,
  projectedClientUser: ProjectedUserMessage,
): void {
  const key = projectedClientUser.id;
  if (state.seenUserKeys.has(key)) {
    return;
  }
  state.seenUserKeys.add(key);
  flushToolActivityBeforeNonToolMessage(state);
  state.messages.push(projectedClientUser);
}

function getToolCallName(decoded: ThreadEvent): string | undefined {
  if (
    (decoded.type !== "item/started" && decoded.type !== "item/completed") ||
    decoded.item.type !== "toolCall"
  ) {
    return undefined;
  }

  return decoded.item.tool;
}

function getToolCallReceiverThreadIds(decoded: ThreadEvent): string[] {
  if (
    (decoded.type !== "item/started" && decoded.type !== "item/completed") ||
    decoded.item.type !== "toolCall"
  ) {
    return [];
  }

  const receiverThreadIds = decoded.item.arguments?.receiverThreadIds;
  if (!Array.isArray(receiverThreadIds)) {
    return [];
  }

  return receiverThreadIds.filter(
    (receiverThreadId): receiverThreadId is string =>
      typeof receiverThreadId === "string" && receiverThreadId.length > 0,
  );
}

function getToolCallSenderThreadId(decoded: ThreadEvent): string | undefined {
  if (
    (decoded.type !== "item/started" && decoded.type !== "item/completed") ||
    decoded.item.type !== "toolCall"
  ) {
    return undefined;
  }

  const senderThreadId = decoded.item.arguments?.senderThreadId;
  return typeof senderThreadId === "string" && senderThreadId.length > 0
    ? senderThreadId
    : undefined;
}

function enqueuePendingDelegationTurnLink(
  state: ProjectionState,
  providerThreadId: string | undefined,
  parentTurnId: string | undefined,
  callId: string,
): void {
  if (!providerThreadId || !parentTurnId) {
    return;
  }
  if (state.delegatedTurnLinkCallIds.has(callId)) {
    return;
  }

  const pendingLinks =
    state.pendingDelegationTurnLinksByProviderThreadId.get(providerThreadId) ??
    [];
  const link: PendingDelegationTurnLink = {
    callId,
    parentTurnId,
  };
  pendingLinks.push(link);
  state.pendingDelegationTurnLinksByProviderThreadId.set(
    providerThreadId,
    pendingLinks,
  );
  state.delegatedTurnLinkCallIds.add(callId);
}

function consumePendingDelegationTurnLink(
  state: ProjectionState,
  providerThreadId: string | undefined,
  turnId: string,
): string | undefined {
  if (!providerThreadId) {
    return undefined;
  }
  if (state.delegationParentToolCallIdsByTurnId.has(turnId)) {
    return state.delegationParentToolCallIdsByTurnId.get(turnId);
  }

  const pendingLinks =
    state.pendingDelegationTurnLinksByProviderThreadId.get(providerThreadId);
  if (!pendingLinks || pendingLinks.length === 0) {
    return undefined;
  }

  while (pendingLinks.length > 0) {
    const pendingLink = pendingLinks.shift();
    if (!pendingLink || pendingLink.parentTurnId === turnId) {
      continue;
    }
    if (pendingLinks.length === 0) {
      state.pendingDelegationTurnLinksByProviderThreadId.delete(
        providerThreadId,
      );
    }
    state.delegationParentToolCallIdsByTurnId.set(turnId, pendingLink.callId);
    return pendingLink.callId;
  }

  state.pendingDelegationTurnLinksByProviderThreadId.delete(providerThreadId);
  return undefined;
}

function shouldUseExplicitEventParentToolCallId({
  eventTurnId,
  isAcceptedRootClientTurn,
  parentToolCallId,
  state,
}: {
  eventTurnId: string | undefined;
  isAcceptedRootClientTurn: boolean;
  parentToolCallId: string | undefined;
  state: ProjectionState;
}): boolean {
  if (!parentToolCallId) {
    return false;
  }
  if (!isAcceptedRootClientTurn) {
    return true;
  }
  return (
    typeof eventTurnId === "string" &&
    state.delegationTurnIdsByCallId.get(parentToolCallId) === eventTurnId
  );
}

function getCompactionTurnFinalization(
  decoded: ThreadEvent,
): CompactionTurnFinalization | undefined {
  if (decoded.type === "provider/error") {
    return {
      status: "error",
      detail: decoded.detail ?? decoded.message,
    };
  }
  if (decoded.type === "turn/completed" && decoded.status === "failed") {
    return {
      status: "error",
      detail: decoded.error?.message,
    };
  }
  if (decoded.type === "turn/completed" && decoded.status === "interrupted") {
    return {
      status: "interrupted",
      detail: decoded.error?.message,
    };
  }
  return undefined;
}

// --- Main entry point ---

function buildFlatProjectionData(
  args: BuildFlatProjectionDataArgs,
): BuildFlatProjectionDataResult {
  const state = createProjectionState();
  const includeDebugRawEvents = args.options?.includeDebugRawEvents ?? false;
  const shouldTrackActiveThinking = args.includeActiveThinking;

  const orderedEvents = args.events;
  const acceptedClientRequestById = buildAcceptedClientRequestById({
    context: args.acceptedClientRequestContext,
    events: orderedEvents,
  });
  const clientRequestById = buildClientTurnRequestById(orderedEvents);
  const selectedStartedTurnIds = buildSelectedStartedTurnIds(orderedEvents);
  const acceptedRootClientTurnIds = buildAcceptedRootClientTurnIds(
    orderedEvents,
    clientRequestById,
  );
  for (const { event: decoded, meta } of orderedEvents) {
    const eventType = decoded.type;
    const eventTurnId = getEventTurnId(decoded);
    const eventProviderThreadId = getEventProviderThreadId(decoded);
    const isAcceptedRootClientTurn =
      typeof eventTurnId === "string" &&
      acceptedRootClientTurnIds.has(eventTurnId);
    const decodedEventParentToolCallId = getEventParentToolCallId(decoded);
    const explicitEventParentToolCallId =
      shouldUseExplicitEventParentToolCallId({
        eventTurnId,
        isAcceptedRootClientTurn,
        parentToolCallId: decodedEventParentToolCallId,
        state,
      })
        ? decodedEventParentToolCallId
        : undefined;

    if (decoded.type === "turn/started") {
      const turnId = requireThreadEventScopeTurnId({
        type: decoded.type,
        scope: decoded.scope,
      });
      if (isAcceptedRootClientTurn) {
        state.delegationParentToolCallIdsByTurnId.delete(turnId);
      } else {
        const pendingParentToolCallId = consumePendingDelegationTurnLink(
          state,
          eventProviderThreadId,
          turnId,
        );
        if (explicitEventParentToolCallId) {
          state.delegationParentToolCallIdsByTurnId.set(
            turnId,
            explicitEventParentToolCallId,
          );
        } else if (pendingParentToolCallId) {
          state.delegationParentToolCallIdsByTurnId.set(
            turnId,
            pendingParentToolCallId,
          );
        }
      }
      onTurnStarted(state, turnId);
    }

    const eventParentToolCallId = isAcceptedRootClientTurn
      ? explicitEventParentToolCallId
      : (explicitEventParentToolCallId ??
        (eventTurnId
          ? state.delegationParentToolCallIdsByTurnId.get(eventTurnId)
          : undefined) ??
        (eventProviderThreadId
          ? state.delegationParentToolCallIdsByProviderThreadId.get(
              eventProviderThreadId,
            )
          : undefined));

    const compactionTurnFinalization = getCompactionTurnFinalization(decoded);
    if (compactionTurnFinalization) {
      finalizeOpenCompactionsForTurn({
        state,
        meta,
        threadId: decoded.threadId,
        turnId: eventTurnId,
        status: compactionTurnFinalization.status,
        detail: compactionTurnFinalization.detail,
      });
    }

    if (isTerminalBufferedTextFlushEvent(eventType)) {
      if (decoded.type === "turn/completed") {
        onTurnCompleted({
          completedAt: meta.createdAt,
          state,
          turnId: requireThreadEventScopeTurnId({
            type: decoded.type,
            scope: decoded.scope,
          }),
          status: decoded.status,
        });
      } else {
        onThreadInterrupted({
          completedAt: meta.createdAt,
          state,
        });
      }
      flushProjectionBufferedOutputs(state);
    }

    if (decoded.type === "turn/input/accepted") {
      const clientRequest = clientRequestById.get(decoded.clientRequestId);
      const acceptedClientRequest = acceptedClientRequestById.get(
        decoded.clientRequestId,
      );
      const acceptedSteers =
        clientRequest && acceptedClientRequest
          ? parseAcceptedSteersFromClientRequest({
              acceptedClientRequest,
              decoded: clientRequest.event,
              meta: clientRequest.meta,
              options: args.options,
            })
          : [];
      for (const acceptedSteer of acceptedSteers) {
        appendProjectedUserMessage(state, acceptedSteer);
      }
      continue;
    }

    const acceptedClientRequest =
      decoded.type === "client/turn/requested"
        ? acceptedClientRequestById.get(decoded.requestId)
        : undefined;
    const visibleProjectionAcceptedClientRequest =
      acceptedClientRequest &&
      decoded.type === "client/turn/requested" &&
      canUseAcceptedClientRequestForVisibleProjection(
        acceptedClientRequest,
        decoded,
        selectedStartedTurnIds,
      )
        ? acceptedClientRequest
        : undefined;
    const usersFromClientRequest = parseUsersFromClientRequest({
      acceptedClientRequest: visibleProjectionAcceptedClientRequest,
      decoded,
      meta,
      options: args.options,
    });
    if (usersFromClientRequest.length > 0) {
      for (const userFromClientRequest of usersFromClientRequest) {
        appendProjectedUserMessage(state, userFromClientRequest);
      }
      continue;
    }

    const legacyUserMessage = parseLegacyUserMessage(decoded, meta);
    if (legacyUserMessage) {
      flushToolActivityBeforeNonToolMessage(state);
      state.messages.push(legacyUserMessage);
      continue;
    }

    if (
      projectAssistantAndReasoningEvent({
        decoded,
        eventParentToolCallId,
        eventTurnId,
        meta,
        shouldTrackActiveThinking,
        state,
      })
    ) {
      continue;
    }

    if (parseBackgroundTaskLifecycleEvent(decoded)) {
      flushToolActivityBeforeNonToolMessage(state);
      upsertBackgroundTaskMessage(state, meta, decoded);
      continue;
    }

    const execEvent = parseExecLifecycleEvent(
      decoded,
      meta,
      eventParentToolCallId,
    );
    if (execEvent) {
      if (execEvent.kind === "begin") {
        onExecBegin(state, meta, decoded.threadId, eventTurnId, execEvent.call);
      } else if (execEvent.kind === "output") {
        onExecOutput(
          state,
          meta,
          execEvent.output,
          execEvent.appendOutput,
          execEvent.replaceOutput,
        );
      } else {
        onExecEnd(state, meta, decoded.threadId, eventTurnId, execEvent.call);
      }
      continue;
    }

    if (shouldSuppressLowValueToolCall(decoded)) {
      continue;
    }

    const toolCallEvent = parseToolCallLifecycleEvent(
      decoded,
      meta,
      eventParentToolCallId,
    );
    if (toolCallEvent) {
      const toolCallName = getToolCallName(decoded);
      const toolCallReceiverThreadIds = getToolCallReceiverThreadIds(decoded);
      const toolCallSenderThreadId = getToolCallSenderThreadId(decoded);
      if (toolCallEvent.kind !== "output") {
        if (toolCallEvent.call.kind === "delegation" && eventTurnId) {
          state.delegationTurnIdsByCallId.set(
            toolCallEvent.call.callId,
            eventTurnId,
          );
        }
        if (
          !toolCallEvent.call.parentToolCallId &&
          toolCallName &&
          PROVIDER_THREAD_CHILD_INTERACTION_TOOL_NAMES.has(toolCallName)
        ) {
          const inferredParentToolCallId = toolCallReceiverThreadIds
            .map((receiverThreadId) =>
              state.delegationParentToolCallIdsByProviderThreadId.get(
                receiverThreadId,
              ),
            )
            .find(
              (parentToolCallId): parentToolCallId is string =>
                typeof parentToolCallId === "string" &&
                parentToolCallId.length > 0,
            );
          if (inferredParentToolCallId) {
            toolCallEvent.call.parentToolCallId = inferredParentToolCallId;
          }
        }
        if (
          toolCallName &&
          PROVIDER_THREAD_DELEGATION_TOOL_NAMES.has(toolCallName)
        ) {
          if (
            toolCallReceiverThreadIds.length === 0 ||
            state.delegatedTurnLinkCallIds.has(toolCallEvent.call.callId)
          ) {
            enqueuePendingDelegationTurnLink(
              state,
              eventProviderThreadId,
              eventTurnId,
              toolCallEvent.call.callId,
            );
          }
          for (const receiverThreadId of toolCallReceiverThreadIds) {
            if (
              receiverThreadId === eventProviderThreadId ||
              receiverThreadId === toolCallSenderThreadId
            ) {
              enqueuePendingDelegationTurnLink(
                state,
                eventProviderThreadId,
                eventTurnId,
                toolCallEvent.call.callId,
              );
              continue;
            }
            state.delegationParentToolCallIdsByProviderThreadId.set(
              receiverThreadId,
              toolCallEvent.call.callId,
            );
          }
        }
      }
      if (toolCallEvent.kind === "begin") {
        onExecBegin(
          state,
          meta,
          decoded.threadId,
          eventTurnId,
          toolCallEvent.call,
        );
      } else if (toolCallEvent.kind === "output") {
        onExecOutput(
          state,
          meta,
          toolCallEvent.output,
          toolCallEvent.appendOutput,
          toolCallEvent.replaceOutput,
        );
      } else {
        onExecEnd(
          state,
          meta,
          decoded.threadId,
          eventTurnId,
          toolCallEvent.call,
        );
      }
      continue;
    }

    const webActivityEvent = parseWebActivityLifecycleEvent(
      decoded,
      eventParentToolCallId,
    );
    if (webActivityEvent) {
      if (webActivityEvent.kind === "begin") {
        onWebActivityBegin(
          state,
          meta,
          decoded.threadId,
          eventTurnId,
          webActivityEvent,
        );
      } else {
        onWebActivityEnd(
          state,
          meta,
          decoded.threadId,
          eventTurnId,
          webActivityEvent,
        );
      }
      continue;
    }

    const fileEdit = parseFileEditFromItemEvent(decoded, eventParentToolCallId);
    if (fileEdit) {
      flushToolActivityBeforeNonToolMessage(state);
      upsertFileEdit(state, meta, decoded.threadId, eventTurnId, fileEdit);
      continue;
    }

    const compactionEvent = parseCompactionLifecycleEvent(decoded, meta);
    if (compactionEvent) {
      flushToolActivityBeforeNonToolMessage(state);
      if (compactionEvent.kind === "begin") {
        onCompactionBegin(
          state,
          meta,
          decoded.threadId,
          eventTurnId,
          compactionEvent,
        );
      } else {
        onCompactionEnd(
          state,
          meta,
          decoded.threadId,
          eventTurnId,
          compactionEvent,
        );
      }
      continue;
    }

    const operation = parseOperationMessage(decoded, meta, {
      includeProviderUnhandledOperations:
        args.options?.includeProviderUnhandledOperations,
      providerDisplayName: args.options?.providerDisplayName,
      threadName: args.options?.threadName ?? "",
    });
    if (operation) {
      flushToolActivityBeforeNonToolMessage(state);
      if (
        operation.kind === "operation" &&
        operation.opType === "thread-provisioning"
      ) {
        upsertProvisioningOperation(state, operation);
        continue;
      }
      if (operation.kind === "operation" && operation.opType === "operation") {
        upsertThreadOperationMessage(state, operation);
        continue;
      }
      if (operation.kind === "permission-grant-lifecycle") {
        upsertPermissionGrantLifecycleMessage(state, operation);
        continue;
      }
      if (operation.kind === "user-question-lifecycle") {
        upsertUserQuestionLifecycleMessage(state, operation);
        continue;
      }
      state.messages.push(operation);
      continue;
    }

    const error = parseErrorMessage(decoded, meta);
    if (error) {
      flushToolActivityBeforeNonToolMessage(state);
      state.messages.push(error);
      continue;
    }

    if (includeDebugRawEvents) {
      const debugReason = isDuplicateEventType(eventType)
        ? "duplicate-event"
        : isIgnoredNoiseType(eventType) ||
            isIgnoredItemStartEvent(decoded) ||
            isIgnoredItemCompletedEvent(decoded)
          ? "ignored-noise"
          : "unhandled";

      if (debugReason !== "unhandled") {
        continue;
      }

      flushToolActivityBeforeNonToolMessage(state);
      appendDebugEvent(state.messages, decoded, meta, debugReason);
    }
  }

  finalizeProjectionState({ state, options: args.options });
  const messages = sortEventProjectionMessagesBySource(state.messages);
  return {
    activeThinking: args.includeActiveThinking
      ? buildProjectionActiveThinking(state, args.options?.threadStatus)
      : null,
    activeWorkflow: selectActiveWorkflowMessage(messages),
    activeBackgroundCommands: selectActiveBackgroundCommandMessages(messages),
    messages,
  };
}

function buildDetailedProjection(
  args: BuildDetailedProjectionArgs,
): EventProjection {
  const projection = groupEventProjectionTurns({
    events: args.events,
    messages: args.messages,
  });
  const semanticProjection = normalizeEventProjection({
    ...projection,
    state: {
      activeThinking: args.activeThinking,
      activeWorkflow: args.activeWorkflow,
      activeBackgroundCommands: args.activeBackgroundCommands,
    },
  });
  return applyProjectionTurnMessageDetail(
    semanticProjection,
    args.turnMessageDetail,
  );
}

function buildFullEventProjection(
  events: ThreadEventWithMeta[],
  options: BuildEventProjectionOptions,
): EventProjection {
  const flatProjection = buildFlatProjectionData({
    acceptedClientRequestContext:
      options.acceptedClientRequestContext ??
      EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    events,
    includeActiveThinking: true,
    options,
  });
  return buildDetailedProjection({
    activeThinking: flatProjection.activeThinking,
    activeWorkflow: flatProjection.activeWorkflow,
    activeBackgroundCommands: flatProjection.activeBackgroundCommands,
    events,
    messages: flatProjection.messages,
    turnMessageDetail: options.turnMessageDetail,
  });
}

export function buildEventProjectionEntries(
  events: ThreadEventWithMeta[] | undefined,
  options: BuildEventProjectionOptions,
): EventProjection {
  if (!events || events.length === 0) {
    return {
      state: {
        activeThinking: null,
        activeWorkflow: null,
        activeBackgroundCommands: [],
      },
      entries: [],
    };
  }

  const orderedEvents = getOrderedThreadEvents(events);
  const flatProjection = buildFlatProjectionData({
    acceptedClientRequestContext:
      options.acceptedClientRequestContext ??
      EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    events: orderedEvents,
    includeActiveThinking: false,
    options,
  });
  return buildDetailedProjection({
    activeThinking: null,
    activeWorkflow: flatProjection.activeWorkflow,
    activeBackgroundCommands: flatProjection.activeBackgroundCommands,
    events: orderedEvents,
    messages: flatProjection.messages,
    turnMessageDetail: options.turnMessageDetail,
  });
}

export function buildEventProjection(
  events: ThreadEventWithMeta[] | undefined,
  options: BuildEventProjectionOptions,
): EventProjection {
  if (!events || events.length === 0) {
    return {
      state: {
        activeThinking: null,
        activeWorkflow: null,
        activeBackgroundCommands: [],
      },
      entries: [],
    };
  }

  const orderedEvents = getOrderedThreadEvents(events);
  return buildFullEventProjection(orderedEvents, options);
}
