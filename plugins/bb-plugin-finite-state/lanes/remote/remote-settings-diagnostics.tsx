import { useCallback, useEffect, useRef, useState } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@bb/plugin-sdk/app";
import { Alert, AlertDescription } from "@bb/shared-ui/alert";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { REMOTE_CONNECTIONS_CHANGED_CHANNEL } from "./connection-state.js";
import {
  remoteDiagnosticsRpcContract,
  type RemoteSelfDiagnosisView,
} from "./diagnostics-contract.js";

interface RemoteRowProps {
  name: string;
  diagnosis: RemoteSelfDiagnosisView;
}

const STATE_LABELS = {
  checking: "Checking",
  ok: "OK",
  "auth-failed": "Auth failed",
  unreachable: "Unreachable",
  "timed-out": "Timed out",
  "not-configured": "Not configured",
  "invalid-settings": "Invalid settings",
  "request-failed": "Request failed",
} as const satisfies Record<RemoteSelfDiagnosisView["state"], string>;

function RemoteRow({ name, diagnosis }: RemoteRowProps): React.JSX.Element {
  const isError = [
    "auth-failed",
    "unreachable",
    "timed-out",
    "invalid-settings",
    "request-failed",
  ].includes(diagnosis.state);
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">{name}</p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            Authenticated read assertion
          </p>
        </div>
        <Badge variant={isError ? "destructive" : "outline"}>
          {STATE_LABELS[diagnosis.state]}
        </Badge>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {diagnosis.message}
      </p>
      {diagnosis.checkedAt === null ? null : (
        <p className="mt-2 text-xs text-muted-foreground">
          Checked {new Date(diagnosis.checkedAt).toLocaleString()}
        </p>
      )}
    </article>
  );
}

export function RemoteSettingsDiagnostics(): React.JSX.Element {
  const rpc = useRpc<typeof remoteDiagnosticsRpcContract>();
  const realtimeConnection = useRealtimeConnectionState();
  const connectedOnce = useRef(false);
  const [diagnosis, setDiagnosis] = useState<{
    platform: RemoteSelfDiagnosisView;
    assuranceStudio: RemoteSelfDiagnosisView;
  } | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setDiagnosis(await rpc.call("remoteConnectionSelfDiagnosis", null));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [rpc]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  useRealtime(REMOTE_CONNECTIONS_CHANGED_CHANNEL, () => {
    void refresh();
  });
  useEffect(() => {
    if (realtimeConnection !== "connected") return;
    const timer = connectedOnce.current
      ? window.setTimeout(() => void refresh(), 0)
      : null;
    connectedOnce.current = true;
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [realtimeConnection, refresh]);

  if (diagnosis === null && !failed) {
    return (
      <div
        aria-label="Checking remote connections"
        className="grid gap-3"
        role="status"
      >
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }
  if (failed) {
    return (
      <Alert>
        <Icon name="AlertCircle" />
        <AlertDescription className="flex items-center gap-3">
          <span>Remote self-diagnosis is unavailable.</span>
          <Button
            className="ml-auto"
            onClick={() => void refresh()}
            size="sm"
            variant="outline"
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (diagnosis === null) throw new Error("unreachable diagnosis state");
  return (
    <div
      className="grid gap-3"
      role="status"
      aria-label="Remote connection self-diagnosis"
    >
      <RemoteRow name="Finite State Platform" diagnosis={diagnosis.platform} />
      <RemoteRow
        name="Assurance Studio"
        diagnosis={diagnosis.assuranceStudio}
      />
    </div>
  );
}
