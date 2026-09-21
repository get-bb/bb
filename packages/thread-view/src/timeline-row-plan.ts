import type { CompletedTurnDisplay } from "@bb/domain";
import type { TimelineTurnRow } from "@bb/server-contract";
import { groupCompletedTurnMessages } from "./completed-turn-grouping.js";
import type {
  EventProjection,
  EventProjectionMessage,
  EventProjectionTurn,
} from "./event-projection-types.js";

interface TimelineMessagePlan {
  kind: "message";
  message: EventProjectionMessage;
}

interface TimelineSummaryPlan {
  kind: "summary";
  row: TimelineTurnRow;
  messages: readonly EventProjectionMessage[];
}

export type TimelineRowPlan = TimelineMessagePlan | TimelineSummaryPlan;

function messagePlan(message: EventProjectionMessage): TimelineMessagePlan {
  return { kind: "message", message };
}

function planTurn(
  turn: EventProjectionTurn,
  completedTurnDisplay: CompletedTurnDisplay,
  rowIdPrefix: string,
): TimelineRowPlan[] {
  if (
    turn.status === "pending" ||
    turn.completedAt === null ||
    completedTurnDisplay === "flat"
  ) {
    return (turn.messages ?? []).map(messagePlan);
  }

  const { summaryItems, terminalMessages, trailingMessages } =
    groupCompletedTurnMessages(turn);
  const plan: TimelineRowPlan[] = [];
  for (const item of summaryItems) {
    if (item.kind === "ungrouped-message") {
      plan.push(messagePlan(item.message));
      continue;
    }
    if (item.summaryCount === 0 && item.sourceMessages.length === 0) continue;

    const useTurnBounds =
      item.segmentIndex === null || item.sourceMessages.length === 0;
    let sourceSeqStart = turn.sourceSeqStart;
    let sourceSeqEnd = turn.sourceSeqEnd;
    let createdAt = turn.createdAt;
    let completedAt = item.completedAt;
    if (!useTurnBounds) {
      sourceSeqStart = Infinity;
      sourceSeqEnd = -Infinity;
      createdAt = Infinity;
    }
    for (const message of item.sourceMessages) {
      if (!useTurnBounds) {
        sourceSeqStart = Math.min(sourceSeqStart, message.sourceSeqStart);
        sourceSeqEnd = Math.max(sourceSeqEnd, message.sourceSeqEnd);
        createdAt = Math.min(createdAt, message.createdAt);
      }
      if (item.completedAt === null) {
        completedAt = Math.max(completedAt ?? -Infinity, message.createdAt);
      }
    }
    const suffix = item.segmentIndex === null ? "" : `:${item.segmentIndex}`;
    plan.push({
      kind: "summary",
      row: {
        id: `${rowIdPrefix}${turn.threadId}:${turn.turnId}:turn${suffix}`,
        threadId: turn.threadId,
        turnId: turn.turnId,
        sourceSeqStart,
        sourceSeqEnd,
        startedAt: item.startedAt,
        createdAt,
        kind: "turn",
        status: turn.status,
        summaryCount: item.summaryCount,
        completedAt,
        children: null,
      },
      messages: item.sourceMessages,
    });
  }
  plan.push(
    ...terminalMessages.map(messagePlan),
    ...trailingMessages.map(messagePlan),
  );
  return plan;
}

export function planTimelineRows(
  projection: EventProjection,
  completedTurnDisplay: CompletedTurnDisplay,
  rowIdPrefix: string,
): TimelineRowPlan[] {
  return projection.entries.flatMap((entry) =>
    entry.kind === "projected-message"
      ? [messagePlan(entry.message)]
      : planTurn(entry.turn, completedTurnDisplay, rowIdPrefix),
  );
}
