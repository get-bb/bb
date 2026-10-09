import type { WorkerPoolManager } from "@pierre/diffs/worker";
import { createContext, useContext, useEffect } from "react";

export interface PierreWorkerPoolGate {
  ready: boolean;
  pool: WorkerPoolManager | undefined;
  request: () => void;
}

export const PierreWorkerPoolGateContext =
  createContext<PierreWorkerPoolGate | null>(null);

export function useRequirePierreWorkerPool(required = true): boolean {
  const gate = useContext(PierreWorkerPoolGateContext);
  const request = required ? gate?.request : undefined;
  useEffect(() => {
    request?.();
  }, [request]);
  return !required || gate === null ? true : gate.ready;
}

export function useRequestPierreWorkerPool(): () => void {
  const request = useContext(PierreWorkerPoolGateContext)?.request;
  return request ?? noop;
}

function noop(): void {}

export function usePierreWorkerPool(): WorkerPoolManager | undefined {
  return useContext(PierreWorkerPoolGateContext)?.pool;
}
