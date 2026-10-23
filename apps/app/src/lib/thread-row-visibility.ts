import {
  useCallback,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from "react";

export const THREAD_ROW_SETTLE_MS = 200;

interface RowState {
  onScreen: boolean;
  live: boolean;
  listeners: Set<() => void>;
}

const rows = new Map<Element, RowState>();
let observer: IntersectionObserver | null = null;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

function pageHidden(): boolean {
  return document.visibilityState === "hidden";
}

function applyLive(nextLive: (state: RowState) => boolean): void {
  const changed: RowState[] = [];
  for (const state of rows.values()) {
    const live = nextLive(state);
    if (live === state.live) continue;
    state.live = live;
    changed.push(state);
  }
  for (const state of changed)
    for (const listener of state.listeners) listener();
}

function settle(): void {
  settleTimer = undefined;
  if (pageHidden()) return;
  applyLive((state) => state.onScreen);
}

function scheduleSettle(): void {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(settle, THREAD_ROW_SETTLE_MS);
}

function onVisibilityChange(): void {
  if (!pageHidden()) {
    scheduleSettle();
    return;
  }
  clearTimeout(settleTimer);
  settleTimer = undefined;
  applyLive(() => false);
}

function onIntersections(entries: readonly IntersectionObserverEntry[]) {
  let changed = false;
  for (const entry of entries) {
    const state = rows.get(entry.target);
    if (state === undefined || state.onScreen === entry.isIntersecting)
      continue;
    state.onScreen = entry.isIntersecting;
    changed = true;
  }
  if (changed) scheduleSettle();
}

function observeRow(element: Element, listener: () => void): () => void {
  let state = rows.get(element);
  if (state === undefined) {
    if (observer === null) {
      observer = new IntersectionObserver(onIntersections);
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    state = { onScreen: false, live: false, listeners: new Set() };
    rows.set(element, state);
    observer.observe(element);
  }
  state.listeners.add(listener);
  const current = state;
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    rows.delete(element);
    observer?.unobserve(element);
    if (rows.size > 0) return;
    observer?.disconnect();
    observer = null;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    clearTimeout(settleTimer);
    settleTimer = undefined;
  };
}

export function useThreadRowLive(anchor: RefObject<Element | null>): boolean {
  const target = useRef<Element | null>(null);
  const subscribe = useCallback(
    (listener: () => void) => {
      if (typeof IntersectionObserver === "undefined") return () => {};
      const element = anchor.current?.parentElement ?? null;
      target.current = element;
      if (element === null) return () => {};
      const stop = observeRow(element, listener);
      return () => {
        stop();
        target.current = null;
      };
    },
    [anchor],
  );
  const getSnapshot = useCallback((): boolean => {
    if (typeof IntersectionObserver === "undefined") return true;
    const state = target.current && rows.get(target.current);
    return state ? state.live : false;
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
