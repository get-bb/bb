import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRealtime, useRpc } from "@bb/plugin-sdk/app";
import { Alert, AlertDescription } from "@bb/shared-ui/alert";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type { BenchDeviceRecord } from "../registry/families.js";
import type { serialRpcContract } from "../serial/fs-serial.js";
import type { SerialLine, SerialGap } from "../serial/ring-buffer.js";
import type { SerialSessionState } from "../serial/session.js";
import { SerialSendBar } from "./serial-send-bar.js";

interface SerialConsoleProps {
  projectId: string;
  projectVersionId: string | null;
  devices: readonly BenchDeviceRecord[];
}

type ConsoleState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ready"; connection: SerialSessionState; message: string | null };

const STATE_LABELS: Record<SerialSessionState, string> = {
  connected: "Connected",
  reconnecting: "Reconnecting",
  closed: "Closed",
  unconfigured: "Needs setup",
};

const STATE_VARIANTS: Record<
  SerialSessionState,
  "default" | "secondary" | "outline" | "destructive"
> = {
  connected: "secondary",
  reconnecting: "outline",
  closed: "outline",
  unconfigured: "destructive",
};

function actionableSerialError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("DEVICE_CLAIMED")) {
    return "This serial port is in use by another session. Close that session or wait for its claim to expire, then retry.";
  }
  if (
    message.includes("SERIAL_SESSION_NOT_OPEN") ||
    message.includes("SERIAL_SESSION_ALREADY_CLOSED") ||
    message.includes("SERIAL_SESSION_NOT_CONNECTED")
  ) {
    return "This serial session is no longer connected. Connect to start a new session.";
  }
  if (
    message.includes("DEVICE_NOT_FOUND") ||
    message.includes("SERIAL_DEVICE_STALE")
  ) {
    return "This serial port is no longer available. Rescan devices and select an available port.";
  }
  return "The serial operation failed. Retry, or reconnect the console before trying again.";
}

function LoadingConsole(): React.JSX.Element {
  return (
    <div
      className="space-y-3 p-3"
      data-state="loading"
      role="status"
      aria-label="Loading serial console"
    >
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

function EmptyConsole(): React.JSX.Element {
  return (
    <div
      className="flex min-h-72 items-center justify-center p-5 text-center"
      data-state="empty"
    >
      <div>
        <Icon
          className="mx-auto size-5 text-muted-foreground"
          name="Terminal"
        />
        <p className="mt-2 text-sm font-medium">No serial port available</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Connect a UART adapter, install pyserial if prompted, then rescan the
          bench.
        </p>
      </div>
    </div>
  );
}

export function SerialConsole({
  projectId,
  projectVersionId,
  devices,
}: SerialConsoleProps): React.JSX.Element {
  const rpc = useRpc<typeof serialRpcContract>();
  const serialDevices = useMemo(
    () => devices.filter((device) => device.kind === "serial"),
    [devices],
  );
  const [deviceId, setDeviceId] = useState<string | null>(
    serialDevices[0]?.deviceId ?? null,
  );
  const [state, setState] = useState<ConsoleState>({ kind: "loading" });
  const [lines, setLines] = useState<SerialLine[]>([]);
  const [gaps, setGaps] = useState<SerialGap[]>([]);
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const cursorRef = useRef(0);
  const filterRef = useRef("");
  const appliedFilterRef = useRef("");
  const pausedRef = useRef(false);
  const sourceKeyRef = useRef("");
  const scope = useMemo(
    () => ({ projectId, projectVersionId }),
    [projectId, projectVersionId],
  );
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 22,
    overscan: 12,
  });

  useEffect(() => {
    if (serialDevices.some((device) => device.deviceId === deviceId)) return;
    setDeviceId(serialDevices[0]?.deviceId ?? null);
  }, [deviceId, serialDevices]);

  const loadSession = useCallback(async () => {
    if (!deviceId) {
      setState({ kind: "empty" });
      return;
    }
    try {
      const current = await rpc.call("benchDevSerialSessionCurrent", {
        ...scope,
        deviceId,
      });
      const autoConnect = current
        ? null
        : await rpc.call("benchDevSerialAutoConnectStatus", scope);
      setState({
        kind: "ready",
        connection: current?.state ?? autoConnect?.state ?? "closed",
        message: current?.message ?? autoConnect?.message ?? null,
      });
      if (current && !pausedRef.current) {
        const filterChanged = appliedFilterRef.current !== filterRef.current;
        const readRequest = {
          ...scope,
          device: deviceId,
          cursor: filterChanged ? 0 : cursorRef.current,
          maxLines: 200,
          ...(filterRef.current ? { filter: filterRef.current } : {}),
        };
        const result = await rpc.call("benchDevSerialLinesRead", readRequest);
        setLines((existing) => {
          if (filterChanged) return result.lines.slice(-10_000);
          const cursors = new Set(existing.map((line) => line.cursor));
          return [
            ...existing,
            ...result.lines.filter((line) => !cursors.has(line.cursor)),
          ]
            .sort((left, right) => left.cursor - right.cursor)
            .slice(-10_000);
        });
        setGaps((existing) => {
          if (filterChanged) return result.gaps.slice(-100);
          const keys = new Set(
            existing.map((gap) => `${gap.afterCursor}:${gap.dropped}`),
          );
          return [
            ...existing,
            ...result.gaps.filter(
              (gap) => !keys.has(`${gap.afterCursor}:${gap.dropped}`),
            ),
          ].slice(-100);
        });
        appliedFilterRef.current = filterRef.current;
        setFilterError(null);
        cursorRef.current = result.nextCursor;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Serial console failed.";
      if (message.includes("INVALID_SERIAL_FILTER")) setFilterError(message);
      else setState({ kind: "error", message });
    }
  }, [deviceId, rpc, scope]);

  useEffect(() => {
    const sourceKey = `${projectId}\u0000${projectVersionId ?? ""}\u0000${deviceId ?? ""}`;
    pausedRef.current = paused;
    filterRef.current = filter;
    if (sourceKeyRef.current !== sourceKey) {
      sourceKeyRef.current = sourceKey;
      cursorRef.current = 0;
      appliedFilterRef.current = filter;
      setLines([]);
      setGaps([]);
      setState(
        serialDevices.length === 0 ? { kind: "empty" } : { kind: "loading" },
      );
    }
    if (!paused) void loadSession();
  }, [
    deviceId,
    filter,
    loadSession,
    paused,
    projectId,
    projectVersionId,
    serialDevices.length,
  ]);

  useRealtime("serial:changed", (hint) => {
    if (
      hint !== null &&
      typeof hint === "object" &&
      Reflect.get(hint, "deviceId") === deviceId &&
      !pausedRef.current
    )
      void loadSession();
  });

  useEffect(() => {
    if (paused || lines.length === 0) return;
    virtualizer.scrollToIndex(lines.length - 1, { align: "end" });
  }, [lines.length, paused, virtualizer]);

  const perform = useCallback(
    async (operation: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      setActionError(null);
      try {
        await operation();
        await loadSession();
        return true;
      } catch (error) {
        setActionError(actionableSerialError(error));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [loadSession],
  );

  if (state.kind === "loading") return <LoadingConsole />;
  if (state.kind === "empty") return <EmptyConsole />;
  if (state.kind === "error") {
    return (
      <div className="p-3" data-state="error">
        <Alert className="border-destructive/40">
          <Icon className="size-4 text-destructive" name="AlertTriangle" />
          <AlertDescription className="space-y-3">
            <p>{state.message}</p>
            <Button
              onClick={() => {
                setState({ kind: "loading" });
                void loadSession();
              }}
              size="sm"
              variant="outline"
            >
              Retry console
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <section
      className="flex h-[34rem] min-h-0 flex-col"
      data-state={state.connection}
    >
      <header className="space-y-2 border-b border-border bg-muted/20 p-2.5">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" name="Terminal" />
          <h2 className="text-sm font-semibold">Serial console</h2>
          <Badge className="ml-auto" variant={STATE_VARIANTS[state.connection]}>
            {STATE_LABELS[state.connection]}
          </Badge>
        </div>
        <select
          aria-label="Serial device"
          className="h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-xs"
          disabled={busy}
          onChange={(event) => setDeviceId(event.target.value)}
          value={deviceId ?? ""}
        >
          {serialDevices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {[device.make, device.model].filter(Boolean).join(" ") ||
                device.deviceId}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <Input
            aria-label="Serial regex filter"
            className="h-8 min-w-0 font-mono text-xs"
            onChange={(event) => {
              setFilterError(null);
              setFilter(event.target.value);
            }}
            placeholder="Regex filter"
            value={filter}
          />
          <Button
            onClick={() =>
              setPaused((value) => {
                pausedRef.current = !value;
                return !value;
              })
            }
            size="sm"
            variant="outline"
          >
            <Icon name={paused ? "Play" : "Pause"} />
            {paused ? "Resume" : "Pause"}
          </Button>
          {state.connection === "connected" ||
          state.connection === "reconnecting" ? (
            <Button
              disabled={busy}
              onClick={() =>
                deviceId &&
                void perform(async () => {
                  await rpc.call("benchDevSerialSessionClose", {
                    ...scope,
                    deviceId,
                  });
                })
              }
              size="sm"
              variant="outline"
            >
              Close
            </Button>
          ) : (
            <Button
              disabled={busy}
              onClick={() =>
                deviceId &&
                void perform(async () => {
                  await rpc.call("benchDevSerialSessionOpen", {
                    ...scope,
                    deviceId,
                    baud: 115_200,
                  });
                })
              }
              size="sm"
            >
              Connect
            </Button>
          )}
        </div>
        {filterError ? (
          <p className="text-xs text-destructive" role="alert">
            {filterError}
          </p>
        ) : null}
      </header>

      {state.connection === "unconfigured" ? (
        <Alert className="m-2 border-border" data-state="unconfigured">
          <Icon className="size-4" name="Settings" />
          <AlertDescription>
            {state.message ??
              "Python with pyserial is required. Review the serial helper in the device registry."}
          </AlertDescription>
        </Alert>
      ) : null}
      {state.connection === "reconnecting" ? (
        <div
          className="border-b border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
          role="status"
        >
          Reconnecting with capped backoff. Capture continues when the port
          returns.
        </div>
      ) : null}
      {state.message && state.connection === "closed" ? (
        <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
          {state.message}
        </div>
      ) : null}
      {actionError ? (
        <div
          className="border-b border-destructive/30 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {actionError}
        </div>
      ) : null}
      {gaps.map((gap, index) => (
        <div
          className="border-b border-border bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground"
          key={`${gap.afterCursor}-${index}`}
        >
          <Icon className="mr-1 inline size-3.5" name="AlertCircle" />
          {gap.dropped.toLocaleString()} lines dropped before cursor{" "}
          {gap.afterCursor.toLocaleString()}
        </div>
      ))}
      <div
        className="min-h-0 flex-1 overflow-auto bg-background font-mono text-xs"
        ref={viewport}
      >
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const line = lines[virtualRow.index]!;
            return (
              <div
                className="absolute left-0 top-0 grid w-full grid-cols-[4.5rem_1.5rem_minmax(0,1fr)] gap-2 border-b border-border/50 px-2 py-1"
                data-index={virtualRow.index}
                key={line.cursor}
                ref={virtualizer.measureElement}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <span className="tabular-nums text-muted-foreground">
                  {line.cursor}
                </span>
                <span
                  className={
                    line.dir === "tx" ? "text-primary" : "text-muted-foreground"
                  }
                >
                  {line.dir}
                </span>
                <span className="whitespace-pre-wrap break-all text-foreground">
                  {line.text}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <SerialSendBar
        busy={busy}
        connected={state.connection === "connected"}
        review={async (data) => {
          setBusy(true);
          setActionError(null);
          try {
            if (!deviceId) return null;
            const result = await rpc.call("benchDevSerialSendReview", {
              ...scope,
              device: deviceId,
              data,
            });
            return result.sendToken;
          } catch (error) {
            setActionError(
              error instanceof Error
                ? error.message
                : "Serial send review failed.",
            );
            return null;
          } finally {
            setBusy(false);
          }
        }}
        send={(data, sendToken) =>
          perform(async () => {
            if (!deviceId) return;
            await rpc.call("benchDevSerialSend", {
              ...scope,
              device: deviceId,
              data,
              sendToken,
            });
          })
        }
      />
      <p className="border-t border-border px-2 py-1.5 text-xs text-muted-foreground">
        Transcript policy retains at most 50 MiB per session and the newest 10
        sessions per device.
      </p>
    </section>
  );
}
