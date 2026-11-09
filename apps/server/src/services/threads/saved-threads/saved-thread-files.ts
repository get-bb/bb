import { rm } from "node:fs/promises";
import {
  deleteSavedThread,
  getThread,
  hideThreadForSaving,
  insertThreadHistoryRows,
  requestThreadPurge,
  listSavedThreadIds,
  listSavedThreadsInStates,
  updateSavedThreadInState,
  type DbConnection,
  type ThreadHistoryEventRow,
} from "@bb/db";
import type { AppDeps } from "../../../types.js";
import {
  listSavedThreadFiles,
  readThreadFileFrame,
  removeSavedThreadFile,
  savedThreadFileExists,
  type OpenThreadFile,
} from "./thread-file.js";

export type SavedThreadDeps = Pick<AppDeps, "config" | "db" | "hub" | "logger">;

const INSERT_BATCH_ROWS = 16;
const INSERT_BATCH_BYTES = 64 * 1024;
const INSERT_SLICE_MS = 8;

const heldByDb = new WeakMap<DbConnection, Map<string, number>>();

export function holdSavedThread(
  db: DbConnection,
  threadId: string,
): () => void {
  let held = heldByDb.get(db);
  if (held === undefined) {
    held = new Map();
    heldByDb.set(db, held);
  }
  const holds = held;
  holds.set(threadId, (holds.get(threadId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (holds.get(threadId) ?? 1) - 1;
    if (remaining === 0) holds.delete(threadId);
    else holds.set(threadId, remaining);
  };
}

export function isSavedThreadHeld(db: DbConnection, threadId: string): boolean {
  return heldByDb.get(db)?.has(threadId) ?? false;
}

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function insertBatches(
  rows: readonly ThreadHistoryEventRow[],
): ThreadHistoryEventRow[][] {
  const batches: ThreadHistoryEventRow[][] = [];
  let batch: ThreadHistoryEventRow[] = [];
  let bytes = 0;
  for (const row of rows) {
    const rowBytes = Buffer.byteLength(row.data);
    if (
      batch.length > 0 &&
      (batch.length >= INSERT_BATCH_ROWS ||
        bytes + rowBytes > INSERT_BATCH_BYTES)
    ) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(row);
    bytes += rowBytes;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

export async function insertInSlices<T>(
  deps: Pick<AppDeps, "db">,
  items: readonly T[],
  insert: (
    tx: Parameters<Parameters<AppDeps["db"]["transaction"]>[0]>[0],
    item: T,
  ) => number,
): Promise<number> {
  let index = 0;
  let total = 0;
  while (index < items.length) {
    const startedAt = performance.now();
    total += deps.db.transaction(
      (tx) => {
        let inserted = 0;
        do {
          const item = items[index];
          index += 1;
          if (item !== undefined) inserted += insert(tx, item);
        } while (
          index < items.length &&
          performance.now() - startedAt < INSERT_SLICE_MS
        );
        return inserted;
      },
      { behavior: "immediate" },
    );
    await yieldToEventLoop();
  }
  return total;
}

export async function insertThreadFileEvents(
  deps: Pick<AppDeps, "db">,
  file: OpenThreadFile,
): Promise<number> {
  let inserted = 0;
  for (const entry of file.table.frames) {
    if (entry.rows === 0) continue;
    const frame = await readThreadFileFrame(file, entry);
    const now = Date.now();
    inserted += await insertInSlices(
      deps,
      insertBatches(frame.rows),
      (tx, rows) => {
        const eventIds = new Set(rows.map((row) => row.id));
        return insertThreadHistoryRows(tx, {
          now,
          retained: frame.retained.filter((output) =>
            eventIds.has(output.eventId),
          ),
          rows,
        });
      },
    );
  }
  return inserted;
}

export async function removeOrphanedSavedThreadFiles(
  deps: Pick<AppDeps, "config" | "db">,
): Promise<number> {
  const known = listSavedThreadIds(deps.db);
  let removed = 0;
  for (const file of await listSavedThreadFiles(deps.config.dataDir)) {
    if (known.has(file.threadId)) continue;
    await rm(file.path, { force: true });
    removed += 1;
  }
  return removed;
}

export async function reconcileSavedThreads(
  deps: Pick<AppDeps, "config" | "db">,
): Promise<void> {
  for (const saved of listSavedThreadsInStates(deps.db, ["saving"])) {
    await removeSavedThreadFile(deps.config.dataDir, saved.threadId);
  }
  for (const saved of listSavedThreadsInStates(deps.db, ["restoring"])) {
    if (!(await savedThreadFileExists(deps.config.dataDir, saved.threadId))) {
      deleteSavedThread(deps.db, saved.threadId);
      continue;
    }
    deps.db.transaction(
      (tx) => {
        const now = Date.now();
        if (getThread(tx, saved.threadId) !== null) {
          hideThreadForSaving(tx, { now, threadId: saved.threadId });
          requestThreadPurge(tx, { now, threadId: saved.threadId });
        }
        updateSavedThreadInState(tx, {
          expectedState: "restoring",
          patch: { state: "saved", updatedAt: now },
          threadId: saved.threadId,
        });
      },
      { behavior: "immediate" },
    );
  }
  await removeOrphanedSavedThreadFiles(deps);
}
