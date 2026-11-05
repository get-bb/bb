import { stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import {
  countThreadEventsChunk,
  countThreadSearchSegments,
  getDatabaseAutoVacuumMode,
  getDatabaseFreelistStats,
  listThreadHistoryEntries,
  readDatabaseFilePath,
  type DbConnection,
} from "@bb/db";
import type { StorageDatabaseResponse } from "@bb/server-contract";

export const THREAD_HISTORY_THREAD_PAGE_SIZE = 500;
export const THREAD_HISTORY_EVENT_CHUNK_SIZE = 1_024;
const THREAD_HISTORY_SLICE_MS = 6;

type ThreadHistory = StorageDatabaseResponse["history"];

function emptyThreadHistory(): ThreadHistory {
  return {
    active: { threads: 0, events: 0, searchSegments: 0 },
    archived: { threads: 0, events: 0, searchSegments: 0 },
    deleted: { threads: 0, events: 0, searchSegments: 0 },
  };
}

function createSlice() {
  let startedAt = performance.now();
  return async () => {
    if (performance.now() - startedAt < THREAD_HISTORY_SLICE_MS) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
    startedAt = performance.now();
  };
}

async function walFileSize(path: string): Promise<number> {
  try {
    return (await stat(`${path}-wal`)).size;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return 0;
    throw error;
  }
}

async function countThreadHistory(db: DbConnection): Promise<ThreadHistory> {
  const history = emptyThreadHistory();
  const yieldIfDue = createSlice();
  let afterThreadId: string | null = null;
  for (;;) {
    const entries = listThreadHistoryEntries(db, {
      afterThreadId,
      limit: THREAD_HISTORY_THREAD_PAGE_SIZE,
    });
    await yieldIfDue();
    for (const entry of entries) {
      const rows = history[entry.state];
      rows.threads += 1;
      rows.searchSegments += countThreadSearchSegments(db, entry.id);
      await yieldIfDue();
      let afterSequence: number | null = null;
      for (;;) {
        const chunk = countThreadEventsChunk(db, {
          afterSequence,
          limit: THREAD_HISTORY_EVENT_CHUNK_SIZE,
          threadId: entry.id,
        });
        rows.events += chunk.count;
        await yieldIfDue();
        if (chunk.count < THREAD_HISTORY_EVENT_CHUNK_SIZE) break;
        afterSequence = chunk.lastSequence;
      }
    }
    const last = entries.at(-1);
    if (last === undefined) return history;
    afterThreadId = last.id;
  }
}

export async function readDatabaseStorage(
  db: DbConnection,
): Promise<StorageDatabaseResponse> {
  const path = readDatabaseFilePath(db);
  if (path === null) throw new Error("The database is not stored in a file");
  const measuredAt = Date.now();
  const header = getDatabaseFreelistStats(db);
  const autoVacuum = getDatabaseAutoVacuumMode(db);
  const history = await countThreadHistory(db);
  const [file, walBytes] = await Promise.all([stat(path), walFileSize(path)]);
  return {
    measuredAt,
    database: {
      path,
      fileBytes: file.size,
      walBytes,
      pageSize: header.pageSize,
      pageCount: header.pageCount,
      freelistPages: header.freelistCount,
      reclaimableBytes: header.freelistBytes,
      autoVacuum,
    },
    history,
  };
}
