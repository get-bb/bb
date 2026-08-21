import { applyNeighborReorder } from "@bb/client-core";
import type { ThreadQueuedMessage } from "@bb/domain";

interface QueuedMessageReorderItem {
  id: string;
}

export interface QueuedMessageReorderRequest {
  groupBoundaryQueuedMessageId?: string;
  nextQueuedMessageId: string | null;
  previousQueuedMessageId: string | null;
  queuedMessageId: string;
}

interface ApplyQueuedMessageReorderArgs<Item extends QueuedMessageReorderItem> {
  queuedMessages: readonly Item[];
  request: QueuedMessageReorderRequest;
}

export function applyQueuedMessageReorder<
  Item extends QueuedMessageReorderItem,
>({ queuedMessages, request }: ApplyQueuedMessageReorderArgs<Item>): Item[] {
  return applyNeighborReorder({
    items: queuedMessages,
    request: {
      itemId: request.queuedMessageId,
      previousItemId: request.previousQueuedMessageId,
      nextItemId: request.nextQueuedMessageId,
    },
  });
}

export function collectLeadQueuedMessageGroupIds(
  queuedMessages: readonly ThreadQueuedMessage[],
): string[] {
  const ids: string[] = [];
  for (const queuedMessage of queuedMessages) {
    ids.push(queuedMessage.id);
    if (!queuedMessage.groupWithNext) break;
  }
  return ids;
}

export function preserveLeadQueuedMessageGroupAfterReorder({
  originalLeadGroupIds,
  queuedMessages,
}: {
  originalLeadGroupIds: readonly string[];
  queuedMessages: readonly ThreadQueuedMessage[];
}): ThreadQueuedMessage[] {
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
