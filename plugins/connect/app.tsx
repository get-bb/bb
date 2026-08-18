// bb-plugin-connect — the frontend bundle.
//
// One settingsSection "Remote access", driven by the `status` rpc and live
// `connect` realtime pushes. Four states, each matched to the redesign mock:
// not paired (promise + two numbered steps + auto-submitting code field),
// pairing (inline typed-code errors), connected (URL hero chip + QR toggle +
// shared ports + isolated disconnect), reconnecting (amber wash + dimmed
// body). Disconnect confirms in a dialog, then lands on the unpaired card
// with a transient receipt.
import { useCallback, useEffect, useRef, useState } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { connectRpcContract } from "./src/rpc.js";
import QRCode from "qrcode";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import { CONNECT_REALTIME_CHANNEL, type ConnectStatus } from "@/src/types";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Danger-quiet: a ghost button that carries the destructive tone (Disconnect,
// Revoke). Isolated from benign quiet buttons so it never looks like a peer.
const DANGER_QUIET_CLASS =
  "text-destructive-text hover:text-destructive-text hover:bg-surface-destructive";

// ---------------------------------------------------------------------------
// Typed pair errors → human copy (never raw RPC text; see rpc.ts).
// ---------------------------------------------------------------------------

type PairErrorCode =
  | "invalid_code"
  | "expired_code"
  | "already_used"
  | "network";

interface PairErrorCopy {
  lead: string;
  linkLabel: string;
  tail: string;
}

const PAIR_ERROR_COPY: Record<PairErrorCode, PairErrorCopy> = {
  invalid_code: {
    lead: "That code is invalid or has expired.",
    linkLabel: "Get a new code",
    tail: " — they only last 10 minutes.",
  },
  expired_code: {
    lead: "That code has expired.",
    linkLabel: "Get a new code",
    tail: " — they only last 10 minutes.",
  },
  already_used: {
    lead: "That code was already used.",
    linkLabel: "Get a new code",
    tail: " — each code works once.",
  },
  network: {
    lead: "Couldn't reach the Connect service.",
    linkLabel: "Open the dashboard",
    tail: " — check your connection, then try again.",
  },
};

function toPairErrorCode(error: unknown): PairErrorCode {
  const message = errorText(error);
  if (
    message === "invalid_code" ||
    message === "expired_code" ||
    message === "already_used" ||
    message === "network"
  ) {
    return message;
  }
  // Anything unexpected reads as a bad code rather than leaking wire text.
  return "invalid_code";
}

// ---------------------------------------------------------------------------
// Status parsing + small formatters.
// ---------------------------------------------------------------------------

function asStatus(payload: unknown): ConnectStatus | null {
  if (payload === null || typeof payload !== "object") return null;
  const record = payload as {
    state?: unknown;
    paired?: unknown;
    handle?: unknown;
    url?: unknown;
    dashboardUrl?: unknown;
    lastError?: unknown;
    nextRetryAt?: unknown;
    since?: unknown;
    remoteClients?: unknown;
    lastRemoteActivityAt?: unknown;
    shares?: unknown;
  };
  if (
    (record.state !== "disconnected" &&
      record.state !== "pairing" &&
      record.state !== "connected" &&
      record.state !== "reconnecting") ||
    typeof record.paired !== "boolean" ||
    typeof record.since !== "number"
  ) {
    return null;
  }
  const shares: ConnectStatus["shares"] = [];
  if (Array.isArray(record.shares)) {
    for (const entry of record.shares) {
      if (
        entry !== null &&
        typeof entry === "object" &&
        typeof (entry as { hostId?: unknown }).hostId === "string" &&
        typeof (entry as { hostName?: unknown }).hostName === "string" &&
        typeof (entry as { port?: unknown }).port === "number" &&
        typeof (entry as { createdAt?: unknown }).createdAt === "number" &&
        typeof (entry as { url?: unknown }).url === "string"
      ) {
        shares.push({
          hostId: (entry as { hostId: string }).hostId,
          hostName: (entry as { hostName: string }).hostName,
          port: (entry as { port: number }).port,
          createdAt: (entry as { createdAt: number }).createdAt,
          url: (entry as { url: string }).url,
          ...(typeof (entry as { unavailableReason?: unknown })
            .unavailableReason === "string"
            ? {
                unavailableReason: (entry as { unavailableReason: string })
                  .unavailableReason,
              }
            : {}),
        });
      }
    }
  }
  return {
    state: record.state,
    paired: record.paired,
    handle: typeof record.handle === "string" ? record.handle : null,
    url: typeof record.url === "string" ? record.url : null,
    dashboardUrl:
      typeof record.dashboardUrl === "string"
        ? record.dashboardUrl
        : "https://getbb.app/dashboard",
    lastError: typeof record.lastError === "string" ? record.lastError : null,
    nextRetryAt:
      typeof record.nextRetryAt === "number" ? record.nextRetryAt : null,
    since: record.since,
    remoteClients:
      typeof record.remoteClients === "number" ? record.remoteClients : 0,
    lastRemoteActivityAt:
      typeof record.lastRemoteActivityAt === "number"
        ? record.lastRemoteActivityAt
        : null,
    shares,
  };
}

/** "5:33 PM" when the timestamp is today, else "Jul 6" — never seconds. */
function formatSince(sinceMs: number): string {
  const at = new Date(sinceMs);
  const now = new Date();
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return sameDay
    ? at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Retry countdown from the backoff timer; computed at render (no live tick). */
function retryHint(nextRetryAt: number | null): string {
  if (nextRetryAt === null) return "retrying automatically";
  const seconds = Math.max(0, Math.round((nextRetryAt - Date.now()) / 1000));
  return seconds > 0 ? `retrying in ${seconds}s` : "retrying…";
}

/** Host-only display of a URL (drop the scheme); the raw string if unparsable. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}

/**
 * Normalize a pasted/typed connect code to the canonical `XXXX-XXXX` shape:
 * uppercase, strip whitespace and any dash variant, group 4-4. Partial input
 * returns a partial canonical value (used both for the field display and the
 * complete-code check that drives auto-submit).
 */
function formatConnectCode(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return cleaned.length > 4
    ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`
    : cleaned;
}

function isCompleteCode(formatted: string): boolean {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(formatted);
}

// ---------------------------------------------------------------------------
// Shared bits.
// ---------------------------------------------------------------------------

function StatusDot({ tone }: { tone: "ok" | "warn" | "muted" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        // Soft halo mixed from the tone anchor so it survives custom palettes.
        tone === "ok" &&
          "bg-success shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_18%,transparent)]",
        tone === "warn" &&
          "animate-pulse bg-warning shadow-[0_0_0_3px_color-mix(in_oklab,var(--warning)_22%,transparent)]",
        tone === "muted" && "bg-muted-foreground/50",
      )}
    />
  );
}

function StepNumber({ value }: { value: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-recessed text-xs font-medium text-muted-foreground"
    >
      {value}
    </span>
  );
}

function QrCodeImage({ value }: { value: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: 320 }).then(
      (url) => {
        if (!cancelled) setDataUrl(url);
      },
      () => {
        if (!cancelled) setDataUrl(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (dataUrl === null) return null;
  return (
    <img
      src={dataUrl}
      alt={`QR code for ${value}`}
      className="size-32 rounded-md border border-border bg-white p-1.5"
    />
  );
}

/**
 * The URL hero chip: recessed, single-line with ellipsis (never wraps
 * mid-address), Copy + optional Open attached. Copy has a real failure path —
 * on clipboard rejection it selects the URL text and flips to "Press ⌘C"
 * rather than failing silently.
 */
function UrlHero({ url, showOpen }: { url: string; showOpen: boolean }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">(
    "idle",
  );
  const urlRef = useRef<HTMLAnchorElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const selectUrl = useCallback(() => {
    const element = urlRef.current;
    if (element === null) return;
    const selection = window.getSelection();
    if (selection === null) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(url).then(
      () => {
        setCopyState("copied");
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopyState("idle"), 1500);
      },
      () => {
        // Locked-down / insecure contexts reject: keep the user unblocked.
        selectUrl();
        setCopyState("manual");
      },
    );
  }, [url, selectUrl]);

  return (
    <div className="flex max-w-xl items-center gap-1 rounded-lg border border-border bg-surface-recessed py-1 pl-3.5 pr-1">
      <a
        ref={urlRef}
        href={url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate font-mono text-sm font-medium text-foreground no-underline hover:underline"
      >
        {url}
      </a>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={copy}
        aria-label="Copy URL"
      >
        <Icon
          name={copyState === "copied" ? "Check" : "Copy"}
          className="size-4"
        />
        {copyState === "copied"
          ? "Copied"
          : copyState === "manual"
            ? "Press ⌘C"
            : "Copy"}
      </Button>
      {showOpen ? (
        <Button type="button" variant="outline" size="sm" asChild>
          <a href={url} target="_blank" rel="noreferrer">
            Open
          </a>
        </Button>
      ) : null}
    </div>
  );
}

function QuietCopyButton({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );
  const copy = useCallback(() => {
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1500);
      },
      () => {
        // Quiet copy has no inline hint; leave the label unchanged.
      },
    );
  }, [url]);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      onClick={copy}
      aria-label={label}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Pairing (paste-a-code) form — used unpaired and for re-pair.
// ---------------------------------------------------------------------------

function PairForm({
  dashboardUrl,
  onPaired,
}: {
  dashboardUrl: string;
  onPaired: () => void;
}) {
  const rpc = useRpc<typeof connectRpcContract>();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [errorCode, setErrorCode] = useState<PairErrorCode | null>(null);
  // The last code we fired so a completed value auto-submits once, not on
  // every keystroke — and a rejected code doesn't loop until it's edited.
  const submittedRef = useRef<string | null>(null);

  const submit = useCallback(
    (value: string) => {
      if (pending) return;
      const canonical = formatConnectCode(value);
      if (!isCompleteCode(canonical)) return;
      submittedRef.current = canonical;
      setPending(true);
      setErrorCode(null);
      rpc.call("pair", { code: canonical }).then(
        () => {
          setPending(false);
          setCode("");
          submittedRef.current = null;
          onPaired();
        },
        (rpcError: unknown) => {
          setPending(false);
          // Inline, never a toast: it must survive a trip to the dashboard.
          setErrorCode(toPairErrorCode(rpcError));
        },
      );
    },
    [pending, rpc, onPaired],
  );

  const onChange = useCallback(
    (raw: string) => {
      const formatted = formatConnectCode(raw);
      setCode(formatted);
      if (errorCode !== null) setErrorCode(null);
      // "It connects automatically": fire as soon as a fresh 4-4 lands.
      if (isCompleteCode(formatted) && formatted !== submittedRef.current) {
        submit(formatted);
      }
    },
    [errorCode, submit],
  );

  const complete = isCompleteCode(code);
  const copy = errorCode !== null ? PAIR_ERROR_COPY[errorCode] : null;

  return (
    <div className="space-y-2.5">
      <form
        className="flex max-w-md items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit(code);
        }}
      >
        <Input
          value={code}
          onChange={(event) => onChange(event.target.value)}
          placeholder="XXXX–XXXX"
          autoComplete="off"
          spellCheck={false}
          aria-label="Connect code"
          aria-invalid={errorCode !== null}
          className={cn(
            "font-mono tracking-widest",
            errorCode !== null && "border-destructive ring-1 ring-destructive",
          )}
        />
        <Button type="submit" disabled={pending || !complete}>
          {pending ? (
            <Icon name="Spinner" className="size-4 animate-spin" />
          ) : null}
          Connect
        </Button>
      </form>
      {copy !== null ? (
        <div className="max-w-md rounded-md border border-surface-destructive-border bg-surface-destructive px-3 py-2 text-xs text-destructive-text">
          {copy.lead}{" "}
          <a
            href={dashboardUrl}
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            {copy.linkLabel}
          </a>
          {copy.tail}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared ports subsection (restyled into the section grammar).
// ---------------------------------------------------------------------------

interface ShareHostGroup {
  hostId: string;
  hostName: string;
  shares: ConnectStatus["shares"];
}

/** Group shares under their host, preserving the backend's host/port order. */
function groupSharesByHost(shares: ConnectStatus["shares"]): ShareHostGroup[] {
  const groups: ShareHostGroup[] = [];
  const byHostId = new Map<string, ShareHostGroup>();
  for (const share of shares) {
    let group = byHostId.get(share.hostId);
    if (group === undefined) {
      group = { hostId: share.hostId, hostName: share.hostName, shares: [] };
      byHostId.set(share.hostId, group);
      groups.push(group);
    }
    group.shares.push(share);
  }
  return groups;
}

function SharedPortsSection({
  shares,
  dimmed,
}: {
  shares: ConnectStatus["shares"];
  dimmed: boolean;
}) {
  const rpc = useRpc<typeof connectRpcContract>();
  const [portInput, setPortInput] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [exposing, setExposing] = useState(false);
  const [revokingShare, setRevokingShare] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const expose = useCallback(() => {
    const trimmed = portInput.trim();
    if (trimmed.length === 0 || exposing) return;
    const port = Number(trimmed);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError("Port must be an integer between 1 and 65535");
      return;
    }
    setExposing(true);
    setError(null);
    rpc.call("expose", { port }).then(
      () => {
        setExposing(false);
        setPortInput("");
        setFormOpen(false);
      },
      (rpcError: unknown) => {
        setExposing(false);
        setError(errorText(rpcError));
      },
    );
  }, [portInput, exposing, rpc]);

  const unexpose = useCallback(
    (hostId: string, port: number) => {
      if (revokingShare !== null) return;
      const key = `${hostId}:${port}`;
      setRevokingShare(key);
      setError(null);
      rpc.call("unexpose", { hostId, port }).then(
        () => {
          setRevokingShare(null);
        },
        (rpcError: unknown) => {
          setRevokingShare(null);
          setError(errorText(rpcError));
        },
      );
    },
    [revokingShare, rpc],
  );

  return (
    <div
      className={cn(
        "space-y-2.5 border-t border-border-seam pt-4",
        dimmed && "pointer-events-none opacity-60 saturate-[0.85]",
      )}
    >
      <div className="flex items-center">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-subtle-foreground">
          Shared ports
        </h3>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setFormOpen((open) => !open)}
        >
          <Icon name="Plus" className="size-3.5" />
          Expose a port
        </Button>
      </div>

      {shares.length > 0 ? (
        <div className="space-y-2.5">
          {groupSharesByHost(shares).map((group) => {
            // A host whose shares all lack a URL is unreachable right now
            // (offline daemon, removed host, …) — the whole group reads
            // degraded, but Revoke stays live since removal works offline.
            const hostDown = group.shares.every((share) => share.url === "");
            return (
              <div key={group.hostId} className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <StatusDot tone={hostDown ? "muted" : "ok"} />
                  <span
                    className={cn(
                      "min-w-0 truncate text-xs font-medium",
                      hostDown ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {group.hostName}
                  </span>
                </div>
                <ul className="space-y-1 pl-3.5">
                  {group.shares.map((share) => (
                    <li
                      key={`${share.hostId}:${share.port}`}
                      className="flex items-center gap-2"
                    >
                      <span
                        className={cn(
                          "shrink-0 font-mono text-xs tabular-nums",
                          share.url
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        :{share.port}
                      </span>
                      {share.url ? (
                        <>
                          <a
                            href={share.url}
                            target="_blank"
                            rel="noreferrer"
                            className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground underline-offset-2 hover:underline"
                          >
                            {hostOf(share.url)}
                          </a>
                          <QuietCopyButton
                            url={share.url}
                            label={`Copy share URL for port ${share.port}`}
                          />
                        </>
                      ) : (
                        <span
                          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                          title={share.unavailableReason}
                        >
                          Unavailable —{" "}
                          {share.unavailableReason ?? "unknown reason"}
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={DANGER_QUIET_CLASS}
                        disabled={
                          revokingShare === `${share.hostId}:${share.port}`
                        }
                        onClick={() => unexpose(share.hostId, share.port)}
                      >
                        {revokingShare === `${share.hostId}:${share.port}` ? (
                          <Icon
                            name="Spinner"
                            className="size-4 animate-spin"
                          />
                        ) : null}
                        Revoke
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}

      {formOpen ? (
        <form
          className="flex max-w-[16rem] items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            expose();
          }}
        >
          <Input
            type="number"
            min={1}
            max={65535}
            step={1}
            value={portInput}
            onChange={(event) => setPortInput(event.target.value)}
            placeholder="Port"
            inputMode="numeric"
            className="max-w-[7rem] font-mono"
            aria-label="Port to share"
          />
          <Button
            type="submit"
            size="sm"
            disabled={exposing || portInput.trim().length === 0}
          >
            {exposing ? (
              <Icon name="Spinner" className="size-4 animate-spin" />
            ) : null}
            Expose
          </Button>
        </form>
      ) : null}

      <p className="text-xs text-subtle-foreground/75">
        Agents can expose their dev servers too — same owner sign-in required to
        view.
      </p>
      {error !== null ? (
        <p className="text-xs text-destructive-text">{error}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Disconnect confirm dialog (names the concrete URL + pending state).
// ---------------------------------------------------------------------------

function DisconnectDialog({
  open,
  onOpenChange,
  host,
  dashboardHost,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  host: string;
  dashboardHost: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <>
            <DialogHeader>
              <DialogTitle>Disconnect remote access?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{host}</span> will
              stop working on all devices. Re-pairing needs a new code from your{" "}
              {dashboardHost} dashboard.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={onConfirm}
              >
                {pending ? (
                  <Icon name="Spinner" className="size-4 animate-spin" />
                ) : null}
                {pending ? "Disconnecting…" : "Disconnect"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Not paired (p1).
// ---------------------------------------------------------------------------

function NotPairedContent({
  dashboardUrl,
  onPaired,
}: {
  dashboardUrl: string;
  onPaired: () => void;
}) {
  const dashboardHost = hostOf(dashboardUrl);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pairing gives this bb a private URL like{" "}
        <span className="rounded bg-surface-recessed px-1.5 py-0.5 font-mono text-xs text-foreground">
          you.{dashboardHost}
        </span>
        . Your code and data stay on this machine.
      </p>

      <div className="flex gap-3">
        <StepNumber value={1} />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm">
            Get a one-time connect code from your {dashboardHost} dashboard.
          </p>
          <Button type="button" asChild>
            <a href={dashboardUrl} target="_blank" rel="noreferrer">
              Get a connect code
              <Icon name="ExternalLink" className="size-3.5" />
            </a>
          </Button>
        </div>
      </div>

      <div className="flex gap-3">
        <StepNumber value={2} />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm">Paste it here — it connects automatically.</p>
          <PairForm dashboardUrl={dashboardUrl} onPaired={onPaired} />
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-xs text-subtle-foreground">
        <Icon
          name="AlertTriangle"
          className="mt-px size-3.5 shrink-0 opacity-70"
        />
        Anyone signed in to your {dashboardHost} account gets full control of
        this bb.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connected (p4) + reconnecting (p5).
// ---------------------------------------------------------------------------

function ConnectedContent({
  status,
  onChanged,
  onDisconnected,
}: {
  status: ConnectStatus;
  onChanged: () => void;
  onDisconnected: () => void;
}) {
  const rpc = useRpc<typeof connectRpcContract>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [repairOpen, setRepairOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const disconnect = useCallback(() => {
    setDisconnecting(true);
    setDisconnectError(null);
    rpc.call("disconnect").then(
      () => {
        setDisconnecting(false);
        setConfirmOpen(false);
        onDisconnected();
        onChanged();
      },
      (error: unknown) => {
        setDisconnecting(false);
        setDisconnectError(errorText(error));
      },
    );
  }, [rpc, onChanged, onDisconnected]);

  const host = status.url !== null ? hostOf(status.url) : "this bb";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <StatusDot tone="ok" />
        <span className="text-sm font-semibold">Connected</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          since {formatSince(status.since)}
          {status.remoteClients > 0
            ? ` · ${status.remoteClients} viewing remotely`
            : ""}
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setRepairOpen((open) => !open)}
        >
          Re-pair
        </Button>
      </div>

      {status.url !== null ? <UrlHero url={status.url} showOpen /> : null}

      {status.url !== null ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setQrOpen((open) => !open)}
            >
              <Icon name="GridView" className="size-3.5" />
              Show QR for phone
            </Button>
            <span className="text-xs text-muted-foreground">
              scan to open on another device
            </span>
          </div>
          {qrOpen ? <QrCodeImage value={status.url} /> : null}
        </div>
      ) : null}

      {repairOpen ? (
        <div className="space-y-2 rounded-md border border-border bg-surface-recessed/50 px-3 py-3">
          <p className="text-xs text-muted-foreground">
            Re-pairing replaces this bb&apos;s credential. Paste a fresh code
            from your dashboard.
          </p>
          <PairForm dashboardUrl={status.dashboardUrl} onPaired={onChanged} />
        </div>
      ) : null}

      <SharedPortsSection shares={status.shares} dimmed={false} />

      <div className="-mx-4 mt-4 flex items-center gap-3 border-t border-border-seam px-4 pt-3">
        <span className="min-w-0 text-xs text-muted-foreground">
          Disconnecting forgets this bb&apos;s credential.
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={DANGER_QUIET_CLASS}
          onClick={() => setConfirmOpen(true)}
        >
          Disconnect
        </Button>
      </div>
      {disconnectError !== null ? (
        <p className="text-xs text-destructive-text">{disconnectError}</p>
      ) : null}

      <DisconnectDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        host={host}
        dashboardHost={hostOf(status.dashboardUrl)}
        pending={disconnecting}
        onConfirm={disconnect}
      />
    </div>
  );
}

function ReconnectingContent({
  status,
  onChanged,
  onDisconnected,
}: {
  status: ConnectStatus;
  onChanged: () => void;
  onDisconnected: () => void;
}) {
  const rpc = useRpc<typeof connectRpcContract>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const disconnect = useCallback(() => {
    setDisconnecting(true);
    setDisconnectError(null);
    rpc.call("disconnect").then(
      () => {
        setDisconnecting(false);
        setConfirmOpen(false);
        onDisconnected();
        onChanged();
      },
      (error: unknown) => {
        setDisconnecting(false);
        setDisconnectError(errorText(error));
      },
    );
  }, [rpc, onChanged, onDisconnected]);

  const host = status.url !== null ? hostOf(status.url) : "this bb";
  const why = [status.lastError, retryHint(status.nextRetryAt)]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(" · ");

  return (
    <div className="space-y-4">
      {/* Amber wash bleeds to the card edges — the whole card changes
          temperature without moving the layout (no jump when it recovers). */}
      <div className="-mx-4 -mt-3.5 flex items-center gap-2.5 rounded-t-lg border-b border-warning/40 bg-warning/10 px-4 py-3">
        <StatusDot tone="warn" />
        <span className="shrink-0 text-sm font-semibold text-warning-text">
          Reconnecting…
        </span>
        <span className="min-w-0 truncate text-xs text-warning-text/80">
          {why}
        </span>
      </div>

      <div className="space-y-2 pointer-events-none opacity-60 saturate-[0.85]">
        <p className="text-sm text-muted-foreground">
          Your bb will be reachable again at:
        </p>
        {status.url !== null ? (
          <UrlHero url={status.url} showOpen={false} />
        ) : null}
      </div>

      <SharedPortsSection shares={status.shares} dimmed />

      <div className="-mx-4 mt-4 flex items-center gap-3 border-t border-border-seam px-4 pt-3">
        <span className="min-w-0 text-xs text-muted-foreground">
          Remote devices can&apos;t reach this bb right now. Local access is
          unaffected.
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={DANGER_QUIET_CLASS}
          onClick={() => setConfirmOpen(true)}
        >
          Disconnect
        </Button>
      </div>
      {disconnectError !== null ? (
        <p className="text-xs text-destructive-text">{disconnectError}</p>
      ) : null}

      <DisconnectDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        host={host}
        dashboardHost={hostOf(status.dashboardUrl)}
        pending={disconnecting}
        onConfirm={disconnect}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section root.
// ---------------------------------------------------------------------------

function ConnectSettingsSection() {
  const rpc = useRpc<typeof connectRpcContract>();
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(() => {
    rpc.call("status").then(
      (result) => {
        const next = asStatus(result);
        if (next !== null) {
          setStatus(next);
          setLoadError(null);
        } else {
          setLoadError("Unexpected status payload.");
        }
      },
      (error: unknown) => setLoadError(errorText(error)),
    );
  }, [rpc]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // The backend pushes a full status snapshot on every transition; apply it
  // directly so the card updates live without polling.
  useRealtime(CONNECT_REALTIME_CHANNEL, (payload) => {
    const next = asStatus(payload);
    if (next !== null) {
      setStatus(next);
      setLoadError(null);
    }
  });

  const showDisconnected = useCallback(() => {
    // Transient inline receipt (the SDK exposes no toast on this surface):
    // the silhouette-identical card swap no longer passes silently.
    setFlash("Remote access disconnected");
    if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(null), 4000);
  }, []);

  useEffect(
    () => () => {
      if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current);
    },
    [],
  );

  if (loadError !== null) {
    return (
      <p className="text-sm text-destructive-text">
        Failed to load remote-access status: {loadError}
      </p>
    );
  }
  if (status === null) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="space-y-3">
      {flash !== null && !status.paired ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-border bg-surface-recessed px-3 py-2 text-xs text-foreground"
        >
          <Icon name="Check" className="size-3.5 text-success" />
          {flash}
        </div>
      ) : null}
      {!status.paired ? (
        <NotPairedContent
          dashboardUrl={status.dashboardUrl}
          onPaired={refetch}
        />
      ) : status.state === "reconnecting" ? (
        <ReconnectingContent
          status={status}
          onChanged={refetch}
          onDisconnected={showDisconnected}
        />
      ) : (
        <ConnectedContent
          status={status}
          onChanged={refetch}
          onDisconnected={showDisconnected}
        />
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "remote-access",
    description:
      "Use this bb from any device, anywhere — powered by getbb.app.",
    component: ConnectSettingsSection,
  });
  app.slots.sidebarFooterAction({
    id: "remote-access",
    title: "Remote access",
    icon: "Smartphone",
    run({ openSettings }) {
      openSettings();
    },
  });
});
