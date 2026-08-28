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

export type ThreadDetailWorkerPoolModule = PierreWorkerPoolModule;

interface ThreadDetailWorkerPoolProviderProps {
  children: ReactNode;
  loadWorkerPool?: () => Promise<PierreWorkerPoolModule>;
}

const loadPierreWorkerPool = createRetryingModuleLoader<PierreWorkerPoolModule>(
  () => import("@/lib/pierre-worker-pool"),
);

interface LoadedPool {
  module: PierreWorkerPoolModule;
  pool: WorkerPoolManager;
  constructedTheme: { dark: string; light: string };
}

export function ThreadDetailWorkerPoolProvider({
  children,
  loadWorkerPool = loadPierreWorkerPool,
}: ThreadDetailWorkerPoolProviderProps) {
  const canUseWorkers = globalThis.Worker !== undefined;
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
    void loadWorkerPool().then(
      (module) => {
        if (cancelled) return;
        setLoaded((current) => {
          if (current !== null) return current;
          return {
            module,
            pool: module.acquirePierreWorkerPool(theme),
            constructedTheme: theme,
          };
        });
      },
      (cause: unknown) => {
        if (cancelled) return;
        console.warn(
          `diff worker pool load failed; diffs highlight on the main thread: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
        setLoadFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [canUseWorkers, loadWorkerPool, requested, theme]);

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
