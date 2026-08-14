import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRealtimeConnectionState } from "@get-bb/plugin-sdk/app";

interface TasksRefreshState {
  generation: number;
  /**
   * True while any mounted query still has a generation-driven fetch in
   * flight (manual refresh or reconnect). Used by the header control for
   * single-flight + loading UI without a second refresh channel.
   */
  isRefreshing: boolean;
  refresh: () => void;
  /** Called by queries when a generation-driven fetch starts. */
  beginGenerationWork: () => void;
  /** Called by queries when a generation-driven fetch settles or unmounts. */
  endGenerationWork: () => void;
}

const TasksRefreshContext = createContext<TasksRefreshState | null>(null);

/**
 * Owns the plugin's single realtime connection listener. Every mounted query
 * observes the same generation, so reconnect and manual refresh each cause at
 * most one request per query without creating per-query connection listeners.
 */
export function TasksRefreshProvider({ children }: { children: ReactNode }) {
  const connectionState = useRealtimeConnectionState();
  const previousConnectionState = useRef(connectionState);
  // `reconnecting` is only emitted after this shared socket connected before,
  // even if the Tasks shell happened to mount during the outage.
  const hasConnected = useRef(connectionState !== "connecting");
  const [generation, setGeneration] = useState(0);
  const pendingWorkRef = useRef(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(() => {
    // Optimistic busy so rapid pointer/keyboard activations coalesce before
    // query effects report beginGenerationWork on the next paint.
    setIsRefreshing(true);
    setGeneration((current) => current + 1);
  }, []);

  const beginGenerationWork = useCallback(() => {
    pendingWorkRef.current += 1;
    setIsRefreshing(true);
  }, []);

  const endGenerationWork = useCallback(() => {
    pendingWorkRef.current = Math.max(0, pendingWorkRef.current - 1);
    if (pendingWorkRef.current === 0) setIsRefreshing(false);
  }, []);

  useEffect(() => {
    const previous = previousConnectionState.current;
    previousConnectionState.current = connectionState;
    if (connectionState !== "connected" || previous === "connected") return;
    if (hasConnected.current) refresh();
    hasConnected.current = true;
  }, [connectionState, refresh]);

  const value = useMemo(
    () => ({
      generation,
      isRefreshing,
      refresh,
      beginGenerationWork,
      endGenerationWork,
    }),
    [generation, isRefreshing, refresh, beginGenerationWork, endGenerationWork],
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
