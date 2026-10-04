import type { TimelineRow } from "@bb/server-contract";
import { parseAgentMessageToolCall } from "./agent-message-tool-call.js";
import type { ThreadTimelineViewRow } from "./timeline-view.js";

const MIN_COLLAPSED_AGENT_EXCHANGES = 2;

export type IsExcludedAgentSender = (senderThreadId: string) => boolean;

type ConversationRow = Extract<TimelineRow, { kind: "conversation" }>;
type UserRow = Extract<ConversationRow, { role: "user" }>;
type AgentMessageRow = UserRow & { senderThreadId: string; turnId: string };

interface GroupAgentConversationsArgs {
  isExcludedSender: IsExcludedAgentSender;
  pinnedRowIds: ReadonlySet<string>;
  rows: readonly ThreadTimelineViewRow[];
}

function isAgentMessageRow(
  row: ThreadTimelineViewRow,
  isExcludedSender: IsExcludedAgentSender,
): row is AgentMessageRow {
  return (
    row.kind === "conversation" &&
    row.role === "user" &&
    row.initiator === "agent" &&
    row.turnRequest.kind === "message" &&
    row.turnRequest.status === "accepted" &&
    row.senderThreadId !== null &&
    row.turnId !== null &&
    !isExcludedSender(row.senderThreadId)
  );
}

function isUserAuthoredRow(row: ThreadTimelineViewRow): boolean {
  return (
    row.kind === "conversation" &&
    row.role === "user" &&
    row.initiator === "user"
  );
}

export function countAgentMessages(
  rows: readonly ThreadTimelineViewRow[],
): number {
  return rows.filter(
    (row) =>
      (row.kind === "conversation" &&
        row.role === "user" &&
        row.senderThreadId !== null) ||
      (row.kind === "work" &&
        row.workKind === "tool" &&
        parseAgentMessageToolCall(row) !== null),
  ).length;
}

export function groupAgentConversations({
  isExcludedSender,
  pinnedRowIds,
  rows,
}: GroupAgentConversationsArgs): ThreadTimelineViewRow[] {
  const entries: ThreadTimelineViewRow[] = [];
  let run: ThreadTimelineViewRow[] = [];
  let runExchangeCount = 0;
  const flushRun = (): void => {
    const first = run[0];
    const last = run.at(-1);
    if (first && last && runExchangeCount >= MIN_COLLAPSED_AGENT_EXCHANGES) {
      entries.push({
        id: `agent-conversation:${first.id}`,
        threadId: first.threadId,
        turnId: null,
        sourceSeqStart: first.sourceSeqStart,
        sourceSeqEnd: last.sourceSeqEnd,
        startedAt: first.startedAt,
        createdAt: first.createdAt,
        kind: "agent-conversation",
        children: run,
      });
    } else {
      entries.push(...run);
    }
    run = [];
    runExchangeCount = 0;
  };

  let index = 0;
  while (index < rows.length) {
    const first = rows[index];
    if (first === undefined) break;
    if (!isAgentMessageRow(first, isExcludedSender)) {
      flushRun();
      entries.push(first);
      index += 1;
      continue;
    }
    const start = index++;
    let settled = true;
    while (index < rows.length) {
      const row = rows[index];
      if (
        !row ||
        row.turnId !== first.turnId ||
        isAgentMessageRow(row, isExcludedSender)
      )
        break;
      if (isUserAuthoredRow(row)) {
        settled = false;
        break;
      }
      index += 1;
    }
    const exchange = rows.slice(start, index);
    if (
      settled &&
      !exchange.some(
        (row) =>
          pinnedRowIds.has(row.id) ||
          ("status" in row && row.status === "pending"),
      )
    ) {
      run.push(...exchange);
      runExchangeCount += 1;
    } else {
      flushRun();
      entries.push(...exchange);
    }
  }
  flushRun();
  return entries;
}
