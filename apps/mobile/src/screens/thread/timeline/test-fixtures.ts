import type {
  TimelineCommandWorkRow,
  TimelineConversationRow,
  TimelineDelegationWorkRow,
  TimelineRow,
  TimelineSystemRow,
  TimelineTurnRow,
} from "@bb/server-contract";

/** Timeline row fixtures for the list-model tests (never imported by app code). */

let nextSeq = 1;

function base(id: string, seq = nextSeq++) {
  return {
    id,
    threadId: "t1",
    turnId: "turn-1",
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    startedAt: 1_000 + seq,
    createdAt: 1_000 + seq,
  };
}

export function resetFixtureSequence(): void {
  nextSeq = 1;
}

export function userRow(
  id: string,
  text: string,
  overrides: Partial<Extract<TimelineConversationRow, { role: "user" }>> = {},
): TimelineConversationRow {
  return {
    ...base(id),
    kind: "conversation",
    role: "user",
    text,
    attachments: null,
    initiator: "user",
    senderThreadId: null,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    turnRequest: { isGrouped: false, kind: "message", status: "accepted" },
    mentions: [],
    ...overrides,
  };
}

export function assistantRow(
  id: string,
  text: string,
): TimelineConversationRow {
  return {
    ...base(id),
    kind: "conversation",
    role: "assistant",
    text,
    attachments: null,
    turnRequest: null,
  };
}

export function commandRow(
  id: string,
  command: string,
  overrides: Partial<TimelineCommandWorkRow> = {},
): TimelineCommandWorkRow {
  return {
    ...base(id),
    kind: "work",
    workKind: "command",
    status: "completed",
    callId: `call-${id}`,
    command,
    cwd: null,
    output: "",
    source: "provider",
    exitCode: 0,
    completedAt: 2_000,
    approvalStatus: null,
    activityIntents: [],
    ...overrides,
  };
}

export function delegationRow(
  id: string,
  childRows: TimelineRow[],
  overrides: Partial<TimelineDelegationWorkRow> = {},
): TimelineDelegationWorkRow {
  return {
    ...base(id),
    kind: "work",
    workKind: "delegation",
    status: "completed",
    callId: `call-${id}`,
    toolName: "Task",
    subagentType: "explore",
    description: "Look around",
    output: "",
    completedAt: 2_000,
    childRows,
    ...overrides,
  };
}

export function systemRow(
  id: string,
  title: string,
  detail: string | null = null,
): TimelineSystemRow {
  return {
    ...base(id),
    kind: "system",
    systemKind: "error",
    status: "error",
    title,
    detail,
  };
}

export function turnRow(
  id: string,
  children: TimelineRow[] | null,
): TimelineTurnRow {
  return {
    ...base(id),
    kind: "turn",
    turnId: `turn-${id}`,
    status: "completed",
    summaryCount: 2,
    completedAt: 2_000,
    children,
  };
}
