import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  definePluginApp,
  UrlLink,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import type { tailscaleRpcContract } from "./src/rpc.js";
import {
  TAILSCALE_REALTIME_CHANNEL,
  tailscaleStatusSchema,
  type TailscaleStatus,
} from "./src/types.js";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asStatus(value: unknown): TailscaleStatus | null {
  const parsed = tailscaleStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

type Tone = "ok" | "warn" | "bad" | "muted";

const STATE_COPY: Record<
  TailscaleStatus["state"],
  { label: string; tone: Tone }
> = {
  "not-installed": { label: "Tailscale isn't installed", tone: "muted" },
  "not-running": { label: "Tailscale isn't connected", tone: "muted" },
  "logged-out": { label: "Signed out of Tailscale", tone: "muted" },
  "needs-approval": { label: "Waiting for tailnet approval", tone: "warn" },
  "needs-magicdns": { label: "MagicDNS is off", tone: "warn" },
  "needs-https": { label: "HTTPS certificates are off", tone: "warn" },
  "not-served": { label: "Not set up", tone: "muted" },
  conflict: { label: "Serve ports are in use", tone: "bad" },
  served: { label: "Reachable on your tailnet", tone: "ok" },
  error: { label: "Couldn't read Tailscale", tone: "bad" },
};

const ADMIN_LINK_TEXT: Partial<Record<TailscaleStatus["state"], string>> = {
  "not-installed": "Download Tailscale",
  "needs-approval": "Open machines in the admin console",
  "needs-magicdns": "Open DNS settings",
  "needs-https": "Open DNS settings",
};

function StatusDot({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        tone === "ok" && "bg-success",
        tone === "warn" && "bg-warning",
        tone === "bad" && "bg-destructive",
        tone === "muted" && "bg-muted-foreground/50",
      )}
    />
  );
}

function useTailscaleStatus() {
  const rpc = useRpc<typeof tailscaleRpcContract>();
  const connectionState = useRealtimeConnectionState();
  const [status, setStatus] = useState<TailscaleStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const latest = useRef(0);

  const accept = useCallback((value: unknown) => {
    const next = asStatus(value);
    if (next === null) return;
    latest.current += 1;
    setStatus(next);
    setLoadError(null);
  }, []);

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

  useRealtime(TAILSCALE_REALTIME_CHANNEL, accept);

  const run = useCallback(
    (method: "setup" | "teardown") => {
      const id = toast.loading(
        method === "setup"
          ? "Setting up Tailscale Serve…"
          : "Removing bb's Tailscale Serve mapping…",
      );
      rpc.call(method).then(
        (result) => {
          accept(result);
          const next = asStatus(result);
          toast.success(
            method === "setup"
              ? "bb is reachable on your tailnet"
              : "Tailscale Serve mapping removed",
            {
              id,
              ...(method === "setup" && next?.serve
                ? { description: next.serve.url }
                : {}),
            },
          );
        },
        (error: unknown) => {
          toast.error(
            method === "setup"
              ? "Couldn't set up Tailscale Serve"
              : "Couldn't remove the Tailscale Serve mapping",
            { id, description: errorText(error) },
          );
          refetch();
        },
      );
    },
    [accept, refetch, rpc],
  );

  return { status, loadError, refetch, run };
}

function TailscaleSettingsSection() {
  const { status, loadError, refetch, run } = useTailscaleStatus();

  if (loadError !== null) {
    return (
      <p role="alert" className="text-sm text-destructive-text">
        Failed to load Tailscale status: {loadError}
      </p>
    );
  }
  if (status === null) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  const copy = STATE_COPY[status.state];
  const adminLink = ADMIN_LINK_TEXT[status.state];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2" role="status">
        <StatusDot tone={copy.tone} />
        <span className="text-sm font-medium">{copy.label}</span>
      </div>
      {status.serve !== null ? (
        <div className="space-y-1">
          <UrlLink
            href={status.serve.url}
            target="_blank"
            rel="noreferrer"
            className="block truncate font-mono text-sm text-foreground hover:underline"
          >
            {status.serve.url}
          </UrlLink>
          <p className="text-xs text-muted-foreground">
            {status.serve.owner === "adopted"
              ? "Set up outside bb. bb uses it as it is and won't remove it."
              : `Set up by bb on port ${status.serve.port}. It stays in place when bb stops or this plugin is disabled; Remove turns it off.`}{" "}
            Forwards to {status.target}.
          </p>
          {status.https !== null && !status.https.ok ? (
            <p className="text-xs text-warning-text">{status.https.error}</p>
          ) : null}
        </div>
      ) : status.dnsName !== null ? (
        <p className="truncate font-mono text-sm text-muted-foreground">
          {status.dnsName}
        </p>
      ) : null}
      {status.message !== null ? (
        <p className="text-xs text-muted-foreground">{status.message}</p>
      ) : null}
      {adminLink !== undefined && status.adminUrl !== null ? (
        <UrlLink
          href={status.adminUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-xs text-foreground underline-offset-4 hover:underline"
        >
          {adminLink}
        </UrlLink>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {status.state === "not-served" ? (
          <Button size="sm" onClick={() => run("setup")}>
            Set up
          </Button>
        ) : null}
        {status.serve?.owner === "bb" ? (
          <Button size="sm" variant="outline" onClick={() => run("teardown")}>
            Remove
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={refetch}>
          Check again
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Only devices on your tailnet that its access rules allow can reach this
        address. Also <code>bb tailscale status|setup|teardown</code>.
      </p>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "tailscale",
    description:
      "Reach this bb privately at its Tailscale address through Tailscale Serve.",
    component: TailscaleSettingsSection,
  });
});
