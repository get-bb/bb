import type { ThreadEvent } from "@bb/domain";
import { createItemRecordStore, type ItemRecordStore } from "./item-records.js";
import type {
  BuildEventProjectionMessagesOptions,
  EventProjectionMessage,
  EventProjectionTurnStatus,
} from "./event-projection-types.js";
import {
  finalizeOperationMessage,
  interruptOperationMessage,
} from "./parse-operation-message.js";
import {
  createOperationProjectionState,
  interruptOpenCompactions,
  type CompactionTurnFinalizationStatus,
  type OperationProjectionState,
} from "./operation-projection.js";
import type { EventMeta } from "./event-decode.js";
import { shouldPreservePendingMessages } from "./user-message-parsing.js";

export interface CompactionTurnFinalization {
  status: CompactionTurnFinalizationStatus;
  detail: string | undefined;
}

type TurnPendingFinalizationStatus = Extract<
  EventProjectionTurnStatus,
  "interrupted"
>;
interface TurnPendingFinalization {
  completedAt: number;
  status: TurnPendingFinalizationStatus;
}
type TurnCompletedStatus = Extract<
  ThreadEvent,
  { type: "turn/completed" }
>["status"];

interface CompleteTurnArgs {
  meta: EventMeta;
  state: ProjectionState;
  status: TurnCompletedStatus;
  turnId: string;
}

interface FinalizeProjectionMessagesArgs {
  options: BuildEventProjectionMessagesOptions | undefined;
  state: ProjectionState;
}

interface ThreadInterruptedArgs {
  meta: EventMeta;
  state: ProjectionState;
  threadId: string;
}

export interface ProjectionState extends OperationProjectionState {
  items: ItemRecordStore;
  seenUserKeys: Set<string>;
  openTurnIds: Set<string>;
  closedTurnIds: Set<string>;
  pendingFinalizationByTurnId: Map<string, TurnPendingFinalization>;
  threadInterruptedAt: number | null;
  delegationParentToolCallIdsByTurnId: Map<string, string>;
  suppressedAcceptedRootParentToolCallIdsByTurnId: Map<string, string>;
}

export function createProjectionState(): ProjectionState {
  const messages: EventProjectionMessage[] = [];
  return {
    ...createOperationProjectionState(messages),
    seenUserKeys: new Set(),
    openTurnIds: new Set(),
    closedTurnIds: new Set(),
    pendingFinalizationByTurnId: new Map(),
    threadInterruptedAt: null,
    items: createItemRecordStore(),
    delegationParentToolCallIdsByTurnId: new Map(),
    suppressedAcceptedRootParentToolCallIdsByTurnId: new Map(),
  };
}

function closeOpenTurns(state: ProjectionState): void {
  for (const turnId of state.openTurnIds) {
    state.closedTurnIds.add(turnId);
  }
  state.openTurnIds.clear();
}

export function onTurnStarted(state: ProjectionState, turnId: string): void {
  state.openTurnIds.add(turnId);
}

export function onTurnCompleted(args: CompleteTurnArgs): void {
  args.state.closedTurnIds.add(args.turnId);
  args.state.openTurnIds.delete(args.turnId);
  if (args.status === "interrupted") {
    args.state.pendingFinalizationByTurnId.set(args.turnId, {
      completedAt: args.meta.createdAt,
      status: "interrupted",
    });
  }
}

export function onThreadInterrupted(args: ThreadInterruptedArgs): void {
  args.state.threadInterruptedAt = args.meta.createdAt;
  interruptOpenCompactions({
    state: args.state,
    meta: args.meta,
    threadId: args.threadId,
  });
  for (const turnId of args.state.openTurnIds) {
    args.state.pendingFinalizationByTurnId.set(turnId, {
      completedAt: args.meta.createdAt,
      status: "interrupted",
    });
  }
  closeOpenTurns(args.state);
}

function callIdsWithRunningBackgroundTasks(
  messages: readonly EventProjectionMessage[],
): Set<string> {
  const callIds = new Set<string>();
  for (const message of messages) {
    if (
      message.kind === "workflow" &&
      message.status === "pending" &&
      message.parentToolCallId
    ) {
      callIds.add(message.parentToolCallId);
    }
  }
  return callIds;
}

function interruptPendingToolMessages(
  state: ProjectionState,
  completedAt: number | null,
  turnId: string | null,
): void {
  const stillRunningCallIds = callIdsWithRunningBackgroundTasks(state.messages);
  for (const message of state.messages) {
    if (
      turnId !== null &&
      (message.scope.kind !== "turn" || message.scope.turnId !== turnId)
    ) {
      continue;
    }
    switch (message.kind) {
      case "command":
      case "tool-call":
      case "delegation":
        if (
          message.status === "pending" &&
          !stillRunningCallIds.has(message.callId)
        ) {
          message.status = "interrupted";
          message.completedAt = completedAt;
          if (message.kind === "command") {
            message.output =
              state.items.currentByItemId.get(message.callId)?.output ??
              message.output;
          }
          message.output ||= "Tool execution interrupted";
          if (
            message.kind !== "delegation" &&
            message.approvalStatus === "waiting_for_approval"
          ) {
            message.approvalStatus = null;
          }
        }
        break;
      case "web-search":
      case "web-fetch":
      case "image-generation":
      case "image-view":
      case "file-read":
      case "search":
      case "plan-steps":
      case "extension":
        if (message.status === "pending") {
          message.status = "interrupted";
          message.completedAt = completedAt;
        }
        break;
      default:
        break;
    }
  }
}

function finalizePendingMessages(args: FinalizeProjectionMessagesArgs): void {
  const shouldPreservePending = shouldPreservePendingMessages(
    args.options?.threadStatus,
  );
  if (shouldPreservePending) {
    return;
  }

  interruptPendingToolMessages(
    args.state,
    args.state.threadInterruptedAt,
    null,
  );

  for (const message of args.state.messages) {
    if (message.kind === "file-edit" && message.status === "pending") {
      message.status = "interrupted";
    }
  }

  for (const message of args.state.messages) {
    if (message.kind !== "operation") continue;
    if (
      args.options?.threadStatus === "idle" &&
      message.opType === "compaction" &&
      message.scope.kind === "turn" &&
      args.state.closedTurnIds.has(message.scope.turnId)
    ) {
      continue;
    }
    finalizeOperationMessage(message, args.options);
  }
}

function getMessageTurnFinalization(
  message: EventProjectionMessage,
  pendingFinalizationByTurnId: ReadonlyMap<string, TurnPendingFinalization>,
): TurnPendingFinalization | null {
  if (message.scope.kind !== "turn") {
    return null;
  }
  return pendingFinalizationByTurnId.get(message.scope.turnId) ?? null;
}

function finalizePendingMessageForInterruptedTurn(
  message: EventProjectionMessage,
  finalization: TurnPendingFinalization,
): void {
  if (finalization.status !== "interrupted") {
    return;
  }

  switch (message.kind) {
    case "command":
    case "tool-call":
    case "web-search":
    case "web-fetch":
    case "image-view":
      return;
    case "file-edit":
      if (message.status === "pending") {
        message.status = "interrupted";
      }
      return;
    case "operation":
      interruptOperationMessage(message);
      return;
    case "permission-grant-lifecycle":
      if (message.status === "pending") {
        message.status = "interrupted";
        message.lifecycle = "interrupted";
      }
      return;
    case "user-question-lifecycle":
      if (message.status === "pending") {
        message.status = "interrupted";
        message.lifecycle = "interrupted";
      }
      return;
    case "plugin-form-lifecycle":
      if (message.status === "pending") {
        message.status = "interrupted";
        message.lifecycle = "cancelled";
      }
      return;
    case "assistant-text":
    case "delegation":
    case "error":
    case "user":
      return;
  }
}

function isPendingInTurns(
  message: EventProjectionMessage,
  turnIds: ReadonlyMap<string, TurnPendingFinalization>,
): boolean {
  return (
    message.scope.kind === "turn" &&
    turnIds.has(message.scope.turnId) &&
    "status" in message &&
    message.status === "pending"
  );
}

export function interruptedTurnFinalizationChangesState(
  state: ProjectionState,
  itemMessages: readonly EventProjectionMessage[],
): boolean {
  const turnIds = state.pendingFinalizationByTurnId;
  return (
    turnIds.size > 0 &&
    (state.messages.some((message) => isPendingInTurns(message, turnIds)) ||
      itemMessages.some((message) => isPendingInTurns(message, turnIds)))
  );
}

function finalizeInterruptedTurnPendingMessages(state: ProjectionState): void {
  if (state.pendingFinalizationByTurnId.size === 0) {
    return;
  }

  for (const [turnId, finalization] of state.pendingFinalizationByTurnId) {
    interruptPendingToolMessages(state, finalization.completedAt, turnId);
  }

  for (const message of state.messages) {
    const finalization = getMessageTurnFinalization(
      message,
      state.pendingFinalizationByTurnId,
    );
    if (!finalization) {
      continue;
    }
    finalizePendingMessageForInterruptedTurn(message, finalization);
  }
}

export function finalizeProjectionState(
  args: FinalizeProjectionMessagesArgs,
): void {
  finalizeInterruptedTurnPendingMessages(args.state);
  finalizePendingMessages(args);
}
