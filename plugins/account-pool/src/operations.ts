import type { Account, AccountSummary, PoolStatus } from "./contracts.js";
import type { AccountAddInput } from "./contracts.js";
import {
  importClaudeCredentials,
  type ImportedClaudeCredentials,
} from "./credentials.js";
import type { AccountPoolHub } from "./hub.js";
import type { AccountStore, QuotaStore } from "./store.js";

export class PoolOperations {
  constructor(
    private readonly accounts: AccountStore,
    private readonly quotas: QuotaStore,
    private readonly hub: AccountPoolHub,
    private readonly importCredentials: () => Promise<ImportedClaudeCredentials> = importClaudeCredentials,
  ) {}

  async add(input: AccountAddInput): Promise<Account> {
    if (input.source.kind === "api-key") {
      return this.accounts.add(
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
    }
    const imported = await this.importCredentials();
    return this.accounts.add(
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
  }

  async list(): Promise<AccountSummary[]> {
    return (await this.hub.status(false)).accounts;
  }

  async remove(id: string): Promise<boolean> {
    const removed = await this.accounts.remove(id);
    if (removed) this.quotas.remove(id);
    return removed;
  }

  async enable(id: string): Promise<Account | null> {
    const account = await this.accounts.setEnabled(id, true);
    if (account === null) return null;
    const quota = this.quotas.get(id);
    this.quotas.put({ ...quota, error: null, heldUntil: null });
    return account;
  }

  async disable(id: string): Promise<Account | null> {
    return this.accounts.setEnabled(id, false);
  }

  status(showKey: boolean): Promise<PoolStatus> {
    return this.hub.status(showKey);
  }
}
