import { z } from "zod";
import type {
  Account,
  AccountPoolConfig,
  AccountQuota,
  AccountSecret,
  ModelFamily,
  PoolProvider,
} from "./contracts.js";
import { retryAfterMilliseconds } from "./quota.js";
import type { AccountStore, QuotaStore } from "./store.js";

const OAUTH_REFRESH_TIMEOUT_MS = 15_000;
const OAUTH_REFRESH_WINDOW_MS = 5 * 60 * 1_000;

const oauthErrorCodeSchema = z.enum([
  "invalid_grant",
  "invalid_client",
  "invalid_request",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
  "access_denied",
  "server_error",
  "temporarily_unavailable",
  "refresh_token_expired",
  "refresh_token_reused",
  "refresh_token_invalidated",
]);
const oauthErrorDescriptionSchema = z.enum([
  "Refresh token expired",
  "Refresh token revoked",
  "Invalid refresh token",
]);
const oauthErrorSchema = z.object({
  error: z.union([
    oauthErrorCodeSchema,
    z.object({ code: oauthErrorCodeSchema }),
  ]),
  error_description: z.unknown().optional(),
});

export class OAuthRefreshError extends Error {}

export class TransientOAuthRefreshError extends OAuthRefreshError {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
  }
}

export interface AdapterSecretContext {
  account: Account;
  secret: AccountSecret;
  accounts: AccountStore;
  quotas: QuotaStore;
  fetch: typeof fetch;
  now: () => number;
  forceRefresh: boolean;
}

export interface AdapterUsageContext {
  account: Account;
  freshSecret: () => Promise<AccountSecret>;
  accounts: AccountStore;
  quotas: QuotaStore;
  fetch: typeof fetch;
  now: () => number;
}

export interface ImportedProviderAccount {
  label: string;
  email: string | null;
  accountUuid?: string;
  codexAccountId?: string;
  subscriptionType: string | null;
  rateLimitTier: string | null;
  secret: Extract<AccountSecret, { kind: "oauth" }>;
}

export interface ProviderAdapter {
  provider: PoolProvider;
  upstreamName: string;
  importAccount(): Promise<ImportedProviderAccount>;
  parseRequest(
    body: Uint8Array,
    headers: Headers,
  ): {
    family: ModelFamily;
    affinityId: string | null;
    parentAffinityId: string | null;
    forAccount: (account: Account) => Uint8Array;
  };
  upstreamUrl(request: Request, settings: AccountPoolConfig): URL;
  requestHeaders(
    inbound: Headers,
    account: Account,
    secret: AccountSecret,
  ): Headers;
  quotaFromHeaders(
    accountId: string,
    headers: Headers,
    previous: AccountQuota,
    family: ModelFamily,
    now: number,
  ): AccountQuota;
  isQuotaRejection(headers: Headers): boolean;
  refreshSecret(
    context: AdapterSecretContext,
  ): Promise<{ secret: AccountSecret; refreshed: boolean }>;
  refreshUsage(context: AdapterUsageContext): Promise<void>;
  errorResponse(
    status: number,
    message: string,
    headers?: HeadersInit,
  ): Response;
}

export function oauthSecretDueForRefresh(
  context: AdapterSecretContext,
): Extract<AccountSecret, { kind: "oauth" }> | null {
  const secret = context.secret;
  if (
    secret.kind !== "oauth" ||
    (!context.forceRefresh &&
      (secret.expiresAt === null ||
        secret.expiresAt > context.now() + OAUTH_REFRESH_WINDOW_MS))
  ) {
    return null;
  }
  return secret;
}

export async function fetchOAuthRefresh(
  context: Pick<AdapterSecretContext, "fetch" | "now">,
  url: string,
  body: Record<string, string>,
): Promise<string> {
  const signal = AbortSignal.timeout(OAUTH_REFRESH_TIMEOUT_MS);
  let onTimeout = () => {};
  const timedOut = new Promise<never>((_resolve, reject) => {
    onTimeout = () => reject(signal.reason);
    if (signal.aborted) onTimeout();
    else signal.addEventListener("abort", onTimeout, { once: true });
  });
  try {
    let response: Response;
    try {
      response = await Promise.race([
        context
          .fetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify(body),
            signal,
          })
          .then((result) => {
            if (signal.aborted)
              void result.body?.cancel().catch(() => undefined);
            return result;
          }),
        timedOut,
      ]);
    } catch {
      throw new TransientOAuthRefreshError(
        "OAuth refresh failed due to a network error or timeout.",
        0,
      );
    }
    if (!response.ok) {
      const retryAfterMs = retryAfterMilliseconds(
        response.headers.get("retry-after"),
        context.now(),
      );
      const detail = await oauthRefreshErrorDetail(response, timedOut);
      const message = `OAuth refresh failed with HTTP ${response.status}.${detail}`;
      if (response.status === 400 || response.status === 401) {
        throw new OAuthRefreshError(message);
      }
      throw new TransientOAuthRefreshError(message, retryAfterMs);
    }
    try {
      return await Promise.race([response.text(), timedOut]);
    } catch {
      throw new TransientOAuthRefreshError(
        "OAuth refresh response failed due to a network error or timeout.",
        0,
      );
    }
  } finally {
    signal.removeEventListener("abort", onTimeout);
  }
}

async function oauthRefreshErrorDetail(
  response: Response,
  timedOut: Promise<never>,
): Promise<string> {
  if (
    !response.headers.get("content-type")?.includes("application/json") ||
    response.body === null
  ) {
    void response.body?.cancel().catch(() => undefined);
    return "";
  }
  const reader = response.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("OAuth error body timed out")),
      1_000,
    );
  });
  try {
    const bytes: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await Promise.race([reader.read(), timedOut, deadline]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4_096) return "";
      bytes.push(chunk.value);
    }
    const parsed = oauthErrorSchema.safeParse(
      JSON.parse(Buffer.concat(bytes).toString("utf8")),
    );
    if (!parsed.success) return "";
    const code =
      typeof parsed.data.error === "string"
        ? parsed.data.error
        : parsed.data.error.code;
    const description = oauthErrorDescriptionSchema.safeParse(
      parsed.data.error_description,
    );
    return ` ${code}${description.success ? `: ${description.data}` : ""}.`;
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}

export function parseOAuthRefreshResponse<T>(
  text: string,
  schema: z.ZodType<T>,
): T {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = undefined;
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new TransientOAuthRefreshError(
      "OAuth refresh returned an unreadable response.",
      0,
    );
  }
  return parsed.data;
}

export function filterRequestHeaders(
  inbound: Headers,
  allowed: ReadonlySet<string>,
  prefixes: readonly string[],
): Headers {
  const headers = new Headers();
  for (const [name, value] of inbound) {
    const normalized = name.toLowerCase();
    if (
      allowed.has(normalized) ||
      prefixes.some((prefix) => normalized.startsWith(prefix))
    ) {
      headers.append(name, value);
    }
  }
  return headers;
}

export function mountedUpstreamUrl(
  request: Request,
  upstreamBaseUrl: string,
  stripPrefix = "",
): URL {
  const requestUrl = new URL(request.url);
  const mountedPath = requestUrl.pathname.indexOf("/http/");
  const rawPath =
    mountedPath < 0
      ? requestUrl.pathname
      : requestUrl.pathname.slice(mountedPath + 5);
  const normalizedPath = rawPath.replace(/^\//u, "");
  const upstreamPath = normalizedPath.startsWith(stripPrefix)
    ? normalizedPath.slice(stripPrefix.length)
    : normalizedPath;
  return new URL(
    upstreamPath + requestUrl.search,
    upstreamBaseUrl.endsWith("/") ? upstreamBaseUrl : `${upstreamBaseUrl}/`,
  );
}
