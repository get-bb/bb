import type {
  Account,
  AccountQuota,
  AccountSummary,
  LimitWindow,
  LimitWindowSlot,
  ModelFamily,
} from "./contracts.js";

const PREFIX = "anthropic-ratelimit-unified-";
const SCOPED_HEADER =
  /^anthropic-ratelimit-unified-7d_(.+)-(utilization|reset|status)$/u;

export const CLAUDE_WINDOWS = {
  primary: { minutes: 300, header: "5h" },
  secondary: { minutes: 10_080, header: "7d" },
} as const satisfies Record<
  LimitWindowSlot,
  { minutes: number; header: string }
>;

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

function windowFromHeaders(
  headers: Headers,
  slot: LimitWindowSlot,
  previous: AccountQuota,
  now: number,
): LimitWindow | null {
  const { minutes, header } = CLAUDE_WINDOWS[slot];
  const utilization = parseNumber(
    headers.get(`${PREFIX}${header}-utilization`),
  );
  const resetAt = parseReset(headers.get(`${PREFIX}${header}-reset`));
  const status = headers.get(`${PREFIX}${header}-status`);
  const prior =
    previous.limitWindows.find((window) => window.slot === slot) ?? null;
  if (utilization === null && resetAt === null && status === null)
    return prior;
  return {
    slot,
    windowMinutes: minutes,
    utilization: utilization ?? prior?.utilization ?? null,
    resetAt: resetAt ?? prior?.resetAt ?? null,
    status: status ?? prior?.status ?? null,
    observedAt: now,
    source: "header",
  };
}

export function quotaFromHeaders(
  accountId: string,
  headers: Headers,
  previous: AccountQuota,
  family: ModelFamily,
  now: number,
): AccountQuota {
  const primary = windowFromHeaders(headers, "primary", previous, now);
  const secondary = windowFromHeaders(headers, "secondary", previous, now);
  const limitWindows = [primary, secondary].filter(
    (window): window is LimitWindow => window !== null,
  );
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
    limitWindows.some((window) => !previous.limitWindows.includes(window)) ||
    representativeClaim !== null ||
    extraUsage !== previous.extraUsage ||
    scoped !== null;
  return {
    accountId,
    usageRestriction: previous.usageRestriction,
    extraUsage,
    representativeClaim: representativeClaim ?? previous.representativeClaim,
    familyWeekly,
    limitWindows,
    observedAt: observed ? now : previous.observedAt,
    heldUntil: previous.heldUntil,
    error: previous.error,
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
    ...quota.limitWindows,
    ...(familyQuota === null ? [] : [familyQuota]),
  ];
}

function isRefusedWindow(window: QuotaWindow, now: number): boolean {
  if (window.resetAt !== null && window.resetAt <= now) return false;
  if (window.status !== null) return window.status.toLowerCase() === "rejected";
  return window.utilization !== null && window.utilization >= 1;
}

function isWindowPastThreshold(
  window: QuotaWindow,
  threshold: number,
  now: number,
): boolean {
  if (window.resetAt !== null && window.resetAt <= now) return false;
  return (
    isRefusedWindow(window, now) ||
    (window.utilization !== null && window.utilization >= threshold)
  );
}

export function blockingResetAt(
  quota: AccountQuota | AccountSummary,
  family: ModelFamily | null,
  now: number,
): number | null {
  if (isUsageRestricted(quota, now))
    return quota.usageRestriction?.resetAt ?? null;
  let latest: number | null = null;
  for (const window of quotaWindows(quota, family)) {
    if (!isRefusedWindow(window, now)) continue;
    if (window.resetAt === null) return null;
    latest = Math.max(latest ?? window.resetAt, window.resetAt);
  }
  return latest;
}

export function isQuotaExhausted(
  quota: AccountQuota | AccountSummary,
  family: ModelFamily | null,
  now: number,
): boolean {
  return (
    isUsageRestricted(quota, now) ||
    quotaWindows(quota, family).some((window) => isRefusedWindow(window, now))
  );
}

export function isPastThreshold(
  quota: AccountQuota,
  family: ModelFamily | null,
  threshold: number,
  now: number,
): boolean {
  return (
    isUsageRestricted(quota, now) ||
    quotaWindows(quota, family).some((window) =>
      isWindowPastThreshold(window, threshold, now),
    )
  );
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

export function hasExtraUsage(quota: AccountQuota): boolean {
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

export function accountStatus(
  account: Account,
  quota: AccountQuota,
  now: number,
): AccountSummary["status"] {
  if (!account.enabled) return "disabled";
  if (quota.error !== null) return "error";
  if (quota.heldUntil !== null && quota.heldUntil > now) return "held";
  if (isUsageRestricted(quota, now)) return "exhausted";
  if (isQuotaExhausted(quota, null, now) && !hasExtraUsage(quota))
    return "exhausted";
  return "ready";
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
