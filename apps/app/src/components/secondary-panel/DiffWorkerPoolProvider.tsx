import type { ReactNode } from "react";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import {
  createDiffWorker,
  getDiffWorkerPoolSize,
} from "@/lib/diff-worker-pool";

const WORKER_POOL_OPTIONS = {
  workerFactory: createDiffWorker,
  poolSize: getDiffWorkerPoolSize(),
};
const HIGHLIGHTER_OPTIONS = {};

export default function DiffWorkerPoolProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <WorkerPoolContextProvider
      poolOptions={WORKER_POOL_OPTIONS}
      highlighterOptions={HIGHLIGHTER_OPTIONS}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
