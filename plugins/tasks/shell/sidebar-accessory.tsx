import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState } from "@bb/plugin-sdk/app";
import { useTasksRpc } from "./data.js";

/** Live count of non-terminal tasks for the host sidebar row. */
export function TasksSidebarAccessory() {
  const rpc = useTasksRpc();
  const connectionState = useRealtimeConnectionState();
  const requestSequence = useRef(0);
  const [count, setCount] = useState<number | null>(null);

  const refresh = useCallback(() => {
    const sequence = ++requestSequence.current;
    void rpc.call("sidebarSummary").then(
      ({ openTaskCount }) => {
        if (sequence === requestSequence.current) setCount(openTaskCount);
      },
      () => {
        // Keep the last durable value during transient RPC failures. A later
        // realtime event or reconnect reconciles it without noisy row chrome.
      },
    );
  }, [rpc]);

  useEffect(() => {
    if (connectionState === "connected") refresh();
    return () => {
      requestSequence.current += 1;
    };
  }, [connectionState, refresh]);
  useRealtime("tasks:changed", refresh);
  useRealtime("projects:changed", refresh);

  return count === null ? null : (
    <span className="text-muted-foreground tabular-nums">{count}</span>
  );
}
