import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRealtimeConnectionState } from "@get-bb/plugin-sdk/app";

interface TasksRefreshState {
  generation: number;
  manualGeneration: number;
  isRefreshing: boolean;
  refresh: () => void;
  beginGenerationWork: () => void;
  endGenerationWork: () => void;
}

const TasksRefreshContext = createContext<TasksRefreshState | null>(null);

interface SharedRefreshSnapshot {
  generation: number;
  manualGeneration: number;
  isRefreshing: boolean;
}

let sharedSnapshot: SharedRefreshSnapshot = {
  generation: 0,
  manualGeneration: 0,
  isRefreshing: false,
};
let pendingGenerationWork = 0;
const refreshListeners = new Set<() => void>();
const connectionStates = new Map<symbol, string>();
let aggregateConnectionState: string | null = null;

function emitRefreshChange() {
  for (const listener of refreshListeners) listener();
}

function updateSharedSnapshot(next: SharedRefreshSnapshot) {
  if (
    next.generation === sharedSnapshot.generation &&
    next.manualGeneration === sharedSnapshot.manualGeneration &&
    next.isRefreshing === sharedSnapshot.isRefreshing
  ) {
    return;
  }
  sharedSnapshot = next;
  emitRefreshChange();
}

function beginGenerationWork() {
  pendingGenerationWork += 1;
  updateSharedSnapshot({ ...sharedSnapshot, isRefreshing: true });
}

function endGenerationWork() {
  pendingGenerationWork = Math.max(0, pendingGenerationWork - 1);
  if (pendingGenerationWork === 0) {
    updateSharedSnapshot({ ...sharedSnapshot, isRefreshing: false });
  }
}

function requestRefresh(reconnected = false) {
  if (sharedSnapshot.isRefreshing) return;
  const generation = sharedSnapshot.generation + 1;
  updateSharedSnapshot({
    generation,
    manualGeneration: sharedSnapshot.manualGeneration + (reconnected ? 0 : 1),
    isRefreshing: true,
  });
  queueMicrotask(() => {
    if (
      sharedSnapshot.generation === generation &&
      pendingGenerationWork === 0
    ) {
      updateSharedSnapshot({ ...sharedSnapshot, isRefreshing: false });
    }
  });
}

function aggregateConnection(): string | null {
  const states = [...connectionStates.values()];
  if (states.length === 0) return null;
  if (states.every((state) => state === "connected")) return "connected";
  if (states.some((state) => state === "reconnecting")) return "reconnecting";
  return "connecting";
}

function updateConnectionState(registrationId: symbol, state: string) {
  const wasUninitialized = aggregateConnectionState === null;
  connectionStates.set(registrationId, state);
  const next = aggregateConnection();
  const previous = aggregateConnectionState;
  aggregateConnectionState = next;
  if (wasUninitialized) return;
  if (next === "connected" && previous !== "connected") {
    requestRefresh(true);
  }
}

function removeConnectionState(registrationId: symbol) {
  connectionStates.delete(registrationId);
  aggregateConnectionState = aggregateConnection();
  if (aggregateConnectionState === null) {
    pendingGenerationWork = 0;
    sharedSnapshot = {
      generation: 0,
      manualGeneration: 0,
      isRefreshing: false,
    };
  }
}

export function TasksRefreshProvider({ children }: { children: ReactNode }) {
  const connectionState = useRealtimeConnectionState();
  const registrationId = useMemo(() => Symbol("tasks-refresh-provider"), []);
  const snapshot = useSyncExternalStore(
    useCallback((listener) => {
      refreshListeners.add(listener);
      return () => refreshListeners.delete(listener);
    }, []),
    () => sharedSnapshot,
    () => sharedSnapshot,
  );

  useEffect(() => {
    updateConnectionState(registrationId, connectionState);
  }, [connectionState, registrationId]);
  useEffect(
    () => () => removeConnectionState(registrationId),
    [registrationId],
  );

  const value = useMemo(
    () => ({
      generation: snapshot.generation,
      manualGeneration: snapshot.manualGeneration,
      isRefreshing: snapshot.isRefreshing,
      refresh: () => requestRefresh(),
      beginGenerationWork,
      endGenerationWork,
    }),
    [snapshot],
  );
  return (
    <TasksRefreshContext.Provider value={value}>
      {children}
    </TasksRefreshContext.Provider>
  );
}

export function useTasksRefresh(): TasksRefreshState {
  const state = useContext(TasksRefreshContext);
  if (state === null) {
    throw new Error("useTasksRefresh must be used within TasksRefreshProvider");
  }
  return state;
}
