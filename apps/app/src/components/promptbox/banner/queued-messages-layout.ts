import type { ThreadQueuedMessage } from "@bb/domain";
import { queuedMessageHasWaitLine } from "@/lib/queued-message-wait";

const DRAWER_HEIGHT = 174;
const DRAWER_CHROME_HEIGHT = 1 + 32 + 12 + 2;
const DRAWER_LIST_PADDING = 8;
const DRAWER_ROW_HEIGHT = 33;
const DRAWER_SECOND_LINE_HEIGHT = 16;
const DRAWER_SENDER_PILL_LINE_HEIGHT = 22;

export function getQueuedMessagesDrawerHeight({
  queuedMessages,
  processingMessageId,
}: {
  queuedMessages: readonly ThreadQueuedMessage[];
  processingMessageId: string | null;
}): number {
  const rowsHeight =
    queuedMessages.length === 0
      ? DRAWER_ROW_HEIGHT
      : queuedMessages.reduce(
          (total, queuedMessage) =>
            total +
            DRAWER_ROW_HEIGHT +
            (queuedMessage.initiator !== "user" ||
            queuedMessageHasWaitLine(queuedMessage) ||
            queuedMessage.id === processingMessageId
              ? queuedMessage.initiator === "agent" &&
                queuedMessage.senderThreadId !== null
                ? DRAWER_SENDER_PILL_LINE_HEIGHT
                : DRAWER_SECOND_LINE_HEIGHT
              : 0),
          0,
        );
  return Math.min(
    DRAWER_HEIGHT,
    DRAWER_CHROME_HEIGHT + DRAWER_LIST_PADDING + rowsHeight,
  );
}

export function getPendingQueuedMessagesDrawerHeight(
  queuedMessageCount: number,
): number {
  return Math.min(
    DRAWER_HEIGHT,
    DRAWER_CHROME_HEIGHT +
      DRAWER_LIST_PADDING +
      Math.max(1, queuedMessageCount) * DRAWER_ROW_HEIGHT,
  );
}
