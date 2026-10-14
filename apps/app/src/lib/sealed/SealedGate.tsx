import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import type { SealedConnection, SealedState } from "./connection";

function useConnectionState(connection: SealedConnection): SealedState {
  return useSyncExternalStore(
    (listener) => connection.subscribe(listener),
    () => connection.getState(),
    () => connection.getState(),
  );
}

function Fingerprint({ value }: { value: string }) {
  return (
    <code className="block rounded-md border border-border bg-surface-recessed px-3 py-2 font-mono text-sm tracking-wide text-foreground">
      {value}
    </code>
  );
}

function DeviceCodeForm({ connection }: { connection: SealedConnection }) {
  const [code, setCode] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = code.trim();
        if (trimmed.length === 0) return;
        connection.useDeviceCode(trimmed);
      }}
    >
      <Input
        value={code}
        onChange={(event) => setCode(event.target.value.toUpperCase())}
        placeholder="ABCD-EFGH-JKLM"
        aria-label="Device code"
        autoComplete="off"
        className="font-mono uppercase"
      />
      <Button
        type="submit"
        variant="outline"
        disabled={code.replace(/[^A-Za-z0-9]/gu, "").length < 12}
      >
        Use code
      </Button>
    </form>
  );
}

export function SealedBootFailure({
  message,
  onReset,
}: {
  message: string;
  onReset?: () => Promise<void>;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Secure connection"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-background p-6 text-foreground"
    >
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-2">
          <Icon name="Lock" className="size-4" />
          <h1 className="text-base font-semibold">Sealed connection</h1>
        </div>
        <p className="text-sm text-destructive-text">
          This app expects a sealed connection to your bb but could not prepare
          its device key ({message}). It will not fall back to a readable
          connection. Fix the problem and reload.
        </p>
        {onReset !== undefined ? (
          <Button
            variant="outline"
            onClick={() => {
              void onReset();
            }}
          >
            Forget this server's key and enroll again
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function sealedGateBlocks(state: SealedState): boolean {
  return (
    state.kind === "pending" ||
    state.kind === "rejected" ||
    state.kind === "key-mismatch" ||
    (state.kind === "ready" && !state.verified && !state.acknowledged)
  );
}

export function SealedReadableChoice({
  reason,
  onContinue,
  onRetry,
}: {
  reason: string;
  onContinue: () => void;
  onRetry: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Secure connection"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-background p-6 text-foreground"
    >
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-2">
          <Icon name="Lock" className="size-4" />
          <h1 className="text-base font-semibold">Sealed connection</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          This bb could not confirm that it offers sealed connections ({reason}
          ). If you reach it through a relay, that relay can read what this page
          sends. Nothing has been sent yet.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
          <Button variant="outline" onClick={onContinue}>
            Continue with a readable connection
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SealedGate({
  connection,
  initial,
}: {
  connection: SealedConnection;
  initial: boolean;
}) {
  const state = useConnectionState(connection);
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setElapsed(true), 1500);
    return () => clearTimeout(timer);
  }, []);
  if (!sealedGateBlocks(state) && !(initial && state.kind !== "ready")) {
    return null;
  }
  const slow =
    elapsed && (state.kind === "connecting" || state.kind === "offline");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Secure connection"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-background p-6 text-foreground"
    >
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-2">
          <Icon name="Lock" className="size-4" />
          <h1 className="text-base font-semibold">Sealed connection</h1>
        </div>
        {state.kind === "connecting" || state.kind === "idle" ? (
          <p className="text-sm text-muted-foreground">
            {slow
              ? "Still opening a sealed connection to your bb…"
              : "Opening a sealed connection to your bb…"}
          </p>
        ) : null}
        {state.kind === "offline" ? (
          <p className="text-sm text-muted-foreground">
            The sealed connection dropped ({state.error}). Retrying
            automatically; readable fallback is disabled.
          </p>
        ) : null}
        {state.kind === "ready" && !state.verified && !state.acknowledged ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This is the first sealed contact with this bb. Compare the server
              key fingerprint below with Settings → Remote access or{" "}
              <code>bb connect encryption</code> on the computer running bb. A
              relay that substituted its own key would show a different
              fingerprint. Nothing has been sent yet.
            </p>
            <Fingerprint value={state.fingerprint} />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  void connection.markVerified();
                }}
              >
                The fingerprints match
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  void connection.acknowledgeUnverified();
                }}
              >
                Continue without checking
              </Button>
            </div>
            <p className="text-xs text-subtle-foreground">
              Or enter a device code from <code>bb connect device-code</code>,
              which verifies the key for you.
            </p>
            <DeviceCodeForm connection={connection} />
          </div>
        ) : null}
        {state.kind === "pending" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This device is waiting for approval. On the computer running bb,
              check that the server key fingerprint below matches Settings →
              Remote access or <code>bb connect encryption</code>, then approve
              device <code>{state.deviceId}</code> with{" "}
              <code>bb connect approve-device</code> or the Devices list.
            </p>
            <Fingerprint value={state.fingerprint} />
            <p className="text-xs text-subtle-foreground">
              Or enter a device code from <code>bb connect device-code</code> to
              pin the key and approve in one step.
            </p>
            <DeviceCodeForm connection={connection} />
          </div>
        ) : null}
        {state.kind === "rejected" ? (
          <div className="space-y-3">
            <p className="text-sm text-destructive-text">
              {state.reason === "revoked"
                ? "This device was revoked on the bb server. In a browser or the phone's web view, Forget in Settings discards this key so the next visit enrolls as a new device; otherwise ask the owner to remove the device there (bb connect remove-device)."
                : state.reason === "invalid-code"
                  ? "That device code was not accepted, or the server you reached could not prove it knows the code. Codes work once and expire after ten minutes; any unverified key pinned on first use was cleared."
                  : `The server refused this device (${state.reason}).`}
            </p>
            {state.fingerprint !== null ? (
              <Fingerprint value={state.fingerprint} />
            ) : null}
            <DeviceCodeForm connection={connection} />
          </div>
        ) : null}
        {state.kind === "key-mismatch" ? (
          <div className="space-y-3">
            <p className="text-sm text-destructive-text">
              The server key changed. Either the bb server rotated its
              encryption key, or something between you and the server is
              impersonating it. Do not continue unless the new fingerprint
              matches what
              <code> bb connect encryption</code> prints on the server.
            </p>
            <div className="space-y-1 text-xs text-subtle-foreground">
              <span>Expected</span>
              <Fingerprint value={state.expected} />
              <span>Presented</span>
              <Fingerprint value={state.actual} />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                void connection.trustPresentedKey();
              }}
            >
              I verified the presented fingerprint — trust it
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
