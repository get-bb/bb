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

/**
 * Human input that the provider actually received during a turn. Only this
 * input can split a completed turn into visible exchange segments.
 *
 * - `accepted-user-request`: a human-sent row the provider accepted. Pending
 *   or rejected rows never reached the provider, so the assistant output that
 *   follows them answers nothing the user said.
 * - `answered-question`: a provider-initiated question the human answered.
 * - `none`: everything else, including agent/system steers.
 */
export type TimelineUserInputSource =
  | "accepted-user-request"
  | "answered-question"
  | "none";

export function getTimelineUserInputSource(
  message: EventProjectionMessage,
): TimelineUserInputSource {
  if (message.kind === "user") {
    return message.initiator === "user" &&
      message.turnRequest.status === "accepted"
      ? "accepted-user-request"
      : "none";
  }
  if (
    message.kind === "user-question-lifecycle" &&
    message.lifecycle === "answered"
  ) {
    return "answered-question";
  }
  return "none";
}

export interface TimelineTurnPhase {
  /**
   * True once the turn has produced assistant/tool output. User input that
   * precedes any output (the turn-starting row, or several initial rows from
   * a grouped `inputGroups` request) is initial input, not a mid-turn
   * follow-up.
   */
  sawTurnOutput: boolean;
}

/**
 * Whether `message` is mid-turn human input that starts a new exchange
 * segment inside a completed turn. An accepted user request is a boundary
 * only after the turn has produced output. An answered question is always a
 * boundary: the provider asked it, so it is itself turn output.
 */
export function isMidTurnUserInputBoundaryMessage(
  message: EventProjectionMessage,
  phase: TimelineTurnPhase,
): boolean {
  switch (getTimelineUserInputSource(message)) {
    case "accepted-user-request":
      return phase.sawTurnOutput;
    case "answered-question":
      return true;
    case "none":
      return false;
  }
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
