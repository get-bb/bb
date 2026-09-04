import type {
  Account,
  AccountSummary,
  HubTokenSummary,
  PoolStatus,
  RoutedThreadStatus,
} from "./contracts.js";
import type { AccountAddInput } from "./contracts.js";
import {
  importClaudeCredentials,
  type ImportedClaudeCredentials,
} from "./credentials.js";
import type { AccountPoolHub } from "./hub.js";
import type {
  AccountStore,
  HubTokenStore,
  QuotaStore,
  RoutingStore,
} from "./store.js";
import type { ClaudeOAuthAccount } from "./oauth-login.js";

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
    private readonly importCredentials: () => Promise<ImportedClaudeCredentials> = importClaudeCredentials,
    private readonly onAccountsChanged: () => void = () => {},
  ) {}

  async add(input: AccountAddInput): Promise<Account> {
    if (input.source.kind === "api-key") {
      const account = await this.accounts.add(
        {
          provider: input.provider,
          kind: "api-key",
          label: input.label ?? "Claude API key",
          email: null,
          subscriptionType: null,
          rateLimitTier: null,
          enabled: true,
          priority: input.priority,
        },
        { kind: "api-key", apiKey: input.source.apiKey },
      );
      this.onAccountsChanged();
      return account;
    }
    const imported = await this.importCredentials();
    const account = await this.accounts.add(
      {
        provider: input.provider,
        kind: "oauth",
        label: input.label ?? imported.email ?? "Claude Code account",
        email: imported.email,
        subscriptionType: imported.subscriptionType,
        rateLimitTier: imported.rateLimitTier,
        enabled: true,
        priority: input.priority,
      },
      {
        kind: "oauth",
        accessToken: imported.accessToken,
        refreshToken: imported.refreshToken,
        expiresAt: imported.expiresAt,
      },
    );
    this.onAccountsChanged();
    return account;
  }

  async addOAuth(authenticated: ClaudeOAuthAccount): Promise<Account> {
    const account = await this.accounts.add(
      {
        provider: "claude",
        kind: "oauth",
        label: authenticated.label,
        email: authenticated.email,
        subscriptionType: authenticated.subscriptionType,
        rateLimitTier: authenticated.rateLimitTier,
        enabled: true,
        priority: 100,
      },
      {
        kind: "oauth",
        accessToken: authenticated.accessToken,
        refreshToken: authenticated.refreshToken,
        expiresAt: authenticated.expiresAt,
      },
    );
    this.onAccountsChanged();
    return account;
  }

  async list(): Promise<AccountSummary[]> {
    return (await this.hub.status()).accounts;
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
    return account;
  }

  async disable(id: string): Promise<Account | null> {
    const account = await this.accounts.setEnabled(id, false);
    if (account !== null) this.onAccountsChanged();
    return account;
  }

  async status(): Promise<PoolStatus> {
    const hosts = await this.listHosts();
    await this.hubTokens.prune(hosts.map((host) => host.id));
    const [status, routedThreadsWithoutLocalLogin] = await Promise.all([
      this.hub.status(),
      this.routedThreadsWithoutLocalLogin(),
    ]);
    const hostNames = new Map(hosts.map((host) => [host.id, host.name]));
    return {
      ...status,
      hosts: status.hosts.map((token) => ({
        ...token,
        hostName: hostNames.get(token.hostId) ?? null,
      })),
      routedThreadsWithoutLocalLogin,
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

  async hasUsableEnabledAccount(): Promise<boolean> {
    for (const account of await this.accounts.list()) {
      if (!account.enabled) continue;
      try {
        await this.accounts.readSecret(account.id);
        return true;
      } catch {
        continue;
      }
    }
    return false;
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
