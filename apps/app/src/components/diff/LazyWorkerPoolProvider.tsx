import { lazy, Suspense, type ReactNode } from "react";

/**
 * Wraps @pierre/diffs WorkerPoolContextProvider behind a Suspense boundary
 * so the heavy syntax-highlighting worker (~505KB) and Shiki engine (~80KB
 * core) never block initial thread/compose/plugin UI paint.
 */
const WorkerPoolContextProvider = lazy(() =>
  import("@pierre/diffs/react").then((m) => ({
    default: m.WorkerPoolContextProvider,
  })),
);

interface Props {
  poolOptions: {
    workerFactory: () => Worker;
    poolSize: number;
  };
  highlighterOptions?: Record<string, unknown>;
  children: ReactNode;
}

export function LazyWorkerPoolProvider({ children, ...rest }: Props) {
  return (
    <Suspense fallback={null}>
      <WorkerPoolContextProvider {...rest}>{children}</WorkerPoolContextProvider>
    </Suspense>
  );
}
