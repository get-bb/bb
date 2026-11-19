import type {
  BbPluginApi,
  ThreadPurgeHookContext,
  ThreadPurgeHookDecision,
} from "@get-bb/plugin-sdk";
import type { SavedThread, SavedThreadList } from "./contract.js";
import { openPluginDatabase } from "./database.js";
import { readThreadsById } from "./sdk-data.js";

export interface SaveRequest {
  id: string;
  projectId: string;
  title: string | null;
  providerId: string;
  createdAt: number;
  archivedAt: number | null;
}

interface SavedThreadRow {
  thread_id: string;
  project_id: string;
  title: string | null;
  provider_id: string;
  thread_created_at: number;
  archived_at: number | null;
  saved_at: number | null;
  file_bytes: number | null;
}

function toSavedThread(row: SavedThreadRow): SavedThread {
  return {
    threadId: row.thread_id,
    projectId: row.project_id,
    title: row.title,
    providerId: row.provider_id,
    threadCreatedAt: row.thread_created_at,
    archivedAt: row.archived_at,
    state: row.saved_at === null ? "saving" : "saved",
    savedAt: row.saved_at,
    fileBytes: row.file_bytes ?? 0,
  };
}

const LISTED_COLUMNS = `thread_id, project_id, title, provider_id,
  thread_created_at, archived_at, saved_at, file_bytes`;

export function createColdStorage(bb: BbPluginApi) {
  const db = openPluginDatabase(bb);
  const exporting = new Set<string>();

  function changed() {
    bb.realtime.publish("saved-threads-changed", null);
  }

  function pendingRow(threadId: string) {
    return db
      .prepare<[string], { saved_at: number | null }>(
        "SELECT saved_at FROM saved_threads WHERE thread_id = ?",
      )
      .get(threadId);
  }

  async function save(thread: SaveRequest): Promise<void> {
    db.prepare(
      `INSERT INTO saved_threads
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
        "DELETE FROM saved_threads WHERE thread_id = ? AND saved_at IS NULL",
      ).run(thread.id);
      throw error;
    }
    changed();
  }

  async function writeFile(threadId: string): Promise<void> {
    try {
      const file = await bb.sdk.threads.experimental_export({ threadId });
      db.prepare(
        `UPDATE saved_threads SET file = ?, file_bytes = ?, saved_at = ?
         WHERE thread_id = ? AND saved_at IS NULL`,
      ).run(Buffer.from(file), file.byteLength, Date.now(), threadId);
      changed();
    } catch (error) {
      bb.log.warn(
        `Could not save thread ${threadId} to a file yet: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      exporting.delete(threadId);
    }
  }

  function beforePurge(
    context: ThreadPurgeHookContext,
  ): ThreadPurgeHookDecision {
    const row = pendingRow(context.threadId);
    if (row === undefined || row.saved_at !== null)
      return { action: "proceed" };
    if (!exporting.has(context.threadId)) {
      exporting.add(context.threadId);
      void writeFile(context.threadId);
    }
    return { action: "wait" };
  }

  async function dropAbandonedSaves(): Promise<void> {
    const pending = db
      .prepare<[], { thread_id: string }>(
        "SELECT thread_id FROM saved_threads WHERE saved_at IS NULL",
      )
      .all()
      .map((row) => row.thread_id)
      .filter((threadId) => !exporting.has(threadId));
    if (pending.length === 0) return;
    const threads = await readThreadsById(bb, pending);
    const remove = db.prepare(
      "DELETE FROM saved_threads WHERE thread_id = ? AND saved_at IS NULL",
    );
    let dropped = 0;
    for (const threadId of pending) {
      const thread = threads.get(threadId);
      if (thread !== undefined && thread.deletedAt !== null) continue;
      if (thread === undefined) {
        bb.log.warn(
          `Thread ${threadId} was removed before it could be saved to a file`,
        );
      }
      dropped += remove.run(threadId).changes;
    }
    if (dropped > 0) changed();
  }

  function list(args: {
    projectId: string | null;
    search: string | null;
    limit: number;
    offset: number;
  }): SavedThreadList {
    const rows = db
      .prepare<
        [
          string | null,
          string | null,
          string | null,
          string | null,
          number,
          number,
        ],
        SavedThreadRow
      >(
        `SELECT ${LISTED_COLUMNS} FROM saved_threads
         WHERE (? IS NULL OR project_id = ?)
           AND (? IS NULL OR title LIKE '%' || ? || '%')
         ORDER BY saved_at IS NOT NULL, saved_at DESC, thread_id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(
        args.projectId,
        args.projectId,
        args.search,
        args.search,
        args.limit + 1,
        args.offset,
      );
    return {
      savedThreads: rows.slice(0, args.limit).map(toSavedThread),
      hasMore: rows.length > args.limit,
    };
  }

  function savedFile(threadId: string): Uint8Array {
    const row = db
      .prepare<[string], { file: Buffer | null }>(
        "SELECT file FROM saved_threads WHERE thread_id = ? AND saved_at IS NOT NULL",
      )
      .get(threadId);
    if (row?.file == null) {
      throw new Error(`Thread ${threadId} isn't saved to a file.`);
    }
    return new Uint8Array(row.file);
  }

  async function restore(threadId: string) {
    const result = await bb.sdk.threads.experimental_import({
      file: savedFile(threadId),
    });
    db.prepare("DELETE FROM saved_threads WHERE thread_id = ?").run(threadId);
    changed();
    return result;
  }

  function remove(threadId: string): { ok: true } {
    const deleted = db
      .prepare(
        "DELETE FROM saved_threads WHERE thread_id = ? AND saved_at IS NOT NULL",
      )
      .run(threadId).changes;
    if (deleted === 0) {
      throw new Error(`Thread ${threadId} isn't saved to a file.`);
    }
    changed();
    return { ok: true };
  }

  return {
    beforePurge,
    dropAbandonedSaves,
    list,
    remove,
    restore,
    save,
    savedFile,
  };
}

export type ColdStorage = ReturnType<typeof createColdStorage>;
