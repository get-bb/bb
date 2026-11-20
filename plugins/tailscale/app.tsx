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
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { CopyIconButton } from "@bb/shared-ui/copy-button";
import { useSdkClipboardCopy } from "@bb/shared-ui/sdk-clipboard-copy";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
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

type PrimaryAction =
  | { kind: "setup" }
  | { kind: "remove" }
  | { kind: "link"; label: string; href: string }
  | null;

interface View {
  tone: Tone;
  title: string;
  body: string | null;
  primary: PrimaryAction;
}

function adminLink(status: TailscaleStatus, label: string): PrimaryAction {
  return status.adminUrl === null
    ? null
    : { kind: "link", label, href: status.adminUrl };
}

function servedView(status: TailscaleStatus): View {
  const remove: PrimaryAction =
    status.serve?.owner === "bb" ? { kind: "remove" } : null;
  if (status.https === null) {
    return {
      tone: "muted",
      title: "Checking the address…",
      body: null,
      primary: remove,
    };
  }
  if (status.https.result === "other-server") {
    return {
      tone: "bad",
      title: "Reaches a different bb server",
      body: status.https.error,
      primary: remove,
    };
  }
  if (status.https.result === "no-answer") {
    return {
      tone: "warn",
      title: "Set up, but not answering yet",
      body: status.https.error,
      primary: remove,
    };
  }
  if (status.serve?.funnel === true) {
    return {
      tone: "warn",
      title: "Public on the internet (Funnel is on)",
      body: status.message,
      primary: remove,
    };
  }
  return {
    tone: "ok",
    title: "Reachable on your tailnet",
    body: null,
    primary: remove,
  };
}

function viewOf(status: TailscaleStatus): View {
  switch (status.state) {
    case "not-installed":
      return {
        tone: "muted",
        title: "Install Tailscale",
        body: "Install Tailscale on the machine running this bb server, then sign in.",
        primary: adminLink(status, "Download Tailscale"),
      };
    case "not-running":
      return {
        tone: "muted",
        title: "Connect Tailscale",
        body: status.message,
        primary: null,
      };
    case "logged-out":
      return {
        tone: "muted",
        title: "Sign in to Tailscale",
        body: "Sign in to Tailscale on the machine running this bb server.",
        primary: null,
      };
    case "needs-approval":
      return {
        tone: "warn",
        title: "Approve this machine",
        body: "This machine is waiting for approval in your tailnet.",
        primary: adminLink(status, "Open machines"),
      };
    case "needs-magicdns":
      return {
        tone: "warn",
        title: "Turn on MagicDNS",
        body: "Tailscale needs MagicDNS to give this machine a ts.net name.",
        primary: adminLink(status, "Open DNS settings"),
      };
    case "needs-https":
      return {
        tone: "warn",
        title: "Turn on HTTPS certificates",
        body: "Tailscale needs HTTPS certificates to serve bb at an https:// address. They're in the same DNS settings.",
        primary: adminLink(status, "Open DNS settings"),
      };
    case "not-served":
      return {
        tone: "muted",
        title: "Not set up",
        body:
          status.dnsName === null
            ? "Gives bb a private HTTPS address on your tailnet."
            : `Gives bb a private HTTPS address at ${status.dnsName}. Only devices on your tailnet can open it.`,
        primary: { kind: "setup" },
      };
    case "conflict":
      return {
        tone: "bad",
        title: "Serve ports are in use",
        body: status.message,
        primary: null,
      };
    case "served":
      return servedView(status);
    case "error":
      return {
        tone: "bad",
        title: "Couldn't read Tailscale",
        body: status.message,
        primary: null,
      };
  }
}

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

  useEffect(() => {
    window.addEventListener("focus", refetch);
    return () => window.removeEventListener("focus", refetch);
  }, [refetch]);

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
          const probe = method === "setup" ? (next?.https ?? null) : null;
          if (probe !== null && probe.result !== "ok") {
            toast.warning(
              probe.result === "other-server"
                ? "Tailscale Serve is set up, but the address reaches a different bb server"
                : "Tailscale Serve is set up, but the address isn't answering yet",
              { id, description: probe.error ?? undefined },
            );
            return;
          }
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

  return { status, loadError, run, refetch };
}

function CheckAgainButton({ onClick }: { onClick: () => void }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground"
            aria-label="Check again"
            onClick={onClick}
          >
            <Icon name="RotateCcw" className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Check again</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function PrimaryButton({
  action,
  run,
}: {
  action: PrimaryAction;
  run: (method: "setup" | "teardown") => void;
}) {
  if (action === null) return null;
  switch (action.kind) {
    case "setup":
      return (
        <Button size="sm" onClick={() => run("setup")}>
          Set up
        </Button>
      );
    case "remove":
      return (
        <Button size="sm" variant="outline" onClick={() => run("teardown")}>
          Remove
        </Button>
      );
    case "link":
      return (
        <Button size="sm" asChild>
          <UrlLink href={action.href} target="_blank" rel="noreferrer">
            {action.label}
          </UrlLink>
        </Button>
      );
  }
}

function CopyAddressButton({ url }: { url: string }) {
  const { copied, copy } = useSdkClipboardCopy({ text: url });
  return (
    <CopyIconButton
      label="Copy address"
      className="size-6 shrink-0 rounded-md hover:bg-state-hover"
      iconClassName="size-3.5"
      copied={copied}
      onCopy={() => void copy()}
    />
  );
}

function TailscaleSettingsSection() {
  const { status, loadError, run, refetch } = useTailscaleStatus();

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

  const view = viewOf(status);
  const serve = status.serve;
  return (
    <div className="space-y-2">
      <div className="space-y-1.5 rounded-lg border border-border bg-card px-4 py-3">
        <div className="-mr-1.5 flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2" role="status">
            <StatusDot tone={view.tone} />
            <span className="truncate text-sm font-medium">{view.title}</span>
          </div>
          <CheckAgainButton onClick={refetch} />
        </div>
        {serve !== null ? (
          <div className="flex min-w-0 items-center gap-1.5">
            <UrlLink
              href={serve.url}
              target="_blank"
              rel="noreferrer"
              className="truncate font-mono text-sm text-foreground hover:underline"
            >
              {serve.url}
            </UrlLink>
            <CopyAddressButton url={serve.url} />
          </div>
        ) : null}
        {view.body !== null ? (
          <p
            className={cn(
              "text-xs",
              serve !== null && view.tone !== "ok"
                ? "text-warning-text"
                : "text-muted-foreground",
            )}
          >
            {view.body}
          </p>
        ) : null}
        {serve !== null ? (
          <p className="text-xs text-subtle-foreground">
            {serve.owner === "adopted"
              ? "Set up outside bb, so bb won't remove it"
              : "Set up by bb"}{" "}
            · forwards to {status.target}
          </p>
        ) : null}
        {view.primary !== null ? (
          <div className="pt-1.5">
            <PrimaryButton action={view.primary} run={run} />
          </div>
        ) : null}
      </div>
      {serve?.owner === "bb" ? (
        <p className="text-xs text-subtle-foreground">
          Stays on if bb stops or this plugin is turned off. Remove turns it
          off.
        </p>
      ) : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "tailscale",
    component: TailscaleSettingsSection,
  });
});
