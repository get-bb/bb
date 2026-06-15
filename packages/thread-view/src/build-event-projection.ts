import type { ThreadEvent } from "@bb/domain";
import { requireThreadEventScopeTurnId } from "@bb/domain";
import { parseCompactionLifecycleEvent } from "./compaction-lifecycle.js";
import { upsertBackgroundTaskMessage } from "./background-task-projection.js";
import {
  getEventParentToolCallId,
  getEventProviderThreadId,
  getEventTurnId,
} from "./event-decode.js";
import {
  createExecLifecycleParseCache,
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
import {
  isDefaultQuietTimelineEventType,
  isIgnoredNoiseType,
} from "./timeline-noise-events.js";
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
  parseAcceptedSteerFromClientRequest,
  parseUserFromClientRequest,
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
  EventProjection,
} from "./event-projection-types.js";
import {
  createProjectionState,
  finalizeProjectionState,
  flushProjectionBufferedOutputs,
  onThreadInterrupted,
  onTurnCompleted,
  onTurnStarted,
  type CompactionTurnFinalization,
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
  messages: EventProjectionMessage[];
}

interface BuildDetailedProjectionArgs {
  activeThinking: ActiveThinking | null;
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

function shouldParseToolCallStaticMetadata(
  decoded: ThreadEvent,
  state: ProjectionState,
): boolean {
  if (
    decoded.type !== "item/completed" ||
    decoded.item.type !== "toolCall" ||
    !decoded.item.id
  ) {
    return true;
  }
  return !state.toolActivity.runningCallsById.has(decoded.item.id);
}

function canProjectAssistantAndReasoningEvent(decoded: ThreadEvent): boolean {
  switch (decoded.type) {
    case "item/agentMessage/delta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
      return true;
    case "item/started":
      return decoded.item.type === "reasoning";
    case "item/completed":
      return (
        decoded.item.type === "agentMessage" ||
        decoded.item.type === "reasoning"
      );
    default:
      return false;
  }
}

function canProjectBackgroundTaskEvent(decoded: ThreadEvent): boolean {
  switch (decoded.type) {
    case "item/backgroundTask/progress":
    case "item/backgroundTask/completed":
      return true;
    case "item/started":
    case "item/completed":
      return decoded.item.type === "backgroundTask";
    default:
      return false;
  }
}

function canProjectCommandEvent(decoded: ThreadEvent): boolean {
  switch (decoded.type) {
    case "item/commandExecution/outputDelta":
      return true;
    case "item/started":
    case "item/completed":
      return decoded.item.type === "commandExecution";
    default:
      return false;
  }
}

function canProjectToolCallEvent(decoded: ThreadEvent): boolean {
  switch (decoded.type) {
    case "item/toolCall/progress":
    case "item/mcpToolCall/progress":
      return true;
    case "item/started":
    case "item/completed":
      return decoded.item.type === "toolCall";
    default:
      return false;
  }
}

function canProjectWebActivityEvent(decoded: ThreadEvent): boolean {
  if (decoded.type !== "item/started" && decoded.type !== "item/completed") {
    return false;
  }
  switch (decoded.item.type) {
    case "webSearch":
    case "webFetch":
    case "imageView":
      return true;
    default:
      return false;
  }
}

function canProjectFileEditEvent(decoded: ThreadEvent): boolean {
  switch (decoded.type) {
    case "item/fileChange/outputDelta":
      return true;
    case "item/started":
    case "item/completed":
      return decoded.item.type === "fileChange";
    default:
      return false;
  }
}

function canProjectCompactionEvent(decoded: ThreadEvent): boolean {
  if (decoded.type === "thread/compacted") {
    return true;
  }
  if (decoded.type !== "item/started" && decoded.type !== "item/completed") {
    return false;
  }
  return decoded.item.type === "contextCompaction";
}

function canProjectOperationEvent(decoded: ThreadEvent): boolean {
  switch (decoded.type) {
    case "provider/unhandled":
    case "provider/warning":
    case "system/thread/interrupted":
    case "system/provider-turn-watchdog":
    case "system/thread-provisioning":
    case "system/operation":
    case "system/permissionGrant/lifecycle":
    case "system/userQuestion/lifecycle":
    case "thread/compacted":
      return true;
    default:
      return false;
  }
}

function canProjectErrorEvent(decoded: ThreadEvent): boolean {
  return decoded.type === "provider/error" || decoded.type === "system/error";
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
  const execLifecycleParseCache = createExecLifecycleParseCache();
  const acceptedClientRequestById = buildAcceptedClientRequestById({
    context: args.acceptedClientRequestContext,
    events: orderedEvents,
  });
  const clientRequestById = buildClientTurnRequestById(orderedEvents);
  const selectedStartedTurnIds = buildSelectedStartedTurnIds(orderedEvents);
  for (const { event: decoded, meta } of orderedEvents) {
    const eventType = decoded.type;
    const eventTurnId = getEventTurnId(decoded);
    const eventProviderThreadId = getEventProviderThreadId(decoded);
    const explicitEventParentToolCallId = getEventParentToolCallId(decoded);
    const eventParentToolCallId =
      explicitEventParentToolCallId ??
      (eventProviderThreadId
        ? state.delegationParentToolCallIdsByProviderThreadId.get(
            eventProviderThreadId,
          )
        : undefined);

    if (decoded.type === "turn/started") {
      onTurnStarted(
        state,
        requireThreadEventScopeTurnId({
          type: decoded.type,
          scope: decoded.scope,
        }),
      );
    }

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
      const acceptedSteer =
        clientRequest && acceptedClientRequest
          ? parseAcceptedSteerFromClientRequest({
              acceptedClientRequest,
              decoded: clientRequest.event,
              meta: clientRequest.meta,
              options: args.options,
            })
          : null;
      if (acceptedSteer) {
        appendProjectedUserMessage(state, acceptedSteer);
      }
      continue;
    }

    if (decoded.type === "client/turn/requested") {
      const acceptedClientRequest = acceptedClientRequestById.get(
        decoded.requestId,
      );
      const visibleProjectionAcceptedClientRequest =
        acceptedClientRequest &&
        canUseAcceptedClientRequestForVisibleProjection(
          acceptedClientRequest,
          decoded,
          selectedStartedTurnIds,
        )
          ? acceptedClientRequest
          : undefined;
      const userFromClientRequest = parseUserFromClientRequest({
        acceptedClientRequest: visibleProjectionAcceptedClientRequest,
        decoded,
        meta,
        options: args.options,
      });
      if (userFromClientRequest) {
        appendProjectedUserMessage(state, userFromClientRequest);
        continue;
      }
    }

    if (decoded.type === "system/manager/user_message") {
      const legacyUserMessage = parseLegacyUserMessage(decoded, meta);
      if (legacyUserMessage) {
        flushToolActivityBeforeNonToolMessage(state);
        state.messages.push(legacyUserMessage);
        continue;
      }
    }

    if (
      canProjectAssistantAndReasoningEvent(decoded) &&
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

    if (canProjectBackgroundTaskEvent(decoded)) {
      flushToolActivityBeforeNonToolMessage(state);
      if (upsertBackgroundTaskMessage(state, meta, decoded)) {
        continue;
      }
    }

    if (canProjectCommandEvent(decoded)) {
      const execEvent = parseExecLifecycleEvent({
        cache: execLifecycleParseCache,
        decoded,
        meta,
        parentToolCallIdOverride: eventParentToolCallId,
      });
      if (execEvent) {
        if (execEvent.kind === "begin") {
          onExecBegin(
            state,
            meta,
            decoded.threadId,
            eventTurnId,
            execEvent.call,
          );
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
    }

    if (
      canProjectToolCallEvent(decoded) &&
      shouldSuppressLowValueToolCall(decoded)
    ) {
      continue;
    }

    if (canProjectToolCallEvent(decoded)) {
      const toolCallEvent = parseToolCallLifecycleEvent({
        decoded,
        meta,
        includeStaticMetadata: shouldParseToolCallStaticMetadata(
          decoded,
          state,
        ),
        parentToolCallIdOverride: eventParentToolCallId,
      });
      if (toolCallEvent) {
        const toolCallName = getToolCallName(decoded);
        const toolCallReceiverThreadIds = getToolCallReceiverThreadIds(decoded);
        if (toolCallEvent.kind !== "output") {
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
            for (const receiverThreadId of toolCallReceiverThreadIds) {
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
    }

    if (canProjectWebActivityEvent(decoded)) {
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
    }

    if (canProjectFileEditEvent(decoded)) {
      const fileEdit = parseFileEditFromItemEvent(
        decoded,
        eventParentToolCallId,
      );
      if (fileEdit) {
        flushToolActivityBeforeNonToolMessage(state);
        upsertFileEdit(state, meta, decoded.threadId, eventTurnId, fileEdit);
        continue;
      }
    }

    if (canProjectCompactionEvent(decoded)) {
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
    }

    if (canProjectOperationEvent(decoded)) {
      const operation = parseOperationMessage(decoded, meta, {
        includeProviderUnhandledOperations:
          args.options?.includeProviderUnhandledOperations,
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
        if (
          operation.kind === "operation" &&
          operation.opType === "operation"
        ) {
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
    }

    if (canProjectErrorEvent(decoded)) {
      const error = parseErrorMessage(decoded, meta);
      if (error) {
        flushToolActivityBeforeNonToolMessage(state);
        state.messages.push(error);
        continue;
      }
    }

    if (includeDebugRawEvents) {
      const debugReason = isDuplicateEventType(eventType)
        ? "duplicate-event"
        : isIgnoredNoiseType(eventType) ||
            isDefaultQuietTimelineEventType(eventType) ||
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
  return {
    activeThinking: args.includeActiveThinking
      ? buildProjectionActiveThinking(state, args.options?.threadStatus)
      : null,
    messages: sortEventProjectionMessagesBySource(state.messages),
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
      },
      entries: [],
    };
  }

  const orderedEvents = getOrderedThreadEvents(events);
  return buildFullEventProjection(orderedEvents, options);
}
