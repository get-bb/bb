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

export type TurnSummaryItem =
  | {
      kind: "message";
      messageId: string;
      sourceSeqEnd: number;
      sourceSeqStart: number;
    }
  | { kind: "summary"; row: TimelineTurnRow };

export interface TurnSummary {
  externalUserBoundarySeqs: number[];
  items: TurnSummaryItem[];
  startedSequence: number;
}

function messagePlan(message: EventProjectionMessage): TimelineMessagePlan {
  return { kind: "message", message };
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

function planSummarizedTurn(
  readMessages: readonly EventProjectionMessage[],
  summary: TurnSummary,
): TimelineRowPlan[] {
  const messagesById = new Map<string, EventProjectionMessage[]>();
  for (const message of readMessages) {
    const messages = messagesById.get(message.id);
    if (messages === undefined) messagesById.set(message.id, [message]);
    else messages.push(message);
  }
  return summary.items.flatMap((item): TimelineRowPlan[] => {
    if (item.kind === "summary") {
      return [{ kind: "summary", row: item.row, messages: [] }];
    }
    const messages = messagesById.get(item.messageId);
    if (messages === undefined || messages.length === 0) return [];
    const exact = messages.findIndex(
      (message) =>
        message.sourceSeqStart === item.sourceSeqStart &&
        message.sourceSeqEnd === item.sourceSeqEnd,
    );
    return [messagePlan(messages.splice(Math.max(exact, 0), 1)[0]!)];
  });
}

export function summarizeCompletedTurns(
  projection: EventProjection,
  rowIdPrefix: string,
): Map<string, Omit<TurnSummary, "startedSequence">> {
  const summaries = new Map<string, Omit<TurnSummary, "startedSequence">>();
  for (const entry of projection.entries) {
    if (entry.kind !== "turn" || !isCollapsedTurn(entry.turn, "collapse")) {
      continue;
    }
    summaries.set(entry.turn.turnId, {
      externalUserBoundarySeqs: [
        ...(entry.turn.externalUserBoundarySeqs ?? []),
      ],
      items: planTurn(entry.turn, "collapse", rowIdPrefix).map(
        (item): TurnSummaryItem =>
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
  return summaries;
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
  turnSummaries?: ReadonlyMap<string, TurnSummary>,
): TimelineRowPlan[] {
  const projectedTurnIds = new Set(
    projection.entries.flatMap((entry) =>
      entry.kind === "turn" ? [entry.turn.turnId] : [],
    ),
  );
  const unreadTurns = [...(turnSummaries?.entries() ?? [])]
    .filter(([turnId]) => !projectedTurnIds.has(turnId))
    .map(([, summary]) => summary)
    .sort((left, right) => left.startedSequence - right.startedSequence);
  const plan: TimelineRowPlan[] = [];
  let unreadIndex = 0;
  const planUnreadTurnsBefore = (sequence: number) => {
    while (
      unreadIndex < unreadTurns.length &&
      unreadTurns[unreadIndex]!.startedSequence < sequence
    ) {
      plan.push(...planSummarizedTurn([], unreadTurns[unreadIndex]!));
      unreadIndex += 1;
    }
  };
  for (const entry of projection.entries) {
    if (entry.kind === "projected-message") {
      planUnreadTurnsBefore(entry.message.sourceSeqStart);
      plan.push(messagePlan(entry.message));
      continue;
    }
    const summary = turnSummaries?.get(entry.turn.turnId);
    planUnreadTurnsBefore(
      summary?.startedSequence ?? entry.turn.sourceSeqStart,
    );
    plan.push(
      ...(summary !== undefined &&
      isCollapsedTurn(entry.turn, completedTurnDisplay)
        ? planSummarizedTurn(entry.turn.messages ?? [], summary)
        : planTurn(entry.turn, completedTurnDisplay, rowIdPrefix)),
    );
  }
  planUnreadTurnsBefore(Number.POSITIVE_INFINITY);
  return plan;
}
