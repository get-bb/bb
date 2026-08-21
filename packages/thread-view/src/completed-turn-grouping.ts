import type {
  EventProjectionMessage,
  EventProjectionTurn,
} from "./event-projection-types.js";
import { getProjectionSummaryCount } from "./apply-turn-message-detail.js";
import { getMessageStartedAt } from "./format-helpers.js";
import {
  findLastTerminalTimelineMessage,
  isSingletonContextManagementOperation,
  isTimelineUngroupableMessage,
} from "./timeline-message-helpers.js";

interface CompletedTurnSummaryGroup {
  kind: "summary";
  startedAt: number;
  completedAt: number | null;
  segmentIndex: number | null;
  sourceMessages: EventProjectionMessage[];
  summaryCount: number;
}

interface CompletedTurnUngroupedMessage {
  kind: "ungrouped-message";
  message: EventProjectionMessage;
}

export type CompletedTurnSummaryItem =
  | CompletedTurnSummaryGroup
  | CompletedTurnUngroupedMessage;

export interface CompletedTurnMessageGroups {
  summaryItems: CompletedTurnSummaryItem[];
  terminalMessages: EventProjectionMessage[];
  trailingMessages: EventProjectionMessage[];
}

interface CompletedTurnMessageSlices {
  summaryMessages: EventProjectionMessage[];
  terminalMessages: EventProjectionMessage[];
  trailingMessages: EventProjectionMessage[];
}

interface SummaryMessageBounds {
  startedAt: number;
}

function isCompletedTurnSummaryGroup(
  item: CompletedTurnSummaryItem,
): item is CompletedTurnSummaryGroup {
  return item.kind === "summary";
}

function unwrapSingletonContextManagementGroups(
  items: readonly CompletedTurnSummaryItem[],
): CompletedTurnSummaryItem[] {
  return items.map((item) => {
    if (
      item.kind !== "summary" ||
      !isSingletonContextManagementOperation(item.sourceMessages)
    ) {
      return item;
    }

    const onlyMessage = item.sourceMessages[0];
    if (!onlyMessage) {
      throw new Error("Singleton context-management group has no message");
    }
    return { kind: "ungrouped-message", message: onlyMessage };
  });
}

function getSummaryMessageBounds(
  sourceMessages: readonly EventProjectionMessage[],
): SummaryMessageBounds {
  const firstMessage = sourceMessages[0];
  if (!firstMessage) {
    throw new Error("Cannot derive summary message bounds from no messages");
  }

  let startedAt = getMessageStartedAt(firstMessage);
  for (const message of sourceMessages.slice(1)) {
    startedAt = Math.min(startedAt, getMessageStartedAt(message));
  }
  return { startedAt };
}

function applySingleSummaryTurnBounds(
  turn: EventProjectionTurn,
  items: readonly CompletedTurnSummaryItem[],
): CompletedTurnSummaryItem[] {
  const summaryGroups = items.filter(isCompletedTurnSummaryGroup);
  if (summaryGroups.length !== 1) {
    return [...items];
  }

  const onlySummaryGroup = summaryGroups[0];
  return items.map((item) =>
    item === onlySummaryGroup
      ? {
          ...item,
          startedAt: turn.startedAt,
          completedAt: turn.completedAt,
        }
      : item,
  );
}

function splitCompletedTurnMessages(
  messages: readonly EventProjectionMessage[],
  terminalMessage: EventProjectionMessage | undefined,
): CompletedTurnMessageSlices {
  if (!terminalMessage) {
    return {
      summaryMessages: [...messages],
      terminalMessages: [],
      trailingMessages: [],
    };
  }

  const terminalIndex = messages.findIndex(
    (message) => message.id === terminalMessage.id,
  );
  if (terminalIndex === -1) {
    return {
      summaryMessages: [...messages],
      terminalMessages: [terminalMessage],
      trailingMessages: [],
    };
  }

  const terminalMessageAtIndex = messages[terminalIndex];
  if (!terminalMessageAtIndex) {
    throw new Error(
      `Cannot split completed turn messages at index ${terminalIndex}`,
    );
  }

  return {
    summaryMessages: messages.slice(0, terminalIndex),
    terminalMessages: [terminalMessageAtIndex],
    trailingMessages: messages.slice(terminalIndex + 1),
  };
}

function groupCompletedTurnSummaryMessages(
  turn: EventProjectionTurn,
  summaryMessages: EventProjectionMessage[],
): CompletedTurnSummaryItem[] {
  const externalBoundarySeqs = turn.externalUserBoundarySeqs ?? [];
  if (
    externalBoundarySeqs.length === 0 &&
    !summaryMessages.some(isTimelineUngroupableMessage)
  ) {
    return [
      {
        kind: "summary",
        startedAt: turn.startedAt,
        completedAt: turn.completedAt,
        segmentIndex: null,
        sourceMessages: summaryMessages,
        summaryCount: turn.summaryCount,
      },
    ];
  }

  const items: CompletedTurnSummaryItem[] = [];
  let groupedMessages: EventProjectionMessage[] = [];
  let segmentIndex = 0;
  let externalBoundaryIndex = 0;

  function appendSummaryGroup(sourceMessages: EventProjectionMessage[]): void {
    if (sourceMessages.length === 0) {
      return;
    }

    const bounds = getSummaryMessageBounds(sourceMessages);
    items.push({
      kind: "summary",
      startedAt: bounds.startedAt,
      completedAt: null,
      segmentIndex,
      sourceMessages,
      summaryCount: getProjectionSummaryCount(sourceMessages, undefined),
    });
    segmentIndex += 1;
  }

  function flushGroupedMessages(preserveLastTerminalMessage = false): void {
    if (groupedMessages.length === 0) {
      return;
    }

    // Human follow-ups split one provider turn into multiple visible exchange
    // segments. Keep each segment's last assistant/error message beside the
    // user row instead of burying it inside that segment's collapsed summary.
    const sourceMessages = groupedMessages;
    groupedMessages = [];
    const terminalMessage = preserveLastTerminalMessage
      ? findLastTerminalTimelineMessage(sourceMessages)
      : undefined;
    if (!terminalMessage) {
      appendSummaryGroup(sourceMessages);
      return;
    }

    appendSummaryGroup(
      sourceMessages.filter((message) => message.id !== terminalMessage.id),
    );
    items.push({
      kind: "ungrouped-message",
      message: terminalMessage,
    });
  }

  function flushExternalBoundariesBefore(
    message: EventProjectionMessage,
  ): void {
    while (
      externalBoundaryIndex < externalBoundarySeqs.length &&
      (externalBoundarySeqs[externalBoundaryIndex] ?? 0) <
        message.sourceSeqStart
    ) {
      flushGroupedMessages(true);
      externalBoundaryIndex += 1;
    }
  }

  for (const message of summaryMessages) {
    flushExternalBoundariesBefore(message);
    if (isTimelineUngroupableMessage(message)) {
      flushGroupedMessages(
        message.kind === "user" && message.initiator === "user",
      );
      items.push({
        kind: "ungrouped-message",
        message,
      });
      continue;
    }
    groupedMessages.push(message);
  }

  while (externalBoundaryIndex < externalBoundarySeqs.length) {
    flushGroupedMessages(true);
    externalBoundaryIndex += 1;
  }
  flushGroupedMessages();
  return applySingleSummaryTurnBounds(turn, items);
}

export function groupCompletedTurnMessages(
  turn: EventProjectionTurn,
): CompletedTurnMessageGroups {
  const messages = turn.messages ?? [];
  const { summaryMessages, terminalMessages, trailingMessages } =
    splitCompletedTurnMessages(messages, turn.terminalMessage);
  return {
    summaryItems: unwrapSingletonContextManagementGroups(
      groupCompletedTurnSummaryMessages(turn, summaryMessages),
    ),
    terminalMessages,
    trailingMessages,
  };
}
