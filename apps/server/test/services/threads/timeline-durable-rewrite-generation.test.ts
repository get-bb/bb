import { prependOlderTimelineRows } from "@bb/client-core";
import { expect, it, vi } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  type Thread,
} from "@bb/domain";
import {
  createProject,
  createThread,
  getLatestStoredConversationOutlineSequence,
  getLatestThreadSequence,
  insertEvents,
  noopNotifier,
  upsertHost,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import type {
  TimelinePaginationCursor,
  TimelineRow,
} from "@bb/server-contract";

type TimelineModule =
  typeof import("../../../src/services/threads/timeline.js");
type EventInput = Parameters<typeof insertEvents>[2][number];

const providerThreadId = "provider-root";
const execution = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "full",
  source: "client/turn/requested",
} as const;

function setup(): { db: DbConnection; thread: Thread } {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    status: "idle",
  });
  return { db, thread };
}

function request(
  thread: Thread,
  sequence: number,
  value: number,
  target: object,
): EventInput {
  return {
    threadId: thread.id,
    sequence,
    type: "client/turn/requested",
    scope: threadScope(),
    itemId: null,
    itemKind: null,
    parentToolCallId: null,
    data: JSON.stringify({
      direction: "outbound",
      source: "tell",
      initiator: "user",
      request: { method: "turn/start", params: {} },
      requestId: encodeClientTurnRequestIdNumber({ value }),
      senderThreadId: null,
      input: [{ type: "text", text: `User message ${value}`, mentions: [] }],
      target,
      execution,
    }),
  };
}

function turnEvent(
  thread: Thread,
  sequence: number,
  type: "turn/started" | "turn/input/accepted" | "turn/completed",
  data: object,
): EventInput {
  return {
    threadId: thread.id,
    sequence,
    type,
    scope: turnScope("turn-1"),
    providerThreadId,
    itemId: null,
    itemKind: null,
    parentToolCallId: null,
    data: JSON.stringify(data),
  };
}

function item(
  thread: Thread,
  sequence: number,
  type: "item/started" | "item/completed",
  value: Record<string, unknown> & { id: string; type: string },
): EventInput {
  return {
    threadId: thread.id,
    sequence,
    type,
    scope: turnScope("turn-1"),
    providerThreadId,
    itemId: value.id,
    itemKind: value.type as EventInput["itemKind"],
    parentToolCallId: null,
    data: JSON.stringify({ item: value }),
  };
}

function command(thread: Thread, sequence: number, id: string): EventInput[] {
  const base = {
    type: "commandExecution",
    id,
    command: `echo ${id}`,
    cwd: "/tmp/test",
    approvalStatus: null,
  };
  return [
    item(thread, sequence, "item/started", { ...base, status: "pending" }),
    item(thread, sequence + 1, "item/completed", {
      ...base,
      status: "completed",
      exitCode: 0,
      aggregatedOutput: id,
    }),
  ];
}

function seedWithGap(db: DbConnection, thread: Thread): number {
  const events: EventInput[] = [
    request(thread, 1, 1, { kind: "thread-start" }),
    turnEvent(thread, 2, "turn/started", {}),
    turnEvent(thread, 3, "turn/input/accepted", {
      clientRequestId: encodeClientTurnRequestIdNumber({ value: 1 }),
    }),
  ];
  let sequence = 4;
  for (let index = 0; index < 300; index += 1) {
    events.push(...command(thread, sequence, `item-${index}`));
    sequence += 2;
  }
  const gap = sequence;
  sequence += 1;
  events.push(
    request(thread, sequence, 2, { kind: "steer", expectedTurnId: "turn-1" }),
    turnEvent(thread, sequence + 1, "turn/input/accepted", {
      clientRequestId: encodeClientTurnRequestIdNumber({ value: 2 }),
    }),
  );
  sequence += 2;
  for (let index = 300; index < 600; index += 1) {
    events.push(...command(thread, sequence, `item-${index}`));
    sequence += 2;
  }
  events.push(
    item(thread, sequence, "item/completed", {
      type: "agentMessage",
      id: "answer",
      text: "All done.",
    }),
    turnEvent(thread, sequence + 1, "turn/completed", {
      status: "completed",
      providerThreadId,
    }),
  );
  insertEvents(db, noopNotifier, events);
  return gap;
}

async function freshTimeline(): Promise<TimelineModule> {
  vi.resetModules();
  return import("../../../src/services/threads/timeline.js");
}

function walk(
  timeline: TimelineModule,
  db: DbConnection,
  thread: Thread,
): TimelineRow[] {
  let rows: TimelineRow[] = [];
  let cursor: TimelinePaginationCursor | null = null;
  for (let page = 0; page < 20; page += 1) {
    const { response } = timeline.buildThreadTimelineWithProfile(db, thread, {
      completedTurnDisplay: "collapse",
      eventBudget: 100,
      includeClearedContextHistory: false,
      includeDiagnosticOperations: false,
      compactionOfferEnabled: false,
      summarizeShellCommands: true,
      maxInlineOutputChars: 32_000,
      maxSeq: 0,
      page: cursor
        ? { kind: "older", beforeCursor: cursor, segmentLimit: 1 }
        : { kind: "latest", segmentLimit: 1 },
    });
    rows = prependOlderTimelineRows({
      olderRows: response.rows,
      loadedRows: rows,
    });
    cursor = response.timelinePage.olderCursor;
    if (cursor === null) return rows;
  }
  throw new Error("walk did not finish");
}

function outline(timeline: TimelineModule, db: DbConnection, thread: Thread) {
  return timeline.loadThreadConversationOutline(db, thread, {
    completedTurnDisplay: "collapse",
    includeClearedContextHistory: false,
    maxSeq: getLatestThreadSequence(db, { threadId: thread.id }),
    outlineSequence: getLatestStoredConversationOutlineSequence(db, {
      threadId: thread.id,
    }),
  });
}

it("ignores stored turn plans and outlines from before a rewrite once the process restarts", async () => {
  const { db, thread } = setup();
  const gap = seedWithGap(db, thread);
  const before = await freshTimeline();
  const rowsBefore = walk(before, db, thread);
  const outlineBefore = outline(before, db, thread);
  expect(
    db.$client
      .prepare("SELECT COUNT(*) AS count FROM thread_turn_timeline_plans")
      .get(),
  ).toEqual({ count: 1 });

  insertEvents(db, noopNotifier, [
    item(thread, gap, "item/completed", {
      type: "agentMessage",
      id: "late-note",
      text: "A late note.",
    }),
  ]);

  const restarted = await freshTimeline();
  const rows = walk(restarted, db, thread);
  const restartedOutline = outline(restarted, db, thread);

  db.$client.exec(
    "DELETE FROM thread_turn_timeline_plans; DELETE FROM thread_conversation_outlines;",
  );
  const rebuilt = await freshTimeline();
  const expectedRows = walk(rebuilt, db, thread);
  const expectedOutline = outline(rebuilt, db, thread);

  expect(expectedRows).not.toEqual(rowsBefore);
  expect(expectedOutline).not.toEqual(outlineBefore);
  expect(rows).toEqual(expectedRows);
  expect(restartedOutline).toEqual(expectedOutline);
});
