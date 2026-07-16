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
import { useRealtimeConnectionState } from "@bb/plugin-sdk/app";

interface TasksRefreshState {
  generation: number;
  refresh: () => void;
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
  const refresh = useCallback(
    () => setGeneration((current) => current + 1),
    [],
  );

  useEffect(() => {
    const previous = previousConnectionState.current;
    previousConnectionState.current = connectionState;
    if (connectionState !== "connected" || previous === "connected") return;
    if (hasConnected.current) refresh();
    hasConnected.current = true;
  }, [connectionState, refresh]);

  const value = useMemo(() => ({ generation, refresh }), [generation, refresh]);
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
