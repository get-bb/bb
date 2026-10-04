import { useState } from "react";
import {
  useRpc,
  type PluginTimelineRendererProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { automationRunMarkerSchema } from "./src/run-marker";
import type { automationRpcContract } from "./src/rpc";

export function AutomationRunMarker({
  row,
  payload,
  Original,
}: PluginTimelineRendererProps) {
  const rpc = useRpc<typeof automationRpcContract>();
  const [expanded, setExpanded] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retried, setRetried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = automationRunMarkerSchema.safeParse(payload);
  if (!parsed.success || parsed.data.execution.mode !== "agent")
    return <Original />;
  const marker = parsed.data;
  const failed = row.status === "error" || row.status === "interrupted";
  const glyph = failed
    ? "CircleAlert"
    : row.status === "completed"
      ? "Check"
      : "Timer";
  const status =
    row.status === "interrupted"
      ? "Stopped"
      : failed
        ? "Failed"
        : row.status === "completed"
          ? "Finished"
          : "Running";
  const retry = async () => {
    setRetrying(true);
    setError(null);
    try {
      await rpc.call("automations_run", {
        projectId: marker.projectId,
        automationId: marker.automationId,
        retryRunId: marker.runId,
        idempotencyKey: `retry:${marker.runId}`,
      });
      setRetried(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRetrying(false);
    }
  };
  return (
    <div className="py-1 text-sm" data-automation-run={marker.runId}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
        <Icon name={glyph} className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 break-words font-medium text-foreground">
          {marker.name}
          {failed ? " didn’t finish" : ""}
        </span>
        <span aria-hidden>·</span>
        <time
          dateTime={new Date(row.startedAt).toISOString()}
          title={new Date(row.startedAt).toLocaleString()}
        >
          {new Date(row.startedAt).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </time>
        <span className="text-xs">{status}</span>
        <button
          type="button"
          className="min-h-6 rounded px-1 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Hide prompt" : "View prompt"}
        </button>
        {failed && (
          <button
            type="button"
            className="inline-flex min-h-6 items-center gap-1 rounded px-1 font-medium text-foreground hover:underline disabled:opacity-50"
            disabled={retrying || retried}
            onClick={() => void retry()}
          >
            {retrying && (
              <Icon
                name="LoaderCircle"
                className="size-3 animate-spin"
                aria-hidden
              />
            )}
            {retried ? "Retry queued" : "Retry"}
          </button>
        )}
      </div>
      {expanded && (
        <div className="mt-2 whitespace-pre-wrap break-words border-l border-border pl-5 text-foreground">
          {marker.execution.prompt}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
