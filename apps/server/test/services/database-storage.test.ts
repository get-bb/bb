import { mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createConnection,
  createProject,
  createThread,
  migrate,
  noopNotifier,
  upsertHost,
  type DbConnection,
} from "@bb/db";
import {
  readDatabaseStorage,
  THREAD_HISTORY_EVENT_CHUNK_SIZE,
  THREAD_HISTORY_THREAD_PAGE_SIZE,
} from "../../src/services/system/database-storage.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "bb-server-db-storage-"));
  cleanups.push(() => rmSync(dir, { force: true, recursive: true }));
  return join(dir, "bb.db");
}

function openDatabase(path: string): DbConnection {
  const db = createConnection(path);
  cleanups.push(() => db.$client.close());
  migrate(db);
  return db;
}

interface SeededThread {
  events: number;
  searchSegments: number;
  state: "active" | "archived" | "deleted" | "archivedThenDeleted";
}

function seedThreads(db: DbConnection, threads: SeededThread[]): void {
  const host = upsertHost(db, noopNotifier, { name: "storage-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "storage-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/project" },
  });
  const insertEvent = db.$client.prepare(
    `INSERT INTO events (id, thread_id, scope_kind, sequence, type, data, created_at)
     VALUES (?, ?, 'thread', ?, 'thread/identity', '{}', 0)`,
  );
  const insertSegment = db.$client.prepare(
    `INSERT INTO thread_search_segments (id, thread_id, source_kind, source_key, text, created_at, updated_at)
     VALUES (?, ?, 'title', ?, 'text', 0, 0)`,
  );
  const markArchived = db.$client.prepare(
    "UPDATE threads SET archived_at = 1 WHERE id = ?",
  );
  const markDeleted = db.$client.prepare(
    "UPDATE threads SET deleted_at = 1 WHERE id = ?",
  );
  for (const seeded of threads) {
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "idle",
    });
    db.$client.exec(`DELETE FROM events WHERE thread_id = '${thread.id}'`);
    db.$client.exec(
      `DELETE FROM thread_search_segments WHERE thread_id = '${thread.id}'`,
    );
    for (let index = 0; index < seeded.events; index += 1)
      insertEvent.run(`${thread.id}:event:${index}`, thread.id, index + 1);
    for (let index = 0; index < seeded.searchSegments; index += 1)
      insertSegment.run(`${thread.id}:segment:${index}`, thread.id, `${index}`);
    if (seeded.state === "archived" || seeded.state === "archivedThenDeleted")
      markArchived.run(thread.id);
    if (seeded.state === "deleted" || seeded.state === "archivedThenDeleted")
      markDeleted.run(thread.id);
  }
}

function buildFreelist(db: DbConnection): void {
  db.$client.exec("CREATE TABLE scratch (id INTEGER PRIMARY KEY, blob TEXT)");
  const insert = db.$client.prepare("INSERT INTO scratch (blob) VALUES (?)");
  db.$client.transaction(() => {
    for (let index = 0; index < 200; index += 1)
      insert.run("x".repeat(8 * 1024));
  })();
  db.$client.exec("DELETE FROM scratch");
}

describe("readDatabaseStorage", () => {
  it("totals history rows by thread state across thread pages and event chunks", async () => {
    const db = openDatabase(tempDatabasePath());
    const threads: SeededThread[] = Array.from(
      { length: THREAD_HISTORY_THREAD_PAGE_SIZE + 10 },
      (_, index) => ({
        events: (index % 4) + 1,
        searchSegments: index % 3,
        state: index % 5 === 0 ? "active" : "archived",
      }),
    );
    threads.push(
      {
        events: THREAD_HISTORY_EVENT_CHUNK_SIZE,
        searchSegments: 0,
        state: "active",
      },
      {
        events: THREAD_HISTORY_EVENT_CHUNK_SIZE * 2 + 3,
        searchSegments: 4,
        state: "archived",
      },
      { events: 7, searchSegments: 2, state: "deleted" },
      { events: 5, searchSegments: 1, state: "archivedThenDeleted" },
    );
    seedThreads(db, threads);
    const expected = { threads: 0, events: 0, searchSegments: 0 };
    const totals = {
      active: { ...expected },
      archived: { ...expected },
      deleted: { ...expected },
    };
    for (const thread of threads) {
      const state =
        thread.state === "archivedThenDeleted" ? "deleted" : thread.state;
      totals[state].threads += 1;
      totals[state].events += thread.events;
      totals[state].searchSegments += thread.searchSegments;
    }

    const readout = await readDatabaseStorage(db);

    expect(readout.history).toEqual(totals);
  });

  it("reads file, WAL and free-page figures from the open database", async () => {
    const path = tempDatabasePath();
    const db = openDatabase(path);
    buildFreelist(db);

    const readout = await readDatabaseStorage(db);

    const freelistPages = db.$client.pragma("freelist_count", {
      simple: true,
    });
    expect(readout.database).toEqual({
      path: realpathSync(path),
      fileBytes: statSync(path).size,
      walBytes: statSync(`${path}-wal`).size,
      pageSize: 4096,
      pageCount: db.$client.pragma("page_count", { simple: true }),
      freelistPages,
      reclaimableBytes: Number(freelistPages) * 4096,
      autoVacuum: "incremental",
    });
    expect(readout.database.freelistPages).toBeGreaterThan(0);
    expect(readout.database.walBytes).toBeGreaterThan(0);
  });
});
