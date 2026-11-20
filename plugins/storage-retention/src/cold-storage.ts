import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
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

type SdkThread = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["list"]>
>[number];
export type ColdStoreRequest = Pick<
  SdkThread,
  | "id"
  | "projectId"
  | "title"
  | "titleFallback"
  | "providerId"
  | "createdAt"
  | "archivedAt"
  | "parentThreadId"
  | "sourceThreadId"
  | "lifecycleOwnerThreadId"
>;
type LinkedThread = Pick<
  SdkThread,
  | "id"
  | "deletedAt"
  | "parentThreadId"
  | "sourceThreadId"
  | "lifecycleOwnerThreadId"
>;
const linkedThreadIdsSchema = z.array(z.string());

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

  async function forget(threadId: string): Promise<boolean> {
    const removed =
      db.prepare("DELETE FROM cold_threads WHERE thread_id = ?").run(threadId)
        .changes > 0;
    await rm(filePath(threadId), { force: true });
    return removed;
  }

  async function store(
    thread: ColdStoreRequest,
    threads: readonly LinkedThread[],
  ): Promise<void> {
    const dependentIds = threads
      .filter(
        (other) =>
          other.deletedAt === null &&
          other.id !== thread.id &&
          (other.parentThreadId === thread.id ||
            other.sourceThreadId === thread.id ||
            other.lifecycleOwnerThreadId === thread.id),
      )
      .map((other) => other.id);
    if (dependentIds.length > 0)
      throw new Error(
        `Thread ${thread.id} can't move to cold storage while other threads point at it as their parent, source or lifecycle owner: ${dependentIds.join(", ")}. Move or delete those first.`,
      );
    const linkedThreadIds = [
      ...new Set(
        [
          thread.parentThreadId,
          thread.sourceThreadId,
          thread.lifecycleOwnerThreadId,
        ].filter((id): id is string => id !== null && id !== thread.id),
      ),
    ];
    db.prepare(
      `INSERT INTO cold_threads
         (thread_id, project_id, title, provider_id, thread_created_at, archived_at, linked_thread_ids, requested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (thread_id) DO UPDATE SET
         project_id = excluded.project_id,
         title = excluded.title,
         provider_id = excluded.provider_id,
         thread_created_at = excluded.thread_created_at,
         archived_at = excluded.archived_at,
         linked_thread_ids = excluded.linked_thread_ids,
         requested_at = excluded.requested_at,
         stored_at = NULL,
         file_bytes = NULL`,
    ).run(
      thread.id,
      thread.projectId,
      thread.title ?? thread.titleFallback ?? null,
      thread.providerId,
      thread.createdAt,
      thread.archivedAt,
      JSON.stringify(linkedThreadIds),
      Date.now(),
    );
    try {
      await bb.sdk.threads.delete({
        threadId: thread.id,
        childThreadsConfirmed: false,
      });
    } catch (error) {
      await forget(thread.id);
      changed();
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

  async function reconcile(): Promise<void> {
    const rows = db
      .prepare<[], { thread_id: string; stored_at: number | null }>(
        "SELECT thread_id, stored_at FROM cold_threads",
      )
      .all()
      .filter((row) => !exporting.has(row.thread_id));
    if (rows.length === 0) return;
    const threads = await readThreadsById(
      bb,
      rows.map((row) => row.thread_id),
    );
    const removeMoving = db.prepare(
      "DELETE FROM cold_threads WHERE thread_id = ? AND stored_at IS NULL",
    );
    const removeStored = db.prepare(
      "DELETE FROM cold_threads WHERE thread_id = ? AND stored_at = ?",
    );
    let dropped = 0;
    for (const row of rows) {
      const thread = threads.get(row.thread_id);
      if (row.stored_at === null) {
        if (thread !== undefined && thread.deletedAt !== null) continue;
        if (thread === undefined) {
          bb.log.warn(
            `Thread ${row.thread_id} was removed before it could be moved to cold storage`,
          );
        }
        if (removeMoving.run(row.thread_id).changes === 0) continue;
      } else {
        if (thread === undefined || thread.deletedAt !== null) continue;
        if (removeStored.run(row.thread_id, row.stored_at).changes === 0)
          continue;
      }
      dropped += 1;
      await rm(filePath(row.thread_id), { force: true });
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

  function storedLinks(threadId: string): string[] | null {
    const row = db
      .prepare<
        [string],
        { stored_at: number | null; linked_thread_ids: string }
      >(
        "SELECT stored_at, linked_thread_ids FROM cold_threads WHERE thread_id = ?",
      )
      .get(threadId);
    if (row?.stored_at == null) return null;
    return linkedThreadIdsSchema.parse(JSON.parse(row.linked_thread_ids));
  }

  async function restoreOne(
    threadId: string,
    restored: string[],
    visiting: Set<string>,
  ): Promise<void> {
    visiting.add(threadId);
    const links = storedLinks(threadId);
    if (links === null) return;
    for (const linkedId of links) {
      if (visiting.has(linkedId) || storedLinks(linkedId) === null) continue;
      try {
        await restoreOne(linkedId, restored, visiting);
      } catch (error) {
        bb.log.warn(
          `Could not restore ${linkedId} before ${threadId}, so ${threadId} comes back without its link to it: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const current = (await readThreadsById(bb, [threadId])).get(threadId);
    if (current === undefined || current.deletedAt !== null) {
      await bb.sdk.threads.experimental_import({
        file: await readFile(filePath(threadId)),
      });
      restored.push(threadId);
    }
    await forget(threadId);
  }

  async function restore(threadId: string) {
    if (storedLinks(threadId) === null) {
      throw new Error(`Thread ${threadId} isn't in cold storage.`);
    }
    const restored: string[] = [];
    try {
      await restoreOne(threadId, restored, new Set());
    } finally {
      changed();
    }
    return { threadId, restoredThreadIds: restored };
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
    list,
    reconcile,
    remove,
    restore,
    store,
  };
}

export type ColdStorage = ReturnType<typeof createColdStorage>;
