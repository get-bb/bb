import { useCallback, useEffect, useSyncExternalStore } from "react";
import { matchPath, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import type { Location } from "react-router-dom";
import { PLUGIN_DETAIL_ROUTE_PATH, PLUGINS_ROUTE_PATH } from "./route-paths";

interface AppRouteHistoryEntry {
  key: string;
  url: string;
  pluginCollectionUrl: string | null;
}

interface AppRouteHistoryState {
  entries: AppRouteHistoryEntry[];
  index: number;
}

interface AppRouteHistoryNavigation {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
}

type AppRouteNavigationType = "POP" | "PUSH" | "REPLACE";

function getNormalizedUrl(location: Location): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

function getNavigationUrl(entry: AppRouteHistoryEntry): string {
  return entry.pluginCollectionUrl ?? entry.url;
}

function findBackTargetIndex(state: AppRouteHistoryState): number | null {
  const current = state.entries[state.index];
  if (current === undefined) {
    return null;
  }
  for (let candidate = state.index - 1; candidate >= 0; candidate -= 1) {
    if (getNavigationUrl(state.entries[candidate]) !== getNavigationUrl(current)) {
      return candidate;
    }
  }
  return null;
}

function findForwardTargetIndex(state: AppRouteHistoryState): number | null {
  const current = state.entries[state.index];
  if (current === undefined) {
    return null;
  }
  for (
    let candidate = state.index + 1;
    candidate < state.entries.length;
    candidate += 1
  ) {
    if (getNavigationUrl(state.entries[candidate]) !== getNavigationUrl(current)) {
      const collectionUrl = state.entries[candidate].pluginCollectionUrl;
      if (collectionUrl !== null) {
        while (state.entries[candidate + 1]?.pluginCollectionUrl === collectionUrl) {
          candidate += 1;
        }
      }
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
      const matchedIndex = state.entries.findIndex(
        (candidate) =>
          candidate.key === entry.key && candidate.url === entry.url,
      );
      if (matchedIndex >= 0) {
        return { entries: state.entries, index: matchedIndex };
      }
      return { entries: [entry], index: 0 };
    }
  }
}

const EMPTY_HISTORY_STATE: AppRouteHistoryState = { entries: [], index: 0 };
let historyState = EMPTY_HISTORY_STATE;
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
  const isPluginCollection =
    matchPath(PLUGINS_ROUTE_PATH, location.pathname) !== null ||
    matchPath(PLUGIN_DETAIL_ROUTE_PATH, location.pathname) !== null;
  const entry = {
    key: location.key,
    url: getNormalizedUrl(location),
    pluginCollectionUrl: isPluginCollection
      ? `${PLUGINS_ROUTE_PATH}${location.search}${location.hash}`
      : null,
  };
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

export function resetAppRouteHistoryForTest(): void {
  historyState = EMPTY_HISTORY_STATE;
  lastRecordedLocation = null;
}

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
