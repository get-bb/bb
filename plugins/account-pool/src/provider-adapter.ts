import type {
  Account,
  AccountQuota,
  AccountSecret,
  ModelFamily,
  PoolProvider,
} from "./contracts.js";
import type { HubSettings } from "./hub.js";
import type { AccountStore, QuotaStore } from "./store.js";

export interface AdapterSecretContext {
  account: Account;
  secret: AccountSecret;
  accounts: AccountStore;
  quotas: QuotaStore;
  fetch: typeof fetch;
  now: () => number;
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
  modelFamily(body: Uint8Array): ModelFamily;
  prepareBody(body: Uint8Array, account: Account): Uint8Array;
  upstreamUrl(request: Request, settings: HubSettings): URL;
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
  refreshUsage?(context: AdapterUsageContext): Promise<void>;
  errorResponse(
    status: number,
    message: string,
    headers?: HeadersInit,
  ): Response;
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
