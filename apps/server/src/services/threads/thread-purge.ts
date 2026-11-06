import {
  deleteThread,
  deleteThreadPurgeBatch,
  isThreadPurgeRequested,
  nextThreadPurge,
} from "@bb/db";
import type { AppDeps } from "../../types.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { defineScanSweep, type ItemSweep } from "../system/item-sweep.js";
import { startPacedRun } from "../system/paced-run.js";

const PURGE_EVENT_ROWS = 64;
const PURGE_EVENT_BYTES = 512 * 1024;
const PURGE_ROWS = 128;

type ThreadPurgeDeps = Pick<AppDeps, "db" | "hub" | "logger">;

function purgeThreadBatch(deps: ThreadPurgeDeps, threadId: string): boolean {
  const notifications = new NotificationBuffer();
  const finished = deps.db.transaction(
    (tx) => {
      if (!isThreadPurgeRequested(tx, threadId)) return true;
      const deleted = deleteThreadPurgeBatch(tx, {
        maxEventBytes: PURGE_EVENT_BYTES,
        maxEventRows: PURGE_EVENT_ROWS,
        maxRows: PURGE_ROWS,
        threadId,
      });
      if (deleted > 0) return false;
      deleteThread(tx, notifications, threadId);
      return true;
    },
    { behavior: "immediate" },
  );
  notifications.flushInto(deps.hub);
  return finished;
}

export function threadPurgeSweep(deps: ThreadPurgeDeps): ItemSweep {
  const paced = startPacedRun(deps);
  return defineScanSweep<string>({
    name: "thread-purge",
    concurrency: 1,
    list: ({ excludedKeys }) => {
      if (!paced.mayContinue()) return [];
      const threadId = nextThreadPurge(deps.db, {
        excludedThreadIds: excludedKeys,
      });
      return threadId === null ? [] : [threadId];
    },
    key: (threadId) => threadId,
    process: async (threadId) => {
      await paced.run(() => purgeThreadBatch(deps, threadId));
    },
  });
}
