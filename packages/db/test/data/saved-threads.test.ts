import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { threadScope, turnScope, type ThreadEventType } from "@bb/domain";
import { createEnvironment } from "../../src/data/environments.js";
import { insertEvents } from "../../src/data/events.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { createQueuedThreadMessage } from "../../src/data/queued-thread-messages.js";
import {
  THREAD_FILE_FORMAT_VERSION,
  insertThreadHistoryRows,
  insertThreadTableRow,
  isThreadSavable,
  nextThreadSave,
  readThreadEventWindow,
  readThreadTableRows,
  restartThreadArchiveClock,
  upsertSavedThread,
  type SavedThread,
} from "../../src/data/saved-threads.js";
import { markThreadPruningPolicyWork } from "../../src/data/thread-pruning-work.js";
import { archiveThread, createThread, getThread, pinThread } from "../../src/data/threads.js";
import { noopNotifier } from "../../src/notifier.js";
import { projectAttachmentBackfills } from "../../src/schema.js";
import { createMigratedConnection } from "../../src/testing.js";

type Db = ReturnType<typeof createMigratedConnection>;

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
  db.insert(projectAttachmentBackfills)
    .values({
      attemptedAt: 0,
      error: null,
      inputCursor: 0,
      inputId: "",
      inputSequence: 0,
      phase: "done",
      projectId: project.id,
      threadCursor: "",
    })
    .run();
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

function savable(db: Db, threadId: string) {
  return isThreadSavable(db, { inProgress: false, threadId });
}

function savedRow(threadId: string, projectId: string, patch: Partial<SavedThread>): SavedThread {
  return {
    archivedAt: 0,
    formatVersion: THREAD_FILE_FORMAT_VERSION,
    packedBytes: 0,
    projectId,
    providerId: "codex",
    rawBytes: 0,
    restoredAt: null,
    rowCount: 0,
    savedAt: null,
    state: "saved",
    threadCreatedAt: 0,
    threadId,
    throughSequence: 0,
    title: null,
    updatedAt: 0,
    ...patch,
  };
}

describe("thread save eligibility", () => {
  it("allows a save of any idle thread, archived or not", () => {
    const context = setup();
    const archived = seedThread(context);
    const live = seedThread(context, { archived: false });
    expect(savable(context.db, archived.id)).toBe(true);
    expect(savable(context.db, live.id)).toBe(true);
  });

  it("queues saves oldest request first and skips excluded threads", () => {
    const context = setup();
    const first = seedThread(context);
    const second = seedThread(context);
    const done = seedThread(context);
    upsertSavedThread(
      context.db,
      savedRow(second.id, context.project.id, { state: "saving", updatedAt: 2 }),
    );
    upsertSavedThread(
      context.db,
      savedRow(first.id, context.project.id, { state: "saving", updatedAt: 1 }),
    );
    upsertSavedThread(
      context.db,
      savedRow(done.id, context.project.id, { state: "saved", updatedAt: 0 }),
    );
    expect(nextThreadSave(context.db, { excludedThreadIds: new Set() })).toBe(first.id);
    expect(
      nextThreadSave(context.db, { excludedThreadIds: new Set([first.id]) }),
    ).toBe(second.id);
    expect(
      nextThreadSave(context.db, { excludedThreadIds: new Set([first.id, second.id]) }),
    ).toBeNull();
  });

  it("skips pinned, running, queued, prompting, pruning-pending and backgrounded threads", () => {
    const context = setup();
    const pinned = seedThread(context);
    pinThread(context.db, noopNotifier, { threadId: pinned.id });
    expect(savable(context.db, pinned.id)).toBe(false);

    const running = seedThread(context);
    context.db.run(sql`UPDATE threads SET status = 'active' WHERE id = ${running.id}`);
    expect(savable(context.db, running.id)).toBe(false);

    const queued = seedThread(context);
    createQueuedThreadMessage(context.db, noopNotifier, {
      threadId: queued.id,
      content: [{ type: "text", text: "later", mentions: [] }],
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "full",
      senderThreadId: null,
      serviceTier: "default",
      waitingOn: null,
      sendAt: null,
      payload: { kind: "inline" },
      systemNotice: null,
    });
    expect(savable(context.db, queued.id)).toBe(false);

    const prompting = seedThread(context);
    context.db.run(sql`
      INSERT INTO pending_interactions (id, thread_id, origin_kind, status, payload, created_at, updated_at)
      VALUES ('interaction-1', ${prompting.id}, 'provider', 'pending', '{}', 0, 0)
    `);
    expect(savable(context.db, prompting.id)).toBe(false);

    const pruning = seedThread(context);
    markThreadPruningPolicyWork(context.db, [pruning.id], "usage");
    expect(savable(context.db, pruning.id)).toBe(false);

    const background = seedThread(context);
    insertEvents(context.db, noopNotifier, [
      {
        threadId: background.id,
        environmentId: context.environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        sequence: 5,
        type: "item/started",
        itemId: "task-1",
        itemKind: "backgroundTask",
        parentToolCallId: null,
        data: JSON.stringify({
          item: { type: "backgroundTask", id: "task-1", title: "build", status: "pending" },
        }),
      },
    ]);
    context.db.run(sql`DELETE FROM thread_pruning_work`);
    expect(savable(context.db, background.id)).toBe(false);
  });

  it("skips a thread that other threads still point at, and projects not ready", () => {
    const context = setup();
    const parent = seedThread(context);
    const child = seedThread(context, { parentThreadId: parent.id });
    expect(savable(context.db, parent.id)).toBe(false);
    expect(savable(context.db, child.id)).toBe(true);

    const other = seedThread(context);
    context.db.run(
      sql`UPDATE project_attachment_backfills SET phase = 'events' WHERE project_id = ${context.project.id}`,
    );
    expect(savable(context.db, other.id)).toBe(false);
  });

  it("skips threads already saving or saved, and allows restored ones again", () => {
    const context = setup();
    const thread = seedThread(context);
    upsertSavedThread(
      context.db,
      savedRow(thread.id, context.project.id, { state: "saving" }),
    );
    expect(savable(context.db, thread.id)).toBe(false);
    expect(
      isThreadSavable(context.db, { inProgress: true, threadId: thread.id }),
    ).toBe(true);
    upsertSavedThread(
      context.db,
      savedRow(thread.id, context.project.id, { state: "saved" }),
    );
    expect(savable(context.db, thread.id)).toBe(false);
    upsertSavedThread(
      context.db,
      savedRow(thread.id, context.project.id, { state: "restored", restoredAt: 1 }),
    );
    expect(savable(context.db, thread.id)).toBe(true);
  });

  it("restarts the archive clock of a restored archived thread only", () => {
    const context = setup();
    const archived = seedThread(context);
    const live = seedThread(context, { archived: false });
    restartThreadArchiveClock(context.db, { now: 42, threadId: archived.id });
    restartThreadArchiveClock(context.db, { now: 42, threadId: live.id });
    expect(getThread(context.db, archived.id)?.archivedAt).toBe(42);
    expect(getThread(context.db, live.id)?.archivedAt).toBeNull();
  });
});

describe("thread file rows", () => {
  it("re-inserts an event window byte-for-byte, ignoring rows already present", () => {
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
      throughSequence: null,
    });
    expect(window.rows.map((row) => row.sequence)).toEqual([1, 2, 3, 4]);
    context.db.run(sql`DELETE FROM events WHERE thread_id = ${thread.id}`);
    expect(
      context.db.all(sql`SELECT id FROM events WHERE thread_id = ${thread.id}`),
    ).toEqual([]);
    expect(
      insertThreadHistoryRows(context.db, {
        now: Date.now(),
        retained: window.retained,
        rows: [...window.rows, ...window.rows],
      }),
    ).toBe(4);
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
    for (const row of rows) insertThreadTableRow(context.db, row);

    expect(getThread(context.db, thread.id)).toEqual({
      ...before,
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
