import type { ThreadQueuedMessage } from "@bb/domain";

export function isTransientSystemNotice(
  queuedMessage: Pick<
    ThreadQueuedMessage,
    "failureReason" | "systemNotice" | "waitingOn"
  >,
): boolean {
  if (queuedMessage.systemNotice === null) return false;
  if (queuedMessage.failureReason !== null) return false;
  return (
    queuedMessage.waitingOn === null || queuedMessage.waitingOn.kind === "time"
  );
}

export function visibleQueuedMessages(
  queuedMessages: readonly ThreadQueuedMessage[],
): readonly ThreadQueuedMessage[] {
  return queuedMessages.some(isTransientSystemNotice)
    ? queuedMessages.filter(
        (queuedMessage) => !isTransientSystemNotice(queuedMessage),
      )
    : queuedMessages;
}
