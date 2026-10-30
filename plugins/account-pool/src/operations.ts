import type {
  Account,
  AccountAddInput,
  AccountSecret,
  AccountSummary,
  HubTokenSummary,
  LoginTarget,
  PoolProvider,
  PoolStatus,
  RoutedThreadStatus,
} from "./contracts.js";
import type { AccountPoolHub } from "./hub.js";
import type {
  AccountStore,
  HubTokenStore,
  QuotaStore,
  RoutingStore,
} from "./store.js";
import type { ClaudeOAuthAccount } from "./oauth-login.js";
import type { CodexDeviceAccount } from "./codex-device-login.js";

interface PoolHost {
  id: string;
  name: string;
}

interface PoolProviderState {
  providerId: string;
  status: string;
  planLabel: string | null;
}

const ROUTED_WINDOW_MS = 24 * 60 * 60 * 1_000;

export class LoginTargetError extends Error {}

interface OAuthLogin {
  provider: PoolProvider;
  label: string;
  email: string | null;
  accountUuid: string | null;
  codexAccountId: string | null;
  subscriptionType: string | null;
  rateLimitTier: string | null;
  secret: Extract<AccountSecret, { kind: "oauth" }>;
}

function identityMismatch(account: Account, login: OAuthLogin): string | null {
  const addInstead =
    "or add the login as a new account with `bb pool account add --login`.";
  if (
    account.provider === "codex" &&
    account.codexAccountId !== login.codexAccountId
  ) {
    return `This login is for a different ChatGPT workspace than ${account.label}. Sign in to that workspace, ${addInstead}`;
  }
  const sameAccount =
    account.accountUuid !== null && login.accountUuid !== null
      ? account.accountUuid === login.accountUuid
      : account.email === null ||
        login.email === null ||
        account.email.toLowerCase() === login.email.toLowerCase();
  if (sameAccount) return null;
  const expected = account.email ?? account.label;
  return `This login is for ${login.email ?? "a different account"}, not ${expected}. Sign in as ${expected}, ${addInstead}`;
}

export class PoolOperations {
  constructor(
    private readonly accounts: AccountStore,
    private readonly quotas: QuotaStore,
    private readonly hub: AccountPoolHub,
    private readonly hubTokens: HubTokenStore,
    private readonly routing: RoutingStore,
    private readonly listHosts: () => Promise<PoolHost[]>,
    private readonly providerStates: (
      hostId: string,
    ) => Promise<PoolProviderState[]>,
    private readonly now: () => number = Date.now,
    private readonly onAccountsChanged: () => void = () => {},
    private readonly onAccountEnabled: (
      accountId: string,
    ) => Promise<void> = async () => {},
    private readonly parentStatus: () => Promise<
      PoolStatus["parent"]
    > = async () => null,
  ) {}

  async add(input: AccountAddInput): Promise<Account> {
    const account = await this.accounts.add(
      {
        provider: input.provider,
        kind: "api-key",
        label: input.label ?? "Claude API key",
        email: null,
        accountUuid: null,
        subscriptionType: null,
        rateLimitTier: null,
        enabled: true,
        priority: input.priority,
      },
      { kind: "api-key", apiKey: input.apiKey },
    );
    this.onAccountsChanged();
    await this.onAccountEnabled(account.id);
    return account;
  }

  async validateLoginTarget(
    provider: PoolProvider,
    target: LoginTarget,
  ): Promise<void> {
    if (target.kind === "relogin") {
      await this.reloginAccount(provider, target.accountId);
    }
  }

  async addOAuth(
    authenticated: ClaudeOAuthAccount,
    target: LoginTarget,
  ): Promise<Account> {
    return this.saveLogin(
      {
        provider: "claude",
        label: authenticated.label,
        email: authenticated.email,
        accountUuid: authenticated.accountUuid,
        codexAccountId: null,
        subscriptionType: authenticated.subscriptionType,
        rateLimitTier: authenticated.rateLimitTier,
        secret: {
          kind: "oauth",
          accessToken: authenticated.accessToken,
          refreshToken: authenticated.refreshToken,
          expiresAt: authenticated.expiresAt,
        },
      },
      target,
    );
  }

  async addCodexOAuth(
    authenticated: CodexDeviceAccount,
    target: LoginTarget,
  ): Promise<AccountSummary> {
    const account = await this.saveLogin(
      {
        provider: "codex",
        label: authenticated.label,
        email: authenticated.email,
        accountUuid: null,
        codexAccountId: authenticated.accountId,
        subscriptionType: null,
        rateLimitTier: null,
        secret: {
          kind: "oauth",
          accessToken: authenticated.accessToken,
          refreshToken: authenticated.refreshToken,
          idToken: authenticated.idToken,
          expiresAt: authenticated.expiresAt,
        },
      },
      target,
    );
    const summary = (await this.list()).find((item) => item.id === account.id);
    if (summary === undefined) {
      throw new Error("Saved Codex account could not be read back.");
    }
    return summary;
  }

  private async saveLogin(
    login: OAuthLogin,
    target: LoginTarget,
  ): Promise<Account> {
    if (target.kind === "relogin") {
      return this.relogin(login, target.accountId);
    }
    const account = await this.accounts.add(
      {
        provider: login.provider,
        kind: "oauth",
        label: target.label ?? login.label,
        email: login.email,
        accountUuid: login.accountUuid,
        ...(login.codexAccountId === null
          ? {}
          : { codexAccountId: login.codexAccountId }),
        subscriptionType: login.subscriptionType,
        rateLimitTier: login.rateLimitTier,
        enabled: true,
        priority: target.priority,
      },
      login.secret,
    );
    this.onAccountsChanged();
    await this.onAccountEnabled(account.id);
    return account;
  }

  private async relogin(
    login: OAuthLogin,
    accountId: string,
  ): Promise<Account> {
    const account = await this.reloginAccount(login.provider, accountId);
    const mismatch = identityMismatch(account, login);
    if (mismatch !== null) throw new LoginTargetError(mismatch);
    const updated = await this.accounts.applyLogin(account.id, login);
    if (updated === null) {
      throw new LoginTargetError(`Account ${account.id} no longer exists.`);
    }
    await this.hub.replaceSecret(account.id, login.secret);
    this.onAccountsChanged();
    if (updated.enabled) await this.onAccountEnabled(updated.id);
    return updated;
  }

  private async reloginAccount(
    provider: PoolProvider,
    accountId: string,
  ): Promise<Account> {
    const account = await this.accounts.get(accountId);
    if (account === null) {
      throw new LoginTargetError(`Account ${accountId} does not exist.`);
    }
    if (account.provider !== provider) {
      throw new LoginTargetError(
        `${account.label} is a ${account.provider === "claude" ? "Claude" : "Codex"} account.`,
      );
    }
    if (account.kind !== "oauth") {
      throw new LoginTargetError(
        `${account.label} uses an API key and has no login to renew.`,
      );
    }
    return account;
  }

  async list(): Promise<AccountSummary[]> {
    return (await this.status()).accounts;
  }

  async remove(id: string): Promise<boolean> {
    const removed = await this.accounts.remove(id);
    if (removed) {
      this.quotas.remove(id);
      this.onAccountsChanged();
    }
    return removed;
  }

  async enable(id: string): Promise<Account | null> {
    const account = await this.accounts.setEnabled(id, true);
    if (account === null) return null;
    const quota = this.quotas.get(id);
    this.quotas.put({ ...quota, error: null, heldUntil: null });
    this.onAccountsChanged();
    await this.onAccountEnabled(account.id);
    return account;
  }

  async disable(id: string): Promise<Account | null> {
    const account = await this.accounts.setEnabled(id, false);
    if (account !== null) this.onAccountsChanged();
    return account;
  }

  async setPriority(id: string, priority: number): Promise<Account | null> {
    const account = await this.accounts.setPriority(id, priority);
    if (account !== null) this.onAccountsChanged();
    return account;
  }

  async reorder(provider: PoolProvider, accountIds: string[]): Promise<void> {
    await this.accounts.reorder(provider, accountIds);
    this.onAccountsChanged();
  }

  async refreshUsage(id: string): Promise<AccountSummary | null> {
    if ((await this.accounts.get(id)) === null) return null;
    await this.hub.refreshUsage(id, true);
    this.onAccountsChanged();
    return (
      (await this.status()).accounts.find((account) => account.id === id) ??
      null
    );
  }

  async setRouting(provider: PoolProvider, enabled: boolean): Promise<void> {
    await this.routing.setProviderEnabled(provider, enabled);
    this.onAccountsChanged();
  }

  isRoutingEnabled(provider: PoolProvider): Promise<boolean> {
    return this.routing.isProviderEnabled(provider);
  }

  async status(): Promise<PoolStatus> {
    const hosts = await this.listHosts();
    await this.hubTokens.prune(hosts.map((host) => host.id));
    const status = await this.hub.status();
    const hostNames = new Map(hosts.map((host) => [host.id, host.name]));
    const [claude, codex] = await Promise.all([
      this.routing.isProviderEnabled("claude"),
      this.routing.isProviderEnabled("codex"),
    ]);
    return {
      ...status,
      hosts: status.hosts.map((token) => ({
        ...token,
        hostName: hostNames.get(token.hostId) ?? null,
      })),
      accounts: status.accounts.map((account) => ({
        ...account,
        lastUsedHostName:
          account.lastUsedHostId === null
            ? null
            : (hostNames.get(account.lastUsedHostId) ?? null),
      })),
      routing: { claude, codex },
      parent: await this.parentStatus(),
    };
  }

  async rotateToken(machine: string): Promise<HubTokenSummary> {
    const hosts = await this.listHosts();
    const matches = hosts.filter(
      (host) => host.id === machine || host.name === machine,
    );
    if (matches.length === 0)
      throw new Error(`Machine ${machine} does not exist.`);
    if (matches.length > 1)
      throw new Error(`Machine name ${machine} matches more than one host.`);
    const host = matches[0];
    if (host === undefined)
      throw new Error(`Machine ${machine} does not exist.`);
    const token = await this.hubTokens.rotate(host.id);
    return { ...token, hostName: host.name };
  }

  async setBypass(
    threadId: string,
    bypassed: boolean,
  ): Promise<{
    threadId: string;
    bypassed: boolean;
  }> {
    await this.routing.setBypassed(threadId, bypassed);
    return { threadId, bypassed };
  }

  async hasUsableEnabledAccount(provider: PoolProvider): Promise<boolean> {
    for (const account of await this.accounts.list()) {
      if (!account.enabled || account.provider !== provider) continue;
      try {
        await this.accounts.readSecret(account.id);
        return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  async routesOnlyApiKeys(provider: PoolProvider): Promise<boolean> {
    let usable = false;
    for (const account of await this.accounts.list()) {
      if (!account.enabled || account.provider !== provider) continue;
      try {
        await this.accounts.readSecret(account.id);
      } catch {
        continue;
      }
      if (account.kind !== "api-key") return false;
      usable = true;
    }
    return usable;
  }

  async routedThreadsWithoutLocalLogin(): Promise<RoutedThreadStatus[]> {
    const routed = await this.routing.listRoutedSince(
      this.now() - ROUTED_WINDOW_MS,
    );
    const [hosts, statesByHost] = await Promise.all([
      this.listHosts(),
      Promise.all(
        [...new Set(routed.map((entry) => entry.hostId))].map(
          async (hostId) => ({
            hostId,
            states: await this.providerStates(hostId).catch(() => []),
          }),
        ),
      ),
    ]);
    const hostNames = new Map(hosts.map((host) => [host.id, host.name]));
    const localStateByHost = new Map(
      statesByHost.map(({ hostId, states }) => [
        hostId,
        states.find((state) => state.providerId === "claude-code") ?? null,
      ]),
    );
    return routed.flatMap((entry) => {
      const state = localStateByHost.get(entry.hostId);
      const status =
        state?.status === "ready" && state.planLabel === "Proxied"
          ? "proxied"
          : state?.status;
      if (
        status !== "unauthenticated" &&
        status !== "expired" &&
        status !== "proxied"
      )
        return [];
      return [
        {
          ...entry,
          hostName: hostNames.get(entry.hostId) ?? null,
          localClaudeStatus: status,
        },
      ];
    });
  }
}
