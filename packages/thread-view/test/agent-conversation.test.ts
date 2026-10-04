import { describe, expect, it } from "vitest";
import type {
  TimelineConversationRow,
  TimelineConversationTurnRequest,
  TimelineToolWorkRow,
} from "@bb/server-contract";
import type { ThreadTimelineViewRow } from "../src/timeline-view.js";
import { groupAgentConversations } from "../src/agent-conversation.js";
import { buildTimelineRowTitle } from "../src/timeline-row-title.js";

const MANAGER = "thr_mngr234567";
let seq = 0;

function base(id: string, turnId: string) {
  seq += 1;
  return {
    id,
    threadId: "thr_wrkr234567",
    turnId,
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    startedAt: seq,
    createdAt: seq,
  };
}

function received(
  id: string,
  turnId: string,
  from: string | null = MANAGER,
  request: Partial<TimelineConversationTurnRequest> = {},
): TimelineConversationRow {
  return {
    ...base(id, turnId),
    kind: "conversation",
    role: "user",
    text: id,
    attachments: null,
    initiator: from === null ? "user" : "agent",
    senderThreadId: from,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    turnRequest: {
      isGrouped: false,
      kind: "message",
      status: "accepted",
      ...request,
    },
    mentions: [],
  };
}

function sent(id: string, turnId: string): TimelineToolWorkRow {
  return {
    ...base(id, turnId),
    kind: "work",
    workKind: "tool",
    status: "completed",
    callId: id,
    toolName: "bb:bb_thread_message",
    toolArgs: { threadId: MANAGER, message: id },
    output: "Delivered.",
    completedAt: seq,
    approvalStatus: null,
  };
}

function exchange(n: number): ThreadTimelineViewRow[] {
  return [received(`r${n}`, `turn_${n}`), sent(`s${n}`, `turn_${n}`)];
}

function group(
  rows: ThreadTimelineViewRow[],
  pinned: string[] = [],
): ThreadTimelineViewRow[] {
  return groupAgentConversations({
    isExcludedSender: () => false,
    pinnedRowIds: new Set(pinned),
    rows,
  });
}

const ids = (rows: ThreadTimelineViewRow[]) => rows.map((row) => row.id);

describe("groupAgentConversations", () => {
  it("collapses back-to-back settled exchanges and counts their agent messages", () => {
    const rows = [
      ...exchange(1),
      ...exchange(2),
      received("user", "turn_9", null),
    ];

    const [conversation, ...rest] = group(rows);

    expect(
      conversation?.kind === "agent-conversation" && ids(conversation.children),
    ).toEqual(["r1", "s1", "r2", "s2"]);
    expect(
      conversation &&
        buildTimelineRowTitle(conversation, {
          summaryStyle: "bundle",
          workStyle: "default",
        }).plain,
    ).toBe("Agent conversation 4 messages");
    expect(ids(rest)).toEqual(["user"]);
  });

  it.each([
    [
      "a single exchange",
      [...exchange(1), received("user", "turn_5", null), ...exchange(2)],
      [],
    ],
    ["the running exchange", [...exchange(3), ...exchange(4)], ["s4"]],
    [
      "a pending message",
      [
        ...exchange(5),
        received("queued", "turn_6", MANAGER, { status: "pending" }),
        ...exchange(7),
      ],
      [],
    ],
    [
      "a user-steered exchange",
      [
        ...exchange(8),
        ...exchange(9),
        received("steer", "turn_9", null, { kind: "steer" }),
      ],
      [],
    ],
    ["a search or unread target", [...exchange(10), ...exchange(11)], ["r11"]],
  ])("keeps %s ungrouped", (_case, rows, pinned) => {
    expect(ids(group(rows, pinned))).toEqual(ids(rows));
  });
});
