import { useSyncExternalStore } from "react";
import type { ThreadQueuedMessage } from "@bb/domain";
import { queuedMessageHasWaitLine } from "@/lib/queued-message-wait";

export const QUEUED_MESSAGES_COLLAPSED_HEIGHT = 44;
const DRAWER_MIN_MAX_HEIGHT = 198;
const DRAWER_MAX_MAX_HEIGHT = 360;
const DRAWER_WINDOW_SHARE = 0.3;
const DRAWER_CHROME_HEIGHT = 1 + 32 + 18 + 12 + 2;
const DRAWER_LIST_PADDING = 4;
const DRAWER_ROW_HEIGHT = 33;
const DRAWER_SECOND_LINE_HEIGHT = 16;
const DRAWER_SENDER_PILL_LINE_HEIGHT = 22;

function queuedMessageSecondLineHeight(
  queuedMessage: ThreadQueuedMessage,
  processingMessageId: string | null,
): number {
  if (
    queuedMessage.initiator === "agent" &&
    queuedMessage.senderThreadId !== null &&
    queuedMessage.payload.kind !== "retry"
  ) {
    return DRAWER_SENDER_PILL_LINE_HEIGHT;
  }
  if (
    (queuedMessage.initiator === "agent" &&
      queuedMessage.payload.kind !== "retry") ||
    queuedMessageHasWaitLine(queuedMessage) ||
    queuedMessage.id === processingMessageId
  ) {
    return DRAWER_SECOND_LINE_HEIGHT;
  }
  return 0;
}

export function getQueuedMessagesDrawerMaxHeight(windowHeight: number): number {
  return Math.min(
    DRAWER_MAX_MAX_HEIGHT,
    Math.max(
      DRAWER_MIN_MAX_HEIGHT,
      Math.floor(windowHeight * DRAWER_WINDOW_SHARE),
    ),
  );
}

export function getQueuedMessagesDrawerHeight({
  queuedMessages,
  processingMessageId,
  windowHeight,
}: {
  queuedMessages: readonly ThreadQueuedMessage[];
  processingMessageId: string | null;
  windowHeight: number;
}): number {
  const rowsHeight =
    queuedMessages.length === 0
      ? DRAWER_ROW_HEIGHT
      : queuedMessages.reduce(
          (total, queuedMessage) =>
            total +
            DRAWER_ROW_HEIGHT +
            queuedMessageSecondLineHeight(queuedMessage, processingMessageId),
          0,
        );
  return Math.min(
    getQueuedMessagesDrawerMaxHeight(windowHeight),
    DRAWER_CHROME_HEIGHT + DRAWER_LIST_PADDING + rowsHeight,
  );
}

function subscribeToWindowResize(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function readWindowHeight(): number {
  return window.innerHeight;
}

function readServerWindowHeight(): number {
  return 0;
}

export function useWindowHeight(): number {
  return useSyncExternalStore(
    subscribeToWindowResize,
    readWindowHeight,
    readServerWindowHeight,
  );
}
