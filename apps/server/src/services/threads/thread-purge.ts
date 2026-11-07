import {
  deleteThread,
  deleteThreadPurgeBatch,
  listRunningThreads,
  nextThreadPurge,
} from "@bb/db";
import type { AppDeps } from "../../types.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { isServerMoveFrozen } from "../server-move/freeze-state.js";
import { defineScanSweep, type ItemSweep } from "../system/item-sweep.js";

const THREAD_PURGE_SLICE_MS = 10;
const THREAD_PURGE_RUN_BUDGET_MS = 30_000;
const BUSY_REST_FACTOR = 9;
const IDLE_REST_FACTOR = 1;
const PURGE_EVENT_ROWS = 64;
const PURGE_EVENT_BYTES = 512 * 1024;
const PURGE_ROWS = 128;
const STEP_COST_SMOOTHING = 0.2;

type ThreadPurgeDeps = Pick<AppDeps, "db" | "hub" | "logger">;

function purgeThreadBatch(deps: ThreadPurgeDeps, threadId: string): boolean {
  const notifications = new NotificationBuffer();
  let finished = false;
  deps.db.transaction(
    (tx) => {
      const deleted = deleteThreadPurgeBatch(tx, {
        maxEventBytes: PURGE_EVENT_BYTES,
        maxEventRows: PURGE_EVENT_ROWS,
        maxRows: PURGE_ROWS,
        threadId,
      });
      if (deleted > 0) return;
      deleteThread(tx, notifications, threadId);
      finished = true;
    },
    { behavior: "immediate" },
  );
  notifications.flushInto(deps.hub);
  return finished;
}

export function threadPurgeSweep(deps: ThreadPurgeDeps): ItemSweep {
  const startedAt = performance.now();
  const mayContinue = () =>
    performance.now() - startedAt < THREAD_PURGE_RUN_BUDGET_MS &&
    !isServerMoveFrozen(deps.db);
  let stepCostMs = 0;
  let resumeAt = 0;
  return defineScanSweep<string>({
    name: "thread-purge",
    concurrency: 1,
    list: ({ excludedKeys }) => {
      if (!mayContinue()) return [];
      const threadId = nextThreadPurge(deps.db, {
        excludedThreadIds: excludedKeys,
      });
      return threadId === null ? [] : [threadId];
    },
    key: (threadId) => threadId,
    process: async (threadId) => {
      for (;;) {
        const restMs = resumeAt - performance.now();
        if (restMs > 0)
          await new Promise<void>((resolve) => setTimeout(resolve, restMs));
        if (!mayContinue()) return;
        const sliceStartedAt = performance.now();
        let finished = false;
        do {
          const stepStartedAt = performance.now();
          finished = purgeThreadBatch(deps, threadId);
          stepCostMs +=
            STEP_COST_SMOOTHING *
            (performance.now() - stepStartedAt - stepCostMs);
        } while (
          !finished &&
          performance.now() - sliceStartedAt + stepCostMs <=
            THREAD_PURGE_SLICE_MS
        );
        const busy =
          deps.hub.hasClients() || listRunningThreads(deps.db).length > 0;
        const workedMs = performance.now() - sliceStartedAt;
        resumeAt =
          performance.now() +
          Math.max(1, workedMs * (busy ? BUSY_REST_FACTOR : IDLE_REST_FACTOR));
        if (finished) return;
      }
    },
  });
}
