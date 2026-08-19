import { WorkerPoolContext } from "@pierre/diffs/react";
import { useContext, type ReactNode } from "react";
import { PierreWorkerPoolGateContext } from "./pierre-worker-pool-gate";

/**
 * Hands the workspace pool (see `pierre-worker-pool-gate.ts`) to
 * `@pierre/diffs` through its own context, right around a diff element.
 *
 * The workspace does not render pierre's provider at its root: importing
 * pierre's `WorkerPoolContext` module there would pull the pool manager and
 * Shiki into the thread route closure, because that module also defines
 * pierre's provider. Diff consumers already import pierre, so this boundary
 * lives with them and costs nothing extra.
 *
 * Outside a workspace gate (tests, storybook, plugin previews) it renders the
 * children unchanged, so a surrounding pierre provider still applies.
 */
export function PierreWorkerPoolBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const gate = useContext(PierreWorkerPoolGateContext);
  if (gate === null) return children;
  return (
    <WorkerPoolContext.Provider value={gate.pool}>
      {children}
    </WorkerPoolContext.Provider>
  );
}
