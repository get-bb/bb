import { z } from "zod";
import type { AccountQuota, AccountSecret, FamilyQuota } from "./contracts.js";
import {
  codexAccessTokenExpiresAt,
  importCodexCredentials,
  type ImportedCodexCredentials,
} from "./credentials.js";
import type { ProviderAdapter } from "./provider-adapter.js";
import {
  filterRequestHeaders,
  mountedUpstreamUrl,
} from "./provider-adapter.js";

const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REFRESH_WINDOW_MS = 5 * 60 * 1_000;
const ALLOWED_REQUEST_HEADERS = new Set([
  "accept",
  "content-encoding",
  "content-type",
  "openai-beta",
  "originator",
  "session_id",
  "user-agent",
]);
const ALLOWED_REQUEST_HEADER_PREFIXES = ["x-codex-", "x-stainless-"];

const refreshResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    id_token: z.string().min(1).optional(),
  })
  .passthrough();

function numberHeader(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resetAt(headers: Headers, prefix: string, now: number): number | null {
  const raw = numberHeader(headers, `${prefix}-reset-at`);
  if (raw !== null)
    return Math.round(raw < 1_000_000_000_000 ? raw * 1_000 : raw);
  const after = numberHeader(headers, `${prefix}-reset-after-seconds`);
  return after === null ? null : now + Math.round(after * 1_000);
}

function windowQuota(
  headers: Headers,
  prefix: string,
  previous: FamilyQuota | null,
  now: number,
): FamilyQuota | null {
  const usedPercent = numberHeader(headers, `${prefix}-used-percent`);
  const reset = resetAt(headers, prefix, now);
  if (usedPercent === null && reset === null) return previous;
  const utilization =
    usedPercent === null
      ? (previous?.utilization ?? null)
      : Math.max(0, Math.min(1, usedPercent / 100));
  return {
    utilization,
    resetAt: reset ?? previous?.resetAt ?? null,
    status: utilization !== null && utilization >= 1 ? "rejected" : null,
    observedAt: now,
    source: "header",
  };
}

function codexQuotaFromHeaders(
  accountId: string,
  headers: Headers,
  previous: AccountQuota,
  now: number,
): AccountQuota {
  const primary = windowQuota(
    headers,
    "x-codex-primary",
    previous.familyWeekly.other,
    now,
  );
  const secondary = windowQuota(headers, "x-codex-secondary", null, now);
  if (primary === previous.familyWeekly.other && secondary === null)
    return previous;
  return {
    ...previous,
    accountId,
    fiveHourUtilization: primary?.utilization ?? previous.fiveHourUtilization,
    fiveHourResetAt: primary?.resetAt ?? previous.fiveHourResetAt,
    fiveHourStatus: primary === null ? previous.fiveHourStatus : primary.status,
    sevenDayUtilization: secondary?.utilization ?? previous.sevenDayUtilization,
    sevenDayResetAt: secondary?.resetAt ?? previous.sevenDayResetAt,
    sevenDayStatus:
      secondary === null ? previous.sevenDayStatus : secondary.status,
    familyWeekly: { ...previous.familyWeekly, other: primary },
    observedAt: now,
    heldUntil: null,
  };
}

export function createCodexAdapter(options: {
  refreshUrl: string;
  importCredentials?: () => Promise<ImportedCodexCredentials>;
}): ProviderAdapter {
  return {
    provider: "codex",
    upstreamName: "ChatGPT",
    async importAccount() {
      const imported = await (
        options.importCredentials ?? importCodexCredentials
      )();
      return {
        label: imported.email ?? "Codex account",
        email: imported.email,
        codexAccountId: imported.accountId,
        subscriptionType: null,
        rateLimitTier: null,
        secret: {
          kind: "oauth",
          accessToken: imported.accessToken,
          refreshToken: imported.refreshToken,
          expiresAt: imported.expiresAt,
          ...(imported.idToken === null ? {} : { idToken: imported.idToken }),
        },
      };
    },
    modelFamily: () => "other",
    prepareBody: (body) => body,
    upstreamUrl: (request, settings) =>
      mountedUpstreamUrl(request, settings.codexUpstreamBaseUrl, "v1/"),
    requestHeaders(inbound, account, secret) {
      if (secret.kind !== "oauth" || account.codexAccountId === undefined) {
        throw new Error(
          "Codex accounts require OAuth credentials and a ChatGPT account id.",
        );
      }
      const headers = filterRequestHeaders(
        inbound,
        ALLOWED_REQUEST_HEADERS,
        ALLOWED_REQUEST_HEADER_PREFIXES,
      );
      headers.set("authorization", `Bearer ${secret.accessToken}`);
      headers.set("chatgpt-account-id", account.codexAccountId);
      return headers;
    },
    quotaFromHeaders(accountId, headers, previous, _family, now) {
      return codexQuotaFromHeaders(accountId, headers, previous, now);
    },
    isQuotaRejection(headers) {
      return ["primary", "secondary"].some((window) => {
        const prefix = `x-codex-${window}`;
        return (
          (numberHeader(headers, `${prefix}-used-percent`) ?? 0) >= 100 ||
          headers.get(`${prefix}-over-limit`)?.toLowerCase() === "true"
        );
      });
    },
    async refreshSecret(context) {
      const secret = context.secret;
      if (
        secret.kind !== "oauth" ||
        secret.expiresAt === null ||
        secret.expiresAt > context.now() + REFRESH_WINDOW_MS
      ) {
        return { secret, refreshed: false };
      }
      const response = await context.fetch(options.refreshUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          client_id: OAUTH_CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: secret.refreshToken,
        }),
      });
      if (!response.ok)
        throw new Error(`OAuth refresh failed with HTTP ${response.status}.`);
      const parsed = refreshResponseSchema.parse(await response.json());
      const refreshed: AccountSecret = {
        kind: "oauth",
        accessToken: parsed.access_token,
        refreshToken: parsed.refresh_token ?? secret.refreshToken,
        ...(parsed.id_token === undefined && secret.idToken === undefined
          ? {}
          : { idToken: parsed.id_token ?? secret.idToken }),
        expiresAt: codexAccessTokenExpiresAt(parsed.access_token),
      };
      await context.accounts.writeSecret(context.account.id, refreshed);
      return { secret: refreshed, refreshed: true };
    },
    errorResponse(status, message, headers) {
      return Response.json(
        {
          error: {
            message,
            type: status === 429 ? "rate_limit_error" : "api_error",
            code: status === 429 ? "rate_limit_exceeded" : null,
          },
        },
        { status, headers },
      );
    },
  };
}
