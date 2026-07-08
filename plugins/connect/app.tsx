// bb-plugin-connect — the frontend bundle.
//
// One settingsSection "Remote access", driven by the `status` rpc and live
// `connect` realtime pushes. Four states: not paired (explainer +
// paste-a-code pairing), pairing (button spinner + inline errors), connected
// (URL + QR + disconnect-with-confirm), reconnecting (amber, last error,
// retrying automatically).
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  definePluginApp,
  useRealtime,
  useRpc,
} from "@bb/plugin-sdk/app";
import QRCode from "qrcode";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  CONNECT_REALTIME_CHANNEL,
  type ConnectStatus,
} from "@/src/types";

// Sign in → claim a handle → generate a connect code, all on one page.
const DASHBOARD_URL = "https://getbb.app/dashboard";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asStatus(payload: unknown): ConnectStatus | null {
  if (payload === null || typeof payload !== "object") return null;
  const record = payload as {
    state?: unknown;
    paired?: unknown;
    handle?: unknown;
    url?: unknown;
    lastError?: unknown;
    since?: unknown;
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
  return {
    state: record.state,
    paired: record.paired,
    handle: typeof record.handle === "string" ? record.handle : null,
    url: typeof record.url === "string" ? record.url : null,
    lastError: typeof record.lastError === "string" ? record.lastError : null,
    since: record.since,
  };
}

function StatusDot({ tone }: { tone: "ok" | "warn" | "muted" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        tone === "ok" && "bg-success",
        tone === "warn" && "bg-warning",
        tone === "muted" && "bg-muted-foreground/50",
      )}
    />
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
      className="size-36 rounded-md border border-border bg-white p-1.5"
    />
  );
}

function CopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );
  const copy = useCallback(() => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    });
  }, [url]);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      aria-label="Copy URL"
    >
      <Icon name={copied ? "Check" : "Copy"} className="size-4" />
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function PairForm({
  paired,
  onPaired,
}: {
  paired: boolean;
  onPaired: () => void;
}) {
  const rpc = useRpc();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pair = useCallback(() => {
    const trimmed = code.trim();
    if (trimmed.length === 0 || pending) return;
    setPending(true);
    setError(null);
    rpc.call("pair", { code: trimmed }).then(
      () => {
        setPending(false);
        setCode("");
        onPaired();
      },
      (rpcError: unknown) => {
        setPending(false);
        // Inline, not a toast: the message must stay readable while the user
        // goes back to the dashboard for a fresh code.
        setError(errorText(rpcError));
      },
    );
  }, [code, pending, rpc, onPaired]);

  return (
    <div className="space-y-2">
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          pair();
        }}
      >
        <Input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Paste your connect code"
          autoComplete="off"
          spellCheck={false}
          className="max-w-xs font-mono"
        />
        <Button type="submit" disabled={pending || code.trim().length === 0}>
          {pending ? (
            <Icon name="Spinner" className="size-4 animate-spin" />
          ) : null}
          {paired ? "Re-pair" : "Connect"}
        </Button>
      </form>
      {error !== null ? (
        <p className="text-sm text-destructive">
          {error} — generate a new code on the{" "}
          <a
            href={DASHBOARD_URL}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            dashboard
          </a>
          .
        </p>
      ) : null}
      {paired ? (
        <p className="text-xs text-muted-foreground">
          Re-pairing replaces this bb&apos;s credential. A code for a
          different handle moves your URL.
        </p>
      ) : null}
    </div>
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

function DisconnectDialog({
  open,
  onOpenChange,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
              <DialogDescription>
                This forgets the credential; re-pairing needs a new code from
                the getbb.app dashboard.
              </DialogDescription>
            </DialogHeader>
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
                Disconnect
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NotPairedContent({ onPaired }: { onPaired: () => void }) {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <StatusDot tone="muted" />
          <h2 className="text-sm font-semibold">Set up remote access</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Use this bb from any device at{" "}
          <span className="font-mono">https://&lt;handle&gt;.getbb.app</span>.
        </p>
      </div>

      <div className="flex gap-3">
        <StepNumber value={1} />
        <div className="min-w-0 space-y-2">
          <p className="text-sm">
            Sign in to getbb.app and pick a name for your bb. The dashboard
            shows a one-time connect code.
          </p>
          <Button type="button" variant="outline" size="sm" asChild>
            <a href={DASHBOARD_URL} target="_blank" rel="noreferrer">
              Sign in to getbb.app
              <Icon name="ExternalLink" className="size-3.5" />
            </a>
          </Button>
        </div>
      </div>

      <div className="flex gap-3">
        <StepNumber value={2} />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm">Paste the connect code here.</p>
          <PairForm paired={false} onPaired={onPaired} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Anyone signed into your getbb.app account gets full control of this
        bb.
      </p>
    </div>
  );
}

function PairedContent({
  status,
  onChanged,
}: {
  status: ConnectStatus;
  onChanged: () => void;
}) {
  const rpc = useRpc();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [repairOpen, setRepairOpen] = useState(false);
  const connected = status.state === "connected";

  const disconnect = useCallback(() => {
    setDisconnecting(true);
    setDisconnectError(null);
    rpc.call("disconnect").then(
      () => {
        setDisconnecting(false);
        setConfirmOpen(false);
        onChanged();
      },
      (error: unknown) => {
        setDisconnecting(false);
        setDisconnectError(errorText(error));
      },
    );
  }, [rpc, onChanged]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <StatusDot tone={connected ? "ok" : "warn"} />
        <h2 className="text-sm font-semibold">
          {connected ? "Connected" : "Reconnecting…"}
        </h2>
        <span className="text-xs text-muted-foreground">
          {connected
            ? `since ${new Date(status.since).toLocaleString()}`
            : "retrying automatically"}
        </span>
      </div>

      {!connected && status.lastError !== null ? (
        <p className="text-sm text-warning-text">
          {status.lastError}
        </p>
      ) : null}

      {status.url !== null ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Open this URL on any device — or scan the code:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={status.url}
              target="_blank"
              rel="noreferrer"
              className="break-all font-mono text-lg font-medium underline-offset-4 hover:underline"
            >
              {status.url}
            </a>
            <CopyUrlButton url={status.url} />
          </div>
          <QrCodeImage value={status.url} />
        </div>
      ) : null}

      <div className="space-y-2 border-t border-border-seam pt-4">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setRepairOpen((open) => !open)}
          >
            <Icon
              name={repairOpen ? "ChevronDown" : "ChevronRight"}
              className="size-3.5"
            />
            Re-pair with a new code
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmOpen(true)}
          >
            Disconnect
          </Button>
        </div>
        {repairOpen ? <PairForm paired onPaired={onChanged} /> : null}
        {disconnectError !== null ? (
          <p className="text-sm text-destructive">{disconnectError}</p>
        ) : null}
      </div>

      <DisconnectDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        pending={disconnecting}
        onConfirm={disconnect}
      />
    </div>
  );
}

function ConnectSettingsSection() {
  const rpc = useRpc();
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  if (loadError !== null) {
    return (
      <p className="text-sm text-destructive">
        Failed to load remote-access status: {loadError}
      </p>
    );
  }
  if (status === null) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  return (
    <>
      {status.paired ? (
        <PairedContent status={status} onChanged={refetch} />
      ) : (
        <NotPairedContent onPaired={refetch} />
      )}
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "remote-access",
    component: ConnectSettingsSection,
  });
});
