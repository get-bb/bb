import type { Account, AccountQuota, AccountSummary } from "./contracts.js";

const PREFIX = "anthropic-ratelimit-unified-";

function parseNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseReset(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric < 1_000_000_000_000
      ? Math.round(numeric * 1_000)
      : Math.round(numeric);
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function quotaFromHeaders(
  accountId: string,
  headers: Headers,
  previous: AccountQuota,
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
  const bucketExhaustion = { ...previous.bucketExhaustion };
  for (const [name, value] of headers) {
    if (!name.startsWith(PREFIX) || !name.endsWith("-status")) continue;
    if (name === `${PREFIX}5h-status` || name === `${PREFIX}7d-status`)
      continue;
    const bucket = name.slice(PREFIX.length, -"-status".length);
    if (bucket === "" || bucket === "overage") continue;
    if (value.toLowerCase() !== "rejected") {
      delete bucketExhaustion[bucket];
      continue;
    }
    const reset = parseReset(headers.get(`${PREFIX}${bucket}-reset`));
    bucketExhaustion[bucket] = reset ?? now;
  }
  const observed =
    fiveHourUtilization !== null ||
    fiveHourResetAt !== null ||
    fiveHourStatus !== null ||
    sevenDayUtilization !== null ||
    sevenDayResetAt !== null ||
    sevenDayStatus !== null ||
    representativeClaim !== null;
  return {
    accountId,
    fiveHourUtilization: fiveHourUtilization ?? previous.fiveHourUtilization,
    fiveHourResetAt: fiveHourResetAt ?? previous.fiveHourResetAt,
    fiveHourStatus: fiveHourStatus ?? previous.fiveHourStatus,
    sevenDayUtilization: sevenDayUtilization ?? previous.sevenDayUtilization,
    sevenDayResetAt: sevenDayResetAt ?? previous.sevenDayResetAt,
    sevenDayStatus: sevenDayStatus ?? previous.sevenDayStatus,
    representativeClaim: representativeClaim ?? previous.representativeClaim,
    bucketExhaustion,
    observedAt: observed ? now : previous.observedAt,
    heldUntil: previous.heldUntil,
    error: previous.error,
  };
}

function activeWindow(
  utilization: number | null,
  status: string | null,
  resetAt: number | null,
  threshold: number,
  now: number,
): boolean {
  if (resetAt !== null && resetAt <= now) return false;
  return (
    status?.toLowerCase() === "rejected" ||
    (utilization !== null && utilization >= threshold)
  );
}

export function isQuotaExhausted(
  quota: AccountQuota,
  threshold: number,
  now: number,
): boolean {
  return (
    activeWindow(
      quota.fiveHourUtilization,
      quota.fiveHourStatus,
      quota.fiveHourResetAt,
      threshold,
      now,
    ) ||
    activeWindow(
      quota.sevenDayUtilization,
      quota.sevenDayStatus,
      quota.sevenDayResetAt,
      threshold,
      now,
    )
  );
}

export function isQuotaRejection(quota: AccountQuota, now: number): boolean {
  return (
    activeWindow(null, quota.fiveHourStatus, quota.fiveHourResetAt, 1, now) ||
    activeWindow(null, quota.sevenDayStatus, quota.sevenDayResetAt, 1, now)
  );
}

export function accountStatus(
  account: Account,
  quota: AccountQuota,
  threshold: number,
  now: number,
): AccountSummary["status"] {
  if (!account.enabled) return "disabled";
  if (quota.error !== null) return "error";
  if (quota.heldUntil !== null && quota.heldUntil > now) return "held";
  if (isQuotaExhausted(quota, threshold, now)) return "exhausted";
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
