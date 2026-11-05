import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { connectNextRpcContract } from "./src/rpc.js";
import {
  CONNECT_NEXT_REALTIME_CHANNEL,
  connectNextStatusSchema,
  type ConnectNextStatus,
} from "./src/types.js";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asStatus(value: unknown): ConnectNextStatus | null {
  const parsed = connectNextStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const STATE_LABEL: Record<
  ConnectNextStatus["state"] | ConnectNextStatus["machines"][number]["state"],
  string
> = {
  off: "Off",
  idle: "Idle",
  "signed-out": "Waiting for bb account sign-in",
  connecting: "Connecting…",
  connected: "Connected",
  refused: "Credential refused",
  waiting: "Not yet available for this bb",
  offline: "Can't reach the gate",
  error: "Couldn't start",
};

const TROUBLE: ReadonlySet<string> = new Set(["refused", "offline", "error"]);

function useConnectNextStatus() {
  const rpc = useRpc<typeof connectNextRpcContract>();
  const connectionState = useRealtimeConnectionState();
  const [status, setStatus] = useState<ConnectNextStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const latest = useRef(0);

  const refetch = useCallback(() => {
    const request = ++latest.current;
    rpc.call("status").then(
      (result) => {
        if (request !== latest.current) return;
        const next = asStatus(result);
        setStatus(next);
        setLoadError(next === null ? "Unexpected status payload." : null);
      },
      (error: unknown) => {
        if (request !== latest.current) return;
        setLoadError(errorText(error));
      },
    );
  }, [rpc]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const previousConnectionState = useRef(connectionState);
  useEffect(() => {
    const previous = previousConnectionState.current;
    previousConnectionState.current = connectionState;
    if (connectionState === "connected" && previous !== "connected") refetch();
  }, [connectionState, refetch]);

  useRealtime(CONNECT_NEXT_REALTIME_CHANNEL, (payload) => {
    const next = asStatus(payload);
    if (next === null) return;
    latest.current += 1;
    setStatus(next);
    setLoadError(null);
  });

  return { status, loadError };
}

function ConnectNextSettingsSection() {
  const { status, loadError } = useConnectNextStatus();

  if (loadError !== null) {
    return (
      <p role="alert" className="text-sm text-destructive-text">
        {loadError}
      </p>
    );
  }
  if (status === null) return null;

  const machines = status.machines.filter((machine) =>
    TROUBLE.has(machine.state),
  );
  return (
    <div className="space-y-1">
      <p role="status" className="text-sm">
        {STATE_LABEL[status.state]}
      </p>
      {status.enabled && !status.remoteAccess ? (
        <p className="text-xs text-muted-foreground">
          Remote access is off in bb connect.
        </p>
      ) : null}
      {status.lastError !== null && TROUBLE.has(status.state) ? (
        <p className="text-xs text-muted-foreground">{status.lastError}</p>
      ) : null}
      {machines.map((machine) => (
        <p key={machine.hostId} className="text-xs text-muted-foreground">
          {machine.hostName}: {STATE_LABEL[machine.state]}
        </p>
      ))}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "connect-next",
    component: ConnectNextSettingsSection,
  });
});
