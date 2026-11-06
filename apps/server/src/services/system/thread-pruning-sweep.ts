import { performance } from "node:perf_hooks";
import {
  advanceThreadPruningPolicy,
  deleteSweepItemFailures,
  getNextThreadPruningPolicy,
  listExistingThreadIds,
  listSweepItemFailures,
  skipThreadPruningThread,
  ThreadPruningAdvanceError,
  THREAD_PRUNING_POLICIES,
} from "@bb/db";
import type { AppDeps } from "../../types.js";
import { clearSweepFailure, recordSweepFailure } from "./item-sweep.js";

const THREAD_PRUNING_SWEEP = "thread-event-pruning";

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
  now: number,
): Promise<void> {
  const startedAt = performance.now();
  const failures = new Map(
    listSweepItemFailures(deps.db, THREAD_PRUNING_SWEEP).map((failure) => [
      failure.itemKey,
      failure,
    ]),
  );
  const threadFailures = [...failures.values()].flatMap((failure) => {
    const [policy, threadId] = failure.itemKey.split(":");
    return policy === undefined || threadId === undefined
      ? []
      : [{ failure, policy, threadId }];
  });
  const existing = new Set(
    listExistingThreadIds(
      deps.db,
      threadFailures.map(({ threadId }) => threadId),
    ),
  );
  const goneKeys = threadFailures
    .filter(({ threadId }) => !existing.has(threadId))
    .map(({ failure }) => failure.itemKey);
  deleteSweepItemFailures(deps.db, {
    itemKeys: goneKeys,
    sweep: THREAD_PRUNING_SWEEP,
  });
  for (const itemKey of goneKeys) failures.delete(itemKey);
  const completed = new Set<string>();
  const excluded = new Set(
    [...failures.values()]
      .filter(
        (failure) => failure.retryAt > now && !failure.itemKey.includes(":"),
      )
      .map((failure) => failure.itemKey),
  );
  const excludedThreadIdsByPolicy = new Map<string, Set<string>>();
  const excludeThread = (policy: string, threadId: string) => {
    const threadIds =
      excludedThreadIdsByPolicy.get(policy) ?? new Set<string>();
    threadIds.add(threadId);
    excludedThreadIdsByPolicy.set(policy, threadIds);
  };
  for (const { failure, policy, threadId } of threadFailures) {
    if (failure.retryAt > now) excludeThread(policy, threadId);
  }
  const compactedThreadIds = new Set<string>();
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
      excluded.size < THREAD_PRUNING_POLICIES.length
    ) {
      const policy = getNextThreadPruningPolicy(deps.db, excluded);
      if (policy === null) break;
      const advanceStartedAt = performance.now();
      let result: ReturnType<typeof advanceThreadPruningPolicy>;
      try {
        result = advanceThreadPruningPolicy(deps.db, {
          excludedThreadIds: excludedThreadIdsByPolicy.get(policy) ?? new Set(),
          policy,
        });
      } catch (error) {
        const failedThreadId =
          error instanceof ThreadPruningAdvanceError ? error.threadId : null;
        if (failedThreadId !== null) {
          skipThreadPruningThread(deps.db, {
            policy,
            threadId: failedThreadId,
          });
          excludeThread(policy, failedThreadId);
        }
        recordSweepFailure(deps, {
          error,
          itemKey:
            failedThreadId === null ? policy : `${policy}:${failedThreadId}`,
          now,
          sweep: THREAD_PRUNING_SWEEP,
        });
        if (failedThreadId === null) excluded.add(policy);
        advances += 1;
        continue;
      }
      const recovered = [
        policy,
        ...(result.action === "thread-complete" && result.threadId !== null
          ? [`${policy}:${result.threadId}`]
          : []),
      ];
      for (const itemKey of recovered) {
        if (failures.delete(itemKey)) {
          clearSweepFailure(deps, { itemKey, sweep: THREAD_PRUNING_SWEEP });
        }
      }
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
        compactedThreadIds.add(result.threadId);
      deps.logger.debug(
        { ...result, advanceElapsedMs },
        "Thread pruning policy advanced",
      );
      if (result.action === "cycle-complete") {
        completed.add(policy);
        excluded.add(policy);
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    if (completed.size === THREAD_PRUNING_POLICIES.length)
      reason = "cycle-complete";
  } catch (error) {
    reason = "failed";
    throw error;
  } finally {
    for (const threadId of compactedThreadIds)
      deps.hub.notifyThread(threadId, ["history-compacted"]);
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
