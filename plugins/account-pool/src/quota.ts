import {
  routingTierSchema,
  type Account,
  type AccountQuota,
  type AccountSummary,
  type LimitWindow,
  type ModelFamily,
  type RoutingTier,
} from "./contracts.js";

const PREFIX = "anthropic-ratelimit-unified-";
const OVERAGE_CLAIM = "overage";
const UNKNOWN_OVERAGE_RESET_MS = 24 * 60 * 60 * 1_000;
const ROUTING_TIERS = routingTierSchema.options;
const SCOPED_HEADER =
  /^anthropic-ratelimit-unified-7d_(.+)-(utilization|reset|status)$/u;

interface ScopedHeaderValues {
  utilization: number | null;
  resetAt: number | null;
  status: string | null;
}

function parseNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function epochMilliseconds(value: number): number {
  return Math.round(value < 1_000_000_000_000 ? value * 1_000 : value);
}

export function parseReset(value: string | number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return epochMilliseconds(value);
  }
  if (value.trim() === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return epochMilliseconds(numeric);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function modelFamily(model: string | null): ModelFamily {
  if (model === null) return "other";
  const normalized = model.toLowerCase();
  if (normalized.includes("fable")) return "fable";
  if (normalized.includes("sonnet")) return "sonnet";
  if (normalized.includes("opus")) return "opus";
  if (normalized.includes("haiku")) return "haiku";
  return "other";
}

function scopedHeaderValues(headers: Headers): ScopedHeaderValues | null {
  const buckets = new Map<string, ScopedHeaderValues>();
  for (const [name, value] of headers) {
    const match = SCOPED_HEADER.exec(name.toLowerCase());
    const bucket = match?.[1];
    const field = match?.[2];
    if (bucket === undefined || field === undefined) continue;
    const current = buckets.get(bucket) ?? {
      utilization: null,
      resetAt: null,
      status: null,
    };
    if (field === "utilization") current.utilization = parseNumber(value);
    if (field === "reset") current.resetAt = parseReset(value);
    if (field === "status") current.status = value;
    buckets.set(bucket, current);
  }
  return [...buckets.values()][0] ?? null;
}

export function quotaFromHeaders(
  accountId: string,
  headers: Headers,
  previous: AccountQuota,
  family: ModelFamily,
  now: number,
): AccountQuota {
  const fiveHourUtilization = parseNumber(
    headers.get(`${PREFIX}5h-utilization`),
  );
  const fiveHourResetAt = parseReset(headers.get(`${PREFIX}5h-reset`));
  const fiveHourStatus = headers.get(`${PREFIX}5h-status`);
  const sevenDayUtilization = parseNumber(
    headers.get(`${PREFIX}7d-utilization`),
  );
  const sevenDayResetAt = parseReset(headers.get(`${PREFIX}7d-reset`));
  const sevenDayStatus = headers.get(`${PREFIX}7d-status`);
  const representativeClaim = headers.get(`${PREFIX}representative-claim`);
  const overageStatus = headers.get(`${PREFIX}overage-status`);
  const extraUsage: AccountQuota["extraUsage"] =
    overageStatus === "allowed" ||
    overageStatus === "allowed_warning" ||
    overageStatus === "rejected"
      ? {
          status: overageStatus === "rejected" ? "rejected" : "allowed",
          observedAt: now,
          source: "header",
        }
      : previous.extraUsage;
  const scoped = scopedHeaderValues(headers);
  const priorFamily = previous.familyWeekly[family];
  const familyWeekly: AccountQuota["familyWeekly"] =
    scoped === null
      ? previous.familyWeekly
      : {
          ...previous.familyWeekly,
          [family]: {
            utilization: scoped.utilization ?? priorFamily?.utilization ?? null,
            resetAt: scoped.resetAt ?? priorFamily?.resetAt ?? null,
            status: scoped.status ?? priorFamily?.status ?? null,
            observedAt: now,
            source: "header",
          },
        };
  const observed =
    fiveHourUtilization !== null ||
    fiveHourResetAt !== null ||
    fiveHourStatus !== null ||
    sevenDayUtilization !== null ||
    sevenDayResetAt !== null ||
    sevenDayStatus !== null ||
    representativeClaim !== null ||
    extraUsage !== previous.extraUsage ||
    scoped !== null;
  const next: AccountQuota = {
    accountId,
    usageRestriction: previous.usageRestriction,
    extraUsage,
    fiveHourUtilization: fiveHourUtilization ?? previous.fiveHourUtilization,
    fiveHourResetAt: fiveHourResetAt ?? previous.fiveHourResetAt,
    fiveHourStatus: fiveHourStatus ?? previous.fiveHourStatus,
    sevenDayUtilization: sevenDayUtilization ?? previous.sevenDayUtilization,
    sevenDayResetAt: sevenDayResetAt ?? previous.sevenDayResetAt,
    sevenDayStatus: sevenDayStatus ?? previous.sevenDayStatus,
    representativeClaim: representativeClaim ?? previous.representativeClaim,
    familyOverageUntil: previous.familyOverageUntil,
    familyWeekly,
    limitWindows: previous.limitWindows,
    observedAt: observed ? now : previous.observedAt,
    heldUntil: previous.heldUntil,
    error: previous.error,
  };
  if (representativeClaim === null) return next;
  const weeklyReset = governingWeeklyResetAt(next, family);
  return {
    ...next,
    familyOverageUntil: {
      ...previous.familyOverageUntil,
      [family]:
        representativeClaim.toLowerCase() !== OVERAGE_CLAIM
          ? null
          : weeklyReset !== null && weeklyReset > now
            ? weeklyReset
            : now + UNKNOWN_OVERAGE_RESET_MS,
    },
  };
}

interface QuotaWindow {
  utilization: number | null;
  status: string | null;
  resetAt: number | null;
}

function quotaWindows(
  quota: AccountQuota | AccountSummary,
  family: ModelFamily | null,
): QuotaWindow[] {
  const familyQuota = family === null ? null : quota.familyWeekly[family];
  return [
    {
      utilization: quota.fiveHourUtilization,
      status: quota.fiveHourStatus,
      resetAt: quota.fiveHourResetAt,
    },
    {
      utilization: quota.sevenDayUtilization,
      status: quota.sevenDayStatus,
      resetAt: quota.sevenDayResetAt,
    },
    ...quota.limitWindows,
    ...(familyQuota === null ? [] : [familyQuota]),
  ];
}

function isBlockedUpstream(window: QuotaWindow, now: number): boolean {
  if (window.resetAt !== null && window.resetAt <= now) return false;
  const status = window.status?.toLowerCase() ?? null;
  if (status !== null) return status === "rejected";
  return window.utilization !== null && window.utilization >= 1;
}

function isAtThreshold(
  window: QuotaWindow,
  threshold: number,
  now: number,
): boolean {
  if (window.resetAt !== null && window.resetAt <= now) return false;
  return (
    isBlockedUpstream(window, now) ||
    (window.utilization !== null && window.utilization >= threshold)
  );
}

const TIER_SPAN = 3;

export function routeRank(
  account: Pick<Account, "enabled" | "kind">,
  quota: AccountQuota | AccountSummary,
  family: ModelFamily | null,
  threshold: number,
  now: number,
): number | null {
  if (!account.enabled || quota.error !== null || isUsageRestricted(quota, now))
    return null;
  const windows = quotaWindows(quota, family);
  const blocked = windows.some((window) => isBlockedUpstream(window, now));
  if (blocked && !hasExtraUsage(quota)) return null;
  const headroom = blocked
    ? 2
    : windows.some((window) => isAtThreshold(window, threshold, now))
      ? 1
      : 0;
  const overage = family === null ? null : quota.familyOverageUntil[family];
  const paid =
    blocked ||
    account.kind === "api-key" ||
    (overage !== null && overage > now);
  const tier = paid ? 2 : headroom;
  return tier * TIER_SPAN + headroom;
}

export function routeTier(rank: number): RoutingTier {
  const tier = ROUTING_TIERS[Math.floor(rank / TIER_SPAN)];
  if (tier === undefined) throw new Error(`Unknown route rank ${rank}.`);
  return tier;
}

export function isSubscriptionRank(rank: number): boolean {
  return rank < 2 * TIER_SPAN;
}

export function isBelowThreshold(
  quota: AccountQuota,
  family: ModelFamily,
  threshold: number,
  now: number,
): boolean {
  return (
    !isUsageRestricted(quota, now) &&
    !quotaWindows(quota, family).some((window) =>
      isAtThreshold(window, threshold, now),
    )
  );
}

export function rejoinAt(
  quota: AccountQuota | AccountSummary,
  family: ModelFamily | null,
  now: number,
): number | null {
  if (isUsageRestricted(quota, now))
    return quota.usageRestriction?.resetAt ?? null;
  let latest = now;
  for (const window of quotaWindows(quota, family)) {
    if (!isBlockedUpstream(window, now)) continue;
    if (window.resetAt === null) return null;
    latest = Math.max(latest, window.resetAt);
  }
  return latest;
}

export function longestLimitWindow(
  windows: readonly LimitWindow[],
): LimitWindow | null {
  let longest: LimitWindow | null = null;
  for (const window of windows) {
    if (
      longest === null ||
      (window.windowMinutes ?? 0) > (longest.windowMinutes ?? 0)
    )
      longest = window;
  }
  return longest;
}

export function isUsageRestricted(
  quota: AccountQuota | AccountSummary,
  now: number,
): boolean {
  return (
    quota.usageRestriction !== null &&
    (quota.usageRestriction.resetAt === null ||
      quota.usageRestriction.resetAt > now)
  );
}

export function hasExtraUsage(quota: AccountQuota | AccountSummary): boolean {
  return (
    quota.extraUsage?.status === "allowed" && quota.usageRestriction === null
  );
}

export function isQuotaRejection(headers: Headers): boolean {
  for (const [name, value] of headers) {
    if (value.toLowerCase() !== "rejected") continue;
    const normalized = name.toLowerCase();
    if (
      normalized === `${PREFIX}5h-status` ||
      normalized === `${PREFIX}7d-status` ||
      SCOPED_HEADER.test(normalized)
    )
      return true;
  }
  return false;
}

export function governingWeeklyResetAt(
  quota: AccountQuota,
  family: ModelFamily,
): number | null {
  return (
    quota.familyWeekly[family]?.resetAt ??
    quota.sevenDayResetAt ??
    longestLimitWindow(quota.limitWindows)?.resetAt ??
    null
  );
}

export function accountStatus(
  account: Account,
  quota: AccountQuota,
  threshold: number,
  now: number,
): Pick<AccountSummary, "status" | "tier"> {
  if (!account.enabled) return { status: "disabled", tier: null };
  if (quota.error !== null) return { status: "error", tier: null };
  const rank = routeRank(account, quota, null, threshold, now);
  const tier = rank === null ? null : routeTier(rank);
  if (quota.heldUntil !== null && quota.heldUntil > now)
    return { status: "held", tier };
  return { status: rank === null ? "exhausted" : "ready", tier };
}

export function retryAfterMilliseconds(
  value: string | null,
  now: number,
): number {
  if (value === null) return 1_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1_000));
  const date = Date.parse(value);
  return Number.isNaN(date) ? 1_000 : Math.max(0, date - now);
}
