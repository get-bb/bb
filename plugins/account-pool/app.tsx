import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
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
import { Input } from "@bb/shared-ui/input";
import { Switch } from "@bb/shared-ui/switch";
import type { AccountSummary } from "./src/contracts.js";
import type { accountPoolRpcContract } from "./src/rpc.js";
import { ACCOUNT_POOL_ACCOUNTS_CHANGED } from "./src/realtime.js";

interface LoginStep {
  sessionId: string;
  authorizeUrl: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function utilization(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function statusLabel(status: AccountSummary["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function AccountPoolSettings() {
  const rpc = useRpc<typeof accountPoolRpcContract>();
  const navigate = useBbNavigate();
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginStep, setLoginStep] = useState<LoginStep | null>(null);
  const [pastedCode, setPastedCode] = useState("");
  const [loginPending, setLoginPending] = useState(false);
  const [removeAccount, setRemoveAccount] = useState<AccountSummary | null>(
    null,
  );
  const [removePending, setRemovePending] = useState(false);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyPending, setApiKeyPending] = useState(false);
  const [accountPending, setAccountPending] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await rpc.call("account.list", null);
      if (!mounted.current) return;
      setAccounts(next);
    } catch (loadError) {
      if (!mounted.current) return;
      setError(errorText(loadError));
    }
  }, [rpc]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  useRealtime(ACCOUNT_POOL_ACCOUNTS_CHANGED, () => {
    void refresh();
  });

  const mutate = useCallback(
    async (action: () => Promise<void>) => {
      setError(null);
      try {
        await action();
        await refresh();
      } catch (mutationError) {
        setError(errorText(mutationError));
      }
    },
    [refresh],
  );

  async function startLogin(): Promise<void> {
    if (loginPending) return;
    setLoginPending(true);
    setError(null);
    try {
      const started = await rpc.call("login.start", null);
      setLoginStep(started);
      setPastedCode("");
      navigate.openUrl(started.authorizeUrl);
    } catch (startError) {
      setError(errorText(startError));
    } finally {
      setLoginPending(false);
    }
  }

  async function completeLogin(): Promise<void> {
    if (loginStep === null || pastedCode.trim().length === 0 || loginPending)
      return;
    setLoginPending(true);
    setError(null);
    try {
      await rpc.call("login.complete", {
        sessionId: loginStep.sessionId,
        pasted: pastedCode,
      });
      setLoginStep(null);
      setPastedCode("");
      await refresh();
    } catch (completeError) {
      setError(errorText(completeError));
    } finally {
      setLoginPending(false);
    }
  }

  async function importAccount(): Promise<void> {
    if (loading) return;
    setLoading(true);
    await mutate(async () => {
      await rpc.call("account.add", {
        provider: "claude",
        source: { kind: "import" },
        label: null,
        priority: 100,
      });
    });
    setLoading(false);
  }

  async function addApiKey(): Promise<void> {
    if (apiKey.trim().length === 0 || apiKeyPending) return;
    setApiKeyPending(true);
    await mutate(async () => {
      await rpc.call("account.add", {
        provider: "claude",
        source: { kind: "api-key", apiKey: apiKey.trim() },
        label: null,
        priority: 100,
      });
      setApiKey("");
      setApiKeyOpen(false);
    });
    setApiKeyPending(false);
  }

  async function toggleAccount(account: AccountSummary): Promise<void> {
    if (accountPending !== null) return;
    setAccountPending(account.id);
    await mutate(async () => {
      await rpc.call(account.enabled ? "account.disable" : "account.enable", {
        id: account.id,
      });
    });
    setAccountPending(null);
  }

  async function confirmRemove(): Promise<void> {
    if (removeAccount === null || removePending) return;
    setRemovePending(true);
    await mutate(async () => {
      await rpc.call("account.remove", { id: removeAccount.id });
      setRemoveAccount(null);
    });
    setRemovePending(false);
  }

  async function copyAuthorizeUrl(): Promise<void> {
    if (loginStep === null) return;
    try {
      await navigator.clipboard.writeText(loginStep.authorizeUrl);
    } catch {
      setError("Copy failed. Select the URL and copy it manually.");
    }
  }

  return (
    <div className="w-full space-y-5">
      <div>
        <h3 className="text-sm font-medium text-foreground">Claude accounts</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Account Pool routes Claude Code threads through an available account
          and moves away from accounts that reach their limits.
        </p>
      </div>

      {accounts === null ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading accounts…
        </p>
      ) : accounts.length === 0 ? (
        <div className="rounded-md border border-border/60 bg-surface-recessed px-4 py-4">
          <p className="text-sm font-medium text-foreground">
            No Claude accounts yet
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Add an account and the plugin will route Claude Code threads through
            the pool automatically.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/60 overflow-hidden rounded-md border border-border/60">
          {accounts.map((account) => (
            <div key={account.id} className="space-y-3 px-3 py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-medium text-foreground">
                      {account.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {account.kind === "oauth" ? "OAuth" : "API key"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {statusLabel(account.status)}
                    </span>
                  </div>
                  {account.email === null ? null : (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {account.email}
                    </p>
                  )}
                </div>
                <Switch
                  checked={account.enabled}
                  disabled={accountPending === account.id}
                  aria-label={`${account.enabled ? "Disable" : "Enable"} ${account.label}`}
                  onCheckedChange={() => {
                    void toggleAccount(account);
                  }}
                />
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>5h {utilization(account.fiveHourUtilization)}</span>
                <span>7d {utilization(account.sevenDayUtilization)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-destructive-text hover:bg-surface-destructive hover:text-destructive-text"
                  onClick={() => setRemoveAccount(account)}
                >
                  Remove
                </Button>
              </div>
              {account.error === null ? null : (
                <p className="text-xs text-destructive-text">{account.error}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {loginStep === null ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={loginPending} onClick={startLogin}>
            {loginPending ? "Starting…" : "Sign in to Claude"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => void importAccount()}
          >
            {loading ? "Importing…" : "Import from this machine"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setApiKeyOpen(true)}
          >
            Add API key
          </Button>
        </div>
      ) : (
        <div className="space-y-3 rounded-md border border-border/60 px-4 py-4">
          <div>
            <p className="text-sm font-medium text-foreground">
              Finish signing in to Claude
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Complete sign-in in the browser, then paste the code shown on the
              final page.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              readOnly
              value={loginStep.authorizeUrl}
              aria-label="Claude sign-in URL"
              className="font-mono text-xs"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button type="button" variant="outline" onClick={copyAuthorizeUrl}>
              Copy
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate.openUrl(loginStep.authorizeUrl)}
            >
              Open
            </Button>
          </div>
          <Input
            value={pastedCode}
            aria-label="Claude authorization code"
            autoComplete="off"
            placeholder="Paste code#state or callback URL"
            onChange={(event) => setPastedCode(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={loginPending || pastedCode.trim().length === 0}
              onClick={() => void completeLogin()}
            >
              {loginPending ? "Completing…" : "Complete sign-in"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={loginPending}
              onClick={() => {
                setLoginStep(null);
                setPastedCode("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error === null ? null : (
        <p className="text-xs text-destructive-text" role="alert">
          {error}
        </p>
      )}

      <Dialog
        open={removeAccount !== null}
        onOpenChange={(open) => {
          if (!open && !removePending) setRemoveAccount(null);
        }}
      >
        <DialogContent>
          {removeAccount === null ? null : (
            <>
              <DialogHeader>
                <DialogTitle>Remove {removeAccount.label}?</DialogTitle>
                <DialogDescription>
                  This permanently removes the account and its stored secret
                  from this bb server.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={removePending}
                  onClick={() => setRemoveAccount(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={removePending}
                  onClick={() => void confirmRemove()}
                >
                  {removePending ? "Removing…" : "Remove account"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={apiKeyOpen}
        onOpenChange={(open) => {
          if (!apiKeyPending) setApiKeyOpen(open);
        }}
      >
        <DialogContent>
          {apiKeyOpen ? (
            <>
              <DialogHeader>
                <DialogTitle>Add an Anthropic API key</DialogTitle>
                <DialogDescription>
                  The key is sent directly to this bb server and stored in its
                  protected Account Pool secret directory.
                </DialogDescription>
              </DialogHeader>
              <Input
                type="password"
                value={apiKey}
                autoComplete="off"
                aria-label="Anthropic API key"
                placeholder="sk-ant-…"
                onChange={(event) => setApiKey(event.target.value)}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={apiKeyPending}
                  onClick={() => setApiKeyOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={apiKeyPending || apiKey.trim().length === 0}
                  onClick={() => void addApiKey()}
                >
                  {apiKeyPending ? "Adding…" : "Add API key"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "accounts",
    component: AccountPoolSettings,
  });
});
