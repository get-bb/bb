import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { threadScope, turnScope, type ThreadEventType } from "@bb/domain";
import { createEnvironment } from "../../src/data/environments.js";
import { insertEvents } from "../../src/data/events.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  insertHiddenThreadRow,
  insertThreadHistoryRows,
  insertThreadTableRow,
  readThreadEventWindow,
  restartThreadArchiveClock,
} from "../../src/data/thread-files.js";
import { archiveThread, createThread, getThread } from "../../src/data/threads.js";
import { noopNotifier } from "../../src/notifier.js";
import {
  createMigratedConnection,
  readThreadTableRows,
} from "../../src/testing.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const environment = createEnvironment(db, noopNotifier, {
    projectId: project.id,
    hostId: host.id,
    path: "/tmp/environment",
    providerOwnsPath: false,
    status: "ready",
    environmentProvider: null,
  });
  return { db, environment, project };
}

function seedThread(
  context: ReturnType<typeof setup>,
  options: { archived?: boolean; parentThreadId?: string } = {},
) {
  const thread = createThread(context.db, noopNotifier, {
    projectId: context.project.id,
    providerId: "codex",
    environmentId: context.environment.id,
    status: "idle",
    parentThreadId: options.parentThreadId ?? null,
  });
  const rows: Array<{ type: ThreadEventType; data: unknown; turn?: boolean }> = [
    { type: "thread/identity", data: {} },
    { type: "turn/started", data: {}, turn: true },
    {
      type: "item/completed",
      turn: true,
      data: { item: { type: "agentMessage", id: "message-1", text: "first reply" } },
    },
    { type: "turn/completed", data: { status: "completed" }, turn: true },
  ];
  insertEvents(
    context.db,
    noopNotifier,
    rows.map((row, index) => ({
      threadId: thread.id,
      environmentId: context.environment.id,
      providerThreadId: "provider-thread-1",
      scope: row.turn ? turnScope("turn-1") : threadScope(),
      sequence: index + 1,
      type: row.type,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify(row.data),
    })),
  );
  if (options.archived ?? true) archiveThread(context.db, noopNotifier, thread.id);
  context.db.run(sql`DELETE FROM thread_pruning_work`);
  return thread;
}

describe("thread file rows", () => {
  it("restarts the archive clock of an imported archived thread only", () => {
    const context = setup();
    const archived = seedThread(context);
    const live = seedThread(context, { archived: false });
    restartThreadArchiveClock(context.db, { now: 42, threadId: archived.id });
    restartThreadArchiveClock(context.db, { now: 42, threadId: live.id });
    expect(getThread(context.db, archived.id)?.archivedAt).toBe(42);
    expect(getThread(context.db, live.id)?.archivedAt).toBeNull();
  });

  it("re-inserts an event window byte-for-byte", () => {
    const context = setup();
    const thread = seedThread(context);
    const before = context.db.all(
      sql`SELECT * FROM events WHERE thread_id = ${thread.id} ORDER BY sequence`,
    );
    const window = readThreadEventWindow(context.db, {
      afterSequence: 0,
      maxBytes: 1024 * 1024,
      maxRows: 100,
      threadId: thread.id,
    });
    expect(window.rows.map((row) => row.sequence)).toEqual([1, 2, 3, 4]);
    context.db.run(sql`DELETE FROM events WHERE thread_id = ${thread.id}`);
    expect(
      context.db.all(sql`SELECT id FROM events WHERE thread_id = ${thread.id}`),
    ).toEqual([]);
    insertThreadHistoryRows(context.db, {
      now: Date.now(),
      retained: window.retained,
      rows: window.rows,
    });
    expect(
      context.db.all(
        sql`SELECT * FROM events WHERE thread_id = ${thread.id} ORDER BY sequence`,
      ),
    ).toEqual(before);
  });

  it("re-creates a deleted thread row, dropping links to rows that no longer exist", () => {
    const context = setup();
    const parent = seedThread(context);
    const thread = seedThread(context, { parentThreadId: parent.id });
    context.db.run(sql`
      INSERT INTO thread_plugin_metadata (thread_id, plugin_id, metadata_json)
      VALUES (${thread.id}, 'example', '{"pr":42}')
    `);
    const rows = readThreadTableRows(context.db, thread.id);
    expect(rows.map((row) => row.table)).toEqual(["threads", "thread_plugin_metadata"]);
    const before = getThread(context.db, thread.id);

    context.db.run(sql`DELETE FROM threads WHERE id IN (${thread.id}, ${parent.id})`);
    context.db.run(sql`DELETE FROM environments`);
    const [threadRow, ...otherRows] = rows;
    if (threadRow === undefined) throw new Error("Expected a thread row");
    expect(() => insertThreadTableRow(context.db, threadRow)).toThrow();
    insertHiddenThreadRow(context.db, threadRow, 1234);
    for (const row of otherRows) insertThreadTableRow(context.db, row);

    expect(getThread(context.db, thread.id)).toEqual({
      ...before,
      deletedAt: 1234,
      environmentId: null,
      parentThreadId: null,
    });
    expect(
      context.db.get<{ metadata: string }>(
        sql`SELECT metadata_json AS metadata FROM thread_plugin_metadata WHERE thread_id = ${thread.id}`,
      )?.metadata,
    ).toBe('{"pr":42}');
  });
});
