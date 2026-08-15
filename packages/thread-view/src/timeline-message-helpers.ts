import type { EventProjectionMessage } from "./event-projection-types.js";

export function isTimelineTerminalMessage(
  message: EventProjectionMessage,
): boolean {
  return message.kind === "assistant-text" || message.kind === "error";
}

export function isTimelineSummaryGroupableSteerMessage(
  message: EventProjectionMessage,
): boolean {
  return (
    message.kind === "user" &&
    message.turnRequest.kind === "steer" &&
    (message.initiator === "agent" || message.initiator === "system")
  );
}

export function isTimelineUngroupableMessage(
  message: EventProjectionMessage,
): boolean {
  if (message.kind === "user") {
    return !isTimelineSummaryGroupableSteerMessage(message);
  }
  if (message.kind === "assistant-text") {
    return message.isLegacyUserMessage === true;
  }
  if (message.kind === "user-question-lifecycle") {
    return message.lifecycle === "answered";
  }
  return message.kind === "debug/raw-event";
}

export function isTimelineUserInputBoundaryMessage(
  message: EventProjectionMessage,
): boolean {
  if (message.kind === "user") {
    return message.initiator === "user";
  }
  return (
    message.kind === "user-question-lifecycle" &&
    message.lifecycle === "answered"
  );
}

export function isTimelineSummaryCountedMessage(
  message: EventProjectionMessage,
): boolean {
  return !isTimelineUngroupableMessage(message);
}

export function isSingletonContextManagementOperation(
  messages: readonly EventProjectionMessage[],
): boolean {
  const onlyMessage = messages.length === 1 ? messages[0] : undefined;
  return (
    onlyMessage?.kind === "operation" &&
    (onlyMessage.opType === "compaction" ||
      onlyMessage.opType === "context-clear")
  );
}

export function findLastTerminalTimelineMessage(
  messages: readonly EventProjectionMessage[],
): EventProjectionMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isTimelineTerminalMessage(message)) {
      return message;
    }
  }
  return undefined;
}
