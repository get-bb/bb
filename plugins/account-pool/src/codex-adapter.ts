import { z } from "zod";
import { parseCodexRequestBody } from "./request-body.js";
import {
  EMPTY_FAMILY_WEEKLY,
  type AccountQuota,
  type AccountSecret,
  type LimitWindow,
  type LimitWindowSlot,
} from "./contracts.js";
import {
  codexAccessTokenExpiresAt,
  importCodexCredentials,
  type ImportedCodexCredentials,
} from "./credentials.js";
import type { ProviderAdapter } from "./provider-adapter.js";
import {
  fetchOAuthRefresh,
  filterRequestHeaders,
  mountedUpstreamUrl,
  oauthSecretDueForRefresh,
  parseOAuthRefreshResponse,
} from "./provider-adapter.js";
import { epochMilliseconds } from "./quota.js";

export const CODEX_AUTH_BASE_URL = "https://auth.openai.com";
export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const DEFAULT_CODEX_REFRESH_URL = `${CODEX_AUTH_BASE_URL}/oauth/token`;
export const DEFAULT_CODEX_USAGE_URL =
  "https://chatgpt.com/backend-api/wham/usage";
const USAGE_REQUEST_TIMEOUT_MS = 15_000;
const ALLOWED_REQUEST_HEADERS = new Set([
  "accept",
  "content-encoding",
  "content-type",
  "openai-beta",
  "originator",
  "session-id",
  "session_id",
  "thread-id",
  "user-agent",
  "x-openai-internal-codex-responses-lite",
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
  if (raw !== null && raw > 0) return epochMilliseconds(raw);
  const after = numberHeader(headers, `${prefix}-reset-after-seconds`);
  return after === null ? null : now + Math.round(after * 1_000);
}

function windowMinutesFromSeconds(
  seconds: number | null | undefined,
): number | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds))
    return null;
  const minutes = Math.round(seconds / 60);
  return minutes > 0 ? minutes : null;
}

function previousWindow(
  previous: AccountQuota,
  slot: LimitWindowSlot,
): LimitWindow | null {
  return previous.limitWindows.find((window) => window.slot === slot) ?? null;
}

function windowFromHeaders(
  headers: Headers,
  slot: LimitWindowSlot,
  previous: LimitWindow | null,
  now: number,
): LimitWindow | null {
  const prefix = `x-codex-${slot}`;
  const usedPercent = numberHeader(headers, `${prefix}-used-percent`);
  const reset = resetAt(headers, prefix, now);
  const minutes = numberHeader(headers, `${prefix}-window-minutes`);
  const overLimit =
    headers.get(`${prefix}-over-limit`)?.toLowerCase() === "true";
  if (usedPercent === null && reset === null && !overLimit) return previous;
  const utilization =
    usedPercent === null
      ? (previous?.utilization ?? null)
      : Math.max(0, Math.min(1, usedPercent / 100));
  const windowMinutes =
    minutes !== null && minutes > 0
      ? Math.round(minutes)
      : (previous?.windowMinutes ?? null);
  const nextReset =
    reset ??
    (previous?.resetAt !== null &&
    previous?.resetAt !== undefined &&
    previous.resetAt > now
      ? previous.resetAt
      : null);
  if (
    windowMinutes === null &&
    nextReset === null &&
    !overLimit &&
    (utilization === null || utilization === 0)
  )
    return null;
  return {
    slot,
    windowMinutes,
    utilization,
    resetAt: nextReset,
    status:
      overLimit || (utilization !== null && utilization >= 1)
        ? "rejected"
        : null,
    observedAt: now,
    source: "header",
  };
}

function orderedWindows(
  windows: ReadonlyArray<LimitWindow | null>,
): LimitWindow[] {
  return windows.filter((window): window is LimitWindow => window !== null);
}

function withoutClaudeSlots(previous: AccountQuota): AccountQuota {
  return {
    ...previous,
    fiveHourUtilization: null,
    fiveHourResetAt: null,
    fiveHourStatus: null,
    sevenDayUtilization: null,
    sevenDayResetAt: null,
    sevenDayStatus: null,
    representativeClaim: null,

    familyWeekly: EMPTY_FAMILY_WEEKLY,
  };
}

function creditAvailability(
  credits: { has_credits: boolean; unlimited: boolean } | null,
  source: "header" | "usage",
  now: number,
): AccountQuota["extraUsage"] {
  return credits === null
    ? null
    : {
        status:
          credits.has_credits || credits.unlimited ? "allowed" : "rejected",
        source,
        observedAt: now,
      };
}

function booleanHeader(headers: Headers, name: string): boolean | null {
  const value = headers.get(name)?.toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return null;
}

function restrictionFromReason(
  reason: string | null,
): AccountQuota["usageRestriction"] {
  return reason === null || reason === "rate_limit_reached"
    ? null
    : { reason, resetAt: null };
}

function codexQuotaFromHeaders(
  accountId: string,
  headers: Headers,
  previous: AccountQuota,
  now: number,
): AccountQuota {
  const priorPrimary = previousWindow(previous, "primary");
  const priorSecondary = previousWindow(previous, "secondary");
  const primary = windowFromHeaders(headers, "primary", priorPrimary, now);
  const secondary = windowFromHeaders(
    headers,
    "secondary",
    priorSecondary,
    now,
  );
  const hasCredits = booleanHeader(headers, "x-codex-credits-has-credits");
  const unlimited = booleanHeader(headers, "x-codex-credits-unlimited");
  const creditsObserved = hasCredits !== null && unlimited !== null;
  const reason = headers.get("x-codex-rate-limit-reached-type");
  let restriction =
    reason === null ? previous.usageRestriction : restrictionFromReason(reason);
  if (
    reason === null &&
    restriction?.reason.includes("credits_depleted") &&
    creditsObserved &&
    (hasCredits || unlimited)
  )
    restriction = null;
  const extraUsage = creditsObserved
    ? creditAvailability({ has_credits: hasCredits, unlimited }, "header", now)
    : previous.extraUsage;
  if (
    primary === priorPrimary &&
    secondary === priorSecondary &&
    !creditsObserved &&
    reason === null
  )
    return previous;
  return {
    ...withoutClaudeSlots(previous),
    accountId,
    extraUsage:
      restriction === null
        ? extraUsage
        : { status: "rejected", source: "header", observedAt: now },
    usageRestriction: restriction,
    limitWindows: orderedWindows([primary, secondary]),
    observedAt: now,
    heldUntil: null,
  };
}

const usageWindowSchema = z
  .object({
    used_percent: z.number(),
    reset_at: z.number().nullish(),
    reset_after_seconds: z.number().nullish(),
    limit_window_seconds: z.number().nullish(),
  })
  .passthrough();

const usageResponseSchema = z
  .object({
    plan_type: z.string().trim().min(1).nullish().catch(null),
    credits: z
      .object({ has_credits: z.boolean(), unlimited: z.boolean() })
      .nullish(),
    spend_control: z
      .object({
        reached: z.boolean(),
        individual_limit: z
          .object({
            remaining_percent: z.number(),
            reset_at: z.number().nullish(),
          })
          .nullish(),
      })
      .nullish(),
    rate_limit_reached_type: z.object({ type: z.string().min(1) }).nullish(),
    rate_limit: z
      .object({
        primary_window: usageWindowSchema.nullish(),
        secondary_window: usageWindowSchema.nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

function windowFromUsage(
  slot: LimitWindowSlot,
  value: z.infer<typeof usageWindowSchema> | null | undefined,
  now: number,
): LimitWindow | null {
  if (value === null || value === undefined) return null;
  const utilization = Math.max(0, Math.min(1, value.used_percent / 100));
  const reset =
    value.reset_at !== null &&
    value.reset_at !== undefined &&
    Number.isFinite(value.reset_at)
      ? epochMilliseconds(value.reset_at)
      : value.reset_after_seconds !== null &&
          value.reset_after_seconds !== undefined &&
          Number.isFinite(value.reset_after_seconds)
        ? now + Math.round(value.reset_after_seconds * 1_000)
        : null;
  return {
    slot,
    windowMinutes: windowMinutesFromSeconds(value.limit_window_seconds),
    utilization,
    resetAt: reset,
    status: utilization >= 1 ? "rejected" : "allowed",
    observedAt: now,
    source: "usage",
  };
}

export function codexQuotaFromUsage(
  accountId: string,
  payload: unknown,
  previous: AccountQuota,
  now: number,
): AccountQuota | null {
  const parsed = usageResponseSchema.safeParse(payload);
  if (!parsed.success) return null;
  const data = parsed.data;
  if (
    data.rate_limit === undefined &&
    data.credits === undefined &&
    data.spend_control === undefined &&
    data.rate_limit_reached_type === undefined
  )
    return null;
  const control = data.spend_control;
  const individual = control?.individual_limit;
  let reasonRestriction =
    data.rate_limit_reached_type === undefined
      ? previous.usageRestriction
      : restrictionFromReason(data.rate_limit_reached_type?.type ?? null);
  if (
    data.rate_limit_reached_type === undefined &&
    reasonRestriction !== null
  ) {
    if (
      reasonRestriction.reason.includes("credits_depleted") &&
      (data.credits?.has_credits === true || data.credits?.unlimited === true)
    )
      reasonRestriction = null;
    if (
      reasonRestriction?.reason.includes("usage_limit_reached") &&
      control?.reached === false &&
      (individual == null || individual.remaining_percent > 0)
    )
      reasonRestriction = null;
  }
  const restriction =
    control?.reached === true ||
    (individual != null && individual.remaining_percent <= 0)
      ? {
          reason: "spend_control_reached",
          resetAt:
            individual?.reset_at == null
              ? null
              : epochMilliseconds(individual.reset_at),
        }
      : control !== undefined &&
          reasonRestriction?.reason === "spend_control_reached"
        ? null
        : reasonRestriction;
  const extraUsage =
    data.credits === undefined
      ? previous.extraUsage
      : creditAvailability(data.credits, "usage", now);
  return {
    ...withoutClaudeSlots(previous),
    accountId,
    usageRestriction: restriction,
    extraUsage:
      restriction === null
        ? extraUsage
        : { status: "rejected", source: "usage", observedAt: now },
    limitWindows:
      data.rate_limit === undefined
        ? previous.limitWindows
        : orderedWindows([
            windowFromUsage("primary", data.rate_limit?.primary_window, now),
            windowFromUsage(
              "secondary",
              data.rate_limit?.secondary_window,
              now,
            ),
          ]),
    observedAt: now,
  };
}

export function createCodexAdapter(options: {
  refreshUrl: string;
  usageUrl: string;
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
    parseRequest(body, headers) {
      const parsed = parseCodexRequestBody(body, headers);
      return {
        family: parsed.family,
        affinityId: parsed.affinityId,
        parentAffinityId: parsed.parentAffinityId,
        forAccount: () => body,
      };
    },
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
      if (headers.has("x-codex-rate-limit-reached-type")) return true;
      return ["primary", "secondary"].some((window) => {
        const prefix = `x-codex-${window}`;
        return (
          (numberHeader(headers, `${prefix}-used-percent`) ?? 0) >= 100 ||
          headers.get(`${prefix}-over-limit`)?.toLowerCase() === "true"
        );
      });
    },
    async refreshSecret(context) {
      const secret = oauthSecretDueForRefresh(context);
      if (secret === null) return { secret: context.secret, refreshed: false };
      const parsed = parseOAuthRefreshResponse(
        await fetchOAuthRefresh(context, options.refreshUrl, {
          client_id: CODEX_OAUTH_CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: secret.refreshToken,
        }),
        refreshResponseSchema,
      );
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
    async refreshUsage(context) {
      const secret = await context.freshSecret();
      if (
        secret.kind !== "oauth" ||
        context.account.codexAccountId === undefined
      )
        return;
      const response = await context.fetch(options.usageUrl, {
        headers: {
          authorization: `Bearer ${secret.accessToken}`,
          "chatgpt-account-id": context.account.codexAccountId,
          originator: "bb",
          accept: "application/json",
        },
        signal: AbortSignal.timeout(USAGE_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return;
      }
      const parsed = usageResponseSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (!parsed.success) return;
      if (parsed.data.plan_type != null) {
        await context.accounts.setSubscriptionType(
          context.account.id,
          parsed.data.plan_type,
        );
      }
      const quota = codexQuotaFromUsage(
        context.account.id,
        parsed.data,
        context.quotas.get(context.account.id),
        context.now(),
      );
      if (quota !== null) context.quotas.put(quota);
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
