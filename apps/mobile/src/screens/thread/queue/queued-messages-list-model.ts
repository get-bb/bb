import {
  countQueuedMessageAttachments,
  formatQueuedMessagePreview,
} from "@bb/client-core";
import type { ThreadQueuedMessage } from "@bb/domain";
import {
  buildMoveQueuedMessageRequest,
  buildQueuedMessageGroupToggle,
  getQueuedMessageGroupBoundaryIndex,
  type QueuedMessageGroupToggle,
  type QueuedMessageReorderRequest,
} from "@/data/thread-runtime/queued-message-order";

/**
 * Pure view model of the native queued-messages list: what each row shows
 * and which actions its menu offers (ports the semantics of
 * apps/app/src/components/promptbox/banner/QueuedMessagesList.tsx without
 * drag: Move up / Move down replace the sortable handle and a per-row group
 * toggle replaces the draggable divider).
 */

export type QueuedMessageProcessingAction = "send" | "edit" | "delete";

export interface QueuedMessageRowModel {
  id: string;
  index: number;
  preview: string;
  attachmentCount: number;
  /** Part of the lead group that sends as one turn (`groupWithNext` prefix). */
  inLeadGroup: boolean;
  /** Last message of the lead group (the divider sits under it). */
  isGroupBoundary: boolean;
  moveUp: QueuedMessageReorderRequest | null;
  moveDown: QueuedMessageReorderRequest | null;
  groupToggle: QueuedMessageGroupToggle | null;
}

export function buildQueuedMessageRowModels(
  queuedMessages: readonly ThreadQueuedMessage[],
): QueuedMessageRowModel[] {
  const boundaryIndex = getQueuedMessageGroupBoundaryIndex(queuedMessages);
  const hasGroup = queuedMessages.length > 1 && boundaryIndex > 0;
  return queuedMessages.map((queuedMessage, index) => ({
    id: queuedMessage.id,
    index,
    preview: formatQueuedMessagePreview(queuedMessage.content),
    attachmentCount: countQueuedMessageAttachments(queuedMessage.content),
    inLeadGroup: hasGroup && index <= boundaryIndex,
    isGroupBoundary: hasGroup && index === boundaryIndex,
    moveUp: buildMoveQueuedMessageRequest(
      queuedMessages,
      queuedMessage.id,
      "up",
    ),
    moveDown: buildMoveQueuedMessageRequest(
      queuedMessages,
      queuedMessage.id,
      "down",
    ),
    groupToggle: buildQueuedMessageGroupToggle(
      queuedMessages,
      queuedMessage.id,
    ),
  }));
}

export function queuedMessageProcessingLabel(
  action: QueuedMessageProcessingAction,
): string {
  switch (action) {
    case "send":
      return "Sending…";
    case "edit":
      return "Saving…";
    case "delete":
      return "Deleting…";
  }
}

export function queuedMessageGroupToggleLabel(
  toggle: QueuedMessageGroupToggle,
): string {
  return toggle.kind === "group-with-above"
    ? "Send together with the messages above"
    : "Send separately from the messages above";
}
