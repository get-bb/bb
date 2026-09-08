import type {
  EventProjectionMessage,
  EventProjection,
  EventProjectionTurn,
  EventProjectionTurnMessageDetail,
} from "./event-projection-types.js";
import {
  findLastTerminalTimelineMessage,
  isSingletonContextManagementOperation,
  isTimelineSummaryCountedMessage,
  isTimelineTerminalMessage,
  isTimelineUngroupableMessage,
} from "./timeline-message-helpers.js";

function getProjectionMessageSummaryCount(
  message: EventProjectionMessage,
): number {
  if (message.kind === "file-edit") {
    return Math.max(1, message.changes.length);
  }
  return 1;
}

export function getProjectionSummaryCount(
  messages: EventProjectionMessage[],
  terminalMessage: EventProjectionMessage | undefined,
): number {
  let count = 0;
  for (const message of messages) {
    if (terminalMessage && message.id === terminalMessage.id) {
      break;
    }
    if (isTimelineSummaryCountedMessage(message)) {
      count += getProjectionMessageSummaryCount(message);
    }
  }
  return count;
}

function shouldIncludeSummaryTurnMessages(
  messages: EventProjectionMessage[],
  terminalMessage: EventProjectionMessage | undefined,
): boolean {
  let foundTerminalMessage = false;
  for (const message of messages) {
    if (terminalMessage && message.id === terminalMessage.id) {
      foundTerminalMessage = true;
      continue;
    }
    if (terminalMessage && isTimelineTerminalMessage(message)) {
      return true;
    }
    if (isTimelineUngroupableMessage(message)) {
      return true;
    }
    if (terminalMessage && foundTerminalMessage) {
      return true;
    }
  }
  return false;
}

export function assertTerminalMessageIncludedInMessages(
  turn: EventProjectionTurn,
): void {
  const messages = turn.messages;
  const terminalMessage = turn.terminalMessage;
  if (!messages || !terminalMessage) {
    return;
  }
  if (messages.some((message) => message.id === terminalMessage.id)) {
    return;
  }
  throw new Error(
    `Timeline projection turn ${turn.turnId} has terminal message ${terminalMessage.id} outside its messages array`,
  );
}

function withChildProjectionDetail(
  message: EventProjectionMessage,
): EventProjectionMessage {
  if (message.kind !== "delegation") {
    return message;
  }
  return {
    ...message,
    childProjection: applyProjectionTurnMessageDetail(
      message.childProjection,
      "full",
    ),
  };
}

function applyTurnMessageDetail(
  turn: EventProjectionTurn,
  turnMessageDetail: EventProjectionTurnMessageDetail,
  foldTerminalMessage: boolean,
): EventProjectionTurn {
  const messages = (turn.messages ?? []).map((message) =>
    withChildProjectionDetail(message),
  );
  const terminalMessage = foldTerminalMessage
    ? undefined
    : findLastTerminalTimelineMessage(messages);
  const summaryMessages = terminalMessage
    ? messages.slice(0, messages.indexOf(terminalMessage))
    : messages;
  const summaryCount = getProjectionSummaryCount(messages, terminalMessage);
  const includeMessages =
    turn.status === "pending" ||
    turnMessageDetail === "full" ||
    (turn.externalUserBoundarySeqs?.length ?? 0) > 0 ||
    isSingletonContextManagementOperation(summaryMessages) ||
    shouldIncludeSummaryTurnMessages(messages, terminalMessage);

  const detailedTurn: EventProjectionTurn = {
    turnId: turn.turnId,
    threadId: turn.threadId,
    sourceSeqStart: turn.sourceSeqStart,
    sourceSeqEnd: turn.sourceSeqEnd,
    startedAt: turn.startedAt,
    createdAt: turn.createdAt,
    completedAt: turn.completedAt,
    status: turn.status,
    hasAcceptedInput: turn.hasAcceptedInput,
    summaryCount,
    ...(turn.externalUserBoundarySeqs
      ? { externalUserBoundarySeqs: turn.externalUserBoundarySeqs }
      : {}),
  };
  if (terminalMessage) {
    detailedTurn.terminalMessage = terminalMessage;
  }
  if (includeMessages) {
    detailedTurn.messages = messages;
  }
  assertTerminalMessageIncludedInMessages(detailedTurn);
  return detailedTurn;
}

function findTurnsWithFoldedTerminalMessages(
  projection: EventProjection,
  forcedTurnIds: ReadonlySet<string>,
): Set<string> {
  const foldedTurnIds = new Set(
    projection.entries.flatMap((entry) =>
      entry.kind === "turn" &&
      forcedTurnIds.has(entry.turn.turnId) &&
      entry.turn.status === "completed" &&
      entry.turn.terminalMessage?.kind === "assistant-text"
        ? [entry.turn.turnId]
        : [],
    ),
  );
  let previousTurn: EventProjectionTurn | undefined;
  for (const entry of projection.entries) {
    if (entry.kind === "projected-message") {
      if (entry.message.kind === "user") {
        previousTurn = undefined;
      }
      continue;
    }

    if (
      !entry.turn.hasAcceptedInput &&
      !entry.turn.messages?.some((message) => message.kind === "user") &&
      previousTurn?.status === "completed" &&
      previousTurn.terminalMessage?.kind === "assistant-text"
    ) {
      foldedTurnIds.add(previousTurn.turnId);
    }
    previousTurn = entry.turn;
  }
  return foldedTurnIds;
}

export function applyProjectionTurnMessageDetail(
  projection: EventProjection,
  turnMessageDetail: EventProjectionTurnMessageDetail,
  forcedFoldedTurnIds: ReadonlySet<string> = new Set(),
): EventProjection {
  const foldedTurnIds = findTurnsWithFoldedTerminalMessages(
    projection,
    forcedFoldedTurnIds,
  );
  return {
    state: projection.state,
    entries: projection.entries.map((entry) => {
      if (entry.kind === "projected-message") {
        return {
          kind: "projected-message",
          message: withChildProjectionDetail(entry.message),
        };
      }
      return {
        kind: "turn",
        turn: applyTurnMessageDetail(
          entry.turn,
          turnMessageDetail,
          foldedTurnIds.has(entry.turn.turnId),
        ),
      };
    }),
  };
}
