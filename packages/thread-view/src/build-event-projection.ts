import type { ThreadEvent } from "@bb/domain";
import {
  isBackgroundAgentTaskType,
  isBackgroundCommandTaskType,
  LOCAL_WORKFLOW_TASK_TYPE,
  requireThreadEventScopeTurnId,
} from "@bb/domain";
import { parseCompactionLifecycleEvent } from "./compaction-lifecycle.js";
import { getEventParentToolCallId, getEventTurnId } from "./event-decode.js";
import { parseOperationMessage } from "./parse-operation-message.js";
import { normalizeProvisioningFailures } from "./normalize-provisioning-failures.js";
import { parseErrorMessage } from "./parse-error-message.js";
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
import {
  buildAcceptedClientRequestById,
  EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
  type AcceptedClientRequest,
  type AcceptedClientRequestContext,
} from "./accepted-client-request-context.js";
import {
  parseAcceptedSteersFromClientRequest,
  parseRejectedUsersFromClientRequest,
  parseUsersFromClientRequest,
  parseLegacyUserMessage,
  parseProviderUserMessage,
  shouldPreservePendingMessages,
} from "./user-message-parsing.js";
import {
  applyItemEvent,
  classifyItemEvent,
  freezeTextAndFlushOutputAtStop,
} from "./item-records.js";
import {
  collectItemRecordMessages,
  selectItemRecordActiveThinking,
} from "./item-record-messages.js";
import {
  finalizeOpenCompactionsForTurn,
  onCompactionBegin,
  onCompactionEnd,
  upsertPermissionGrantLifecycleMessage,
  upsertPluginFormLifecycleMessage,
  upsertUserQuestionLifecycleMessage,
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
  interruptedTurnFinalizationChangesState,
  onThreadInterrupted,
  onTurnCompleted,
  onTurnStarted,
  type CompactionTurnFinalization,
  type ProjectionState,
} from "./event-projection-state.js";

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
  activeWorkflows: EventProjectionWorkflowMessage[];
  activeBackgroundCommands: EventProjectionWorkflowMessage[];
  delegatedTurnIds: ReadonlySet<string>;
  messages: EventProjectionMessage[];
}

interface BuildDetailedProjectionArgs {
  activeThinking: ActiveThinking | null;
  activeWorkflows: EventProjectionWorkflowMessage[];
  activeBackgroundCommands: EventProjectionWorkflowMessage[];
  delegatedTurnIds: ReadonlySet<string>;
  events: ThreadEventWithMeta[];
  messages: EventProjectionMessage[];
  turnMessageDetail: BuildEventProjectionOptions["turnMessageDetail"];
}

function selectActiveWorkflowMessages(
  messages: readonly EventProjectionMessage[],
): EventProjectionWorkflowMessage[] {
  const running: EventProjectionWorkflowMessage[] = [];
  for (const message of messages) {
    if (
      message.kind !== "workflow" ||
      message.taskType !== LOCAL_WORKFLOW_TASK_TYPE ||
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

type EventProjectionCallMessage = Extract<
  EventProjectionMessage,
  { callId: string }
>;

function isEventProjectionCallMessage(
  message: EventProjectionMessage,
): message is EventProjectionCallMessage {
  switch (message.kind) {
    case "command":
    case "delegation":
    case "extension":
    case "file-edit":
    case "file-read":
    case "image-generation":
    case "image-view":
    case "plan-steps":
    case "search":
    case "tool-call":
    case "web-fetch":
    case "web-search":
      return true;
    case "assistant-text":
    case "error":
    case "operation":
    case "permission-grant-lifecycle":
    case "plugin-form-lifecycle":
    case "user":
    case "user-question-lifecycle":
    case "workflow":
      return false;
  }
}

function buildCallMessageById(
  messages: readonly EventProjectionMessage[],
): ReadonlyMap<string, EventProjectionCallMessage> {
  const byId = new Map<string, EventProjectionCallMessage>();
  for (const message of messages) {
    if (!isEventProjectionCallMessage(message)) {
      continue;
    }
    byId.set(message.callId, message);
  }
  return byId;
}

function isDirectBackgroundTaskForCurrentAgent(
  message: EventProjectionWorkflowMessage,
  callMessageById: ReadonlyMap<string, EventProjectionCallMessage>,
): boolean {
  if (!message.parentToolCallId) {
    return true;
  }
  const spawningCall = callMessageById.get(message.parentToolCallId);
  return spawningCall ? spawningCall.parentToolCallId === undefined : true;
}

function getBackgroundAgentModel(
  message: EventProjectionWorkflowMessage,
  callMessageById: ReadonlyMap<string, EventProjectionCallMessage>,
): string | null {
  if (
    !isBackgroundAgentTaskType(message.taskType) ||
    !message.parentToolCallId
  ) {
    return null;
  }
  const spawningCall = callMessageById.get(message.parentToolCallId);
  return spawningCall?.kind === "delegation"
    ? (spawningCall.model ?? null)
    : null;
}

function getBackgroundTaskFamilyId(
  message: EventProjectionWorkflowMessage,
): string {
  if (message.familyId !== null) {
    return `family:${message.familyId}`;
  }
  const itemId = message.itemId;
  const generationMatch = /#(\d+)$/.exec(itemId);
  if (!generationMatch) {
    return itemId;
  }
  const generation = Number(generationMatch[1]);
  return Number.isSafeInteger(generation) && generation > 1
    ? itemId.slice(0, -generationMatch[0].length)
    : itemId;
}

function enrichBackgroundAgentModels(
  messages: readonly EventProjectionMessage[],
  callMessageById: ReadonlyMap<string, EventProjectionCallMessage>,
): void {
  const modelByTaskFamilyId = new Map<string, string>();
  for (const message of messages) {
    if (
      message.kind !== "workflow" ||
      !isBackgroundAgentTaskType(message.taskType)
    ) {
      continue;
    }

    const taskFamilyId = getBackgroundTaskFamilyId(message);
    const model =
      getBackgroundAgentModel(message, callMessageById) ??
      message.model ??
      modelByTaskFamilyId.get(taskFamilyId) ??
      null;
    message.model = model;
    if (model !== null) {
      modelByTaskFamilyId.set(taskFamilyId, model);
    }
  }
}

function getRootSpawningCallId(
  message: EventProjectionWorkflowMessage,
  callMessageById: ReadonlyMap<string, EventProjectionCallMessage>,
): string | undefined {
  let callId = message.parentToolCallId;
  const visited = new Set<string>();
  while (callId && !visited.has(callId)) {
    visited.add(callId);
    const call = callMessageById.get(callId);
    if (!call?.parentToolCallId) {
      return callId;
    }
    callId = call.parentToolCallId;
  }
  return undefined;
}

function selectActiveBackgroundCommandMessages(
  messages: readonly EventProjectionMessage[],
  callMessageById: ReadonlyMap<string, EventProjectionCallMessage>,
): EventProjectionWorkflowMessage[] {
  const representedRootCallIds = new Set<string>();
  for (const message of messages) {
    if (
      message.kind === "workflow" &&
      message.status === "pending" &&
      !message.skipTranscript &&
      message.parentToolCallId &&
      isDirectBackgroundTaskForCurrentAgent(message, callMessageById)
    ) {
      representedRootCallIds.add(message.parentToolCallId);
    }
  }
  const running: EventProjectionWorkflowMessage[] = [];
  for (const message of messages) {
    const isDirect =
      message.kind === "workflow" &&
      isDirectBackgroundTaskForCurrentAgent(message, callMessageById);
    const rootSpawningCallId =
      message.kind === "workflow"
        ? getRootSpawningCallId(message, callMessageById)
        : undefined;
    const isRepresentedByActiveParent =
      !isDirect &&
      rootSpawningCallId !== undefined &&
      representedRootCallIds.has(rootSpawningCallId);
    if (
      message.kind !== "workflow" ||
      message.taskType === LOCAL_WORKFLOW_TASK_TYPE ||
      message.status !== "pending" ||
      message.skipTranscript ||
      message.foreground ||
      isRepresentedByActiveParent ||
      (!isDirect && !isBackgroundCommandTaskType(message.taskType))
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

function buildRejectedClientRequestIds(
  events: ThreadEventWithMeta[],
  acceptedClientRequestById: ReadonlyMap<string, unknown>,
): ReadonlySet<string> {
  const requestIds = new Set<string>();
  for (const { event } of events) {
    if (
      event.type === "client/turn/rejected" &&
      !acceptedClientRequestById.has(event.requestId)
    ) {
      requestIds.add(event.requestId);
    }
  }
  return requestIds;
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
  state.messages.push(projectedClientUser);
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
    typeof eventTurnId !== "string" ||
    state.suppressedAcceptedRootParentToolCallIdsByTurnId.get(eventTurnId) !==
      parentToolCallId
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
  if (
    decoded.type === "provider/warning" &&
    decoded.category === "compaction-skipped"
  ) {
    return {
      status: "completed",
      detail: decoded.details ?? decoded.summary,
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

interface ProjectionFoldLookups {
  acceptedClientRequestById: ReturnType<typeof buildAcceptedClientRequestById>;
  acceptedRootClientTurnIds: ReadonlySet<string>;
  clientRequestById: Map<string, ClientTurnRequestedWithMeta>;
  rejectedClientRequestIds: ReadonlySet<string>;
  selectedStartedTurnIds: ReadonlySet<string>;
}

const PROJECTION_FOLD_LOOKUP_EVENT_TYPES: ReadonlySet<ThreadEvent["type"]> =
  new Set([
    "client/turn/requested",
    "client/turn/rejected",
    "turn/input/accepted",
    "turn/started",
  ]);

function createProjectionFoldLookups(
  context: AcceptedClientRequestContext,
  orderedEvents: ThreadEventWithMeta[],
): ProjectionFoldLookups {
  const clientRequestById = buildClientTurnRequestById(orderedEvents);
  const acceptedClientRequestById = buildAcceptedClientRequestById({
    context,
    events: orderedEvents,
  });
  return {
    acceptedClientRequestById,
    acceptedRootClientTurnIds: buildAcceptedRootClientTurnIds(
      orderedEvents,
      clientRequestById,
    ),
    clientRequestById,
    rejectedClientRequestIds: buildRejectedClientRequestIds(
      orderedEvents,
      acceptedClientRequestById,
    ),
    selectedStartedTurnIds: buildSelectedStartedTurnIds(orderedEvents),
  };
}

function foldProjectionEvent(
  state: ProjectionState,
  lookups: ProjectionFoldLookups,
  options: BuildEventProjectionMessagesOptions | undefined,
  entry: ThreadEventWithMeta,
): void {
  const { event: decoded, meta } = entry;
  const {
    acceptedClientRequestById,
    acceptedRootClientTurnIds,
    clientRequestById,
    rejectedClientRequestIds,
    selectedStartedTurnIds,
  } = lookups;
  const eventType = decoded.type;
  const eventTurnId = getEventTurnId(decoded);
  const isAcceptedRootClientTurn =
    typeof eventTurnId === "string" &&
    acceptedRootClientTurnIds.has(eventTurnId);
  const decodedEventParentToolCallId = getEventParentToolCallId(decoded);
  if (
    decoded.type === "turn/started" &&
    isAcceptedRootClientTurn &&
    decodedEventParentToolCallId
  ) {
    state.suppressedAcceptedRootParentToolCallIdsByTurnId.set(
      eventTurnId,
      decodedEventParentToolCallId,
    );
  }
  const explicitEventParentToolCallId = shouldUseExplicitEventParentToolCallId({
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
    } else if (explicitEventParentToolCallId) {
      state.delegationParentToolCallIdsByTurnId.set(
        turnId,
        explicitEventParentToolCallId,
      );
    }
    onTurnStarted(state, turnId);
  }

  const eventParentToolCallId = isAcceptedRootClientTurn
    ? explicitEventParentToolCallId
    : (explicitEventParentToolCallId ??
      (eventTurnId
        ? state.delegationParentToolCallIdsByTurnId.get(eventTurnId)
        : undefined));

  const compactionTurnFinalization = getCompactionTurnFinalization(decoded);
  if (compactionTurnFinalization) {
    const settledPendingCompaction = finalizeOpenCompactionsForTurn({
      state,
      meta,
      threadId: decoded.threadId,
      turnId: eventTurnId,
      status: compactionTurnFinalization.status,
      detail: compactionTurnFinalization.detail,
    });
    if (settledPendingCompaction && decoded.type === "provider/warning") {
      return;
    }
  }

  if (
    eventType === "system/thread/interrupted" ||
    eventType === "turn/completed"
  ) {
    if (decoded.type === "turn/completed") {
      const completedTurnId = requireThreadEventScopeTurnId({
        type: decoded.type,
        scope: decoded.scope,
      });
      onTurnCompleted({
        meta,
        state,
        turnId: completedTurnId,
        status: decoded.status,
      });
      freezeTextAndFlushOutputAtStop(state.items, completedTurnId, {
        seq: meta.seq,
        createdAt: meta.createdAt,
        interrupted: decoded.status !== "completed",
      });
    } else {
      onThreadInterrupted({
        meta,
        state,
        threadId: decoded.threadId,
      });
      freezeTextAndFlushOutputAtStop(state.items, null, {
        seq: meta.seq,
        createdAt: meta.createdAt,
        interrupted: true,
      });
    }
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
            options: options,
          })
        : [];
    for (const acceptedSteer of acceptedSteers) {
      appendProjectedUserMessage(state, acceptedSteer);
    }
    return;
  }

  if (decoded.type === "client/turn/rejected") {
    const clientRequest = clientRequestById.get(decoded.requestId);
    if (clientRequest && rejectedClientRequestIds.has(decoded.requestId)) {
      for (const rejectedMessage of parseRejectedUsersFromClientRequest({
        decoded: clientRequest.event,
        requestMeta: clientRequest.meta,
        meta,
        options: options,
      })) {
        appendProjectedUserMessage(state, rejectedMessage);
      }
    }
    return;
  }

  if (
    decoded.type === "client/turn/requested" &&
    rejectedClientRequestIds.has(decoded.requestId)
  ) {
    return;
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
    options: options,
  });
  if (usersFromClientRequest.length > 0) {
    for (const userFromClientRequest of usersFromClientRequest) {
      appendProjectedUserMessage(state, userFromClientRequest);
    }
    return;
  }

  const providerUserMessage = parseProviderUserMessage(decoded, meta);
  if (providerUserMessage) {
    appendProjectedUserMessage(state, providerUserMessage);
    return;
  }

  const legacyUserMessage = parseLegacyUserMessage(decoded, meta);
  if (legacyUserMessage) {
    state.messages.push(legacyUserMessage);
    return;
  }

  const itemEventRole = classifyItemEvent(decoded);
  if (itemEventRole?.kind === "compaction") {
    const payload = {
      key: eventTurnId ?? itemEventRole.itemId,
      ...(eventParentToolCallId
        ? { parentToolCallId: eventParentToolCallId }
        : {}),
    };
    if (itemEventRole.completes) {
      onCompactionEnd(state, meta, decoded.threadId, eventTurnId, {
        ...payload,
        kind: "end",
      });
    } else {
      onCompactionBegin(state, meta, decoded.threadId, eventTurnId, {
        ...payload,
        kind: "begin",
      });
    }
    return;
  }
  if (itemEventRole !== null) {
    if (itemEventRole.kind === "ignored") {
      return;
    }
    const turnClosed =
      eventTurnId !== undefined && state.closedTurnIds.has(eventTurnId);
    const record = applyItemEvent(state.items, entry, itemEventRole, {
      parentToolCallId: eventParentToolCallId,
      turnClosed,
    });
    if (record?.textKind && record.turnId && !turnClosed) {
      state.openTurnIds.add(record.turnId);
    }
    return;
  }

  const compactionEvent = parseCompactionLifecycleEvent(
    decoded,
    meta,
    eventParentToolCallId,
  );
  if (compactionEvent) {
    onCompactionEnd(
      state,
      meta,
      decoded.threadId,
      eventTurnId,
      compactionEvent,
    );
    return;
  }

  const operation = parseOperationMessage(decoded, meta, {
    includeDiagnosticOperations: options?.includeDiagnosticOperations,
    providerDisplayName: options?.providerDisplayName,
    threadName: options?.threadName ?? "",
  });
  if (operation) {
    if (
      operation.kind === "operation" &&
      operation.opType === "thread-provisioning"
    ) {
      upsertProvisioningOperation(state, operation);
      return;
    }
    if (operation.kind === "operation" && operation.opType === "operation") {
      upsertThreadOperationMessage(state, operation);
      return;
    }
    if (operation.kind === "permission-grant-lifecycle") {
      upsertPermissionGrantLifecycleMessage(state, operation);
      return;
    }
    if (operation.kind === "user-question-lifecycle") {
      upsertUserQuestionLifecycleMessage(state, operation);
      return;
    }
    if (operation.kind === "plugin-form-lifecycle") {
      upsertPluginFormLifecycleMessage(state, operation);
      return;
    }
    state.messages.push(operation);
    return;
  }

  const error = parseErrorMessage(decoded, meta);
  if (error) {
    state.messages.push(error);
    return;
  }
}

function nestDelegatedTurnMessages(
  messages: EventProjectionMessage[],
  parentToolCallIdsByTurnId: ReadonlyMap<string, string>,
): EventProjectionMessage[] {
  return messages.map((message) => {
    if (message.parentToolCallId || message.scope.kind !== "turn") {
      return message;
    }
    const parentToolCallId = parentToolCallIdsByTurnId.get(
      message.scope.turnId,
    );
    return parentToolCallId ? { ...message, parentToolCallId } : message;
  });
}

function shouldSettleStreamingText(
  options: BuildEventProjectionMessagesOptions | undefined,
): boolean {
  return (
    options?.threadStatus !== undefined &&
    !shouldPreservePendingMessages(options.threadStatus)
  );
}

function finishFlatProjection(
  state: ProjectionState,
  orderedEvents: ThreadEventWithMeta[],
  options: BuildEventProjectionMessagesOptions | undefined,
  includeActiveThinking: boolean,
): BuildFlatProjectionDataResult {
  finalizeProjectionState({ state, options: options });
  const messages = sortEventProjectionMessagesBySource(
    nestDelegatedTurnMessages(
      normalizeProvisioningFailures(orderedEvents, state.messages),
      state.delegationParentToolCallIdsByTurnId,
    ),
  );
  const callMessageById = buildCallMessageById(messages);
  enrichBackgroundAgentModels(messages, callMessageById);
  return {
    activeThinking: includeActiveThinking
      ? options?.threadStatus === "active"
        ? selectItemRecordActiveThinking(state.items)
        : null
      : null,
    activeWorkflows: selectActiveWorkflowMessages(messages),
    activeBackgroundCommands: selectActiveBackgroundCommandMessages(
      messages,
      callMessageById,
    ),
    delegatedTurnIds: new Set(state.delegationParentToolCallIdsByTurnId.keys()),
    messages,
  };
}

function buildFlatProjectionData(
  args: BuildFlatProjectionDataArgs,
): BuildFlatProjectionDataResult {
  const state = createProjectionState();
  const lookups = createProjectionFoldLookups(
    args.acceptedClientRequestContext,
    args.events,
  );
  for (const event of args.events) {
    foldProjectionEvent(state, lookups, args.options, event);
  }
  state.messages.push(
    ...collectItemRecordMessages(
      state.items,
      shouldSettleStreamingText(args.options),
    ),
  );
  return finishFlatProjection(
    state,
    args.events,
    args.options,
    args.includeActiveThinking,
  );
}

function buildDetailedProjection(
  args: BuildDetailedProjectionArgs,
): EventProjection {
  const projection = groupEventProjectionTurns({
    delegatedTurnIds: args.delegatedTurnIds,
    events: args.events,
    messages: args.messages,
  });
  const semanticProjection = normalizeEventProjection({
    ...projection,
    state: {
      activeThinking: args.activeThinking,
      activeWorkflows: args.activeWorkflows,
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
    activeWorkflows: flatProjection.activeWorkflows,
    activeBackgroundCommands: flatProjection.activeBackgroundCommands,
    delegatedTurnIds: flatProjection.delegatedTurnIds,
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
        activeWorkflows: [],
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
    activeWorkflows: flatProjection.activeWorkflows,
    activeBackgroundCommands: flatProjection.activeBackgroundCommands,
    delegatedTurnIds: flatProjection.delegatedTurnIds,
    events: orderedEvents,
    messages: flatProjection.messages,
    turnMessageDetail: options.turnMessageDetail,
  });
}

export interface EventProjectionFold {
  events: ThreadEventWithMeta[];
  lookups: ProjectionFoldLookups;
  options: BuildEventProjectionOptions;
  state: ProjectionState;
}

export function startEventProjectionFold(
  events: ThreadEventWithMeta[],
  options: BuildEventProjectionOptions,
): EventProjectionFold {
  const orderedEvents = getOrderedThreadEvents(events);
  const lookups = createProjectionFoldLookups(
    options.acceptedClientRequestContext ??
      EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    orderedEvents,
  );
  const state = createProjectionState();
  for (const event of orderedEvents) {
    foldProjectionEvent(state, lookups, options, event);
  }
  return { events: orderedEvents, lookups, options, state };
}

export function resumeEventProjectionFold(
  fold: EventProjectionFold,
  appended: readonly ThreadEventWithMeta[],
): boolean {
  let lastSeq = fold.events.at(-1)?.meta.seq ?? Number.NEGATIVE_INFINITY;
  for (const { event, meta } of appended) {
    if (
      meta.seq <= lastSeq ||
      PROJECTION_FOLD_LOOKUP_EVENT_TYPES.has(event.type)
    ) {
      return false;
    }
    lastSeq = meta.seq;
  }
  for (const event of appended) {
    foldProjectionEvent(fold.state, fold.lookups, fold.options, event);
    fold.events.push(event);
  }
  return true;
}

function copyProjectionStateForFinish(
  state: ProjectionState,
  options: BuildEventProjectionOptions,
): ProjectionState {
  const itemMessages = collectItemRecordMessages(
    state.items,
    shouldSettleStreamingText(options),
  );
  const { items, ...rest } = state;
  if (
    !shouldPreservePendingMessages(options.threadStatus) ||
    interruptedTurnFinalizationChangesState(state, itemMessages)
  ) {
    const copy: ProjectionState = { ...structuredClone(rest), items };
    copy.messages.push(...itemMessages.map((message) => ({ ...message })));
    return copy;
  }
  return {
    ...state,
    messages: [...state.messages, ...itemMessages].map((message) =>
      message.kind === "workflow" ? { ...message } : message,
    ),
  };
}

export function finishEventProjectionFold(
  fold: EventProjectionFold,
  events: ThreadEventWithMeta[],
): EventProjection {
  const orderedEvents = getOrderedThreadEvents(events);
  const flatProjection = finishFlatProjection(
    copyProjectionStateForFinish(fold.state, fold.options),
    orderedEvents,
    fold.options,
    true,
  );
  return buildDetailedProjection({
    activeThinking: flatProjection.activeThinking,
    activeWorkflows: flatProjection.activeWorkflows,
    activeBackgroundCommands: flatProjection.activeBackgroundCommands,
    delegatedTurnIds: flatProjection.delegatedTurnIds,
    events: orderedEvents,
    messages: flatProjection.messages,
    turnMessageDetail: fold.options.turnMessageDetail,
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
        activeWorkflows: [],
        activeBackgroundCommands: [],
      },
      entries: [],
    };
  }

  const orderedEvents = getOrderedThreadEvents(events);
  return buildFullEventProjection(orderedEvents, options);
}
