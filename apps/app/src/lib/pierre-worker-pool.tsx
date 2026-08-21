import {
  getOrCreateWorkerPoolSingleton,
  terminateWorkerPoolSingleton,
  type WorkerPoolManager,
} from "@pierre/diffs/worker";
import { createDiffWorker, getDiffWorkerPoolSize } from "./diff-worker-pool";
import {
  useSyncPierreWorkerPoolTheme,
  type CodeThemePair,
} from "./pierre-worker-pool-theme";

/**
 * The lazily loaded half of the workspace worker-pool provider. It is the
 * only module that constructs the pool, so `@pierre/diffs`'s pool manager and
 * the Shiki engine behind it stay out of the route closure until a diff asks
 * for them (see `pierre-worker-pool-gate.ts`).
 */
const WORKER_POOL_OPTIONS = {
  workerFactory: createDiffWorker,
  poolSize: getDiffWorkerPoolSize(),
};

/**
 * Constructing the manager spawns every worker at once, so call this only
 * after a diff consumer asked for the pool. Pierre keeps one page-wide
 * singleton; a manager that already exists is reused as is.
 */
export function acquirePierreWorkerPool(
  theme: CodeThemePair,
): WorkerPoolManager {
  return getOrCreateWorkerPoolSingleton({
    poolOptions: WORKER_POOL_OPTIONS,
    highlighterOptions: { theme },
  });
}

export function releasePierreWorkerPool(): void {
  terminateWorkerPoolSingleton();
}

export function PierreWorkerPoolThemeSync({
  pool,
  constructedTheme,
}: {
  pool: WorkerPoolManager;
  constructedTheme: CodeThemePair;
}) {
  useSyncPierreWorkerPoolTheme(pool, constructedTheme);
  return null;
}
