import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@bb/plugin-sdk/app";
import { Alert, AlertDescription } from "@bb/shared-ui/alert";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type { rpcContract } from "../../shared/contract.js";
import { REMOTE_CONNECTIONS_CHANGED_CHANNEL } from "./connection-state.js";

interface PlatformConnection {
  state:
    | "needs-configuration"
    | "disabled"
    | "configured"
    | "connected"
    | "unreachable";
  message: string | null;
}

type ConnectionGateState =
  | { kind: "loading" }
  | { kind: "ready"; platform: PlatformConnection }
  | { kind: "error" };

const SETTINGS_PATH = "/settings/plugins/finite-state";

function LoadingState(): React.JSX.Element {
  return (
    <div
      aria-label="Loading Finite State connection status"
      className="flex h-full items-center justify-center bg-background p-6"
      role="status"
    >
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-sm">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-4 h-7 w-64 max-w-full" />
        <Skeleton className="mt-3 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-4/5" />
        <Skeleton className="mt-6 h-9 w-44" />
      </div>
    </div>
  );
}

function UnconfiguredState({ message }: { message: string | null }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center bg-background p-6 text-foreground">
      <section
        aria-labelledby="finite-state-connect-title"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-card shadow-sm"
      >
        <div className="border-b border-border bg-muted/40 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
              <Icon name="ElectricPlugs" className="size-4" />
            </span>
            <div>
              <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                PLATFORM CONNECTION
              </p>
              <h1
                className="mt-1 text-lg font-semibold"
                id="finite-state-connect-title"
              >
                Connect Finite State Platform
              </h1>
            </div>
          </div>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm leading-6 text-muted-foreground">
            {message ??
              "Configure the Platform URL and API token to load Finite State data in this panel."}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Optional Assurance Studio and Forge Compute connections remain independent.
          </p>
          <Button asChild className="mt-5">
            <a href={SETTINGS_PATH}>
              <Icon name="Settings" />
              Open connection settings
              <Icon name="ExternalLink" />
            </a>
          </Button>
        </div>
      </section>
    </div>
  );
}

export function PlatformConnectionGate({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const rpc = useRpc<typeof rpcContract>();
  const realtimeConnection = useRealtimeConnectionState();
  const connectedOnce = useRef(false);
  const [state, setState] = useState<ConnectionGateState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const status = await rpc.call("connectionsStatus", null);
      setState({ kind: "ready", platform: status.platform });
    } catch {
      setState({ kind: "error" });
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime(REMOTE_CONNECTIONS_CHANGED_CHANNEL, () => {
    void refresh();
  });
  useEffect(() => {
    if (realtimeConnection !== "connected") return;
    if (connectedOnce.current) void refresh();
    connectedOnce.current = true;
  }, [realtimeConnection, refresh]);

  if (state.kind === "loading") return <LoadingState />;
  if (
    state.kind === "ready" &&
    state.platform.state === "needs-configuration"
  ) {
    return <UnconfiguredState message={state.platform.message} />;
  }
  if (state.kind === "error") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Alert className="m-3 w-auto shrink-0">
          <Icon name="AlertCircle" />
          <AlertDescription className="flex items-center gap-3">
            <span>
              Connection status is unavailable. Panel data remains accessible.
            </span>
            <Button className="ml-auto" onClick={() => void refresh()} size="sm" variant="outline">
              Retry
            </Button>
          </AlertDescription>
        </Alert>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    );
  }
  return <>{children}</>;
}
