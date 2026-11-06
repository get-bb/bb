import {
  THREAD_FILE_FORMAT_VERSION,
  deleteSavedThread,
  getExperiments,
  getLatestThreadSequence,
  getSavedThread,
  getThread,
  hideThreadForSaving,
  isThreadSavable,
  nextThreadSave,
  requestThreadPurge,
  updateSavedThreadInState,
  upsertSavedThread,
  type DbConnection,
  type SavedThread,
} from "@bb/db";
import { defineScanSweep, type ItemSweep } from "../../system/item-sweep.js";
import { startPacedRun } from "../../system/paced-run.js";
import {
  openThreadFile,
  removeSavedThreadFile,
  savedThreadFilePath,
  verifyThreadFileFrame,
  type ThreadFileFrameEntry,
} from "./thread-file.js";
import {
  isSavedThreadHeld,
  type SavedThreadDeps,
} from "./saved-thread-files.js";
import { ThreadFileExport } from "./thread-transfer.js";

type ThreadRow = NonNullable<ReturnType<typeof getThread>>;

interface ExportTask {
  exporter: ThreadFileExport;
  kind: "export";
  throughSequence: number | null;
}

interface VerifyTask {
  frameIndex: number;
  frames: ThreadFileFrameEntry[];
  kind: "verify";
  packedBytes: number;
  rawBytes: number;
  rows: number;
  throughSequence: number | null;
  verifiedRows: number;
}

type SaveTask = ExportTask | VerifyTask;

class SaveAbandoned extends Error {}

const activeSavesByDb = new WeakMap<DbConnection, Map<string, SaveTask>>();

function activeSaves(db: DbConnection): Map<string, SaveTask> {
  let saves = activeSavesByDb.get(db);
  if (saves === undefined) {
    saves = new Map();
    activeSavesByDb.set(db, saves);
  }
  return saves;
}

function savingRow(
  thread: ThreadRow,
  args: {
    now: number;
    previous: SavedThread | null;
    throughSequence: number | null;
  },
): SavedThread {
  return {
    archivedAt: thread.archivedAt,
    formatVersion: THREAD_FILE_FORMAT_VERSION,
    packedBytes: 0,
    projectId: thread.projectId,
    providerId: thread.providerId,
    rawBytes: 0,
    restoredAt: args.previous?.restoredAt ?? null,
    rowCount: 0,
    savedAt: null,
    state: "saving",
    threadCreatedAt: thread.createdAt,
    threadId: thread.id,
    throughSequence: args.throughSequence ?? 0,
    title: thread.title ?? thread.titleFallback,
    updatedAt: args.now,
  };
}

export function isThreadSavableNow(
  deps: Pick<SavedThreadDeps, "db" | "hub">,
  threadId: string,
  inProgress: boolean,
): boolean {
  return (
    !isSavedThreadHeld(deps.db, threadId) &&
    deps.hub.listThreadTimelineTags(threadId).size === 0 &&
    isThreadSavable(deps.db, { inProgress, threadId })
  );
}

export function requestThreadSave(
  deps: Pick<SavedThreadDeps, "db">,
  thread: ThreadRow,
): SavedThread {
  const row = savingRow(thread, {
    now: Date.now(),
    previous: getSavedThread(deps.db, thread.id),
    throughSequence: getLatestThreadSequence(deps.db, { threadId: thread.id }),
  });
  upsertSavedThread(deps.db, row);
  return row;
}

async function dropTask(
  deps: SavedThreadDeps,
  threadId: string,
): Promise<void> {
  const saves = activeSaves(deps.db);
  const task = saves.get(threadId);
  saves.delete(threadId);
  if (task?.kind === "export") await task.exporter.abort();
  await removeSavedThreadFile(deps.config.dataDir, threadId);
}

async function abandonSave(
  deps: SavedThreadDeps,
  threadId: string,
  reason: string,
): Promise<void> {
  await dropTask(deps, threadId);
  const saved = getSavedThread(deps.db, threadId);
  if (saved?.state === "saving") {
    if (saved.restoredAt === null) {
      deleteSavedThread(deps.db, threadId);
    } else {
      updateSavedThreadInState(deps.db, {
        expectedState: "saving",
        patch: { state: "restored", updatedAt: Date.now() },
        threadId,
      });
    }
  }
  deps.logger.debug({ reason, threadId }, "Thread save abandoned");
}

async function startTask(
  deps: SavedThreadDeps,
  threadId: string,
): Promise<SaveTask> {
  const thread = getThread(deps.db, threadId);
  if (thread === null) throw new SaveAbandoned("Thread no longer exists");
  const throughSequence = getLatestThreadSequence(deps.db, { threadId });
  const exporter = await ThreadFileExport.start(deps, {
    path: savedThreadFilePath(deps.config.dataDir, threadId),
    threadId,
    throughSequence,
  });
  if (exporter === null) throw new SaveAbandoned("Thread has nothing to save");
  upsertSavedThread(
    deps.db,
    savingRow(thread, {
      now: Date.now(),
      previous: getSavedThread(deps.db, threadId),
      throughSequence,
    }),
  );
  return { exporter, kind: "export", throughSequence };
}

async function advanceTask(
  deps: SavedThreadDeps,
  threadId: string,
  task: SaveTask,
): Promise<SaveTask | null> {
  if (!isThreadSavableNow(deps, threadId, true)) {
    throw new SaveAbandoned("Thread is no longer eligible for saving");
  }
  if (task.kind === "export") {
    if (await task.exporter.step()) return task;
    const sealed = await task.exporter.seal();
    const file = await openThreadFile(
      savedThreadFilePath(deps.config.dataDir, threadId),
    );
    const frames = file.table.frames;
    await file.close();
    return {
      frameIndex: 0,
      frames,
      kind: "verify",
      packedBytes: sealed.packedBytes,
      rawBytes: sealed.rawBytes,
      rows: sealed.rows,
      throughSequence: task.throughSequence,
      verifiedRows: 0,
    };
  }
  const entry = task.frames[task.frameIndex];
  if (entry === undefined) {
    if (task.verifiedRows !== task.rows) {
      throw new Error("Thread file row count mismatch");
    }
    return null;
  }
  const file = await openThreadFile(
    savedThreadFilePath(deps.config.dataDir, threadId),
  );
  try {
    const rows = await verifyThreadFileFrame(file, entry);
    if (rows !== entry.rows) {
      throw new Error("Thread file frame row count mismatch");
    }
    task.verifiedRows += rows;
  } finally {
    await file.close();
  }
  task.frameIndex += 1;
  return task;
}

function finishSave(
  deps: SavedThreadDeps,
  threadId: string,
  task: VerifyTask,
): void {
  const now = Date.now();
  const thread = getThread(deps.db, threadId);
  const saved = deps.db.transaction(
    (tx) => {
      if (getLatestThreadSequence(tx, { threadId }) !== task.throughSequence) {
        return false;
      }
      if (
        !updateSavedThreadInState(tx, {
          expectedState: "saving",
          patch: {
            packedBytes: task.packedBytes,
            rawBytes: task.rawBytes,
            rowCount: task.rows,
            savedAt: now,
            state: "saved",
            updatedAt: now,
          },
          threadId,
        })
      ) {
        return false;
      }
      hideThreadForSaving(tx, { now, threadId });
      requestThreadPurge(tx, { now, threadId });
      return true;
    },
    { behavior: "immediate" },
  );
  if (!saved) throw new SaveAbandoned("Thread changed while it was saved");
  activeSaves(deps.db).delete(threadId);
  if (thread !== null) {
    deps.hub.notifyThread(threadId, ["thread-deleted"], {
      projectId: thread.projectId,
    });
    deps.hub.notifyProject(thread.projectId, ["threads-changed"]);
  }
  deps.logger.info({ threadId }, "Thread saved to file");
}

async function saveThread(
  deps: SavedThreadDeps,
  paced: ReturnType<typeof startPacedRun>,
  threadId: string,
): Promise<void> {
  try {
    if (!getExperiments(deps.db).savedThreads) {
      throw new SaveAbandoned("The saved threads experiment is off");
    }
    if (getSavedThread(deps.db, threadId)?.state !== "saving") {
      await dropTask(deps, threadId);
      return;
    }
    const saves = activeSaves(deps.db);
    let task = saves.get(threadId) ?? (await startTask(deps, threadId));
    saves.set(threadId, task);
    const finished = await paced.run(async () => {
      const next = await advanceTask(deps, threadId, task);
      if (next === null) return true;
      task = next;
      saves.set(threadId, next);
      return false;
    });
    if (!finished || task.kind !== "verify") return;
    finishSave(deps, threadId, task);
  } catch (error) {
    if (error instanceof SaveAbandoned) {
      await abandonSave(deps, threadId, error.message);
      return;
    }
    await dropTask(deps, threadId);
    throw error;
  }
}

export function threadSaveSweep(deps: SavedThreadDeps): ItemSweep {
  const paced = startPacedRun(deps);
  return defineScanSweep<string>({
    name: "thread-save",
    concurrency: 1,
    list: ({ excludedKeys }) => {
      if (!paced.mayContinue()) return [];
      const threadId = nextThreadSave(deps.db, {
        excludedThreadIds: excludedKeys,
      });
      return threadId === null ? [] : [threadId];
    },
    key: (threadId) => threadId,
    process: (threadId) => saveThread(deps, paced, threadId),
  });
}
