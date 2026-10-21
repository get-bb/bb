import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  definePluginApp,
  UrlLink,
  experimental_useRpcQuery,
  experimental_useRpcMutation,
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
import { accountPrivateRpcContract } from "./src/contract.js";
import {
  type Account,
  type AccountStatus,
  type LoginView,
  type SignOutResult,
} from "./src/schemas.js";

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

function useAccountState() {
  const query = experimental_useRpcQuery<
    typeof accountPrivateRpcContract,
    "login.poll"
  >({
    contract: accountPrivateRpcContract,
    method: "login.poll",
    input: { loginId: null },
  });
  return {
    state: query.data ?? null,
    loadError: query.error?.message ?? null,
    refetch: query.refetch,
  };
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

function useSignOutMutation() {
  return experimental_useRpcMutation<
    typeof accountPrivateRpcContract,
    "signOut"
  >({
    contract: accountPrivateRpcContract,
    method: "signOut",
    optimistic(_input, cache) {
      cache.update("login.poll", { loginId: null }, (current) => ({
        ...current,
        login: null,
        status: { ...current.status, state: "signed-out", account: null },
      }));
    },
  });
}
const signOutContext = createContext<ReturnType<
  typeof useSignOutMutation
> | null>(null);

function SignOutControl({
  onSignedOut,
}: {
  onSignedOut: (result: SignOutResult) => void;
}) {
  const mutation = useContext(signOutContext);
  if (mutation === null)
    throw new Error("Sign out requires an account settings owner");
  const { mutate: signOutRpc, isPending: pending } = mutation;
  const [confirmOpen, setConfirmOpen] = useState(false);

  const signOut = useCallback(() => {
    signOutRpc(null).then(
      (result) => {
        setConfirmOpen(false);
        onSignedOut(result);
      },
      () => undefined,
    );
  }, [onSignedOut, signOutRpc]);

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
  onSignedOut,
}: {
  account: Account;
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
        <SignOutControl onSignedOut={onSignedOut} />
      </div>
    </div>
  );
}

function ProfilePendingContent({
  onSignedOut,
}: {
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
        <SignOutControl onSignedOut={onSignedOut} />
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

function PairCodeForm({ onDone }: { onDone: () => void }) {
  const { mutate: redeemRpc } = experimental_useRpcMutation<
    typeof accountPrivateRpcContract,
    "redeemCode"
  >({ contract: accountPrivateRpcContract, method: "redeemCode" });
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = isCompletePairingCode(code);

  const submit = useCallback(() => {
    if (pending || !isCompletePairingCode(code)) return;
    setPending(true);
    setError(null);
    redeemRpc({ code, baseUrl: null }).then(
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
  }, [code, onDone, pending, redeemRpc]);

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
  login,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  login: LoginView | null;
}) {
  const { mutate: startRpc } = experimental_useRpcMutation<
    typeof accountPrivateRpcContract,
    "login.start"
  >({ contract: accountPrivateRpcContract, method: "login.start" });
  const { mutate: cancelRpc } = experimental_useRpcMutation<
    typeof accountPrivateRpcContract,
    "login.cancel"
  >({ contract: accountPrivateRpcContract, method: "login.cancel" });
  const [startedLogin, setStartedLogin] = useState<LoginView | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const startedForOpen = useRef(false);

  const start = useCallback(() => {
    setStarting(true);
    setStartError(null);
    startRpc({ baseUrl: null }).then(
      (view) => {
        setStarting(false);
        setStartedLogin(view);
      },
      (error: unknown) => {
        setStarting(false);
        setStartError(errorText(error));
      },
    );
  }, [startRpc]);

  useEffect(() => {
    if (!open) {
      startedForOpen.current = false;
      return;
    }
    if (startedForOpen.current) return;
    startedForOpen.current = true;
    start();
  }, [open, start]);

  const pendingId = startedLogin?.state === "pending" ? startedLogin.id : null;
  const query = experimental_useRpcQuery<
    typeof accountPrivateRpcContract,
    "login.poll"
  >({
    contract: accountPrivateRpcContract,
    method: "login.poll",
    input: { loginId: pendingId },
    enabled: open && pendingId !== null,
  });
  const current =
    query.data === undefined
      ? login?.id === startedLogin?.id
        ? login
        : startedLogin
      : query.data.login;

  useEffect(() => {
    if (open && current?.state === "signed-in") onOpenChange(false);
  }, [current?.state, onOpenChange, open]);

  const close = useCallback(
    (next: boolean) => {
      if (!next && pendingId !== null) {
        cancelRpc({ loginId: pendingId }).then(
          () => {},
          () => {},
        );
      }
      onOpenChange(next);
    },
    [onOpenChange, pendingId, cancelRpc],
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
            {query.error ? (
              <div>
                <p>{query.error.message}</p>
                <Button
                  onClick={() => {
                    void query.refetch();
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : null}
            <SignInDialogBody
              login={current}
              starting={starting}
              startError={
                startError ??
                (!starting && pendingId !== null && query.data?.login === null
                  ? "This sign-in is no longer active. Try again for a new code."
                  : null)
              }
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
  login,
  onChanged,
}: {
  login: LoginView | null;
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
      {codeOpen ? <PairCodeForm onDone={onChanged} /> : null}
      <p className="text-xs text-subtle-foreground">
        From a terminal: <span className="font-mono">bb account login</span>
      </p>
      <SignInDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        login={login}
      />
    </div>
  );
}

function AccountSettingsSection() {
  const mutation = useSignOutMutation();
  return (
    <signOutContext.Provider value={mutation}>
      <AccountSettingsContent />
    </signOutContext.Provider>
  );
}

function AccountSettingsContent() {
  const signOut = useContext(signOutContext);
  const { state, loadError, refetch } = useAccountState();
  const [notice, setNotice] = useState<ReactNode>(null);
  const onSignedOut = useCallback(
    (result: SignOutResult) => {
      setNotice(signOutNotice(result));
      refetch();
    },
    [refetch],
  );

  return (
    <div className="space-y-3" aria-busy={signOut?.isPending}>
      {signOut?.error && (
        <p role="alert" className="text-sm text-destructive-text">
          {errorText(signOut.error)}
        </p>
      )}
      {loadError !== null ? (
        <div role="alert">
          <p className="text-sm text-destructive-text">
            Failed to load your bb account: {loadError}
          </p>
          <Button
            onClick={() => {
              void refetch();
            }}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {state === null ? (
        loadError === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : null
      ) : state.status.state === "signed-in" ? (
        <SignedInContent
          account={state.status.account}
          onSignedOut={onSignedOut}
        />
      ) : state.status.state === "profile-pending" ? (
        <ProfilePendingContent onSignedOut={onSignedOut} />
      ) : (
        <>
          {notice}
          <SignedOutContent
            login={state.login}
            onChanged={() => {
              setNotice(null);
              void refetch();
            }}
          />
        </>
      )}
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
