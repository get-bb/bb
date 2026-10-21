import { ExpandableText } from "@bb/shared-ui/expandable-text";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  definePluginApp,
  experimental_copyToClipboard,
  UrlLink as UrlLink,
  experimental_useRpcQuery,
  experimental_useRpcMutation,
} from "@get-bb/plugin-sdk/app";
import {
  encodeMobilePairingPayload,
  mobilePairingPayload,
  type MobilePairingPayload,
} from "@bb/connect-client";
import { connectRpcContract } from "./src/rpc.js";
import type { MachineCodeErrorCode } from "./src/machine-code.js";
import {
  ACCOUNT_PLUGIN_ID,
  accountErrorCode,
  accountLoginRpcContract,
  loginPollOutputSchema,
  loginViewSchema,
  type LoginView,
} from "./src/account-client.js";
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
import { type ConnectStatus } from "@/src/types";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const DANGER_QUIET_CLASS =
  "text-destructive-text hover:text-destructive-text hover:bg-surface-destructive";

type ConnectPairErrorCode =
  | "invalid_code"
  | "expired_code"
  | "already_used"
  | "network"
  | "unauthorized"
  | "profile_unavailable"
  | "superseded"
  | "account_unavailable";

interface PairErrorCopy {
  lead: string;
  linkLabel: string;
  tail: string;
}

const PAIR_ERROR_COPY: Record<ConnectPairErrorCode, PairErrorCopy> = {
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
    lead: "Couldn't reach getbb.app.",
    linkLabel: "Open the dashboard",
    tail: " — check your connection, then try again.",
  },
  unauthorized: {
    lead: "getbb.app rejected the new pairing.",
    linkLabel: "Get a new code",
    tail: " and try again.",
  },
  profile_unavailable: {
    lead: "This bb saved the pairing, but getbb.app hasn't returned your account yet.",
    linkLabel: "Open the dashboard",
    tail: " — bb keeps retrying, and remote access starts once it does.",
  },
  superseded: {
    lead: "Another sign-in or a sign-out replaced this one.",
    linkLabel: "Open the dashboard",
    tail: " — check which account this bb uses under bb account.",
  },
  account_unavailable: {
    lead: "The bb account plugin is off.",
    linkLabel: "Open the dashboard",
    tail: " — turn bb account on under Plugins, then try again.",
  },
};

function isUnavailableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error.status === 503 || error.status === 404)
  );
}

function toPairErrorCode(error: unknown): ConnectPairErrorCode {
  if (isUnavailableError(error)) return "account_unavailable";
  const code = accountErrorCode(error);
  if (
    code === "invalid_code" ||
    code === "expired_code" ||
    code === "already_used" ||
    code === "network" ||
    code === "unauthorized" ||
    code === "profile_unavailable" ||
    code === "superseded"
  ) {
    return code;
  }
  return "invalid_code";
}

function asStatus(payload: unknown): ConnectStatus | null {
  if (payload === null || typeof payload !== "object") return null;
  const record = payload as {
    state?: unknown;
    paired?: unknown;
    enabled?: unknown;
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
    enabled: typeof record.enabled === "boolean" ? record.enabled : true,
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

function retryHint(nextRetryAt: number | null): string {
  if (nextRetryAt === null) return "retrying automatically";
  const seconds = Math.max(0, Math.round((nextRetryAt - Date.now()) / 1000));
  return seconds > 0 ? `retrying in ${seconds}s` : "retrying…";
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}

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

function StatusDot({ tone }: { tone: "ok" | "warn" | "muted" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        tone === "ok" &&
          "bg-success shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_18%,transparent)]",
        tone === "warn" &&
          "animate-pulse bg-warning shadow-[0_0_0_3px_color-mix(in_oklab,var(--warning)_22%,transparent)]",
        tone === "muted" && "bg-muted-foreground/50",
      )}
    />
  );
}

function QrCodeImage({
  value,
  alt,
  className,
}: {
  value: string;
  alt: string;
  className?: string;
}) {
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
      alt={alt}
      className={cn(
        "size-32 rounded-md border border-border bg-white p-1.5",
        className,
      )}
    />
  );
}

function UrlHero({ url, showOpen }: { url: string; showOpen: boolean }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">(
    "idle",
  );
  const urlRef = useRef<HTMLSpanElement>(null);
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
    void experimental_copyToClipboard({ text: url }).then((copied) => {
      if (!copied) {
        selectUrl();
        setCopyState("manual");
        return;
      }
      setCopyState("copied");
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopyState("idle"), 1500);
    });
  }, [url, selectUrl]);

  return (
    <div className="flex max-w-xl items-center gap-1 rounded-lg border border-border bg-surface-recessed py-1 pl-3.5 pr-1">
      <UrlLink
        href={url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate font-mono text-sm font-medium text-foreground no-underline hover:underline"
      >
        <span ref={urlRef}>{url}</span>
      </UrlLink>
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
          <UrlLink href={url} target="_blank" rel="noreferrer">
            Open
          </UrlLink>
        </Button>
      ) : null}
    </div>
  );
}

function QuietCopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );
  const copy = useCallback(() => {
    void experimental_copyToClipboard({ text }).then((written) => {
      if (!written) return;
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
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

function PairForm({
  dashboardUrl,
  onPaired,
}: {
  dashboardUrl: string;
  onPaired: () => void;
}) {
  const { mutate: redeemRpc } = experimental_useRpcMutation({
    contract: accountLoginRpcContract,
    pluginId: ACCOUNT_PLUGIN_ID,
    method: "redeemCode",
  });
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [errorCode, setErrorCode] = useState<ConnectPairErrorCode | null>(null);
  const submittedRef = useRef<string | null>(null);

  const submit = useCallback(
    (value: string) => {
      if (pending) return;
      const canonical = formatConnectCode(value);
      if (!isCompleteCode(canonical)) return;
      submittedRef.current = canonical;
      setPending(true);
      setErrorCode(null);
      redeemRpc({ code: canonical, baseUrl: null }).then(
        () => {
          setPending(false);
          setCode("");
          submittedRef.current = null;
          onPaired();
        },
        (rpcError: unknown) => {
          setPending(false);
          setErrorCode(toPairErrorCode(rpcError));
        },
      );
    },
    [pending, redeemRpc, onPaired],
  );

  const onChange = useCallback(
    (raw: string) => {
      const formatted = formatConnectCode(raw);
      setCode(formatted);
      if (errorCode !== null) setErrorCode(null);
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
          aria-label="Pairing code"
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
          Pair
        </Button>
      </form>
      {copy !== null ? (
        <div className="max-w-md rounded-md border border-surface-destructive-border bg-surface-destructive px-3 py-2 text-xs text-destructive-text">
          {copy.lead}{" "}
          <UrlLink
            href={dashboardUrl}
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            {copy.linkLabel}
          </UrlLink>
          {copy.tail}
        </div>
      ) : null}
    </div>
  );
}

function signInStartErrorText(error: unknown): string {
  if (isUnavailableError(error)) {
    return "The bb account plugin is off. Turn it on under Plugins, then try again.";
  }
  switch (accountErrorCode(error)) {
    case "rate_limited":
      return "Too many sign-in attempts from this network. Wait a minute, then try again.";
    case "unavailable":
      return "getbb.app couldn't start sign-in right now. Try again in a minute.";
    default:
      return "Couldn't reach getbb.app to start sign-in. Check your connection, then try again.";
  }
}

function toMachineCodeErrorCode(error: unknown): MachineCodeErrorCode {
  const message = errorText(error);
  if (message === "machine_limit" || message === "not_paired") return message;
  return "network";
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function useCountdown(expiresAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (expiresAt === null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);
  return expiresAt === null ? null : expiresAt - now;
}

function MobilePairingCard({
  payload,
  dashboardHost,
  minting,
  onRenew,
}: {
  payload: MobilePairingPayload;
  dashboardHost: string;
  minting: boolean;
  onRenew: () => void;
}) {
  const remainingMs = useCountdown(payload.expiresAt);
  const expired = remainingMs !== null && remainingMs <= 0;
  const qrText = encodeMobilePairingPayload(payload);
  return (
    <div className="@container/connect-pairing min-w-0">
      <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-recessed/50 px-3 py-3 @min-[32rem]/connect-pairing:flex-row @min-[32rem]/connect-pairing:items-start">
        <div
          className={cn(
            "shrink-0 self-center @min-[32rem]/connect-pairing:self-start",
            expired && "opacity-40 saturate-0",
          )}
        >
          <QrCodeImage
            value={qrText}
            alt="QR code to pair the bb mobile app"
            className="size-40"
          />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm">
            {expired
              ? "Generate a new code, then scan it or enter it in the bb mobile app."
              : "Scan this with the bb mobile app, or enter the code by hand."}
          </p>
          <div className="flex max-w-xs items-center gap-1 rounded-lg border border-border bg-surface-recessed py-1 pl-3.5 pr-1">
            <span
              className={cn(
                "min-w-0 flex-1 truncate font-mono text-sm font-medium tracking-widest",
                expired
                  ? "text-muted-foreground line-through"
                  : "text-foreground",
              )}
              aria-label="Mobile pairing code"
            >
              {payload.code}
            </span>
            {expired ? null : (
              <QuietCopyButton text={payload.code} label="Copy pairing code" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle-foreground">
            {expired ? (
              <>
                <span>Code expired</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={minting}
                  onClick={onRenew}
                >
                  {minting ? (
                    <Icon name="Spinner" className="size-4 animate-spin" />
                  ) : null}
                  Generate a new code
                </Button>
              </>
            ) : remainingMs !== null ? (
              <span className="tabular-nums">
                Code expires in {formatCountdown(remainingMs)}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-subtle-foreground/75">
            {expired ? "Each new code works once." : "This code works once."}{" "}
            You can revoke your phone’s access from the {dashboardHost}{" "}
            dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}

function AddMobileDeviceSection({ dashboardUrl }: { dashboardUrl: string }) {
  const { mutate: mintRpc } = experimental_useRpcMutation<
    typeof connectRpcContract,
    "createMachineCode"
  >({ contract: connectRpcContract, method: "createMachineCode" });
  const [payload, setPayload] = useState<MobilePairingPayload | null>(null);
  const [minting, setMinting] = useState(false);
  const [errorCode, setErrorCode] = useState<MachineCodeErrorCode | null>(null);
  const dashboardHost = hostOf(dashboardUrl);

  const mint = useCallback(() => {
    if (minting) return;
    setMinting(true);
    setErrorCode(null);
    mintRpc().then(
      (result) => {
        setMinting(false);
        setPayload(mobilePairingPayload(result));
      },
      (rpcError: unknown) => {
        setMinting(false);
        setErrorCode(toMachineCodeErrorCode(rpcError));
      },
    );
  }, [minting, mintRpc]);

  return (
    <div className="mt-3 space-y-2.5 border-t border-border-seam pt-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-medium">Pair your phone</h3>
          {payload === null ? (
            <p className="mt-1 text-xs text-subtle-foreground/75">
              Scan or enter a code.
            </p>
          ) : null}
        </div>
        {payload === null ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={minting}
            onClick={mint}
          >
            {minting ? (
              <Icon name="Spinner" className="size-3.5 animate-spin" />
            ) : (
              <Icon
                name={errorCode === "network" ? "RotateCcw" : "Plus"}
                className="size-3.5"
              />
            )}
            {errorCode === "network" ? "Try again" : "Add mobile device"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              setPayload(null);
              setErrorCode(null);
            }}
          >
            Done
          </Button>
        )}
      </div>

      {payload !== null ? (
        <MobilePairingCard
          key={payload.code}
          payload={payload}
          dashboardHost={dashboardHost}
          minting={minting}
          onRenew={mint}
        />
      ) : null}

      {errorCode !== null ? (
        <p role="alert" className="text-xs text-destructive-text">
          {errorCode === "machine_limit" ? (
            <>
              Your {dashboardHost} account has reached its machine limit.{" "}
              <UrlLink
                href={dashboardUrl}
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline underline-offset-2"
              >
                Revoke a device you no longer use
              </UrlLink>{" "}
              in the dashboard, then try again.
            </>
          ) : errorCode === "not_paired" ? (
            "This bb is signed out. Open Manage to sign in, then try again."
          ) : (
            "Couldn't reach the Connect service to create a code — check your connection, then try again."
          )}
        </p>
      ) : null}
    </div>
  );
}

interface ShareHostGroup {
  hostId: string;
  hostName: string;
  shares: ConnectStatus["shares"];
}

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
  const { mutate: exposeRpc } = experimental_useRpcMutation<
    typeof connectRpcContract,
    "expose"
  >({ contract: connectRpcContract, method: "expose" });
  const { mutate: unexposeRpc, pendingInputs: revokingShares } =
    experimental_useRpcMutation<typeof connectRpcContract, "unexpose">({
      contract: connectRpcContract,
      method: "unexpose",
      optimistic(input, cache) {
        if (input.hostId === undefined) return;
        cache.update("status", null, (current) => ({
          ...current,
          shares: current.shares.filter(
            (share) =>
              share.port !== input.port ||
              (input.hostId !== undefined && share.hostId !== input.hostId),
          ),
        }));
      },
    });
  const { mutate: unexposeAllRpc, pendingInputs: revokingHosts } =
    experimental_useRpcMutation<typeof connectRpcContract, "unexposeAll">({
      contract: connectRpcContract,
      method: "unexposeAll",
      optimistic(input, cache) {
        cache.update("status", null, (current) => ({
          ...current,
          shares: current.shares.filter(
            (share) => share.hostId !== input.hostId,
          ),
        }));
      },
    });
  const [portInput, setPortInput] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [exposing, setExposing] = useState(false);
  const [collapsedHosts, setCollapsedHosts] = useState<Set<string>>(
    () => new Set(),
  );
  const revokingHost = revokingHosts.at(-1)?.hostId ?? null;
  const revokingShare = revokingShares.at(-1);
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
    exposeRpc({ port }).then(
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
  }, [
    portInput,
    exposing,
    revokingHost,
    exposeRpc,
    unexposeRpc,
    unexposeAllRpc,
  ]);

  const unexpose = useCallback(
    (hostId: string, port: number) => {
      if (
        revokingShares.some(
          (input) => input.hostId === hostId && input.port === port,
        )
      )
        return;
      setError(null);
      unexposeRpc({ hostId, port }).then(
        () => undefined,
        (rpcError: unknown) => {
          setError(errorText(rpcError));
        },
      );
    },
    [revokingShares, unexposeRpc],
  );

  const unexposeAll = async (hostId: string) => {
    if (revokingHosts.some((input) => input.hostId === hostId)) return;
    setError(null);
    try {
      await unexposeAllRpc({ hostId });
    } catch (rpcError) {
      setError(errorText(rpcError));
    }
  };

  return (
    <div
      className={cn(
        "space-y-2.5 border-t border-border-seam pt-4",
        dimmed && "pointer-events-none opacity-60 saturate-[0.85]",
      )}
    >
      <div className="flex flex-wrap items-center gap-1">
        <h3 className="text-2xs font-semibold uppercase tracking-wide text-subtle-foreground">
          Shared ports
        </h3>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          disabled={exposing}
          onClick={() => setFormOpen((open) => !open)}
        >
          <Icon name="Plus" className="size-3.5" />
          Expose a port
        </Button>
      </div>

      {shares.length > 0 ? (
        <div className="space-y-2.5">
          {groupSharesByHost(shares).map((group) => {
            const collapsed = collapsedHosts.has(group.hostId);
            const hostDown = group.shares.every((share) => share.url === "");
            return (
              <div key={group.hostId} className="space-y-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`${group.hostName}, ${group.shares.length} shared ports`}
                    aria-expanded={!collapsed}
                    onClick={() =>
                      setCollapsedHosts((previous) => {
                        const next = new Set(previous);
                        if (next.has(group.hostId)) next.delete(group.hostId);
                        else next.add(group.hostId);
                        return next;
                      })
                    }
                  >
                    <Icon
                      name={collapsed ? "ChevronRight" : "ChevronDown"}
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    <StatusDot tone={hostDown ? "muted" : "ok"} />
                    <span
                      className={cn(
                        "min-w-0 truncate text-xs font-medium",
                        hostDown ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {group.hostName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {group.shares.length}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={DANGER_QUIET_CLASS}
                    aria-label={`Revoke all (${group.shares.length}) shared ports on ${group.hostName}`}
                    disabled={exposing}
                    onClick={() => void unexposeAll(group.hostId)}
                  >
                    {revokingHost === group.hostId ? (
                      <Icon name="Spinner" className="size-4 animate-spin" />
                    ) : null}
                    Revoke all ({group.shares.length})
                  </Button>
                </div>
                <ul hidden={collapsed} className="space-y-1 pl-7">
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
                          <UrlLink
                            href={share.url}
                            target="_blank"
                            rel="noreferrer"
                            className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground underline-offset-2 hover:underline"
                          >
                            {hostOf(share.url)}
                          </UrlLink>
                          <QuietCopyButton
                            text={share.url}
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
                        aria-busy={revokingShares.some(
                          (input) =>
                            input.hostId === share.hostId &&
                            input.port === share.port,
                        )}
                        onClick={() => unexpose(share.hostId, share.port)}
                      >
                        {revokingShare?.hostId === share.hostId &&
                        revokingShare.port === share.port ? (
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
            disabled={
              exposing || revokingHost !== null || portInput.trim().length === 0
            }
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

function TurnOffDialog({
  open,
  onOpenChange,
  host,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  host: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <>
            <DialogHeader>
              <DialogTitle>Turn off remote access?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{host}</span> will
              stop working on all devices until you turn remote access back on.
              This bb stays signed in to your bb account.
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
                {pending ? "Turning off…" : "Turn off"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function useAccountLogin(onSignedIn: () => void) {
  const { mutate: startRpc } = experimental_useRpcMutation({
    contract: accountLoginRpcContract,
    pluginId: ACCOUNT_PLUGIN_ID,
    method: "login.start",
  });
  const { mutate: cancelRpc } = experimental_useRpcMutation({
    contract: accountLoginRpcContract,
    pluginId: ACCOUNT_PLUGIN_ID,
    method: "login.cancel",
  });
  const [startedLogin, setStartedLogin] = useState<LoginView | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(() => {
    setStarting(true);
    setError(null);
    startRpc({ baseUrl: null }).then(
      (view) => {
        setStarting(false);
        setStartedLogin(loginViewSchema.parse(view));
      },
      (rpcError: unknown) => {
        setStarting(false);
        setError(signInStartErrorText(rpcError));
      },
    );
  }, [startRpc]);

  const pendingId = startedLogin?.state === "pending" ? startedLogin.id : null;
  const pendingLogin = experimental_useRpcQuery({
    contract: accountLoginRpcContract,
    pluginId: ACCOUNT_PLUGIN_ID,
    method: "login.poll",
    input: { loginId: pendingId },
    enabled: pendingId !== null,
  });
  const result =
    pendingId !== null && pendingLogin.data !== undefined
      ? loginPollOutputSchema.parse(pendingLogin.data)
      : undefined;
  const state = result?.login?.state;
  useEffect(() => {
    if (state === "signed-in") onSignedIn();
  }, [state, onSignedIn]);

  const cancel = useCallback(() => {
    if (pendingId !== null) {
      cancelRpc({ loginId: pendingId }).then(
        () => {},
        () => {},
      );
    }
    setStartedLogin(null);
    setError(null);
  }, [pendingId, cancelRpc]);

  return {
    login: result === undefined ? startedLogin : result.login,
    starting,
    error:
      error ??
      pendingLogin.error?.message ??
      (result?.login === null
        ? "This sign-in is no longer active. Try again for a new code."
        : null),
    start,
    cancel,
    retry: pendingLogin.refetch,
  };
}

function AccountSignInCard({ onSignedIn }: { onSignedIn: () => void }) {
  const { login, starting, error, start, cancel, retry } =
    useAccountLogin(onSignedIn);

  if (login === null) {
    return (
      <div className="min-w-0 space-y-2">
        <Button
          type="button"
          className="h-auto min-h-9 max-w-full whitespace-normal"
          disabled={starting}
          onClick={start}
        >
          {starting ? (
            <Icon name="Spinner" className="size-4 animate-spin" />
          ) : null}
          Sign in to your bb account
        </Button>
        {error !== null ? (
          <p className="text-xs text-destructive-text">{error}</p>
        ) : null}
      </div>
    );
  }

  if (login.state === "signed-in") {
    return (
      <p className="text-xs text-muted-foreground">
        Signed in. Remote access is starting…
      </p>
    );
  }

  if (login.state !== "pending") {
    return (
      <div className="space-y-2">
        <p className="text-xs text-destructive-text">
          {login.message ?? "Sign-in didn't finish."}
        </p>
        <Button type="button" variant="outline" onClick={start}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 rounded-md border border-border bg-surface-recessed/50 px-3 py-3">
      <p className="text-xs text-muted-foreground">
        Confirm this code on {hostOf(login.verificationUrl)}:
      </p>
      <p
        aria-label="Sign-in code"
        className="font-mono text-base font-semibold tracking-widest"
      >
        {login.userCode}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" asChild>
          <UrlLink
            href={login.verificationUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open getbb.app
            <Icon name="ExternalLink" className="size-3.5" />
          </UrlLink>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={cancel}
        >
          Cancel
        </Button>
      </div>
      <p className="flex items-center gap-2 text-xs text-subtle-foreground">
        <Icon name="Spinner" className="size-3.5 animate-spin" />
        Waiting for you to approve it. You can approve from any device.
      </p>
      {error !== null ? (
        <div role="alert">
          <p className="text-xs text-destructive-text">{error}</p>
          <Button
            onClick={() => {
              void retry();
            }}
          >
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function NotPairedContent({
  dashboardUrl,
  onPaired,
}: {
  dashboardUrl: string;
  onPaired: () => void;
}) {
  const dashboardHost = hostOf(dashboardUrl);
  const [codeOpen, setCodeOpen] = useState(false);
  return (
    <div className="@container/connect-controls space-y-4">
      <p className="text-sm text-muted-foreground">
        Remote access uses your bb account. Once you sign in, this bb gets a
        private URL like{" "}
        <span className="rounded bg-surface-recessed px-1.5 py-0.5 font-mono text-xs text-foreground">
          you.{dashboardHost}
        </span>
        . Your code and data stay on this machine.
      </p>

      <div className="flex flex-col items-start gap-2 @min-[32rem]/connect-controls:flex-row @min-[32rem]/connect-controls:flex-wrap @min-[32rem]/connect-controls:items-center">
        <AccountSignInCard onSignedIn={onPaired} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setCodeOpen((open) => !open)}
        >
          Have a pairing code?
        </Button>
      </div>
      {codeOpen ? (
        <PairForm dashboardUrl={dashboardUrl} onPaired={onPaired} />
      ) : null}

      <p className="text-xs text-subtle-foreground">
        Only your {dashboardHost} account can open this bb. Manage the account
        under Plugins → bb account.
      </p>
    </div>
  );
}

function useRemoteAccessMutation() {
  return experimental_useRpcMutation<
    typeof connectRpcContract,
    "setRemoteAccess"
  >({
    contract: connectRpcContract,
    method: "setRemoteAccess",
    optimistic(input, cache) {
      cache.update("status", null, (current) => ({
        ...current,
        enabled: input.enabled,
        state: input.enabled ? "reconnecting" : "disconnected",
        lastError: null,
        nextRetryAt: null,
      }));
    },
  });
}

const remoteAccessContext = createContext<ReturnType<
  typeof useRemoteAccessMutation
> | null>(null);
function useRemoteAccessControl() {
  const mutation = useContext(remoteAccessContext);
  if (mutation === null)
    throw new Error("Remote access controls require a settings owner");
  return mutation;
}

function TurnOffControls({
  status,
  note,
  onTurnedOff,
}: {
  status: ConnectStatus;
  note: string;
  onTurnedOff: () => void;
}) {
  const { mutate: setRemoteAccessRpc, isPending: pending } =
    useRemoteAccessControl();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const turnOff = useCallback(() => {
    setRemoteAccessRpc({ enabled: false }).then(
      () => {
        setConfirmOpen(false);
        onTurnedOff();
      },
      () => undefined,
    );
  }, [setRemoteAccessRpc, onTurnedOff]);

  const host = status.url !== null ? hostOf(status.url) : "this bb";

  return (
    <>
      <div className="-mx-4 mt-4 flex items-center gap-3 border-t border-border-seam px-4 pt-3">
        <span className="min-w-0 text-xs text-muted-foreground">{note}</span>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={DANGER_QUIET_CLASS}
          onClick={() => setConfirmOpen(true)}
        >
          Turn off
        </Button>
      </div>

      <TurnOffDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        host={host}
        pending={pending}
        onConfirm={turnOff}
      />
    </>
  );
}

function ConnectedContent({
  status,
  onTurnedOff,
}: {
  status: ConnectStatus;
  onTurnedOff: () => void;
}) {
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
      </div>

      {status.url !== null ? <UrlHero url={status.url} showOpen /> : null}

      <SharedPortsSection shares={status.shares} dimmed={false} />

      <TurnOffControls
        status={status}
        note="Turning off keeps this bb signed in to your bb account."
        onTurnedOff={onTurnedOff}
      />
    </div>
  );
}

function ReconnectingContent({
  status,
  onTurnedOff,
}: {
  status: ConnectStatus;
  onTurnedOff: () => void;
}) {
  const why = [status.lastError, retryHint(status.nextRetryAt)]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(" · ");

  return (
    <div className="space-y-4">
      <div className="-mx-4 -mt-3.5 flex items-center gap-2.5 rounded-t-lg border-b border-warning/40 bg-warning/10 px-4 py-3">
        <StatusDot tone="warn" />
        <span className="shrink-0 text-sm font-semibold text-warning-text">
          Reconnecting…
        </span>
        <ExpandableText
          expandLabel="Show details"
          className="min-w-0 text-xs text-warning-text/80"
        >
          {why}
        </ExpandableText>
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

      <TurnOffControls
        status={status}
        note="Remote devices can't reach this bb right now. Local access is unaffected."
        onTurnedOff={onTurnedOff}
      />
    </div>
  );
}

function OffContent({ status }: { status: ConnectStatus }) {
  const { mutate: setRemoteAccessRpc, isPending: pending } =
    useRemoteAccessControl();

  const turnOn = useCallback(() => {
    setRemoteAccessRpc({ enabled: true }).then(
      () => {},
      () => undefined,
    );
  }, [setRemoteAccessRpc]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <StatusDot tone="muted" />
        <span className="text-sm font-semibold">Remote access is off</span>
        <span className="flex-1" />
        <Button type="button" size="sm" aria-busy={pending} onClick={turnOn}>
          {pending ? (
            <Icon name="Spinner" className="size-4 animate-spin" />
          ) : null}
          Turn on
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        This bb stays signed in to your bb account. Turn remote access on to
        reach it again
        {status.url !== null ? ` at ${hostOf(status.url)}` : ""}.
      </p>
      <SharedPortsSection shares={status.shares} dimmed />
    </div>
  );
}

function useConnectStatus() {
  const query = experimental_useRpcQuery<typeof connectRpcContract, "status">({
    contract: connectRpcContract,
    method: "status",
    input: null,
  });
  return {
    status: query.data === undefined ? null : asStatus(query.data),
    loadError: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

function MobilePairingSection() {
  const { status, loadError, refetch } = useConnectStatus();
  const canPair =
    status?.paired && status.enabled && status.state === "connected";
  if (!canPair && loadError === null) return null;
  return (
    <div className="space-y-2">
      {loadError !== null ? (
        <div role="alert" className="space-y-2">
          <p className="text-xs text-destructive-text">
            Could not load phone pairing: {loadError}
          </p>
          <Button variant="ghost" size="sm" onClick={refetch}>
            Retry
          </Button>
        </div>
      ) : null}
      {canPair ? (
        <AddMobileDeviceSection dashboardUrl={status.dashboardUrl} />
      ) : null}
    </div>
  );
}

function ConnectSettingsSection() {
  const mutation = useRemoteAccessMutation();
  return (
    <remoteAccessContext.Provider value={mutation}>
      <ConnectSettingsContent />
    </remoteAccessContext.Provider>
  );
}

function ConnectSettingsContent() {
  const { status, loadError, refetch } = useConnectStatus();
  const remoteAccess = useRemoteAccessControl();
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTurnedOff = useCallback(() => {
    setFlash("Remote access turned off");
    if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(null), 4000);
  }, []);

  useEffect(
    () => () => {
      if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current);
    },
    [],
  );

  const error =
    loadError === null ? null : (
      <div role="alert">
        <p className="text-sm text-destructive-text">
          Failed to load remote-access status: {loadError}
        </p>
        <Button
          onClick={() => {
            void refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  if (status === null)
    return error ?? <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-3" aria-busy={remoteAccess.isPending}>
      {error}
      {remoteAccess.error && (
        <p role="alert" className="text-sm text-destructive-text">
          {remoteAccess.error.message}
        </p>
      )}
      {flash !== null && !status.enabled ? (
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
      ) : !status.enabled ? (
        <OffContent status={status} />
      ) : status.state === "reconnecting" ? (
        <ReconnectingContent status={status} onTurnedOff={showTurnedOff} />
      ) : (
        <ConnectedContent status={status} onTurnedOff={showTurnedOff} />
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
  app.slots.settingsSection({
    id: "mobile-pairing",
    experimental_page: "mobile",
    component: MobilePairingSection,
  });
});
