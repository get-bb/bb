import type { AccessCredential, AccessPairing } from "@bb/sdk/browser";
import { Button } from "@bb/shared-ui/button";
import { Pill } from "@bb/shared-ui/pill";
import { cn } from "@bb/shared-ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { pairingLink } from "@/components/access/pairing-code";
import { CopyButton } from "@/components/ui/copy-button";
import { SettingsSection } from "@bb/shared-ui/settings-section";
import { getHttpErrorMessage, asHttpError } from "@/lib/http-error";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  accessCredentialsQueryKey,
  invalidateAccessCredentials,
} from "@/hooks/cache-owners/access-credentials-cache-owner";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { sdk } from "@/lib/sdk";

function errorText(error: unknown): string {
  const httpError = asHttpError(error);
  return (
    (httpError === null ? null : getHttpErrorMessage(httpError)) ??
    "Request failed."
  );
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function qrCodeDataUrl(value: string): Promise<string> {
  return import("qrcode").then((QRCode) =>
    QRCode.toDataURL(value, { margin: 1, width: 320 }),
  );
}

function QrCodeImage({ value, alt }: { value: string; alt: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void qrCodeDataUrl(value).then(
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
  if (dataUrl === null) return <div className="size-40" />;
  return (
    <img
      src={dataUrl}
      alt={alt}
      className="size-40 rounded-md border border-border"
    />
  );
}

function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function isLoopbackOrigin(origin: string): boolean {
  const { hostname } = new URL(origin);
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  );
}

function usePairingLinkOrigin(): string | null {
  const serverUrl = useSystemConfig().data?.serverUrl ?? null;
  if (!isLoopbackOrigin(window.location.origin)) return window.location.origin;
  return serverUrl !== null && !isLoopbackOrigin(serverUrl)
    ? new URL(serverUrl).origin
    : null;
}

function PairingPanel({
  pairing,
  minting,
  onRenew,
}: {
  pairing: AccessPairing;
  minting: boolean;
  onRenew: () => void;
}) {
  const now = useNow(1000);
  const remainingMs = pairing.expiresAt - now;
  const expired = remainingMs <= 0;
  const linkOrigin = usePairingLinkOrigin();
  const link =
    linkOrigin === null ? null : pairingLink(linkOrigin, pairing.code);
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border px-3 py-3 sm:flex-row sm:items-start">
      {link !== null && (
        <div
          className={cn(
            "shrink-0 self-center sm:self-start",
            expired && "opacity-40 saturate-0",
          )}
        >
          <QrCodeImage value={link} alt="QR code to sign another device in" />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm">
          {expired
            ? "This code expired. Make a new one."
            : link === null
              ? "Open bb on the other device and enter this code."
              : "Scan this on the other device, open the link there, or open bb there and enter the code."}
        </p>
        <div className="flex max-w-xs items-center gap-1 rounded-lg border border-border py-1 pl-3.5 pr-1">
          <span
            aria-label="Pairing code"
            className={cn(
              "min-w-0 flex-1 truncate font-mono text-base font-medium tracking-widest",
              expired && "text-muted-foreground line-through",
            )}
          >
            {pairing.code}
          </span>
          {!expired && (
            <CopyButton text={pairing.code} label="Copy pairing code" />
          )}
        </div>
        {link !== null && (
          <p className="break-all text-xs text-subtle-foreground">{link}</p>
        )}
        <div className="flex items-center gap-2 text-xs text-subtle-foreground">
          {expired ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={minting}
              onClick={onRenew}
            >
              {minting ? "Making a code…" : "New code"}
            </Button>
          ) : (
            <span role="timer">
              Expires in {formatRemaining(remainingMs)} · works once
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function CredentialRow({
  credential,
  now,
  revoking,
  onRevoke,
}: {
  credential: AccessCredential;
  now: number;
  revoking: boolean;
  onRevoke: () => void;
}) {
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{credential.label}</span>
          <Pill variant="outline" size="sm">
            {credential.kind === "browser" ? "Browser" : "Device"}
          </Pill>
          {credential.current && (
            <Pill variant="secondary" size="sm">
              This device
            </Pill>
          )}
        </div>
        <p className="truncate text-xs text-subtle-foreground">
          {credential.origin}
        </p>
        <p className="text-xs text-subtle-foreground">
          Signed in{" "}
          {formatRelativeTime({ timestamp: credential.createdAt, now })} · Last
          used {formatRelativeTime({ timestamp: credential.lastUsedAt, now })}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={revoking}
        onClick={onRevoke}
      >
        {credential.current ? "Sign out" : "Revoke"}
      </Button>
    </li>
  );
}

export function DevicesSettingsSection() {
  const queryClient = useQueryClient();
  const now = useNow(60_000);
  const credentials = useQuery({
    queryKey: accessCredentialsQueryKey,
    queryFn: ({ signal }) =>
      sdk.experimental_access.listCredentials({ signal }),
  });
  const [pairing, setPairing] = useState<AccessPairing | null>(null);
  const mint = useMutation({
    mutationFn: () => sdk.experimental_access.createPairing(),
    meta: { errorMessage: "Could not make a pairing code." },
    onSuccess: setPairing,
  });
  const revoke = useMutation({
    mutationFn: (credential: AccessCredential) =>
      sdk.experimental_access.revokeCredential({ id: credential.id }),
    meta: { errorMessage: "Could not revoke that device." },
    onSuccess: (_result, credential) => {
      if (credential.current) {
        window.location.reload();
        return;
      }
      invalidateAccessCredentials(queryClient);
    },
  });

  const list = credentials.data?.credentials ?? [];

  return (
    <section aria-label="Devices" className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">Devices</h2>
        <p className="mt-1 text-sm text-subtle-foreground">
          Browsers and apps that reach this bb from another computer or phone
          sign in once with a pairing code.
        </p>
      </div>
      <SettingsSection
        title="Sign in another device"
        description="Make a one-time code, valid for 10 minutes."
        action={
          pairing === null ? (
            <Button
              type="button"
              disabled={mint.isPending}
              onClick={() => mint.mutate()}
            >
              {mint.isPending ? "Making a code…" : "Sign in another device"}
            </Button>
          ) : undefined
        }
      >
        {pairing !== null && (
          <PairingPanel
            pairing={pairing}
            minting={mint.isPending}
            onRenew={() => mint.mutate()}
          />
        )}
      </SettingsSection>
      <SettingsSection title="Signed-in devices">
        {credentials.isPending ? (
          <p className="text-sm text-subtle-foreground" role="status">
            Loading…
          </p>
        ) : credentials.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {errorText(credentials.error)}
          </p>
        ) : list.length === 0 ? (
          <p className="text-sm text-subtle-foreground">
            No other devices are signed in. This computer runs bb, so it never
            needs to sign in.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((credential) => (
              <CredentialRow
                key={credential.id}
                credential={credential}
                now={now}
                revoking={
                  revoke.isPending && revoke.variables?.id === credential.id
                }
                onRevoke={() => revoke.mutate(credential)}
              />
            ))}
          </ul>
        )}
      </SettingsSection>
    </section>
  );
}
