import { useSyncExternalStore } from "react";
import {
  isDocumentVisible,
  subscribeToDocumentVisibility,
} from "@/lib/document-visibility";

/**
 * One 1 Hz ticker shared by every live-duration label. Each label used to own
 * a `setInterval` plus a state update; with several workflow/background rows
 * mounted that is many timers firing at slightly different phases, each a
 * separate render. One interval, one notification per second, and it stops
 * when the last subscriber leaves.
 *
 * The interval also stops while the document is hidden: nothing it drives can
 * be seen, and on phones the pending timer only queues work for the resume.
 * The first tick after becoming visible fires immediately so durations jump
 * to the current truth instead of waiting out the next second.
 */
const listeners = new Set<() => void>();
let lastTickMs = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
let unsubscribeVisibility: (() => void) | null = null;

function tick(): void {
  lastTickMs = Date.now();
  for (const listener of listeners) listener();
}

function startInterval(): void {
  if (intervalId === null && isDocumentVisible()) {
    intervalId = setInterval(tick, 1_000);
  }
}

function stopInterval(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function handleVisibilityChange(): void {
  if (!isDocumentVisible()) {
    stopInterval();
    return;
  }
  if (listeners.size > 0 && intervalId === null) {
    tick();
    startInterval();
  }
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    lastTickMs = Date.now();
    unsubscribeVisibility = subscribeToDocumentVisibility(
      handleVisibilityChange,
    );
    startInterval();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopInterval();
      unsubscribeVisibility?.();
      unsubscribeVisibility = null;
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
