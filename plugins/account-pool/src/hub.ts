import { z } from "zod";
import type {
  Account,
  AccountQuota,
  AccountSecret,
  PoolStatus,
} from "./contracts.js";
import {
  accountStatus,
  isQuotaExhausted,
  isQuotaRejection,
  quotaFromHeaders,
  retryAfterMilliseconds,
} from "./quota.js";
import type { AccountStore, HubTokenStore, QuotaStore } from "./store.js";

const ROUTE = "/api/v1/plugins/account-pool/http";
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const DEFAULT_REFRESH_URL = "https://platform.claude.com/v1/oauth/token";
const REFRESH_WINDOW_MS = 5 * 60 * 1_000;
const MAX_INLINE_HOLD_MS = 20_000;

const ALLOWED_REQUEST_HEADERS = new Set([
  "accept",
  "content-type",
  "user-agent",
  "x-app",
]);

const ALLOWED_REQUEST_HEADER_PREFIXES = ["anthropic-", "x-stainless-"];

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

const refreshResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: z.number().positive().optional(),
    expires_at: z.number().positive().optional(),
  })
  .passthrough();

export interface HubSettings {
  upstreamBaseUrl: string;
  switchThreshold: number;
}

interface HubOptions {
  accounts: AccountStore;
  quotas: QuotaStore;
  hubTokens: HubTokenStore;
  getSettings: () => HubSettings;
  fetch: typeof fetch;
  now: () => number;
  refreshUrl: string;
  drainTimeoutMs: number;
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
  private readonly drainWaiters = new Set<() => void>();

  constructor(private readonly options: HubOptions) {}

  async start(signal: AbortSignal): Promise<void> {
    this.accepting = true;
    await waitForAbort(signal);
    await this.stop();
  }

  async stop(): Promise<void> {
    this.accepting = false;
    if (this.inFlightCount() === 0) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([
      new Promise<void>((resolve) => {
        this.drainWaiters.add(resolve);
      }),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, this.options.drainTimeoutMs);
      }),
    ]);
    if (timeout !== null) clearTimeout(timeout);
    if (this.inFlightCount() === 0) return;
    for (const controller of this.activeControllers) {
      controller.abort(
        new Error(
          "Account Pool stopped before the upstream response completed.",
        ),
      );
    }
  }

  async handle(request: Request): Promise<Response> {
    if (
      (await this.options.hubTokens.authenticate(
        readBearer(request.headers.get("authorization")),
      )) === null
    ) {
      return anthropicError(
        401,
        "authentication_error",
        "Invalid Account Pool bearer token.",
      );
    }
    if (!this.accepting) {
      return anthropicError(
        503,
        "api_error",
        "Account Pool is not accepting requests.",
      );
    }
    const body = new Uint8Array(await request.arrayBuffer());
    return this.forward(request, body);
  }

  async status(): Promise<Omit<PoolStatus, "routedThreadsWithoutLocalLogin">> {
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
          fiveHourUtilization: quota.fiveHourUtilization,
          fiveHourResetAt: quota.fiveHourResetAt,
          fiveHourStatus: quota.fiveHourStatus,
          sevenDayUtilization: quota.sevenDayUtilization,
          sevenDayResetAt: quota.sevenDayResetAt,
          sevenDayStatus: quota.sevenDayStatus,
          representativeClaim: quota.representativeClaim,
          bucketExhaustion: quota.bucketExhaustion,
          observedAt: quota.observedAt,
          heldUntil: quota.heldUntil,
          error: quota.error,
          inFlight: this.inFlightByAccount.get(account.id) ?? 0,
          status: accountStatus(account, quota, settings.switchThreshold, now),
        };
      }),
    };
  }

  private async forward(request: Request, body: Uint8Array): Promise<Response> {
    const attempted = new Set<string>();
    const accounts = await this.options.accounts.list();
    while (attempted.size < accounts.length) {
      const selected = await this.select(attempted);
      if (selected === null) return this.noEligibleResponse(accounts);
      attempted.add(selected.account.id);
      let secret: AccountSecret;
      try {
        secret = await this.freshSecret(selected.account);
      } catch (error) {
        this.markError(selected.account.id, errorMessage(error));
        continue;
      }
      let upstream: UpstreamResult;
      try {
        upstream = await this.fetchUpstream(
          request,
          body,
          selected.account,
          secret,
        );
      } catch (error) {
        return anthropicError(
          502,
          "api_error",
          "Account Pool could not reach Anthropic.",
        );
      }
      const observed = quotaFromHeaders(
        selected.account.id,
        upstream.response.headers,
        this.options.quotas.get(selected.account.id),
        this.options.now(),
      );
      this.options.quotas.put(observed);
      if (
        upstream.response.status === 429 &&
        isQuotaRejection(observed, this.options.now())
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
              body,
              selected.account,
              secret,
            );
            const retryQuota = quotaFromHeaders(
              selected.account.id,
              retry.response.headers,
              this.options.quotas.get(selected.account.id),
              this.options.now(),
            );
            if (retry.response.status === 429) {
              const retryWaitMs = retryAfterMilliseconds(
                retry.response.headers.get("retry-after"),
                this.options.now(),
              );
              this.options.quotas.put({
                ...retryQuota,
                heldUntil: this.options.now() + retryWaitMs,
              });
            } else {
              this.options.quotas.put(retryQuota);
            }
            if (
              retry.response.status === 401 ||
              retry.response.status === 403
            ) {
              const detail = await retry.response
                .clone()
                .text()
                .catch(() => "");
              this.markError(
                selected.account.id,
                detail.trim() ||
                  `Anthropic returned HTTP ${retry.response.status}.`,
              );
            }
            return this.clientResponse(retry);
          } catch {
            return anthropicError(
              502,
              "api_error",
              "Account Pool could not reach Anthropic.",
            );
          }
        }
      }
      if (
        upstream.response.status === 401 ||
        upstream.response.status === 403
      ) {
        const detail = await upstream.response
          .clone()
          .text()
          .catch(() => "");
        this.markError(
          selected.account.id,
          detail.trim() ||
            `Anthropic returned HTTP ${upstream.response.status}.`,
        );
      }
      return this.clientResponse(upstream);
    }
    return this.noEligibleResponse(accounts);
  }

  private async select(
    attempted: ReadonlySet<string>,
  ): Promise<SelectedAccount | null> {
    const now = this.options.now();
    const threshold = this.options.getSettings().switchThreshold;
    const candidates = (await this.options.accounts.list())
      .filter((account) => account.enabled && !attempted.has(account.id))
      .map((account) => ({
        account,
        quota: this.options.quotas.get(account.id),
      }))
      .filter(({ quota }) => quota.error === null)
      .filter(({ quota }) => quota.heldUntil === null || quota.heldUntil <= now)
      .filter(({ quota }) => !isQuotaExhausted(quota, threshold, now));
    candidates.sort((left, right) => {
      const priority = left.account.priority - right.account.priority;
      if (priority !== 0) return priority;
      const inFlight =
        (this.inFlightByAccount.get(left.account.id) ?? 0) -
        (this.inFlightByAccount.get(right.account.id) ?? 0);
      if (inFlight !== 0) return inFlight;
      return (
        (left.quota.sevenDayResetAt ?? Number.MAX_SAFE_INTEGER) -
        (right.quota.sevenDayResetAt ?? Number.MAX_SAFE_INTEGER)
      );
    });
    return candidates[0] ?? null;
  }

  private async freshSecret(account: Account): Promise<AccountSecret> {
    const secret = await this.options.accounts.readSecret(account.id);
    if (
      secret.kind !== "oauth" ||
      secret.expiresAt === null ||
      secret.expiresAt > this.options.now() + REFRESH_WINDOW_MS
    ) {
      return secret;
    }
    const existing = this.refreshes.get(account.id);
    if (existing !== undefined) return existing;
    const refresh = this.refresh(account.id, secret).finally(() => {
      this.refreshes.delete(account.id);
    });
    this.refreshes.set(account.id, refresh);
    return refresh;
  }

  private async refresh(
    accountId: string,
    secret: Extract<AccountSecret, { kind: "oauth" }>,
  ): Promise<AccountSecret> {
    const response = await this.options.fetch(this.options.refreshUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: secret.refreshToken,
        client_id: OAUTH_CLIENT_ID,
      }),
    });
    if (!response.ok) {
      throw new Error(`OAuth refresh failed with HTTP ${response.status}.`);
    }
    const parsed = refreshResponseSchema.parse(await response.json());
    const rawExpiresAt =
      parsed.expires_at ??
      (parsed.expires_in === undefined
        ? this.options.now() + 60 * 60 * 1_000
        : this.options.now() + parsed.expires_in * 1_000);
    const refreshed: AccountSecret = {
      kind: "oauth",
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token ?? secret.refreshToken,
      expiresAt:
        rawExpiresAt < 1_000_000_000_000
          ? Math.round(rawExpiresAt * 1_000)
          : Math.round(rawExpiresAt),
    };
    await this.options.accounts.writeSecret(accountId, refreshed);
    const quota = this.options.quotas.get(accountId);
    this.options.quotas.put({ ...quota, error: null });
    return refreshed;
  }

  private async fetchUpstream(
    request: Request,
    body: Uint8Array,
    account: Account,
    secret: AccountSecret,
  ): Promise<UpstreamResult> {
    const requestUrl = new URL(request.url);
    const mountedPath = requestUrl.pathname.indexOf("/http/");
    const upstreamPath =
      mountedPath < 0
        ? requestUrl.pathname
        : requestUrl.pathname.slice(mountedPath + 5);
    const upstreamUrl = new URL(
      upstreamPath.replace(/^\//u, "") + requestUrl.search,
      ensureSlash(this.options.getSettings().upstreamBaseUrl),
    );
    const headers = new Headers();
    for (const [name, value] of request.headers) {
      if (isAllowedRequestHeader(name)) headers.append(name, value);
    }
    if (secret.kind === "oauth") {
      headers.set("authorization", `Bearer ${secret.accessToken}`);
    } else {
      headers.set("x-api-key", secret.apiKey);
    }
    const controller = new AbortController();
    this.activeControllers.add(controller);
    this.increment(account.id);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.activeControllers.delete(controller);
      this.decrement(account.id);
    };
    try {
      const upstreamBody = new ArrayBuffer(body.byteLength);
      new Uint8Array(upstreamBody).set(body);
      const response = await this.options.fetch(upstreamUrl, {
        method: request.method,
        headers,
        body: upstreamBody,
        signal: controller.signal,
      });
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
            return;
          }
          controller.enqueue(chunk.value);
        } catch (error) {
          upstream.release();
          if (eventStream) {
            const message = errorMessage(error);
            controller.enqueue(
              new TextEncoder().encode(
                `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message } })}\n\n`,
              ),
            );
            controller.close();
          } else {
            controller.error(
              error instanceof Error ? error : new Error(String(error)),
            );
          }
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

  private noEligibleResponse(accounts: readonly Account[]): Response {
    if (!accounts.some((account) => account.enabled)) {
      return anthropicError(
        503,
        "api_error",
        "Account Pool has no enabled account",
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
        ].filter((value): value is number => value !== null && value > now);
      })
      .sort((left, right) => left - right)[0];
    const retryAfter = Math.max(
      1,
      Math.ceil(((next ?? now + 1_000) - now) / 1_000),
    );
    return anthropicError(
      429,
      "rate_limit_error",
      "No Account Pool account is currently eligible.",
      { "retry-after": String(retryAfter) },
    );
  }

  private markError(accountId: string, message: string): void {
    const quota = this.options.quotas.get(accountId);
    this.options.quotas.put({ ...quota, error: message.slice(0, 1_000) });
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
  drainTimeoutMs?: number;
}): AccountPoolHub {
  return new AccountPoolHub({
    accounts: options.accounts,
    quotas: options.quotas,
    hubTokens: options.hubTokens,
    getSettings: options.getSettings,
    fetch: options.fetch ?? fetch,
    now: options.now ?? Date.now,
    refreshUrl: options.refreshUrl ?? DEFAULT_REFRESH_URL,
    drainTimeoutMs: options.drainTimeoutMs ?? 60_000,
  });
}

function isAllowedRequestHeader(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    ALLOWED_REQUEST_HEADERS.has(normalized) ||
    ALLOWED_REQUEST_HEADER_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix),
    )
  );
}

function ensureSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function readBearer(value: string | null): string | null {
  if (value === null) return null;
  const match = /^Bearer\s+(.+)$/iu.exec(value);
  return match?.[1] ?? null;
}

function anthropicError(
  status: number,
  type: string,
  message: string,
  headers?: HeadersInit,
): Response {
  return Response.json(
    { type: "error", error: { type, message } },
    { status, headers },
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
