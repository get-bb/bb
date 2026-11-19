import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  BbPluginApi,
  ThreadDeleteFinalizeHookContext,
  ThreadDeleteFinalizeHookDecision,
} from "@get-bb/plugin-sdk";
import type {
  ColdThread,
  ColdThreadCursor,
  ColdThreadList,
} from "./contract.js";
import { openPluginDatabase } from "./database.js";
import { readThreadsById } from "./sdk-data.js";

export interface ColdStoreRequest {
  id: string;
  projectId: string;
  title: string | null;
  providerId: string;
  createdAt: number;
  archivedAt: number | null;
}

interface ColdThreadRow {
  thread_id: string;
  project_id: string;
  title: string | null;
  provider_id: string;
  thread_created_at: number;
  archived_at: number | null;
  stored_at: number | null;
  file_bytes: number | null;
}

function toColdThread(row: ColdThreadRow): ColdThread {
  return {
    threadId: row.thread_id,
    projectId: row.project_id,
    title: row.title,
    providerId: row.provider_id,
    threadCreatedAt: row.thread_created_at,
    archivedAt: row.archived_at,
    state: row.stored_at === null ? "moving" : "stored",
    storedAt: row.stored_at,
    fileBytes: row.file_bytes ?? 0,
  };
}

const LISTED_COLUMNS = `thread_id, project_id, title, provider_id,
  thread_created_at, archived_at, stored_at, file_bytes`;

export function createColdStorage(bb: BbPluginApi) {
  const db = openPluginDatabase(bb);
  const directory = join(dirname(db.name), "cold-storage");
  const exporting = new Set<string>();

  function changed() {
    bb.realtime.publish("cold-storage-changed", null);
  }

  function filePath(threadId: string): string {
    return join(directory, `${threadId}.jsonl.zst`);
  }

  function pendingRow(threadId: string) {
    return db
      .prepare<[string], { stored_at: number | null }>(
        "SELECT stored_at FROM cold_threads WHERE thread_id = ?",
      )
      .get(threadId);
  }

  async function store(thread: ColdStoreRequest): Promise<void> {
    db.prepare(
      `INSERT INTO cold_threads
         (thread_id, project_id, title, provider_id, thread_created_at, archived_at, requested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (thread_id) DO NOTHING`,
    ).run(
      thread.id,
      thread.projectId,
      thread.title,
      thread.providerId,
      thread.createdAt,
      thread.archivedAt,
      Date.now(),
    );
    try {
      await bb.sdk.threads.delete({
        threadId: thread.id,
        childThreadsConfirmed: true,
      });
    } catch (error) {
      db.prepare(
        "DELETE FROM cold_threads WHERE thread_id = ? AND stored_at IS NULL",
      ).run(thread.id);
      throw error;
    }
    changed();
  }

  async function writeColdFile(threadId: string): Promise<void> {
    const path = filePath(threadId);
    const partial = `${path}.partial`;
    try {
      const file = await bb.sdk.threads.experimental_export({ threadId });
      await mkdir(directory, { recursive: true });
      await writeFile(partial, file);
      await rename(partial, path);
      const stored = db
        .prepare(
          `UPDATE cold_threads SET file_bytes = ?, stored_at = ?
           WHERE thread_id = ? AND stored_at IS NULL`,
        )
        .run(file.byteLength, Date.now(), threadId).changes;
      if (stored === 0) await rm(path, { force: true });
      else changed();
    } catch (error) {
      await rm(partial, { force: true });
      bb.log.warn(
        `Could not move thread ${threadId} to cold storage yet: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      exporting.delete(threadId);
    }
  }

  function beforeDeleteFinalize(
    context: ThreadDeleteFinalizeHookContext,
  ): ThreadDeleteFinalizeHookDecision {
    const row = pendingRow(context.threadId);
    if (row === undefined || row.stored_at !== null)
      return { action: "proceed" };
    if (!exporting.has(context.threadId)) {
      exporting.add(context.threadId);
      void writeColdFile(context.threadId);
    }
    return { action: "wait" };
  }

  async function dropAbandonedMoves(): Promise<void> {
    const pending = db
      .prepare<[], { thread_id: string }>(
        "SELECT thread_id FROM cold_threads WHERE stored_at IS NULL",
      )
      .all()
      .map((row) => row.thread_id)
      .filter((threadId) => !exporting.has(threadId));
    if (pending.length === 0) return;
    const threads = await readThreadsById(bb, pending);
    const remove = db.prepare(
      "DELETE FROM cold_threads WHERE thread_id = ? AND stored_at IS NULL",
    );
    let dropped = 0;
    for (const threadId of pending) {
      const thread = threads.get(threadId);
      if (thread !== undefined && thread.deletedAt !== null) continue;
      if (thread === undefined) {
        bb.log.warn(
          `Thread ${threadId} was removed before it could be moved to cold storage`,
        );
      }
      if (remove.run(threadId).changes === 0) continue;
      dropped += 1;
      await rm(filePath(threadId), { force: true });
    }
    if (dropped > 0) changed();
  }

  function list(args: {
    projectId: string | null;
    search: string | null;
    limit: number;
    after: ColdThreadCursor | null;
  }): ColdThreadList {
    const pattern =
      args.search === null
        ? null
        : `%${args.search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    const filter = `(? IS NULL OR project_id = ?)
      AND (? IS NULL OR title LIKE ? ESCAPE '\\')`;
    const filterParams = [args.projectId, args.projectId, pattern, pattern];
    const cursor =
      args.after === null
        ? { sql: "1", params: [] }
        : args.after.storedAt === null
          ? {
              sql: "((stored_at IS NULL AND thread_id < ?) OR stored_at IS NOT NULL)",
              params: [args.after.threadId],
            }
          : {
              sql: "(stored_at < ? OR (stored_at = ? AND thread_id < ?))",
              params: [
                args.after.storedAt,
                args.after.storedAt,
                args.after.threadId,
              ],
            };
    const rows = db
      .prepare<(string | number | null)[], ColdThreadRow>(
        `SELECT ${LISTED_COLUMNS} FROM cold_threads
         WHERE ${filter} AND ${cursor.sql}
         ORDER BY stored_at IS NOT NULL, stored_at DESC, thread_id DESC
         LIMIT ?`,
      )
      .all(...filterParams, ...cursor.params, args.limit + 1);
    const totals = db
      .prepare<
        (string | null)[],
        {
          count: number;
          bytes: number;
          moving: number;
          lastStoredAt: number | null;
        }
      >(
        `SELECT COUNT(*) AS count, COALESCE(SUM(file_bytes), 0) AS bytes,
           COUNT(*) - COUNT(stored_at) AS moving, MAX(stored_at) AS lastStoredAt
         FROM cold_threads WHERE ${filter}`,
      )
      .get(...filterParams)!;
    return {
      threads: rows.slice(0, args.limit).map(toColdThread),
      hasMore: rows.length > args.limit,
      totalCount: totals.count,
      totalBytes: totals.bytes,
      movingCount: totals.moving,
      lastStoredAt: totals.lastStoredAt,
    };
  }

  function cursorOf(threadId: string): ColdThreadCursor {
    const row = pendingRow(threadId);
    if (row === undefined) {
      throw new Error(`Thread ${threadId} isn't in cold storage.`);
    }
    return { storedAt: row.stored_at, threadId };
  }

  function requireStored(threadId: string): void {
    const row = pendingRow(threadId);
    if (row?.stored_at == null) {
      throw new Error(`Thread ${threadId} isn't in cold storage.`);
    }
  }

  async function restore(threadId: string) {
    requireStored(threadId);
    const result = await bb.sdk.threads.experimental_import({
      file: await readFile(filePath(threadId)),
    });
    db.prepare("DELETE FROM cold_threads WHERE thread_id = ?").run(threadId);
    await rm(filePath(threadId), { force: true });
    changed();
    return result;
  }

  async function remove(threadId: string): Promise<{ ok: true }> {
    const deleted = db
      .prepare(
        "DELETE FROM cold_threads WHERE thread_id = ? AND stored_at IS NOT NULL",
      )
      .run(threadId).changes;
    if (deleted === 0) {
      throw new Error(`Thread ${threadId} isn't in cold storage.`);
    }
    await rm(filePath(threadId), { force: true });
    changed();
    return { ok: true };
  }

  return {
    beforeDeleteFinalize,
    cursorOf,
    dropAbandonedMoves,
    list,
    remove,
    restore,
    store,
  };
}

export type ColdStorage = ReturnType<typeof createColdStorage>;
