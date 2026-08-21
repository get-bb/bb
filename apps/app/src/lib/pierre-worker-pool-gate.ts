import type { WorkerPoolManager } from "@pierre/diffs/worker";
import { createContext, useContext, useEffect } from "react";

/**
 * "Someone on this page renders a diff" gate for the `@pierre/diffs` worker
 * pool.
 *
 * The pool spawns every worker (each ~830 KB of JavaScript plus a Shiki heap)
 * the moment it is constructed. Every routed pane sits under the workspace
 * provider, so without a gate the workers spawn on the root compose page and
 * on threads with no diff at all. Diff consumers call
 * `useRequirePierreWorkerPool` before they render a pierre element; the
 * workspace loads the pool chunk and constructs the pool only after the
 * first one asks, and publishes it here.
 *
 * This module must stay free of runtime `@pierre/diffs` imports: it is
 * imported from the route closure, and the pool chunk is what it keeps lazy.
 * (The type import is erased.) Consumers hand the pool to pierre through
 * `PierreWorkerPoolBoundary`, which lives with the pierre code.
 */
export interface PierreWorkerPoolGate {
  /**
   * True once the pool exists (or once it is known that no pool will exist:
   * no `Worker` support, or the pool chunk failed to load), so a pierre
   * element rendered now captures the final pool.
   */
  ready: boolean;
  /** The pool once built; undefined before that and when none will exist. */
  pool: WorkerPoolManager | undefined;
  /** Idempotent: ask the workspace to construct the pool. */
  request: () => void;
}

export const PierreWorkerPoolGateContext =
  createContext<PierreWorkerPoolGate | null>(null);

/**
 * Diff consumers call this and render their `@pierre/diffs` element only
 * when it returns true.
 *
 * `@pierre/diffs` reads its worker-pool context once, when it creates the
 * diff instance in its ref callback, so a consumer that renders before the
 * pool exists would highlight on the main thread for its whole life. After
 * the first request the gate stays ready, so every later consumer sees
 * `true` on its first render.
 *
 * Outside a gate (tests, storybook, plugin previews) there is no pool to wait
 * for and the hook returns true at once.
 */
export function useRequirePierreWorkerPool(): boolean {
  const gate = useContext(PierreWorkerPoolGateContext);
  const request = gate?.request;
  useEffect(() => {
    request?.();
  }, [request]);
  return gate === null ? true : gate.ready;
}

/** The workspace pool, or undefined outside a gate / before it is built. */
export function usePierreWorkerPool(): WorkerPoolManager | undefined {
  return useContext(PierreWorkerPoolGateContext)?.pool;
}
