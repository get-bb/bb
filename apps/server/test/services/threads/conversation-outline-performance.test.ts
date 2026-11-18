import { describe, expect, it } from "vitest";
import { threadScope, turnScope, type Thread } from "@bb/domain";
import {
  createProject,
  createThread,
  deleteThreadEventSuffixInTransaction,
  getThreadEventRewriteGeneration,
  insertEvents,
  noopNotifier,
  threads,
  upsertHost,
  type DbConnection,
  type SlowDbQueryLogFields,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { eq } from "drizzle-orm";
import { runThreadRead } from "../../../src/services/threads/read-pool/thread-read.js";
import { buildThreadConversationOutline } from "../../../src/services/threads/timeline.js";

function readOutline(db: DbConnection, threadId: string) {
  const result = runThreadRead(db, {
    kind: "conversation-outline",
    providers: {},
    rewriteGeneration: getThreadEventRewriteGeneration(threadId),
    threadId,
  });
  if (result.kind !== "conversation-outline" || result.outline === null) {
    throw new Error(`Expected an outline for ${threadId}`);
  }
  return result.outline;
}

function userMessage(threadId: string, sequence: number, text: string) {
  return {
    threadId,
    sequence,
    type: "system/manager/user_message" as const,
    scope: threadScope(),
    itemId: null,
    itemKind: null,
    parentToolCallId: null,
    data: JSON.stringify({ text }),
  };
}

function setup(status: Thread["status"] = "starting") {
  const queries: SlowDbQueryLogFields[] = [];
  const db = createMigratedConnection({
    slowQueryThresholdMs: 0,
    slowQueryLogger: {
      info(fields) {
        queries.push(fields);
      },
    },
  });
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    status,
  });
  return { db, queries, thread };
}

describe("thread conversation outline performance", () => {
  it("bounds previews while preserving whitespace normalization and Unicode", () => {
    const { db, thread } = setup();
    const cases = [
      { text: " \t\r\n\u00a0\ufeff", preview: "" },
      { text: "  Hello\t\nworld \u00a0!  ", preview: "Hello world !" },
      { text: "x".repeat(199) + " 😀tail", preview: "x".repeat(199) },
      { text: "x".repeat(199) + "😀tail", preview: "x".repeat(199) },
      { text: "x".repeat(198) + "😀tail", preview: "x".repeat(198) + "😀" },
      { text: "\n".repeat(1_000) + "Hello", preview: "Hello" },
      {
        text: " ".repeat(201) + "x".repeat(198) + "😀tail",
        preview: "x".repeat(198) + "😀",
      },
      { text: "Hello" + " ".repeat(1_000) + "world", preview: "Hello world" },
      { text: "word ".repeat(100_000), preview: "word ".repeat(40).trimEnd() },
    ];
    insertEvents(
      db,
      noopNotifier,
      cases.map(({ text }, index) => ({
        threadId: thread.id,
        sequence: index + 1,
        type: "system/manager/user_message",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        data: JSON.stringify({ text }),
      })),
    );

    const outline = buildThreadConversationOutline(db, thread, {
      completedTurnDisplay: "collapse",
      includeClearedContextHistory: false,
      maxSeq: cases.length,
    });

    expect(outline.items.map((item) => item.preview)).toEqual(
      cases.map(({ preview }) => preview),
    );
    db.$client.close();
  });

  it("serves a repeated outline read from the read cache without event history", () => {
    const { db, queries, thread } = setup("idle");
    insertEvents(db, noopNotifier, [userMessage(thread.id, 1, "Response")]);
    const readsEventRows = () =>
      queries.some((query) =>
        query.sql.startsWith('select "created_at", "data"'),
      );
    queries.length = 0;
    const first = readOutline(db, thread.id);
    expect(readsEventRows()).toBe(true);
    queries.length = 0;

    expect(readOutline(db, thread.id)).toEqual(first);
    expect(readsEventRows()).toBe(false);
    db.$client.close();
  });

  it("re-projects a cached outline after a rename or a rewind", () => {
    const { db, queries, thread } = setup("idle");
    insertEvents(db, noopNotifier, [
      userMessage(thread.id, 1, "Original response"),
    ]);
    readOutline(db, thread.id);
    db.update(threads)
      .set({ title: "Renamed thread" })
      .where(eq(threads.id, thread.id))
      .run();
    queries.length = 0;

    readOutline(db, thread.id);

    expect(queries.some((query) => query.sql.includes('from "events"'))).toBe(
      true,
    );
    db.transaction((tx) =>
      deleteThreadEventSuffixInTransaction(tx, {
        cutoffSequence: 1,
        oldMaxSequence: 1,
        threadId: thread.id,
      }),
    );

    expect(readOutline(db, thread.id)).toEqual({ items: [], maxSeq: 0 });
    db.$client.close();
  });

  it("selects only events that can produce conversation rows", () => {
    const { db, queries, thread } = setup();
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "system/manager/user_message",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        data: JSON.stringify({ text: "Visible response" }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "item/completed",
        scope: turnScope("turn-1"),
        providerThreadId: "provider-thread-1",
        itemId: "command-1",
        itemKind: "commandExecution",
        parentToolCallId: null,
        data: JSON.stringify({
          item: {
            id: "command-1",
            type: "commandExecution",
            command: "printf noise",
            cwd: "/tmp/test",
            status: "completed",
            approvalStatus: null,
            aggregatedOutput: "Timeline-only noise",
            exitCode: 0,
          },
        }),
      },
    ]);
    queries.length = 0;

    const outline = buildThreadConversationOutline(db, thread, {
      completedTurnDisplay: "collapse",
      includeClearedContextHistory: false,
      maxSeq: 2,
    });

    expect(outline.items).toEqual([
      expect.objectContaining({ preview: "Visible response" }),
    ]);
    const eventSelectQueries = queries.filter((query) =>
      query.sql.includes('"events"."type" in'),
    );
    expect(eventSelectQueries).toHaveLength(1);
    expect(eventSelectQueries[0]?.sql).toContain('"events"."type" in');
    expect(eventSelectQueries[0]?.sql).not.toContain('"events"."type" not in');
    db.$client.close();
  });

  it("preserves errored-turn conversation visibility", () => {
    const { db, thread } = setup();
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "turn/started",
        scope: turnScope("turn-1"),
        providerThreadId: "provider-thread-1",
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        data: JSON.stringify({}),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "item/completed",
        scope: turnScope("turn-1"),
        providerThreadId: "provider-thread-1",
        itemId: "message-1",
        itemKind: "agentMessage",
        parentToolCallId: null,
        data: JSON.stringify({
          item: {
            id: "message-1",
            type: "agentMessage",
            text: "Failed answer collapsed behind the turn summary",
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "provider/error",
        scope: turnScope("turn-1"),
        providerThreadId: "provider-thread-1",
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        data: JSON.stringify({ message: "Provider failed" }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "turn/completed",
        scope: turnScope("turn-1"),
        providerThreadId: "provider-thread-1",
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        data: JSON.stringify({ status: "failed" }),
      },
    ]);

    const outline = buildThreadConversationOutline(db, thread, {
      completedTurnDisplay: "collapse",
      includeClearedContextHistory: false,
      maxSeq: 4,
    });

    expect(outline.items).toEqual([]);
    db.$client.close();
  });
});
