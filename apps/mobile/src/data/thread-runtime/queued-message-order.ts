import { applyNeighborReorder } from "@bb/client-core";
import type { ThreadQueuedMessage } from "@bb/domain";
import type { ThreadQueuedMessageListResponse } from "@bb/server-contract";

/**
 * Queue ordering and grouping rules (ports apps/app/src/lib/queued-message-reorder.ts
 * and the group helpers of thread-runtime-cache-owner.ts /
 * QueuedMessagesList.tsx). The lead group is the prefix of messages with
 * `groupWithNext: true` plus the first message without it: those send
 * together as one turn. Setting the group boundary to message N groups
 * 0..N.
 *
 * The native list has no drag: it offers Move up / Move down and a per-row
 * "send together with above" / "send separately" toggle, whose requests are
 * built here.
 */

export interface QueuedMessageReorderRequest {
  groupBoundaryQueuedMessageId?: string;
  nextQueuedMessageId: string | null;
  previousQueuedMessageId: string | null;
  queuedMessageId: string;
}

export interface QueuedMessageGroupBoundaryRequest {
  expectedGroupedPrefixQueuedMessageIds: string[];
  groupBoundaryQueuedMessageId: string;
}

export type QueuedMessageMoveDirection = "up" | "down";

export function applyQueuedMessageReorder<Item extends { id: string }>(
  queuedMessages: readonly Item[],
  request: QueuedMessageReorderRequest,
): Item[] {
  return applyNeighborReorder({
    items: queuedMessages,
    request: {
      itemId: request.queuedMessageId,
      previousItemId: request.previousQueuedMessageId,
      nextItemId: request.nextQueuedMessageId,
    },
  });
}

/** Index of the last message of the lead group (0 when nothing is grouped). */
export function getQueuedMessageGroupBoundaryIndex(
  queuedMessages: readonly Pick<ThreadQueuedMessage, "groupWithNext">[],
): number {
  const firstUngroupedIndex = queuedMessages.findIndex(
    (queuedMessage) => !queuedMessage.groupWithNext,
  );
  return firstUngroupedIndex === -1
    ? Math.max(0, queuedMessages.length - 1)
    : firstUngroupedIndex;
}

export function collectLeadQueuedMessageGroupIds(
  queuedMessages: readonly Pick<ThreadQueuedMessage, "id" | "groupWithNext">[],
): string[] {
  const ids: string[] = [];
  for (const queuedMessage of queuedMessages) {
    ids.push(queuedMessage.id);
    if (!queuedMessage.groupWithNext) break;
  }
  return ids;
}

export function applyQueuedMessageGroupBoundary(
  queuedMessages: readonly ThreadQueuedMessage[],
  groupBoundaryQueuedMessageId: string,
): ThreadQueuedMessage[] {
  const boundaryIndex = queuedMessages.findIndex(
    (queuedMessage) => queuedMessage.id === groupBoundaryQueuedMessageId,
  );
  if (boundaryIndex === -1) return [...queuedMessages];
  return queuedMessages.map((queuedMessage, index) => ({
    ...queuedMessage,
    groupWithNext: index < boundaryIndex,
  }));
}

/**
 * After a plain reorder the lead group survives only when the same messages
 * still occupy the head of the queue; otherwise every message sends alone.
 */
export function preserveLeadQueuedMessageGroupAfterReorder(
  queuedMessages: readonly ThreadQueuedMessage[],
  originalLeadGroupIds: readonly string[],
): ThreadQueuedMessage[] {
  if (originalLeadGroupIds.length <= 1) {
    return queuedMessages.map((queuedMessage) => ({
      ...queuedMessage,
      groupWithNext: false,
    }));
  }
  const originalLeadGroupIdSet = new Set(originalLeadGroupIds);
  const preservesLeadGroup = queuedMessages
    .slice(0, originalLeadGroupIds.length)
    .every((queuedMessage) => originalLeadGroupIdSet.has(queuedMessage.id));
  return queuedMessages.map((queuedMessage, index) => ({
    ...queuedMessage,
    groupWithNext:
      preservesLeadGroup && index < originalLeadGroupIds.length - 1,
  }));
}

/** What "send now" on `queuedMessageId` sends: the lead group, or the one message. */
export function queuedMessageSendGroup(
  queuedMessages: readonly ThreadQueuedMessage[] | undefined,
  queuedMessageId: string,
): ThreadQueuedMessage[] {
  if (!queuedMessages) return [];
  const index = queuedMessages.findIndex(
    (queuedMessage) => queuedMessage.id === queuedMessageId,
  );
  if (index === -1) return [];
  const target = queuedMessages[index];
  if (!target) return [];
  if (index !== 0) return [target];
  const group: ThreadQueuedMessage[] = [];
  for (const queuedMessage of queuedMessages) {
    group.push(queuedMessage);
    if (!queuedMessage.groupWithNext) break;
  }
  return group;
}

export function removeQueuedMessagesAndRepairGroupEdges(
  queuedMessages: ThreadQueuedMessageListResponse | undefined,
  removeIds: ReadonlySet<string>,
): ThreadQueuedMessageListResponse | undefined {
  if (!queuedMessages) return queuedMessages;
  return queuedMessages.flatMap((queuedMessage, index) => {
    if (removeIds.has(queuedMessage.id)) return [];
    const next = queuedMessages[index + 1];
    if (next && removeIds.has(next.id) && queuedMessage.groupWithNext) {
      return [{ ...queuedMessage, groupWithNext: false }];
    }
    return [queuedMessage];
  });
}

/** `PATCH .../order` request for moving one message one slot up or down. */
export function buildMoveQueuedMessageRequest(
  queuedMessages: readonly Pick<ThreadQueuedMessage, "id">[],
  queuedMessageId: string,
  direction: QueuedMessageMoveDirection,
): QueuedMessageReorderRequest | null {
  const index = queuedMessages.findIndex(
    (queuedMessage) => queuedMessage.id === queuedMessageId,
  );
  if (index === -1) return null;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= queuedMessages.length) return null;
  const ids = queuedMessages.map((queuedMessage) => queuedMessage.id);
  const moved = [...ids];
  moved.splice(index, 1);
  moved.splice(targetIndex, 0, queuedMessageId);
  return {
    queuedMessageId,
    previousQueuedMessageId: moved[targetIndex - 1] ?? null,
    nextQueuedMessageId: moved[targetIndex + 1] ?? null,
  };
}

export type QueuedMessageGroupToggle =
  | { kind: "group-with-above"; request: QueuedMessageGroupBoundaryRequest }
  | { kind: "send-separately"; request: QueuedMessageGroupBoundaryRequest };

/**
 * Per-row grouping action. A message after the lead group can join it
 * ("send together with the messages above", which also pulls in everything
 * between); a message inside the lead group (not the first) can split off
 * ("send separately", which also releases everything after it).
 */
export function buildQueuedMessageGroupToggle(
  queuedMessages: readonly Pick<ThreadQueuedMessage, "id" | "groupWithNext">[],
  queuedMessageId: string,
): QueuedMessageGroupToggle | null {
  const index = queuedMessages.findIndex(
    (queuedMessage) => queuedMessage.id === queuedMessageId,
  );
  if (index <= 0) return null;
  const boundaryIndex = getQueuedMessageGroupBoundaryIndex(queuedMessages);
  const ids = queuedMessages.map((queuedMessage) => queuedMessage.id);
  if (index > boundaryIndex) {
    return {
      kind: "group-with-above",
      request: {
        expectedGroupedPrefixQueuedMessageIds: ids.slice(0, index + 1),
        groupBoundaryQueuedMessageId: queuedMessageId,
      },
    };
  }
  const newBoundaryId = ids[index - 1];
  if (newBoundaryId === undefined) return null;
  return {
    kind: "send-separately",
    request: {
      expectedGroupedPrefixQueuedMessageIds: ids.slice(0, index),
      groupBoundaryQueuedMessageId: newBoundaryId,
    },
  };
}
