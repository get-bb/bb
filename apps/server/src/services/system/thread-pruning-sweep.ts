import { performance } from "node:perf_hooks";
import {
  advanceThreadPruning,
  getNextThreadPruningPolicy,
  pickThreadPruningThread,
  type THREAD_PRUNING_POLICIES,
} from "@bb/db";
import type { AppDeps } from "../../types.js";
import { defineScanSweep, type ItemSweep } from "./item-sweep.js";

export interface ThreadPruningSweepLimits {
  elapsedBudgetMs: number;
  maxAdvances: number;
}

export const THREAD_PRUNING_SWEEP_LIMITS: ThreadPruningSweepLimits = {
  elapsedBudgetMs: 50,
  maxAdvances: 64,
};

interface ThreadPruningItem {
  policy: (typeof THREAD_PRUNING_POLICIES)[number];
  threadId: string;
}

function pruningItemKey(item: ThreadPruningItem): string {
  return `${item.policy}:${item.threadId}`;
}

export function threadPruningSweep(
  deps: Pick<AppDeps, "db" | "hub" | "logger">,
  limits: ThreadPruningSweepLimits,
): ItemSweep {
  const startedAt = performance.now();
  let advances = 0;
  const withinBudget = () =>
    advances < limits.maxAdvances &&
    performance.now() - startedAt < limits.elapsedBudgetMs;
  const finishedPolicies = new Set<string>();
  return defineScanSweep<ThreadPruningItem>({
    name: "thread-event-pruning",
    concurrency: 1,
    list: ({ excludedKeys }) => {
      const items: ThreadPruningItem[] = [];
      if (!withinBudget()) return items;
      const visited = new Set<string>(finishedPolicies);
      for (
        let policy = getNextThreadPruningPolicy(deps.db, visited);
        policy !== null;
        policy = getNextThreadPruningPolicy(deps.db, visited)
      ) {
        visited.add(policy);
        const prefix = `${policy}:`;
        const excludedThreadIds = new Set(
          [...excludedKeys]
            .filter((itemKey) => itemKey.startsWith(prefix))
            .map((itemKey) => itemKey.slice(prefix.length)),
        );
        const threadId = pickThreadPruningThread(deps.db, {
          excludedThreadIds,
          policy,
        });
        if (threadId === null) finishedPolicies.add(policy);
        else items.push({ policy, threadId });
      }
      return items;
    },
    key: pruningItemKey,
    process: async (item) => {
      let removed = 0;
      try {
        while (withinBudget()) {
          const advanceStartedAt = performance.now();
          const result = advanceThreadPruning(deps.db, item.policy);
          const advanceElapsedMs = performance.now() - advanceStartedAt;
          advances += 1;
          removed += result.removed;
          if (advanceElapsedMs >= 50)
            deps.logger.warn(
              { ...result, advanceElapsedMs },
              "Slow thread pruning advance",
            );
          deps.logger.debug(
            { ...result, advanceElapsedMs },
            "Thread pruning policy advanced",
          );
          if (result.threadId !== item.threadId || result.action !== "advanced")
            return;
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      } finally {
        if (removed > 0)
          deps.hub.notifyThread(item.threadId, ["history-compacted"]);
      }
    },
  });
}
