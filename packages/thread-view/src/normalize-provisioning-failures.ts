import type { ThreadEventWithMeta } from "./group-event-projection-turns.js";
import type {
  EventProjectionMessage,
  EventProjectionOperationMessage,
} from "./event-projection-types.js";
import { haveCompatibleEventProjectionMessageScope } from "./message-scope.js";

export function normalizeProvisioningFailures(
  events: readonly ThreadEventWithMeta[],
  messages: readonly EventProjectionMessage[],
): EventProjectionMessage[] {
  const operationsByIdentity = new Map<
    string,
    EventProjectionOperationMessage
  >();
  for (const message of messages) {
    if (message.kind === "operation" && message.provisioning) {
      operationsByIdentity.set(
        JSON.stringify([message.threadId, message.provisioning.provisioningId]),
        message,
      );
    }
  }
  const companionsBySequence = new Map<
    string,
    EventProjectionOperationMessage
  >();
  const pendingFailuresByThread = new Map<
    string,
    EventProjectionOperationMessage
  >();
  for (const { event, meta } of events) {
    if (event.type === "system/thread-provisioning") {
      pendingFailuresByThread.delete(event.threadId);
      const operation = operationsByIdentity.get(
        JSON.stringify([event.threadId, event.provisioningId]),
      );
      if (event.status === "failed" && operation?.status === "error") {
        pendingFailuresByThread.set(event.threadId, operation);
      }
    } else if (event.type === "turn/started") {
      pendingFailuresByThread.delete(event.threadId);
    } else if (
      event.type === "system/error" &&
      event.code === "thread_provisioning_failed"
    ) {
      const operation = pendingFailuresByThread.get(event.threadId);
      if (
        operation &&
        haveCompatibleEventProjectionMessageScope(operation, event)
      ) {
        companionsBySequence.set(
          JSON.stringify([event.threadId, meta.seq]),
          operation,
        );
        pendingFailuresByThread.delete(event.threadId);
      }
    }
  }
  return messages.filter((message) => {
    if (
      message.kind !== "error" ||
      message.systemErrorCode !== "thread_provisioning_failed"
    ) {
      return true;
    }
    const operation = companionsBySequence.get(
      JSON.stringify([message.threadId, message.sourceSeqStart]),
    );
    if (!operation) return true;
    const details = [operation.detail, message.message, message.detail].filter(
      (detail): detail is string =>
        Boolean(detail) && detail !== operation.title,
    );
    operation.detail = [...new Set(details)].join("\n") || undefined;
    operation.sourceSeqEnd = Math.max(
      operation.sourceSeqEnd,
      message.sourceSeqEnd,
    );
    operation.createdAt = Math.max(operation.createdAt, message.createdAt);
    return false;
  });
}
