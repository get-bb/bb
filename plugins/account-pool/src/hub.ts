import type {
  Account,
  AccountQuota,
  AccountSecret,
  ModelFamily,
  PoolProvider,
  PoolStatus,
} from "./contracts.js";
import { createClaudeAdapter } from "./claude-adapter.js";
import {
  createCodexAdapter,
  DEFAULT_CODEX_REFRESH_URL,
  DEFAULT_CODEX_USAGE_URL,
} from "./codex-adapter.js";
import type { ProviderAdapter } from "./provider-adapter.js";
import type { ImportedProviderAccount } from "./provider-adapter.js";
import type {
  ImportedClaudeCredentials,
  ImportedCodexCredentials,
} from "./credentials.js";
import {
  accountStatus,
  governingWeeklyResetAt,
  isQuotaExhausted,
  retryAfterMilliseconds,
} from "./quota.js";
import type { AccountStore, HubTokenStore, QuotaStore } from "./store.js";

const ROUTE = "/api/v1/plugins/account-pool/http";
const DEFAULT_REFRESH_URL = "https://platform.claude.com/v1/oauth/token";
const DEFAULT_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const DEFAULT_PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
const DEFAULT_USAGE_REFRESH_INTERVAL_MS = 5 * 60 * 1_000;
const MAX_INLINE_HOLD_MS = 20_000;
const DROPPED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export interface HubSettings {
  anthropicUpstreamBaseUrl: string;
  codexUpstreamBaseUrl: string;
  switchThreshold: number;
}

interface HubOptions {
  accounts: AccountStore;
  quotas: QuotaStore;
  hubTokens: HubTokenStore;
  getSettings: () => HubSettings;
  adapters: ReadonlyMap<PoolProvider, ProviderAdapter>;
  fetch: typeof fetch;
  now: () => number;
  usageRefreshIntervalMs: number;
  drainTimeoutMs: number;
  onAccountsChanged: () => void;
}

interface SelectedAccount {
  account: Account;
  quota: AccountQuota;
}
interface UpstreamResult {
  response: Response;
  controller: AbortController;
  release: () => void;
}

export class AccountPoolHub {
  private accepting = false;
  private readonly inFlightByAccount = new Map<string, number>();
  private readonly activeControllers = new Set<AbortController>();
  private readonly refreshes = new Map<string, Promise<AccountSecret>>();
  private readonly usageRefreshes = new Map<string, Promise<void>>();
  private readonly lastUsageRefreshAt = new Map<string, number>();
  private readonly drainWaiters = new Set<() => void>();

  constructor(private readonly options: HubOptions) {}

  async start(signal: AbortSignal): Promise<void> {
    this.accepting = true;
    while (!signal.aborted) {
      await this.refreshUsage();
      await waitForDelay(this.options.usageRefreshIntervalMs, signal);
    }
    await this.stop();
  }

  async authenticate(request: Request): Promise<string | null> {
    const token =
      request.headers.get("x-bb-account-pool-token") ??
      readBearer(request.headers.get("authorization"));
    return this.options.hubTokens.authenticate(token);
  }

  async importAccount(
    provider: PoolProvider,
  ): Promise<ImportedProviderAccount> {
    return this.adapter(provider).importAccount();
  }

  async handle(request: Request, provider: PoolProvider): Promise<Response> {
    const adapter = this.adapter(provider);
    const hostId = await this.authenticate(request);
    if (hostId === null) {
      return adapter.errorResponse(401, "Invalid Account Pooler bearer token.");
    }
    return this.handleAuthenticated(request, provider, hostId);
  }

  async handleAuthenticated(
    request: Request,
    provider: PoolProvider,
    hostId: string | null = null,
  ): Promise<Response> {
    const adapter = this.adapter(provider);
    if (!this.accepting)
      return adapter.errorResponse(
        503,
        "Account Pooler is not accepting requests.",
      );
    return this.forward(
      request,
      new Uint8Array(await request.arrayBuffer()),
      adapter,
      hostId,
    );
  }

  async refreshUsage(accountId?: string, force = false): Promise<void> {
    const accounts = (await this.options.accounts.list()).filter(
      (account) =>
        account.enabled &&
        account.kind === "oauth" &&
        (accountId === undefined || account.id === accountId),
    );
    await Promise.all(
      accounts.map((account) => this.refreshAccountUsage(account, force)),
    );
  }

  private async refreshAccountUsage(
    account: Account,
    force: boolean,
  ): Promise<void> {
    const adapter = this.adapter(account.provider);
    if (
      adapter.refreshUsage === undefined ||
      (this.inFlightByAccount.get(account.id) ?? 0) > 0
    )
      return;
    const now = this.options.now();
    const last = this.lastUsageRefreshAt.get(account.id);
    if (
      !force &&
      last !== undefined &&
      now - last < this.options.usageRefreshIntervalMs
    )
      return;
    const running = this.usageRefreshes.get(account.id);
    if (running !== undefined) return running;
    this.lastUsageRefreshAt.set(account.id, now);
    const refresh = adapter
      .refreshUsage({
        account,
        freshSecret: () => this.freshSecret(account, adapter),
        accounts: this.options.accounts,
        quotas: this.options.quotas,
        fetch: this.options.fetch,
        now: this.options.now,
      })
      .catch(() => undefined)
      .finally(() => this.usageRefreshes.delete(account.id));
    this.usageRefreshes.set(account.id, refresh);
    return refresh;
  }

  async stop(): Promise<void> {
    this.accepting = false;
    if (this.inFlightCount() === 0) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([
      new Promise<void>((resolve) => this.drainWaiters.add(resolve)),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, this.options.drainTimeoutMs);
      }),
    ]);
    if (timeout !== null) clearTimeout(timeout);
    if (this.inFlightCount() === 0) return;
    for (const controller of this.activeControllers) {
      controller.abort(
        new Error(
          "Account Pooler stopped before the upstream response completed.",
        ),
      );
    }
  }

  async status(): Promise<
    Omit<PoolStatus, "routedThreadsWithoutLocalLogin" | "routing">
  > {
    const settings = this.options.getSettings();
    const now = this.options.now();
    const accounts = await this.options.accounts.list();
    return {
      route: ROUTE,
      enabledAccountCount: accounts.filter((account) => account.enabled).length,
      inFlight: this.inFlightCount(),
      accepting: this.accepting,
      hosts: await this.options.hubTokens.list(),
      accounts: accounts.map((account) => {
        const quota = this.options.quotas.get(account.id);
        return {
          ...account,
          lastUsedHostName: null,
          fiveHourUtilization: quota.fiveHourUtilization,
          fiveHourResetAt: quota.fiveHourResetAt,
          fiveHourStatus: quota.fiveHourStatus,
          sevenDayUtilization: quota.sevenDayUtilization,
          sevenDayResetAt: quota.sevenDayResetAt,
          sevenDayStatus: quota.sevenDayStatus,
          representativeClaim: quota.representativeClaim,
          familyWeekly: quota.familyWeekly,
          limitWindows: quota.limitWindows,
          observedAt: quota.observedAt,
          heldUntil: quota.heldUntil,
          error: quota.error,
          inFlight: this.inFlightByAccount.get(account.id) ?? 0,
          status: accountStatus(account, quota, settings.switchThreshold, now),
        };
      }),
    };
  }

  private async forward(
    request: Request,
    body: Uint8Array,
    adapter: ProviderAdapter,
    hostId: string | null,
  ): Promise<Response> {
    const attempted = new Set<string>();
    const accounts = (await this.options.accounts.list()).filter(
      (account) => account.provider === adapter.provider,
    );
    const family = adapter.modelFamily(body);
    while (attempted.size < accounts.length) {
      const selected = await this.select(adapter.provider, attempted, family);
      if (selected === null)
        return this.noEligibleResponse(accounts, family, adapter);
      attempted.add(selected.account.id);
      if (hostId !== null) {
        const changed = await this.options.accounts.recordUsed(
          selected.account.id,
          this.options.now(),
          hostId,
        );
        if (changed) this.options.onAccountsChanged();
      }
      let secret: AccountSecret;
      try {
        secret = await this.freshSecret(selected.account, adapter);
      } catch (error) {
        this.markError(selected.account.id, errorMessage(error));
        continue;
      }
      let upstream: UpstreamResult;
      try {
        upstream = await this.fetchUpstream(
          request,
          adapter.prepareBody(body, selected.account),
          selected.account,
          secret,
          adapter,
        );
      } catch {
        return adapter.errorResponse(
          502,
          `Account Pooler could not reach ${adapter.upstreamName}.`,
        );
      }
      const observed = adapter.quotaFromHeaders(
        selected.account.id,
        upstream.response.headers,
        this.options.quotas.get(selected.account.id),
        family,
        this.options.now(),
      );
      this.options.quotas.put(observed);
      if (
        upstream.response.status === 429 &&
        adapter.isQuotaRejection(upstream.response.headers)
      ) {
        await upstream.response.body?.cancel();
        upstream.release();
        continue;
      }
      if (upstream.response.status === 429) {
        const waitMs = retryAfterMilliseconds(
          upstream.response.headers.get("retry-after"),
          this.options.now(),
        );
        this.options.quotas.put({
          ...observed,
          heldUntil: this.options.now() + waitMs,
        });
        if (waitMs <= MAX_INLINE_HOLD_MS) {
          await upstream.response.body?.cancel();
          upstream.release();
          await delay(waitMs);
          try {
            const retry = await this.fetchUpstream(
              request,
              adapter.prepareBody(body, selected.account),
              selected.account,
              secret,
              adapter,
            );
            const retryQuota = adapter.quotaFromHeaders(
              selected.account.id,
              retry.response.headers,
              this.options.quotas.get(selected.account.id),
              family,
              this.options.now(),
            );
            this.options.quotas.put(
              retry.response.status === 429
                ? {
                    ...retryQuota,
                    heldUntil:
                      this.options.now() +
                      retryAfterMilliseconds(
                        retry.response.headers.get("retry-after"),
                        this.options.now(),
                      ),
                  }
                : retryQuota,
            );
            await this.captureAuthError(
              retry.response,
              selected.account,
              adapter,
            );
            return this.clientResponse(retry);
          } catch {
            return adapter.errorResponse(
              502,
              `Account Pooler could not reach ${adapter.upstreamName}.`,
            );
          }
        }
      }
      await this.captureAuthError(upstream.response, selected.account, adapter);
      return this.clientResponse(upstream);
    }
    return this.noEligibleResponse(accounts, family, adapter);
  }

  private async captureAuthError(
    response: Response,
    account: Account,
    adapter: ProviderAdapter,
  ): Promise<void> {
    if (response.status !== 401 && response.status !== 403) return;
    const detail = await response
      .clone()
      .text()
      .catch(() => "");
    this.markError(
      account.id,
      detail.trim() ||
        `${adapter.upstreamName} returned HTTP ${response.status}.`,
    );
  }

  private async select(
    provider: PoolProvider,
    attempted: ReadonlySet<string>,
    family: ModelFamily,
  ): Promise<SelectedAccount | null> {
    const now = this.options.now();
    const threshold = this.options.getSettings().switchThreshold;
    const candidates = (await this.options.accounts.list())
      .filter(
        (account) =>
          account.provider === provider &&
          account.enabled &&
          !attempted.has(account.id),
      )
      .map((account) => ({
        account,
        quota: this.options.quotas.get(account.id),
      }))
      .filter(({ quota }) => quota.error === null)
      .filter(({ quota }) => quota.heldUntil === null || quota.heldUntil <= now)
      .filter(({ quota }) => !isQuotaExhausted(quota, family, threshold, now));
    candidates.sort((left, right) => {
      const priority = left.account.priority - right.account.priority;
      if (priority !== 0) return priority;
      const inFlight =
        (this.inFlightByAccount.get(left.account.id) ?? 0) -
        (this.inFlightByAccount.get(right.account.id) ?? 0);
      if (inFlight !== 0) return inFlight;
      return (
        (governingWeeklyResetAt(left.quota, family) ??
          Number.MAX_SAFE_INTEGER) -
        (governingWeeklyResetAt(right.quota, family) ?? Number.MAX_SAFE_INTEGER)
      );
    });
    return candidates[0] ?? null;
  }

  private async freshSecret(
    account: Account,
    adapter: ProviderAdapter,
  ): Promise<AccountSecret> {
    const existing = this.refreshes.get(account.id);
    if (existing !== undefined) return existing;
    const secret = await this.options.accounts.readSecret(account.id);
    const refresh = adapter
      .refreshSecret({
        account,
        secret,
        accounts: this.options.accounts,
        quotas: this.options.quotas,
        fetch: this.options.fetch,
        now: this.options.now,
      })
      .then((result) => {
        if (result.refreshed) {
          const quota = this.options.quotas.get(account.id);
          this.options.quotas.put({ ...quota, error: null });
        }
        return result.secret;
      })
      .finally(() => this.refreshes.delete(account.id));
    this.refreshes.set(account.id, refresh);
    return refresh;
  }

  private async fetchUpstream(
    request: Request,
    body: Uint8Array,
    account: Account,
    secret: AccountSecret,
    adapter: ProviderAdapter,
  ): Promise<UpstreamResult> {
    const controller = new AbortController();
    const abortFromRequest = () => controller.abort(request.signal.reason);
    this.activeControllers.add(controller);
    this.increment(account.id);
    if (request.signal.aborted) abortFromRequest();
    else
      request.signal.addEventListener("abort", abortFromRequest, {
        once: true,
      });
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      request.signal.removeEventListener("abort", abortFromRequest);
      this.activeControllers.delete(controller);
      this.decrement(account.id);
    };
    try {
      const upstreamBody = new ArrayBuffer(body.byteLength);
      new Uint8Array(upstreamBody).set(body);
      const response = await this.options.fetch(
        adapter.upstreamUrl(request, this.options.getSettings()),
        {
          method: request.method,
          headers: adapter.requestHeaders(request.headers, account, secret),
          ...(request.method === "GET" || request.method === "HEAD"
            ? {}
            : { body: upstreamBody }),
          signal: controller.signal,
        },
      );
      return { response, controller, release };
    } catch (error) {
      release();
      throw error;
    }
  }

  private clientResponse(upstream: UpstreamResult): Response {
    const headers = new Headers();
    for (const [name, value] of upstream.response.headers) {
      if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase()))
        headers.append(name, value);
    }
    if (upstream.response.body === null) {
      upstream.release();
      return new Response(null, {
        status: upstream.response.status,
        statusText: upstream.response.statusText,
        headers,
      });
    }
    const reader = upstream.response.body.getReader();
    const eventStream =
      upstream.response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase() === "text/event-stream";
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            upstream.release();
            controller.close();
          } else controller.enqueue(chunk.value);
        } catch (error) {
          upstream.release();
          if (!eventStream) {
            controller.error(
              error instanceof Error ? error : new Error(String(error)),
            );
            return;
          }
          controller.enqueue(
            new TextEncoder().encode(
              `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message: errorMessage(error) } })}\n\n`,
            ),
          );
          controller.close();
        }
      },
      async cancel() {
        upstream.controller.abort();
        await reader.cancel().catch(() => undefined);
        upstream.release();
      },
    });
    return new Response(body, {
      status: upstream.response.status,
      statusText: upstream.response.statusText,
      headers,
    });
  }

  private noEligibleResponse(
    accounts: readonly Account[],
    family: ModelFamily,
    adapter: ProviderAdapter,
  ): Response {
    if (!accounts.some((account) => account.enabled)) {
      return adapter.errorResponse(
        503,
        "Account Pooler has no enabled account",
      );
    }
    const now = this.options.now();
    const next = accounts
      .filter((account) => account.enabled)
      .flatMap((account) => {
        const quota = this.options.quotas.get(account.id);
        return [
          quota.heldUntil,
          quota.fiveHourResetAt,
          quota.sevenDayResetAt,
          ...quota.limitWindows.map((window) => window.resetAt),
          governingWeeklyResetAt(quota, family),
        ].filter((value): value is number => value !== null && value > now);
      })
      .sort((left, right) => left - right)[0];
    const retryAfter = Math.max(
      1,
      Math.ceil(((next ?? now + 1_000) - now) / 1_000),
    );
    return adapter.errorResponse(
      429,
      "No Account Pooler account is currently eligible.",
      { "retry-after": String(retryAfter) },
    );
  }

  private markError(accountId: string, message: string): void {
    const quota = this.options.quotas.get(accountId);
    this.options.quotas.put({ ...quota, error: message.slice(0, 1_000) });
  }

  private adapter(provider: PoolProvider): ProviderAdapter {
    const adapter = this.options.adapters.get(provider);
    if (adapter === undefined)
      throw new Error(`Missing ${provider} Account Pooler adapter.`);
    return adapter;
  }

  private increment(accountId: string): void {
    this.inFlightByAccount.set(
      accountId,
      (this.inFlightByAccount.get(accountId) ?? 0) + 1,
    );
  }

  private decrement(accountId: string): void {
    const next = Math.max(0, (this.inFlightByAccount.get(accountId) ?? 1) - 1);
    if (next === 0) this.inFlightByAccount.delete(accountId);
    else this.inFlightByAccount.set(accountId, next);
    if (this.inFlightCount() !== 0) return;
    for (const resolve of this.drainWaiters) resolve();
    this.drainWaiters.clear();
  }

  private inFlightCount(): number {
    let total = 0;
    for (const count of this.inFlightByAccount.values()) total += count;
    return total;
  }
}

export function createHub(options: {
  accounts: AccountStore;
  quotas: QuotaStore;
  hubTokens: HubTokenStore;
  getSettings: () => HubSettings;
  fetch?: typeof fetch;
  now?: () => number;
  refreshUrl?: string;
  codexRefreshUrl?: string;
  codexUsageUrl?: string;
  importClaudeCredentials?: () => Promise<ImportedClaudeCredentials>;
  importCodexCredentials?: () => Promise<ImportedCodexCredentials>;
  usageUrl?: string;
  profileUrl?: string;
  usageRefreshIntervalMs?: number;
  drainTimeoutMs?: number;
  onAccountsChanged?: () => void;
}): AccountPoolHub {
  const adapters: ReadonlyMap<PoolProvider, ProviderAdapter> = new Map([
    [
      "claude",
      createClaudeAdapter({
        refreshUrl: options.refreshUrl ?? DEFAULT_REFRESH_URL,
        usageUrl: options.usageUrl ?? DEFAULT_USAGE_URL,
        profileUrl: options.profileUrl ?? DEFAULT_PROFILE_URL,
        importCredentials: options.importClaudeCredentials,
      }),
    ],
    [
      "codex",
      createCodexAdapter({
        refreshUrl: options.codexRefreshUrl ?? DEFAULT_CODEX_REFRESH_URL,
        usageUrl: options.codexUsageUrl ?? DEFAULT_CODEX_USAGE_URL,
        importCredentials: options.importCodexCredentials,
      }),
    ],
  ]);
  return new AccountPoolHub({
    accounts: options.accounts,
    quotas: options.quotas,
    hubTokens: options.hubTokens,
    getSettings: options.getSettings,
    adapters,
    fetch: options.fetch ?? fetch,
    now: options.now ?? Date.now,
    usageRefreshIntervalMs:
      options.usageRefreshIntervalMs ?? DEFAULT_USAGE_REFRESH_INTERVAL_MS,
    drainTimeoutMs: options.drainTimeoutMs ?? 60_000,
    onAccountsChanged: options.onAccountsChanged ?? (() => {}),
  });
}

function readBearer(value: string | null): string | null {
  if (value === null) return null;
  return /^Bearer\s+(.+)$/iu.exec(value)?.[1] ?? null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function waitForDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    timeout.unref();
    const abort = () => {
      clearTimeout(timeout);
      resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
