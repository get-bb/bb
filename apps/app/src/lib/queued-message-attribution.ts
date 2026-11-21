import type { ThreadQueuedMessage } from "@bb/domain";

export interface QueuedMessageAttribution {
  prefix: "From" | "Requested by";
  threadId: string | null;
}

export function queuedMessageAttribution(
  queuedMessage: Pick<
    ThreadQueuedMessage,
    "initiator" | "payload" | "senderThreadId"
  >,
): QueuedMessageAttribution | null {
  if (queuedMessage.payload.kind === "retry") return null;
  if (queuedMessage.initiator === "agent") {
    return { prefix: "From", threadId: queuedMessage.senderThreadId };
  }
  if (
    queuedMessage.initiator === "user" &&
    queuedMessage.senderThreadId !== null
  ) {
    return { prefix: "Requested by", threadId: queuedMessage.senderThreadId };
  }
  return null;
}
