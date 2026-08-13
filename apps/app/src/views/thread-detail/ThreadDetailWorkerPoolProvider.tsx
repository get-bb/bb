import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import type { ReactNode } from "react";
import {
  createDiffWorker,
  getDiffWorkerPoolSize,
} from "@/lib/diff-worker-pool";
import { useResolvedCodeThemePair } from "@/lib/code-theme";
import { useSyncPierreWorkerPoolTheme } from "@/lib/pierre-worker-pool-theme";

const WORKER_POOL_OPTIONS = {
  workerFactory: createDiffWorker,
  poolSize: getDiffWorkerPoolSize(),
};

function PierreWorkerPoolThemeSync() {
  useSyncPierreWorkerPoolTheme();
  return null;
}

export function ThreadDetailWorkerPoolProvider({
  children,
}: {
  children: ReactNode;
}) {
  const theme = useResolvedCodeThemePair();
  if (typeof Worker === "undefined") {
    return children;
  }
  return (
    <WorkerPoolContextProvider
      poolOptions={WORKER_POOL_OPTIONS}
      highlighterOptions={{ theme }}
    >
      <PierreWorkerPoolThemeSync />
      {children}
    </WorkerPoolContextProvider>
  );
}
