import { applyNeighborReorder } from "./neighbor-reorder";

export interface QueuedMessageReorderItem {
  id: string;
}

export interface QueuedMessageReorderRequest {
  groupBoundaryQueuedMessageId?: string;
  nextQueuedMessageId: string | null;
  previousQueuedMessageId: string | null;
  queuedMessageId: string;
}

export interface ApplyQueuedMessageReorderArgs<
  Item extends QueuedMessageReorderItem,
> {
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
