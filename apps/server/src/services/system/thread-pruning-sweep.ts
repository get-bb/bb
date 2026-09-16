import { performance } from "node:perf_hooks";
import {
  advanceThreadPruning,
  getNextThreadPruningPolicy,
  getDatabaseMaintenanceActivity,
  isDatabaseMaintenanceIdle,
  THREAD_PRUNING_POLICIES,
} from "@bb/db";
import type { AppDeps } from "../../types.js";

export async function runThreadPruningSweep(
  deps: Pick<AppDeps, "db" | "hub" | "logger">,
): Promise<void> {
  const startedAt = performance.now();
  const completed = new Set<string>();
  let advances = 0;
  let removed = 0;
  let scanned = 0;
  let removedBytes = 0;
  let reason = "budget";
  try {
    while (
      advances < 64 &&
      performance.now() - startedAt < 50 &&
      completed.size < THREAD_PRUNING_POLICIES.length
    ) {
      const activity = getDatabaseMaintenanceActivity(deps.db);
      if (!isDatabaseMaintenanceIdle(activity)) {
        reason = "busy";
        deps.logger.debug(
          { activity, advances },
          "Thread pruning skipped while app work is active",
        );
        break;
      }
      const policy = getNextThreadPruningPolicy(deps.db, completed);
      if (policy === null) break;
      const result = advanceThreadPruning(deps.db, policy);
      advances += 1;
      scanned += result.scanned;
      removed += result.removed;
      removedBytes += result.removedBytes;
      if (result.removed > 0 && result.threadId !== null)
        deps.hub.notifyThread(result.threadId, ["history-rewritten"]);
      deps.logger.debug({ ...result }, "Thread pruning policy advanced");
      if (result.action === "cycle-complete") completed.add(policy);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    if (completed.size === THREAD_PRUNING_POLICIES.length)
      reason = "cycle-complete";
  } catch (error) {
    reason = "failed";
    throw error;
  } finally {
    deps.logger.debug(
      {
        advances,
        removed,
        scanned,
        removedBytes,
        reason,
        elapsedMs: performance.now() - startedAt,
      },
      "Thread pruning sweep finished",
    );
  }
}
