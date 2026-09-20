import { performance } from "node:perf_hooks";
import {
  advanceThreadPruning,
  getNextThreadPruningPolicy,
  getDatabaseMaintenanceActivity,
  isDatabaseMaintenanceIdle,
  THREAD_PRUNING_POLICIES,
} from "@bb/db";
import type { AppDeps } from "../../types.js";

export interface ThreadPruningSweepLimits {
  elapsedBudgetMs: number;
  maxAdvances: number;
}

export const THREAD_PRUNING_SWEEP_LIMITS: ThreadPruningSweepLimits = {
  elapsedBudgetMs: 50,
  maxAdvances: 64,
};

export async function runThreadPruningSweep(
  deps: Pick<AppDeps, "db" | "hub" | "logger">,
  limits: ThreadPruningSweepLimits,
): Promise<void> {
  const startedAt = performance.now();
  const completed = new Set<string>();
  let advances = 0;
  let removed = 0;
  let scanned = 0;
  let removedBytes = 0;
  let maxAdvanceMs = 0;
  let reason = "budget";
  try {
    while (
      advances < limits.maxAdvances &&
      performance.now() - startedAt < limits.elapsedBudgetMs &&
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
      const advanceStartedAt = performance.now();
      const result = advanceThreadPruning(deps.db, policy);
      const advanceElapsedMs = performance.now() - advanceStartedAt;
      maxAdvanceMs = Math.max(maxAdvanceMs, advanceElapsedMs);
      if (advanceElapsedMs >= 50)
        deps.logger.warn(
          { ...result, advanceElapsedMs },
          "Slow thread pruning advance",
        );
      advances += 1;
      scanned += result.scanned;
      removed += result.removed;
      removedBytes += result.removedBytes;
      if (result.removed > 0 && result.threadId !== null)
        deps.hub.notifyThread(result.threadId, ["history-rewritten"]);
      deps.logger.debug(
        { ...result, advanceElapsedMs },
        "Thread pruning policy advanced",
      );
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
        maxAdvanceMs,
        reason,
        elapsedMs: performance.now() - startedAt,
      },
      "Thread pruning sweep finished",
    );
  }
}
