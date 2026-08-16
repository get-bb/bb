import { useSyncExternalStore } from "react";

/**
 * Whether the page's plugin frontends have finished their first load (well or
 * badly). Plugin registrations arrive after first paint, so a route that
 * depends on a registration cannot tell "not loaded yet" from "not installed"
 * on its own; this flag is the difference between a quiet placeholder and an
 * error message that is wrong for a few hundred milliseconds on every reload.
 */
let settled = false;
const listeners = new Set<() => void>();

export function markPluginFrontendsSettled(): void {
  if (settled) return;
  settled = true;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return settled;
}

export function usePluginFrontendsSettled(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test-only. */
export function resetPluginFrontendBootStateForTest(): void {
  settled = false;
}
