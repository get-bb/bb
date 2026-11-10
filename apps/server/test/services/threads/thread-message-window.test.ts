import { describe, expect, it } from "vitest";
import type { Thread } from "@bb/domain";
import { getLatestThreadSequence, type DbConnection } from "@bb/db";
import type { TimelineConversationRow } from "@bb/server-contract";
import { getThreadMessage } from "../../../src/services/threads/timeline.js";
import {
  appendRows,
  withTestThread,
  type RowSpec,
  type TestThread,
} from "../../helpers/timeline-cache-fixture.js";

const REQUEST_ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";
const requestIds = new Map<string, string>();

function requestId(name: string): string {
  let id = requestIds.get(name);
  if (id === undefined) {
    let value = requestIds.size + 1;
    let suffix = "";
    for (let index = 0; index < 10; index += 1) {
      suffix = REQUEST_ID_ALPHABET[value % 32] + suffix;
      value = Math.floor(value / 32);
    }
    id = `creq_${suffix}`;
    requestIds.set(name, id);
  }
  return id;
}

function request(
  name: string,
  expectedTurnId: string | null = null,
  initiator: "user" | "system" = "user",
): RowSpec {
  return {
    type: "client/turn/requested",
    data: {
      direction: "outbound",
      requestId: requestId(name),
      source: "tell",
      initiator,
      senderThreadId: null,
      input: [{ type: "text", text: `Ask ${name}` }],
      target:
        expectedTurnId === null
          ? { kind: "new-turn" }
          : { kind: "steer", expectedTurnId },
      request: { method: "turn/start", params: {} },
      execution: {
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "workspace-write",
        source: "client/turn/requested",
        serviceTier: "auto",
      },
    },
  };
}

function accepted(name: string, turnId: string): RowSpec {
  return {
    type: "turn/input/accepted",
    turnId,
    data: { clientRequestId: requestId(name) },
  };
}

function rejected(name: string): RowSpec {
  return {
    type: "client/turn/rejected",
    data: {
      requestId: requestId(name),
      reason: "turn_not_active",
      message: "The turn already finished",
    },
  };
}

function started(turnId: string): RowSpec {
  return { type: "turn/started", turnId, data: {} };
}

function completed(turnId: string): RowSpec {
  return { type: "turn/completed", turnId, data: { status: "completed" } };
}

function answer(turnId: string, name: string): RowSpec {
  const itemId = `message-${name}`;
  return {
    type: "item/completed",
    turnId,
    itemId,
    itemKind: "agentMessage",
    data: {
      item: { id: itemId, type: "agentMessage", text: `Answer ${name}` },
    },
  };
}

function streamedAnswer(turnId: string, name: string): RowSpec[] {
  return [
    {
      type: "item/agentMessage/delta",
      turnId,
      itemId: `message-${name}`,
      data: { itemId: `message-${name}`, delta: "Answer" },
    },
    answer(turnId, name),
  ];
}

function backgroundTask(
  turnId: string | null,
  taskId: string,
  status: "pending" | "completed" | "failed",
  parentToolCallId: string | null = null,
): RowSpec {
  return {
    type:
      status === "pending" ? "item/started" : "item/backgroundTask/completed",
    turnId,
    itemId: taskId,
    itemKind: "backgroundTask",
    parentToolCallId,
    data: {
      providerThreadId: "provider-memo",
      item: {
        type: "backgroundTask",
        id: taskId,
        taskType: "local_bash",
        description: `Background ${taskId}`,
        status,
        taskStatus: status === "pending" ? "running" : status,
        skipTranscript: false,
        foreground: false,
        ...(parentToolCallId === null ? {} : { parentToolCallId }),
      },
    },
  };
}

function delegation(turnId: string, itemId: string): RowSpec {
  return {
    type: "item/started",
    turnId,
    itemId,
    itemKind: "delegation",
    data: {
      item: {
        id: itemId,
        type: "delegation",
        childRef: "child-thread",
        label: "Investigate",
        status: "pending",
        background: true,
      },
    },
  };
}

function turn(name: string, middle: RowSpec[] = []): RowSpec[] {
  const turnId = `turn-${name}`;
  return [
    request(name),
    started(turnId),
    accepted(name, turnId),
    ...middle,
    answer(turnId, name),
    completed(turnId),
  ];
}

function turns(prefix: string, count: number): RowSpec[] {
  return Array.from({ length: count }, (_, index) =>
    turn(`${prefix}${index}`),
  ).flat();
}

function readMessage(
  db: DbConnection,
  thread: Thread,
  seq: number,
  before: number,
  after: number,
) {
  return getThreadMessage(db, thread, {
    completedTurnDisplay: "collapse",
    includeClearedContextHistory: false,
    maxSeq: getLatestThreadSequence(db, { threadId: thread.id }),
    seq,
    before,
    after,
  });
}

function readAllMessages(
  testThread: TestThread,
  thread: Thread,
): TimelineConversationRow[] {
  const all = readMessage(
    testThread.coldDb,
    thread,
    firstRequestSequence(testThread),
    0,
    1_000_000,
  );
  return [all.message, ...all.after];
}

function firstRequestSequence(testThread: TestThread): number {
  return testThread.db.$client
    .prepare(
      "SELECT min(sequence) AS sequence FROM events WHERE thread_id = ? AND type = 'client/turn/requested'",
    )
    .pluck()
    .get(testThread.thread.id) as number;
}

function countSelectedEventRows(
  testThread: TestThread,
  run: () => void,
): number {
  const raw = testThread.db.$client;
  const originalPrepare = raw.prepare.bind(raw);
  let count = 0;
  Object.defineProperty(raw, "prepare", {
    configurable: true,
    writable: true,
    value: (source: string) => {
      const statement = originalPrepare(source);
      if (source.includes('from "events"') && source.includes('"created_at"')) {
        const originalAll = statement.all.bind(statement);
        statement.all = function (...params: unknown[]) {
          const rows = originalAll(...params);
          count += rows.length;
          return rows;
        };
      }
      return statement;
    },
  });
  try {
    run();
  } finally {
    raw.prepare = originalPrepare;
  }
  return count;
}

function expectEveryMessageMatchesFullHistory(
  testThread: TestThread,
  thread: Thread,
): void {
  const rows = readAllMessages(testThread, thread);
  expect(rows.length).toBeGreaterThan(10);
  for (const [index, row] of rows.entries()) {
    for (const [before, after] of [
      [0, 0],
      [1, 1],
      [3, 3],
      [0, 6],
      [6, 0],
    ] as const) {
      expect(
        readMessage(testThread.db, thread, row.messageSeq, before, after),
      ).toEqual({
        message: row,
        before: rows.slice(Math.max(0, index - before), index),
        after: rows.slice(index + 1, index + 1 + after),
      });
    }
  }
}

const crossBoundaryHistories: { name: string; rows: RowSpec[] }[] = [
  {
    name: "a background task that finishes several turns later",
    rows: [
      ...turn("bg", [backgroundTask("turn-bg", "task-1", "pending")]),
      ...turns("mid", 2),
      backgroundTask(null, "task-1", "completed"),
    ],
  },
  {
    name: "a delegated background task that fails several turns later",
    rows: [
      ...turn("delegating", [
        delegation("turn-delegating", "delegation-1"),
        backgroundTask("turn-delegating", "task-2", "pending", "delegation-1"),
      ]),
      ...turns("waiting", 2),
      backgroundTask(null, "task-2", "failed", "delegation-1"),
    ],
  },
  {
    name: "a request queued during the previous turn",
    rows: [
      request("queued-a"),
      started("turn-queued-a"),
      accepted("queued-a", "turn-queued-a"),
      request("queued-b"),
      answer("turn-queued-a", "queued-a"),
      completed("turn-queued-a"),
      started("turn-queued-b"),
      accepted("queued-b", "turn-queued-b"),
      answer("turn-queued-b", "queued-b"),
      completed("turn-queued-b"),
    ],
  },
  {
    name: "a steer rejected after its turn completed",
    rows: [
      ...turn("steered"),
      request("late-steer", "turn-steered"),
      ...turn("between"),
      rejected("late-steer"),
    ],
  },
  {
    name: "an answer that completes after its turn",
    rows: [
      request("late"),
      started("turn-late"),
      accepted("late", "turn-late"),
      {
        type: "item/agentMessage/delta",
        turnId: "turn-late",
        itemId: "message-late",
        data: { itemId: "message-late", delta: "Partial" },
      },
      completed("turn-late"),
      answer("turn-late", "late"),
    ],
  },
  {
    name: "steers accepted mid-turn after an earlier queued request",
    rows: [
      request("boundary-a"),
      started("turn-boundary-a"),
      accepted("boundary-a", "turn-boundary-a"),
      request("boundary-b"),
      answer("turn-boundary-a", "boundary-a"),
      completed("turn-boundary-a"),
      started("turn-boundary-b"),
      accepted("boundary-b", "turn-boundary-b"),
      answer("turn-boundary-b", "boundary-b"),
      completed("turn-boundary-b"),
      ...turns("gap", 14),
      request("steered"),
      started("turn-steered"),
      accepted("steered", "turn-steered"),
      ...streamedAnswer("turn-steered", "steered-1"),
      request("system-steer", "turn-steered", "system"),
      accepted("system-steer", "turn-steered"),
      request("user-steer", "turn-steered"),
      accepted("user-steer", "turn-steered"),
      ...streamedAnswer("turn-steered", "steered-2"),
      ...streamedAnswer("turn-steered", "steered-3"),
      completed("turn-steered"),
    ],
  },
];

describe("thread message lookups", () => {
  it("reads only the turns around the message", () => {
    withTestThread((testThread) => {
      appendRows(testThread, turns("t", 120));
      const thread = { ...testThread.thread, status: "idle" as const };
      const rows = readAllMessages(testThread, thread);
      expect(rows).toHaveLength(240);
      const index = rows.findIndex((row) => row.text === "Ask t60");
      const target = rows[index]!;
      for (const context of [0, 3]) {
        const selected = countSelectedEventRows(testThread, () => {
          expect(
            readMessage(
              testThread.db,
              thread,
              target.messageSeq,
              context,
              context,
            ),
          ).toEqual({
            message: target,
            before: rows.slice(index - context, index),
            after: rows.slice(index + 1, index + 1 + context),
          });
        });
        expect(selected).toBeLessThan(60);
      }
    });
  });

  it.each(crossBoundaryHistories)(
    "matches the full history around $name",
    ({ rows }) => {
      for (const status of ["idle", "active"] as const) {
        withTestThread((testThread) => {
          appendRows(testThread, [
            ...turns("before", 30),
            ...rows,
            ...turns("after", 30),
          ]);
          expectEveryMessageMatchesFullHistory(testThread, {
            ...testThread.thread,
            status,
          });
        });
      }
    },
  );
});
