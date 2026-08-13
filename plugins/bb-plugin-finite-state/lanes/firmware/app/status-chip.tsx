import { useCallback, useEffect, useRef, useState } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@bb/plugin-sdk/app";
import { Alert, AlertDescription } from "@bb/shared-ui/alert";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type { rpcContract } from "../../../shared/contract.js";
import type { FirmwareStatusState, FirmwareStatusView } from "../status.js";
import { MaterializeDialog } from "./materialize-dialog.js";
import { VersionDiff } from "./version-diff.js";

const labels: Record<FirmwareStatusState, string> = {
  not_materialized: "Not materialized",
  hashing: "Hashing",
  unpacking: "Unpacking",
  validating: "Validating",
  ingesting: "Ingesting",
  ready: "Ready",
  ready_with_gaps: "Ready with gaps",
  metadata_only: "Metadata only",
  stale: "Stale",
  error: "Error",
};

const activeStates = new Set<FirmwareStatusState>(["hashing", "unpacking", "validating", "ingesting"]);

function statusFromFields(fields: Record<string, unknown>): FirmwareStatusView | null {
  const state = fields.state;
  const pvId = fields.pvId ?? fields.projectVersionId;
  if (typeof pvId !== "string" || typeof state !== "string" || !(state in labels)) return null;
  const source = fields.source;
  return {
    pvId,
    source: source === "api" || source === "standalone_unpack" ? source : null,
    state: state as FirmwareStatusState,
    files: typeof fields.files === "number" ? fields.files : 0,
    materializedFiles: typeof fields.materializedFiles === "number" ? fields.materializedFiles : 0,
    errors: typeof fields.errors === "number" ? fields.errors : 0,
    inputSha256: typeof fields.inputSha256 === "string" ? fields.inputSha256 : null,
    artifactHash: typeof fields.artifactHash === "string" ? fields.artifactHash : null,
    ...(typeof fields.message === "string" ? { message: fields.message } : {}),
  };
}

function signalPvId(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = Reflect.get(payload, "pvId");
  return typeof value === "string" ? value : null;
}

function StatusBadge({ status }: { status: FirmwareStatusView }): React.JSX.Element {
  const active = activeStates.has(status.state);
  const className = status.state === "ready"
    ? "border-success/40 bg-success/10 text-success"
    : status.state === "error"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : status.state === "ready_with_gaps" || status.state === "metadata_only" || status.state === "stale"
        ? "border-border bg-muted text-muted-foreground"
        : undefined;
  return (
    <Badge variant="outline" className={className}>
      {active ? <Icon name="Loading" className="mr-1 size-3 animate-spin" /> : null}
      {labels[status.state]}
    </Badge>
  );
}

export function FirmwareStatusChip({
  projectId,
  isCompactViewport,
}: PluginThreadHeaderActionProps): React.JSX.Element {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const connectedOnce = useRef(false);
  const [status, setStatus] = useState<FirmwareStatusView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      setError("Select a project to inspect firmware.");
      return;
    }
    setError(null);
    try {
      const mounts = await rpc.call("firmwareMountsList", {
        projectId,
        projectVersionId: null,
        pageSize: 1,
        continuation: null,
      });
      const first = mounts.items[0];
      if (!first || first.projectVersionId === null) {
        setStatus(null);
        return;
      }
      const detail = await rpc.call("firmwareMountGet", {
        projectId,
        projectVersionId: first.projectVersionId,
      });
      setStatus(statusFromFields(detail.fields));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Firmware status is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [projectId, rpc]);

  useEffect(() => { void refresh(); }, [refresh]);
  useRealtime("firmware:progress", (payload) => {
    const pvId = signalPvId(payload);
    if (pvId !== null && status?.pvId === pvId) void refresh();
  });
  useRealtime("firmware:changed", (payload) => {
    const pvId = signalPvId(payload);
    if (pvId !== null && (status === null || status.pvId === pvId)) void refresh();
  });
  useEffect(() => {
    if (connection !== "connected") return;
    if (connectedOnce.current) void refresh();
    connectedOnce.current = true;
  }, [connection, refresh]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 max-w-44 gap-1.5 px-2"
          aria-label="Firmware status"
        >
          <Icon name="Code" className="size-4 shrink-0" />
          {!isCompactViewport ? (
            loading ? <Skeleton className="h-4 w-20" /> : status ? <StatusBadge status={status} /> : <span>Firmware</span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,32rem)] space-y-4" mobileTitle="Firmware status">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Firmware</h3>
            <p className="text-sm text-muted-foreground">Authoritative mount status; realtime only prompts a refetch.</p>
          </div>
          <MaterializeDialog projectId={projectId} initialPvId={status?.pvId} onStarted={() => void refresh()} />
        </div>

        {loading ? (
          <div className="space-y-2" aria-label="Loading firmware status">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : status ? (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-sm">{status.pvId}</span>
              <StatusBadge status={status} />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div><dt className="text-muted-foreground">Files</dt><dd>{status.materializedFiles.toLocaleString()} / {status.files.toLocaleString()}</dd></div>
              <div><dt className="text-muted-foreground">Errors</dt><dd>{status.errors.toLocaleString()}</dd></div>
              <div><dt className="text-muted-foreground">Source</dt><dd>{status.source === "standalone_unpack" ? "Local image" : status.source === "api" ? "API fallback" : "Unknown"}</dd></div>
              <div><dt className="text-muted-foreground">Rootfs</dt><dd>{status.state === "ready" || status.state === "ready_with_gaps" ? "Available in workspace" : "Not available"}</dd></div>
            </dl>
            {status.inputSha256 ? <p className="break-all font-mono text-xs text-muted-foreground">Input {status.inputSha256}</p> : null}
            {status.artifactHash ? <p className="break-all font-mono text-xs text-muted-foreground">Firmware {status.artifactHash}</p> : null}
            {status.message ? <p className="text-sm text-muted-foreground">{status.message}</p> : null}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-sm">
            <p className="font-medium">No firmware is materialized</p>
            <p className="mt-1 text-muted-foreground">Start with a local image, or load API metadata as a bounded fallback.</p>
          </div>
        )}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>{error} Existing status is retained when available.</span>
              <Button size="sm" variant="outline" onClick={() => void refresh()}>Retry</Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Binary inspection: in the native file tree choose Open with → Firmware binary metadata.
          Use the same visible action for extensionless executables; the opener verifies manifest MIME/full type before showing metadata.
        </p>

        <VersionDiff projectId={projectId} initialToPvId={status?.pvId ?? ""} />
      </PopoverContent>
    </Popover>
  );
}
