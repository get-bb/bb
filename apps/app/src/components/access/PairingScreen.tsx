import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PAIR_ROUTE_PATH, type AccessSignOutReason } from "@/lib/access-state";
import { sdk } from "@/lib/sdk";
import {
  formatPairingCodeInput,
  isCompletePairingCode,
  pairingCodeFromHash,
  pairingErrorMessage,
} from "./pairing-code";

interface PairingScreenProps {
  reason: AccessSignOutReason;
}

function returnPath(): string {
  const { pathname, search } = window.location;
  return pathname === PAIR_ROUTE_PATH ? "/" : `${pathname}${search}`;
}

export function PairingScreen({ reason }: PairingScreenProps) {
  const [code, setCode] = useState(() =>
    window.location.pathname === PAIR_ROUTE_PATH
      ? (pairingCodeFromHash(window.location.hash) ?? "")
      : "",
  );
  const redeem = useMutation({
    mutationFn: (pairingCode: string) =>
      sdk.experimental_access.redeemPairing({
        kind: "browser",
        code: pairingCode,
      }),
    meta: { showErrorToast: false },
    onSuccess: () => window.location.replace(returnPath()),
  });
  const autoSubmitted = useRef(false);

  useEffect(() => {
    if (autoSubmitted.current) return;
    autoSubmitted.current = true;
    if (window.location.hash.length > 0) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
    if (isCompletePairingCode(code)) redeem.mutate(code);
  }, [code, redeem]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (isCompletePairingCode(code)) redeem.mutate(code);
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-5"
      >
        <div className="space-y-1">
          <h1 className="text-base font-semibold">Sign in to this bb</h1>
          <p className="text-sm text-subtle-foreground">
            On the server machine run <code>bb access pair</code>, or open
            Settings → Devices on a device that is already signed in, then enter
            the code.
          </p>
          {reason === "credential_requires_https" && (
            <p className="text-sm text-subtle-foreground">
              This browser signed in over HTTPS, so it can't use that sign-in on
              this plain HTTP address. Open the HTTPS address, or sign in again
              here.
            </p>
          )}
        </div>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Pairing code</span>
          <Input
            autoFocus
            autoCapitalize="characters"
            autoComplete="one-time-code"
            spellCheck={false}
            placeholder="XXXXX-XXXXX"
            className="font-mono tracking-widest"
            value={code}
            onChange={(event) =>
              setCode(formatPairingCodeInput(event.target.value))
            }
          />
        </label>
        {redeem.isError && (
          <p role="alert" className="text-sm text-destructive">
            {pairingErrorMessage(redeem.error)}
          </p>
        )}
        <Button
          type="submit"
          className="w-full"
          disabled={!isCompletePairingCode(code) || redeem.isPending}
        >
          {redeem.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </main>
  );
}
