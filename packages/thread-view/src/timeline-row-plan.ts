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

export type StoredTimelineTurnPlanItem =
  | {
      kind: "message";
      messageId: string;
      sourceSeqEnd: number;
      sourceSeqStart: number;
    }
  | { kind: "summary"; row: TimelineTurnRow };

export interface StoredTimelineTurnPlan {
  externalUserBoundarySeqs: number[];
  items: StoredTimelineTurnPlanItem[];
}

function isCollapsedTurn(
  turn: EventProjectionTurn,
  completedTurnDisplay: CompletedTurnDisplay,
): boolean {
  return (
    turn.status !== "pending" &&
    turn.completedAt !== null &&
    completedTurnDisplay !== "flat"
  );
}

function planStoredTurn(
  turn: EventProjectionTurn,
  stored: StoredTimelineTurnPlan,
): TimelineRowPlan[] {
  const messagesById = new Map<string, EventProjectionMessage[]>();
  for (const message of turn.messages ?? []) {
    const messages = messagesById.get(message.id);
    if (messages === undefined) messagesById.set(message.id, [message]);
    else messages.push(message);
  }
  return stored.items.flatMap((item): TimelineRowPlan[] => {
    if (item.kind === "summary") {
      return [{ kind: "summary", row: item.row, messages: [] }];
    }
    const message = messagesById.get(item.messageId)?.shift();
    return message === undefined ||
      message.sourceSeqStart !== item.sourceSeqStart ||
      message.sourceSeqEnd !== item.sourceSeqEnd
      ? []
      : [messagePlan(message)];
  });
}

export function captureTimelineTurnPlans(
  projection: EventProjection,
  completedTurnDisplay: CompletedTurnDisplay,
  rowIdPrefix: string,
): Map<string, StoredTimelineTurnPlan> {
  const plans = new Map<string, StoredTimelineTurnPlan>();
  for (const entry of projection.entries) {
    if (
      entry.kind !== "turn" ||
      !isCollapsedTurn(entry.turn, completedTurnDisplay)
    ) {
      continue;
    }
    plans.set(entry.turn.turnId, {
      externalUserBoundarySeqs: [
        ...(entry.turn.externalUserBoundarySeqs ?? []),
      ],
      items: planTurn(entry.turn, completedTurnDisplay, rowIdPrefix).map(
        (item): StoredTimelineTurnPlanItem =>
          item.kind === "summary"
            ? { kind: "summary", row: item.row }
            : {
                kind: "message",
                messageId: item.message.id,
                sourceSeqEnd: item.message.sourceSeqEnd,
                sourceSeqStart: item.message.sourceSeqStart,
              },
      ),
    });
  }
  return plans;
}

function messagePlan(message: EventProjectionMessage): TimelineMessagePlan {
  return { kind: "message", message };
}

function planTurn(
  turn: EventProjectionTurn,
  completedTurnDisplay: CompletedTurnDisplay,
  rowIdPrefix: string,
): TimelineRowPlan[] {
  if (!isCollapsedTurn(turn, completedTurnDisplay)) {
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
  storedTurnPlans?: ReadonlyMap<string, StoredTimelineTurnPlan>,
): TimelineRowPlan[] {
  return projection.entries.flatMap((entry) => {
    if (entry.kind === "projected-message") return [messagePlan(entry.message)];
    const stored = storedTurnPlans?.get(entry.turn.turnId);
    return stored !== undefined &&
      isCollapsedTurn(entry.turn, completedTurnDisplay)
      ? planStoredTurn(entry.turn, stored)
      : planTurn(entry.turn, completedTurnDisplay, rowIdPrefix);
  });
}
