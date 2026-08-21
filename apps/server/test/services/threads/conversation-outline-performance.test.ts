import { describe, expect, it } from "vitest";
import { threadScope, turnScope } from "@bb/domain";
import {
  createConnection,
  createProject,
  createThread,
  insertEvents,
  migrate,
  noopNotifier,
  upsertHost,
  type SlowDbQueryLogFields,
} from "@bb/db";
import { buildThreadConversationOutline } from "../../../src/services/threads/timeline.js";

function setup() {
  const queries: SlowDbQueryLogFields[] = [];
  const db = createConnection(":memory:", {
    slowQueryThresholdMs: 0,
    slowQueryLogger: {
      info(fields) {
        queries.push(fields);
      },
    },
  });
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  return { db, queries, thread };
}

describe("thread conversation outline performance", () => {
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

    const outline = buildThreadConversationOutline(db, thread, { maxSeq: 2 });

    expect(outline.items).toEqual([
      expect.objectContaining({ preview: "Visible response" }),
    ]);
    const eventSelectQueries = queries.filter((query) =>
      query.sql.includes('from "events"'),
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

    const outline = buildThreadConversationOutline(db, thread, { maxSeq: 4 });

    expect(outline.items).toEqual([]);
    db.$client.close();
  });
});
