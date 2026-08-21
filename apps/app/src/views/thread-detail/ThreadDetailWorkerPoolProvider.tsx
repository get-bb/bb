import type { WorkerPoolManager } from "@pierre/diffs/worker";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useResolvedCodeThemePair } from "@/lib/code-theme";
import {
  PierreWorkerPoolGateContext,
  type PierreWorkerPoolGate,
} from "@/lib/pierre-worker-pool-gate";
import { createRetryingModuleLoader } from "@/lib/plugin-frontend-lazy";

type PierreWorkerPoolModule = typeof import("@/lib/pierre-worker-pool");

/**
 * Loads the pool chunk once and re-tries after a failed fetch, so a flaky
 * network cannot leave the page without diff highlighting for good.
 */
const loadPierreWorkerPool = createRetryingModuleLoader<PierreWorkerPoolModule>(
  () => import("@/lib/pierre-worker-pool"),
);

interface LoadedPool {
  module: PierreWorkerPoolModule;
  pool: WorkerPoolManager;
  constructedTheme: { dark: string; light: string };
}

/**
 * Owns the `@pierre/diffs` worker pool for every routed pane, but builds it
 * only after the first diff consumer asks (`useRequirePierreWorkerPool`).
 *
 * The pool is published through the app's own gate context; consumers hand it
 * to pierre with `PierreWorkerPoolBoundary`. Nothing here imports pierre at
 * runtime (the type import is erased), so the pool manager, the workers, the
 * Shiki engine and the theme sync all stay in the lazily loaded
 * `pierre-worker-pool` chunk and out of the thread route closure. The child
 * tree keeps its position in every state, so nothing remounts when the pool
 * arrives.
 *
 * The pool is terminated when this provider unmounts (leaving the split
 * workspace), and the next workspace again waits for a diff before it
 * spawns workers.
 */
export function ThreadDetailWorkerPoolProvider({
  children,
}: {
  children: ReactNode;
}) {
  const canUseWorkers = typeof Worker !== "undefined";
  const theme = useResolvedCodeThemePair();
  const [requested, setRequested] = useState(false);
  const [loaded, setLoaded] = useState<LoadedPool | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const request = useCallback(() => {
    setRequested(true);
  }, []);

  useEffect(() => {
    if (!requested || !canUseWorkers) return;
    let cancelled = false;
    void loadPierreWorkerPool().then(
      (module) => {
        if (cancelled) return;
        // Pierre reads the theme in the constructor only; the sync applies
        // later changes. React state, not a ref: consumers must see `ready`
        // and the pool in the same render.
        setLoaded((current) => {
          if (current !== null) return current;
          return {
            module,
            pool: module.acquirePierreWorkerPool(theme),
            constructedTheme: theme,
          };
        });
      },
      (error: unknown) => {
        if (cancelled) return;
        console.warn(
          `diff worker pool load failed; diffs highlight on the main thread: ${error instanceof Error ? error.message : String(error)}`,
        );
        setLoadFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
    // A theme change after the pool exists re-runs this and resolves the
    // cached loader; the updater keeps the existing pool. The theme sync
    // applies the change.
  }, [canUseWorkers, requested, theme]);

  useEffect(() => {
    if (loaded === null) return;
    return () => {
      loaded.module.releasePierreWorkerPool();
    };
  }, [loaded]);

  const ready = !canUseWorkers || loaded !== null || loadFailed;
  const pool = loaded?.pool;
  const gate = useMemo<PierreWorkerPoolGate>(
    () => ({ ready, pool, request }),
    [pool, ready, request],
  );

  return (
    <PierreWorkerPoolGateContext.Provider value={gate}>
      {children}
      {loaded === null ? null : (
        <loaded.module.PierreWorkerPoolThemeSync
          pool={loaded.pool}
          constructedTheme={loaded.constructedTheme}
        />
      )}
    </PierreWorkerPoolGateContext.Provider>
  );
}
