import { useSyncExternalStore } from "react";

/**
 * One 1 Hz ticker shared by every live-duration label. Each label used to own
 * a `setInterval` plus a state update; with several workflow/background rows
 * mounted that is many timers firing at slightly different phases, each a
 * separate render. One interval, one notification per second, and it stops
 * when the last subscriber leaves.
 */
const listeners = new Set<() => void>();
let lastTickMs = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  lastTickMs = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    lastTickMs = Date.now();
    intervalId = setInterval(tick, 1_000);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getSnapshot(): number {
  // Before the first subscription there is no ticker; read the clock once so
  // the initial render is not a stale zero.
  if (lastTickMs === 0) lastTickMs = Date.now();
  return lastTickMs;
}

/** Current time in ms, refreshed once per second while any subscriber is mounted. */
export function useSecondTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
