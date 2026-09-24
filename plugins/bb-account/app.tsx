import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  definePluginApp,
  UrlLink,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
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
import type { accountPrivateRpcContract } from "./src/contract.js";
import {
  ACCOUNT_REALTIME_CHANNEL,
  accountRealtimePayloadSchema,
  type Account,
  type AccountStatus,
  type LoginView,
  type SignOutResult,
} from "./src/schemas.js";

const LOGIN_POLL_MS = 2_000;

const DANGER_QUIET_CLASS =
  "text-destructive-text hover:text-destructive-text hover:bg-surface-destructive";

const ERROR_COPY: Record<string, string> = {
  invalid_code:
    "That code is invalid or has expired. Get a new one from the getbb.app dashboard.",
  expired_code:
    "That code has expired. Get a new one from the getbb.app dashboard.",
  already_used:
    "That code was already used. Get a new one from the getbb.app dashboard.",
  network: "Couldn't reach getbb.app. Check your connection, then try again.",
  rate_limited:
    "Too many sign-in attempts from this network. Wait a minute, then try again.",
  unavailable:
    "getbb.app couldn't handle that request right now. Try again in a minute.",
  unauthorized: "getbb.app rejected the new pairing. Try again.",
  profile_unavailable:
    "bb saved the pairing, but getbb.app didn't return your account yet. bb keeps retrying.",
  superseded:
    "Another sign-in or a sign-out replaced this one. Check the account above.",
};

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return ERROR_COPY[message] ?? message;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatPairingCode(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return cleaned.length > 4
    ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`
    : cleaned;
}

function isCompletePairingCode(formatted: string): boolean {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(formatted);
}

type AccountRpc = ReturnType<typeof useRpc<typeof accountPrivateRpcContract>>;

interface AccountState {
  status: AccountStatus;
  login: LoginView | null;
}

function useAccountState(): {
  state: AccountState | null;
  loadError: string | null;
  apply(next: AccountState): void;
  refetch(): void;
} {
  const rpc = useRpc<typeof accountPrivateRpcContract>();
  const [state, setState] = useState<AccountState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const apply = useCallback((next: AccountState) => {
    setState((previous) =>
      previous !== null && previous.status.revision > next.status.revision
        ? { status: previous.status, login: next.login }
        : next,
    );
    setLoadError(null);
  }, []);

  const refetch = useCallback(() => {
    rpc
      .call("login.poll", { loginId: null })
      .then(apply, (error: unknown) => setLoadError(errorText(error)));
  }, [apply, rpc]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useRealtime(ACCOUNT_REALTIME_CHANNEL, (payload) => {
    const parsed = accountRealtimePayloadSchema.safeParse(payload);
    if (parsed.success) apply(parsed.data);
  });

  return { state, loadError, apply, refetch };
}

function Avatar({ account }: { account: Account }) {
  const [failed, setFailed] = useState(false);
  const initial = (account.githubLogin ?? account.name)
    .slice(0, 1)
    .toUpperCase();
  if (account.avatarUrl === null || failed) {
    return (
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-recessed text-sm font-semibold text-muted-foreground"
      >
        {initial}
      </span>
    );
  }
  return (
    <img
      src={account.avatarUrl}
      alt=""
      className="size-10 shrink-0 rounded-full border border-border"
      onError={() => setFailed(true)}
    />
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-24 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm">{children}</dd>
    </div>
  );
}

function SignOutDialog({
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
              <DialogTitle>Sign out of your bb account?</DialogTitle>
              <DialogDescription>
                getbb.app forgets this bb. Remote access and hosted services
                stop until you sign in again.
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
                {pending ? (
                  <Icon name="Spinner" className="size-4 animate-spin" />
                ) : null}
                {pending ? "Signing out…" : "Sign out"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SignOutControl({
  rpc,
  onSignedOut,
}: {
  rpc: AccountRpc;
  onSignedOut: (result: SignOutResult) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = useCallback(() => {
    setPending(true);
    setError(null);
    rpc.call("signOut", null).then(
      (result) => {
        setPending(false);
        setConfirmOpen(false);
        onSignedOut(result);
      },
      (rpcError: unknown) => {
        setPending(false);
        setError(errorText(rpcError));
      },
    );
  }, [onSignedOut, rpc]);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={DANGER_QUIET_CLASS}
        onClick={() => setConfirmOpen(true)}
      >
        Sign out
      </Button>
      {error !== null ? (
        <p className="text-xs text-destructive-text">{error}</p>
      ) : null}
      <SignOutDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        pending={pending}
        onConfirm={signOut}
      />
    </>
  );
}

function SignedInContent({
  account,
  rpc,
  onSignedOut,
}: {
  account: Account;
  rpc: AccountRpc;
  onSignedOut: (result: SignOutResult) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar account={account} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{account.name}</p>
          {account.githubLogin !== null ? (
            <p className="truncate text-xs text-muted-foreground">
              @{account.githubLogin} on GitHub
            </p>
          ) : null}
        </div>
      </div>
      <dl className="space-y-1.5">
        <DetailRow label="Handle">
          {account.handle ?? "Not claimed yet"}
        </DetailRow>
        <DetailRow label="This server">
          <span className="font-mono text-xs">{account.serverLabel}</span>
          <span className="text-muted-foreground">
            {" "}
            · {hostOf(account.serverUrl)}
          </span>
        </DetailRow>
      </dl>
      <div className="-mx-4 flex flex-wrap items-center gap-3 border-t border-border-seam px-4 pt-3">
        <span className="min-w-0 text-xs text-muted-foreground">
          Remote access and hosted services use this account.
        </span>
        <span className="flex-1" />
        <SignOutControl rpc={rpc} onSignedOut={onSignedOut} />
      </div>
    </div>
  );
}

function ProfilePendingContent({
  rpc,
  onSignedOut,
}: {
  rpc: AccountRpc;
  onSignedOut: (result: SignOutResult) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Spinner" className="size-4 animate-spin" />
        This bb is paired with getbb.app, but hasn't loaded your account yet. It
        keeps retrying.
      </p>
      <div className="-mx-4 flex flex-wrap items-center gap-3 border-t border-border-seam px-4 pt-3">
        <span className="min-w-0 text-xs text-muted-foreground">
          Remote access and hosted services start once it does.
        </span>
        <span className="flex-1" />
        <SignOutControl rpc={rpc} onSignedOut={onSignedOut} />
      </div>
    </div>
  );
}

function signOutNotice(result: SignOutResult): ReactNode {
  if (result.revocation !== "failed") return null;
  return (
    <p className="text-xs text-destructive-text">
      Signed out here, but getbb.app didn't confirm it revoked this server (
      {result.message}). Remove it from{" "}
      <UrlLink href={result.dashboardUrl} target="_blank" rel="noreferrer">
        your dashboard
      </UrlLink>
      .
    </p>
  );
}

function PairCodeForm({
  rpc,
  onDone,
}: {
  rpc: AccountRpc;
  onDone: () => void;
}) {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = isCompletePairingCode(code);

  const submit = useCallback(() => {
    if (pending || !isCompletePairingCode(code)) return;
    setPending(true);
    setError(null);
    rpc.call("redeemCode", { code, baseUrl: null }).then(
      () => {
        setPending(false);
        setCode("");
        onDone();
      },
      (rpcError: unknown) => {
        setPending(false);
        setError(errorText(rpcError));
      },
    );
  }, [code, onDone, pending, rpc]);

  return (
    <div className="space-y-2">
      <form
        className="flex max-w-md items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          value={code}
          onChange={(event) => {
            setCode(formatPairingCode(event.target.value));
            setError(null);
          }}
          placeholder="XXXX–XXXX"
          autoComplete="off"
          spellCheck={false}
          aria-label="Pairing code"
          aria-invalid={error !== null}
          className={cn(
            "font-mono tracking-widest",
            error !== null && "border-destructive ring-1 ring-destructive",
          )}
        />
        <Button type="submit" variant="outline" disabled={pending || !complete}>
          {pending ? (
            <Icon name="Spinner" className="size-4 animate-spin" />
          ) : null}
          Pair
        </Button>
      </form>
      {error !== null ? (
        <p className="max-w-md text-xs text-destructive-text">{error}</p>
      ) : null}
    </div>
  );
}

function SignInDialogBody({
  login,
  starting,
  startError,
  onRetry,
}: {
  login: LoginView | null;
  starting: boolean;
  startError: string | null;
  onRetry: () => void;
}) {
  if (startError !== null) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive-text">{startError}</p>
        <Button type="button" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  if (login === null || starting) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Spinner" className="size-4 animate-spin" />
        Getting a sign-in code…
      </p>
    );
  }
  const pending = login.state === "pending";
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">
          Confirm this code on {hostOf(login.verificationUrl)}:
        </p>
        <p
          aria-label="Sign-in code"
          className={cn(
            "font-mono text-base font-semibold tracking-widest",
            !pending && "text-muted-foreground line-through",
          )}
        >
          {login.userCode}
        </p>
      </div>
      {pending ? (
        <>
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
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon name="Spinner" className="size-3.5 animate-spin" />
            Waiting for you to approve it. You can approve from any device.
          </p>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-destructive-text">
            {login.message ?? "Sign-in didn't finish."}
          </p>
          <Button type="button" variant="outline" onClick={onRetry}>
            Get a new code
          </Button>
        </div>
      )}
    </div>
  );
}

function SignInDialog({
  open,
  onOpenChange,
  rpc,
  login,
  onLogin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rpc: AccountRpc;
  login: LoginView | null;
  onLogin: (state: AccountState) => void;
}) {
  const [loginId, setLoginId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const startedForOpen = useRef(false);

  const start = useCallback(() => {
    setStarting(true);
    setStartError(null);
    rpc.call("login.start", { baseUrl: null }).then(
      (view) => {
        setStarting(false);
        setLoginId(view.id);
      },
      (error: unknown) => {
        setStarting(false);
        setStartError(errorText(error));
      },
    );
  }, [rpc]);

  useEffect(() => {
    if (!open) {
      startedForOpen.current = false;
      return;
    }
    if (startedForOpen.current) return;
    startedForOpen.current = true;
    start();
  }, [open, start]);

  const current = login !== null && login.id === loginId ? login : null;
  const pendingId = current?.state === "pending" ? current.id : null;

  useEffect(() => {
    if (pendingId === null) return;
    const interval = setInterval(() => {
      rpc.call("login.poll", { loginId: pendingId }).then(
        (result) => onLogin(result),
        () => {},
      );
    }, LOGIN_POLL_MS);
    return () => clearInterval(interval);
  }, [onLogin, pendingId, rpc]);

  useEffect(() => {
    if (open && current?.state === "signed-in") onOpenChange(false);
  }, [current?.state, onOpenChange, open]);

  const close = useCallback(
    (next: boolean) => {
      if (!next && pendingId !== null) {
        rpc.call("login.cancel", { loginId: pendingId }).then(
          () => {},
          () => {},
        );
      }
      onOpenChange(next);
    },
    [onOpenChange, pendingId, rpc],
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        {open ? (
          <>
            <DialogHeader>
              <DialogTitle>Sign in to your bb account</DialogTitle>
              <DialogDescription>
                Approve this bb on getbb.app. You sign in with GitHub there.
              </DialogDescription>
            </DialogHeader>
            <SignInDialogBody
              login={current}
              starting={starting}
              startError={startError}
              onRetry={start}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => close(false)}
              >
                Cancel
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SignedOutContent({
  rpc,
  login,
  onLogin,
  onChanged,
}: {
  rpc: AccountRpc;
  login: LoginView | null;
  onLogin: (state: AccountState) => void;
  onChanged: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Sign in to link this bb to your getbb.app account. Remote access and
        hosted services such as title and commit message generation use it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => setDialogOpen(true)}>
          Sign in
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setCodeOpen((value) => !value)}
        >
          Have a pairing code?
        </Button>
      </div>
      {codeOpen ? <PairCodeForm rpc={rpc} onDone={onChanged} /> : null}
      <p className="text-xs text-subtle-foreground">
        From a terminal: <span className="font-mono">bb account login</span>
      </p>
      <SignInDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rpc={rpc}
        login={login}
        onLogin={onLogin}
      />
    </div>
  );
}

function AccountSettingsSection() {
  const rpc = useRpc<typeof accountPrivateRpcContract>();
  const { state, loadError, apply, refetch } = useAccountState();
  const [notice, setNotice] = useState<ReactNode>(null);
  const onSignedOut = useCallback(
    (result: SignOutResult) => {
      setNotice(signOutNotice(result));
      refetch();
    },
    [refetch],
  );

  if (loadError !== null && state === null) {
    return (
      <p className="text-sm text-destructive-text">
        Failed to load your bb account: {loadError}
      </p>
    );
  }
  if (state === null) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (state.status.state === "signed-in") {
    return (
      <SignedInContent
        account={state.status.account}
        rpc={rpc}
        onSignedOut={onSignedOut}
      />
    );
  }
  if (state.status.state === "profile-pending") {
    return <ProfilePendingContent rpc={rpc} onSignedOut={onSignedOut} />;
  }
  return (
    <div className="space-y-3">
      {notice}
      <SignedOutContent
        rpc={rpc}
        login={state.login}
        onLogin={apply}
        onChanged={() => {
          setNotice(null);
          refetch();
        }}
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "account",
    description: "The getbb.app account this bb is signed in to.",
    component: AccountSettingsSection,
  });
});
