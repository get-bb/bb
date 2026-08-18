import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import type { Location } from "react-router-dom";

/**
 * One slot in the app-owned route history. `key` is React Router's
 * per-entry `location.key`, used to reconcile native/router POP movements
 * back to a known slot. `url` is the normalized `pathname + search + hash`
 * used to decide whether two slots are visibly the same route (duplicate
 * same-URL entries get distinct keys but share a `url`).
 */
export interface AppRouteHistoryEntry {
  key: string;
  url: string;
}

/**
 * The app-owned history stack and the index of the current slot. This mirrors
 * the React Router entries the app has actually visited while mounted —
 * including duplicate same-URL pushes — so Back/Forward can move by a real
 * router delta rather than by reconstructing URLs.
 */
export interface AppRouteHistoryState {
  entries: AppRouteHistoryEntry[];
  index: number;
}

export interface AppRouteHistoryNavigation {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
}

/** The navigation kinds React Router reports for a location change. */
type AppRouteNavigationType = "POP" | "PUSH" | "REPLACE";

function getNormalizedUrl(location: Location): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

/**
 * Index of the nearest earlier slot whose URL is visibly different from the
 * current slot, or null when none exists. Skipping equal-URL slots means one
 * Back click lands on a different route instead of a no-op duplicate.
 */
function findBackTargetIndex(state: AppRouteHistoryState): number | null {
  const currentUrl = state.entries[state.index]?.url;
  if (currentUrl === undefined) {
    return null;
  }
  for (let candidate = state.index - 1; candidate >= 0; candidate -= 1) {
    if (state.entries[candidate].url !== currentUrl) {
      return candidate;
    }
  }
  return null;
}

/** Forward counterpart of {@link findBackTargetIndex}. */
function findForwardTargetIndex(state: AppRouteHistoryState): number | null {
  const currentUrl = state.entries[state.index]?.url;
  if (currentUrl === undefined) {
    return null;
  }
  for (
    let candidate = state.index + 1;
    candidate < state.entries.length;
    candidate += 1
  ) {
    if (state.entries[candidate].url !== currentUrl) {
      return candidate;
    }
  }
  return null;
}

function reduceHistory(
  state: AppRouteHistoryState,
  navigationType: AppRouteNavigationType,
  entry: AppRouteHistoryEntry,
): AppRouteHistoryState {
  switch (navigationType) {
    case "PUSH": {
      // A new navigation after going back drops the forward stack.
      const entries = state.entries.slice(0, state.index + 1);
      entries.push(entry);
      return { entries, index: entries.length - 1 };
    }
    case "REPLACE": {
      const entries = state.entries.slice();
      entries[state.index] = entry;
      return { entries, index: state.index };
    }
    case "POP": {
      // Match on key AND normalized URL. BrowserRouter labels unkeyed
      // document-history entries `"default"`, so a POP can share the mounted
      // entry's key while pointing at a different URL; matching by key alone
      // would reconcile to a recorded slot and leave the stack pointing at a
      // stale URL.
      const matchedIndex = state.entries.findIndex(
        (candidate) =>
          candidate.key === entry.key && candidate.url === entry.url,
      );
      if (matchedIndex >= 0) {
        // Native/router Back/Forward into a slot we recorded: reconcile to it
        // and keep the surrounding entries so movement stays reversible.
        return { entries: state.entries, index: matchedIndex };
      }
      // POP to an unrecorded entry landed outside the app-owned session (e.g. a
      // restored off-app history position, or a `"default"`-key collision).
      // Treat the current route as the history boundary rather than offering
      // navigation into history we did not record.
      return { entries: [entry], index: 0 };
    }
  }
}

/**
 * The stack lives at module scope, not in the consuming component: the
 * Back/Forward controls are mounted by whichever sidebar the current layout
 * uses (app, settings, or Extensions), and navigating between those layouts
 * REMOUNTS the controls. Component state restarted the stack at every such
 * remount, which is exactly the moment the user wants Back — e.g. an
 * Extensions page handing off to the new-thread composer swaps sidebars and
 * used to arrive with Back disabled.
 */
const EMPTY_HISTORY_STATE: AppRouteHistoryState = { entries: [], index: 0 };
let historyState = EMPTY_HISTORY_STATE;
// Identity of the last recorded location. React Router hands out a fresh
// location object per navigation, so identity both dedupes double effects and
// lets a freshly mounted instance record a navigation the unmounting one
// missed (cleanup runs instead of effects during the swap commit).
let lastRecordedLocation: Location | null = null;
const historyListeners = new Set<() => void>();

function recordLocation(
  location: Location,
  navigationType: AppRouteNavigationType,
): void {
  if (lastRecordedLocation === location) {
    return;
  }
  lastRecordedLocation = location;
  const entry = { key: location.key, url: getNormalizedUrl(location) };
  historyState =
    historyState.entries.length === 0
      ? { entries: [entry], index: 0 }
      : reduceHistory(historyState, navigationType, entry);
  for (const listener of historyListeners) {
    listener();
  }
}

function subscribeToHistory(listener: () => void): () => void {
  historyListeners.add(listener);
  return () => {
    historyListeners.delete(listener);
  };
}

/** Test-only: forget the module-level stack between cases. */
export function resetAppRouteHistoryForTest(): void {
  historyState = EMPTY_HISTORY_STATE;
  lastRecordedLocation = null;
}

/**
 * App-shell route history for the sidebar Back/Forward controls. Tracks the
 * React Router entries visited while the app runs and exposes browser-style
 * navigation that skips duplicate same-URL slots and never steps into
 * history the app did not record. This is app-route history only; it does not
 * touch the in-thread browser tab history.
 */
export function useRouteStateHistoryNavigation(): AppRouteHistoryNavigation {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();

  useEffect(() => {
    recordLocation(location, navigationType);
  }, [location, navigationType]);

  const state = useSyncExternalStore(
    subscribeToHistory,
    () => historyState,
    () => historyState,
  );

  const goBack = useCallback(() => {
    const current = historyState;
    const target = findBackTargetIndex(current);
    if (target === null) {
      return;
    }
    void navigate(target - current.index);
  }, [navigate]);

  const goForward = useCallback(() => {
    const current = historyState;
    const target = findForwardTargetIndex(current);
    if (target === null) {
      return;
    }
    void navigate(target - current.index);
  }, [navigate]);

  return {
    canGoBack: findBackTargetIndex(state) !== null,
    canGoForward: findForwardTargetIndex(state) !== null,
    goBack,
    goForward,
  };
}
