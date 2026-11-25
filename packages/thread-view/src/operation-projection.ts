import type {
  EventProjectionMessage,
  EventProjectionOperationMessage,
  EventProjectionPermissionGrantLifecycleMessage,
  EventProjectionUserQuestionLifecycleMessage,
  EventProjectionPluginFormLifecycleMessage,
} from "./event-projection-types.js";
import type { CompactionLifecycleEvent } from "./compaction-lifecycle.js";
import type { EventMeta } from "./event-decode.js";
import { messageId } from "./format-helpers.js";
import {
  mergeProvisioningMetadata,
  provisioningKey,
  provisioningTitleForStatus,
} from "./provisioning-helpers.js";
import {
  haveCompatibleEventProjectionMessageScope,
  eventProjectionMessageThreadScopeFields,
  eventProjectionMessageTurnScopeFields,
} from "./message-scope.js";

export interface OperationProjectionState {
  messages: EventProjectionMessage[];
  openCompactionsByKey: Map<string, EventProjectionOperationMessage>;
  finalizedCompactionKeys: Set<string>;
  provisioningOperationsByKey: Map<string, EventProjectionOperationMessage>;
  permissionGrantsByInteractionId: Map<
    string,
    EventProjectionPermissionGrantLifecycleMessage
  >;
  userQuestionsByInteractionId: Map<
    string,
    EventProjectionUserQuestionLifecycleMessage
  >;
  pluginFormsByInteractionId: Map<
    string,
    EventProjectionPluginFormLifecycleMessage
  >;
  threadOperationsById: Map<string, EventProjectionOperationMessage>;
}

export function createOperationProjectionState(
  messages: EventProjectionMessage[],
): OperationProjectionState {
  return {
    messages,
    openCompactionsByKey: new Map(),
    finalizedCompactionKeys: new Set(),
    provisioningOperationsByKey: new Map(),
    permissionGrantsByInteractionId: new Map(),
    userQuestionsByInteractionId: new Map(),
    pluginFormsByInteractionId: new Map(),
    threadOperationsById: new Map(),
  };
}

export type CompactionTurnFinalizationStatus = Extract<
  EventProjectionOperationMessage["status"],
  "completed" | "error" | "interrupted"
>;

interface FinalizeOpenCompactionsForTurnArgs {
  state: OperationProjectionState;
  meta: EventMeta;
  threadId: string;
  turnId: string | undefined;
  status: CompactionTurnFinalizationStatus;
  detail: string | undefined;
}

interface InterruptOpenCompactionsArgs {
  state: OperationProjectionState;
  meta: EventMeta;
  threadId: string;
}

type LifecycleStatus = Extract<
  EventProjectionOperationMessage["status"],
  "pending" | "completed" | "error" | "interrupted"
>;

type LifecycleEventProjectionMessage =
  | EventProjectionOperationMessage
  | EventProjectionPermissionGrantLifecycleMessage
  | EventProjectionUserQuestionLifecycleMessage
  | EventProjectionPluginFormLifecycleMessage;

interface OperationDetailMergeArgs {
  existing: string | undefined;
  incoming: string | undefined;
}

interface UpsertKeyedLifecycleMessageArgs<
  TMessage extends LifecycleEventProjectionMessage,
> {
  index: Map<string, TMessage>;
  incoming: TMessage;
  key: string | null | undefined;
  mergeExisting: (existing: TMessage, incoming: TMessage) => void;
  state: OperationProjectionState;
}

function isTerminalLifecycleStatus(status: LifecycleStatus): boolean {
  return status !== "pending";
}

function mergeLifecycleStatus(
  existing: LifecycleStatus,
  incoming: LifecycleStatus,
): LifecycleStatus {
  if (isTerminalLifecycleStatus(existing)) {
    return existing;
  }
  return incoming;
}

function mergeOperationDetail(
  args: OperationDetailMergeArgs,
): string | undefined {
  const details = [args.existing, args.incoming].filter(
    (value): value is string => Boolean(value),
  );
  if (details.length === 0) {
    return undefined;
  }
  return [...new Set(details)].join("\n");
}

function upsertKeyedLifecycleMessage<
  TMessage extends LifecycleEventProjectionMessage,
>(args: UpsertKeyedLifecycleMessageArgs<TMessage>): void {
  if (!args.key) {
    args.state.messages.push(args.incoming);
    return;
  }

  const scopedKey = lifecycleMessageKey(args.key, args.incoming);
  const existing = args.index.get(scopedKey);
  if (!existing) {
    args.index.set(scopedKey, args.incoming);
    args.state.messages.push(args.incoming);
    return;
  }

  updateMessageBounds(existing, args.incoming);
  args.mergeExisting(existing, args.incoming);
}

function lifecycleMessageKey(
  key: string,
  message: LifecycleEventProjectionMessage,
): string {
  if (message.scope.kind === "thread") {
    return `thread:${key}`;
  }
  return `turn:${message.scope.turnId}:${key}`;
}

function mergeProvisioningOperation(
  existing: EventProjectionOperationMessage,
  incoming: EventProjectionOperationMessage,
): void {
  const wasPending = (existing.status ?? "pending") === "pending";
  existing.status = mergeLifecycleStatus(
    existing.status ?? "pending",
    incoming.status ?? "pending",
  );
  existing.title = provisioningTitleForStatus(existing.status);
  if (wasPending && existing.status !== "pending") {
    existing.completedAt = incoming.completedAt ?? incoming.createdAt;
  }
  existing.provisioning = mergeProvisioningMetadata(
    existing.provisioning,
    incoming.provisioning,
  );
  existing.detail = mergeOperationDetail({
    existing: existing.detail,
    incoming: incoming.detail,
  });
}

export function upsertProvisioningOperation(
  state: OperationProjectionState,
  incoming: EventProjectionOperationMessage,
): void {
  upsertKeyedLifecycleMessage({
    index: state.provisioningOperationsByKey,
    incoming,
    key: provisioningKey(incoming),
    mergeExisting: mergeProvisioningOperation,
    state,
  });
}

function updateMessageBounds(
  existing: LifecycleEventProjectionMessage,
  incoming: LifecycleEventProjectionMessage,
): void {
  if (!haveCompatibleEventProjectionMessageScope(existing, incoming)) {
    throw new Error(
      `Cannot merge ${existing.kind} messages with different scopes`,
    );
  }
  existing.sourceSeqStart = Math.min(
    existing.sourceSeqStart,
    incoming.sourceSeqStart,
  );
  existing.sourceSeqEnd = Math.max(
    existing.sourceSeqEnd,
    incoming.sourceSeqEnd,
  );
  existing.createdAt = Math.max(existing.createdAt, incoming.createdAt);
  existing.startedAt = Math.min(
    existing.startedAt ?? existing.createdAt,
    incoming.startedAt ?? incoming.createdAt,
  );
}

export function upsertThreadOperationMessage(
  state: OperationProjectionState,
  incoming: EventProjectionOperationMessage,
): void {
  upsertKeyedLifecycleMessage({
    index: state.threadOperationsById,
    incoming,
    key: incoming.threadOperation?.operationId,
    mergeExisting: mergeThreadOperationMessage,
    state,
  });
}

function mergeThreadOperationMessage(
  existing: EventProjectionOperationMessage,
  incoming: EventProjectionOperationMessage,
): void {
  const mergedStatus = mergeLifecycleStatus(
    existing.status ?? "pending",
    incoming.status ?? "pending",
  );
  const shouldUseIncomingLifecycle = existing.status !== mergedStatus;
  existing.status = mergedStatus;
  if (shouldUseIncomingLifecycle) {
    existing.title = incoming.title;
    existing.threadOperation = incoming.threadOperation;
    if (mergedStatus !== "pending") {
      existing.completedAt = incoming.completedAt ?? incoming.createdAt;
    }
  }
  existing.detail = mergeOperationDetail({
    existing: existing.detail,
    incoming: incoming.detail,
  });
}

export function upsertPermissionGrantLifecycleMessage(
  state: OperationProjectionState,
  incoming: EventProjectionPermissionGrantLifecycleMessage,
): void {
  upsertKeyedLifecycleMessage({
    index: state.permissionGrantsByInteractionId,
    incoming,
    key: incoming.interactionId,
    mergeExisting: mergePermissionGrantLifecycleMessage,
    state,
  });
}

export function upsertUserQuestionLifecycleMessage(
  state: OperationProjectionState,
  incoming: EventProjectionUserQuestionLifecycleMessage,
): void {
  upsertKeyedLifecycleMessage({
    index: state.userQuestionsByInteractionId,
    incoming,
    key: incoming.interactionId,
    mergeExisting: mergeUserQuestionLifecycleMessage,
    state,
  });
}

export function upsertPluginFormLifecycleMessage(
  state: OperationProjectionState,
  incoming: EventProjectionPluginFormLifecycleMessage,
): void {
  upsertKeyedLifecycleMessage({
    index: state.pluginFormsByInteractionId,
    incoming,
    key: incoming.interactionId,
    mergeExisting: mergePluginFormLifecycleMessage,
    state,
  });
}

function mergePluginFormLifecycleMessage(
  existing: EventProjectionPluginFormLifecycleMessage,
  incoming: EventProjectionPluginFormLifecycleMessage,
): void {
  const wasTerminal = isTerminalLifecycleStatus(existing.status);
  existing.status = mergeLifecycleStatus(existing.status, incoming.status);
  if (wasTerminal) {
    return;
  }
  existing.lifecycle = incoming.lifecycle;
  existing.title = incoming.title;
  existing.statusReason = incoming.statusReason;
  existing.presentation = incoming.presentation;
  existing.payload = incoming.payload;
}

function mergeUserQuestionLifecycleMessage(
  existing: EventProjectionUserQuestionLifecycleMessage,
  incoming: EventProjectionUserQuestionLifecycleMessage,
): void {
  const wasTerminal = isTerminalLifecycleStatus(existing.status);
  const mergedStatus = mergeLifecycleStatus(existing.status, incoming.status);
  existing.status = mergedStatus;
  if (wasTerminal) {
    return;
  }

  existing.lifecycle = incoming.lifecycle;
  existing.questions = incoming.questions;
  existing.answers = incoming.answers;
  existing.statusReason = incoming.statusReason;
}

function mergePermissionGrantLifecycleMessage(
  existing: EventProjectionPermissionGrantLifecycleMessage,
  incoming: EventProjectionPermissionGrantLifecycleMessage,
): void {
  const wasTerminal = isTerminalLifecycleStatus(existing.status);
  const mergedStatus = mergeLifecycleStatus(existing.status, incoming.status);
  existing.status = mergedStatus;
  if (!wasTerminal) {
    existing.lifecycle = incoming.lifecycle;
  }
  existing.approvalTarget = incoming.approvalTarget;
}

export function onCompactionBegin(
  state: OperationProjectionState,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
  payload: CompactionLifecycleEvent,
): void {
  if (state.finalizedCompactionKeys.has(payload.key)) {
    return;
  }

  const existing = state.openCompactionsByKey.get(payload.key);
  if (existing) {
    existing.sourceSeqEnd = Math.max(existing.sourceSeqEnd, meta.seq);
    existing.createdAt = Math.max(existing.createdAt, meta.createdAt);
    existing.status = "pending";
    existing.title = "Compacting context";
    existing.detail = payload.detail ?? existing.detail;
    existing.parentToolCallId =
      payload.parentToolCallId ?? existing.parentToolCallId;
    return;
  }

  const message: EventProjectionOperationMessage = {
    kind: "operation",
    id: messageId(threadId, "op", `compaction:${payload.key}`),
    threadId,
    sourceEvent: { seq: meta.seq, part: 0 },
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    startedAt: meta.createdAt,
    completedAt: null,
    ...(turnId
      ? eventProjectionMessageTurnScopeFields(turnId)
      : eventProjectionMessageThreadScopeFields()),
    opType: "compaction",
    title: "Compacting context",
    detail: payload.detail,
    ...(payload.parentToolCallId
      ? { parentToolCallId: payload.parentToolCallId }
      : {}),
    status: "pending",
  };
  state.openCompactionsByKey.set(payload.key, message);
  state.messages.push(message);
}

export function onCompactionEnd(
  state: OperationProjectionState,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
  payload: CompactionLifecycleEvent,
): void {
  const existing = state.openCompactionsByKey.get(payload.key);
  if (existing) {
    existing.sourceSeqEnd = Math.max(existing.sourceSeqEnd, meta.seq);
    existing.createdAt = Math.max(existing.createdAt, meta.createdAt);
    existing.completedAt = meta.createdAt;
    existing.status = "completed";
    existing.title = "Context compacted";
    existing.detail = payload.detail ?? existing.detail;
    existing.parentToolCallId =
      payload.parentToolCallId ?? existing.parentToolCallId;
    state.openCompactionsByKey.delete(payload.key);
    state.finalizedCompactionKeys.add(payload.key);
    return;
  }

  if (state.finalizedCompactionKeys.has(payload.key)) {
    return;
  }

  state.messages.push({
    kind: "operation",
    id: messageId(threadId, "op", `compaction:${payload.key}`),
    threadId,
    sourceEvent: { seq: meta.seq, part: 0 },
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    startedAt: meta.createdAt,
    completedAt: meta.createdAt,
    ...(turnId
      ? eventProjectionMessageTurnScopeFields(turnId)
      : eventProjectionMessageThreadScopeFields()),
    opType: "compaction",
    title: "Context compacted",
    detail: payload.detail,
    ...(payload.parentToolCallId
      ? { parentToolCallId: payload.parentToolCallId }
      : {}),
    status: "completed",
  });
  state.finalizedCompactionKeys.add(payload.key);
}

function finalizeOpenCompaction(
  message: EventProjectionOperationMessage,
  meta: EventMeta,
  status: CompactionTurnFinalizationStatus,
  detail: string | undefined,
): void {
  message.sourceSeqEnd = Math.max(message.sourceSeqEnd, meta.seq);
  message.createdAt = Math.max(message.createdAt, meta.createdAt);
  message.completedAt = meta.createdAt;
  message.status = status;
  message.title =
    status === "error"
      ? "Context compaction failed"
      : status === "completed"
        ? "Context compaction skipped"
        : "Context compaction interrupted";
  message.detail = detail ?? message.detail;
}

export function finalizeOpenCompactionsForTurn(
  args: FinalizeOpenCompactionsForTurnArgs,
): boolean {
  if (!args.turnId) return false;

  let settledPending = false;
  for (const message of args.state.openCompactionsByKey.values()) {
    if (
      message.threadId !== args.threadId ||
      message.scope.kind !== "turn" ||
      message.scope.turnId !== args.turnId
    ) {
      continue;
    }

    if (message.status === "pending") {
      settledPending = true;
    }
    finalizeOpenCompaction(message, args.meta, args.status, args.detail);
  }
  return settledPending;
}

export function interruptOpenCompactions(
  args: InterruptOpenCompactionsArgs,
): void {
  for (const message of args.state.openCompactionsByKey.values()) {
    if (
      message.threadId !== args.threadId ||
      message.status !== "pending" ||
      message.sourceSeqStart > args.meta.seq
    ) {
      continue;
    }

    finalizeOpenCompaction(message, args.meta, "interrupted", undefined);
  }
}
