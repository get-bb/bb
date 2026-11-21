export function usageBarColorClass(usedPercent: number): string {
  if (usedPercent >= 95) return "bg-destructive";
  if (usedPercent >= 80) return "bg-warning";
  return "bg-primary";
}

export function formatUsageReset(resetsAt: string | null): string | null {
  if (resetsAt === null) return null;
  const reset = new Date(resetsAt);
  if (Number.isNaN(reset.getTime())) return null;
  const diffMs = reset.getTime() - Date.now();
  if (diffMs <= 0) return "Resetting now";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `Resets in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes === 0
      ? `Resets in ${hours} hr`
      : `Resets in ${hours} hr ${remainingMinutes} min`;
  }
  const withinWeek = diffMs < 7 * 24 * 60 * 60_000;
  const formatted = reset.toLocaleString(undefined, {
    weekday: withinWeek ? "short" : undefined,
    month: withinWeek ? undefined : "short",
    day: withinWeek ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Resets ${formatted}`;
}

export function formatUsdCents(
  cents: number,
  alwaysShowCents: boolean,
): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: alwaysShowCents || cents % 100 !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

const USAGE_WINDOW_LENGTH_MS = {
  "five-hour": 5 * 60 * 60_000,
  daily: 24 * 60 * 60_000,
  weekly: 7 * 24 * 60 * 60_000,
} as const;

const PACE_TOLERANCE_PERCENT = 5;
const PACE_TOO_EARLY_PERCENT = 5;

export type UsagePace = "ahead" | "on" | "under";

export interface UsageWindowPace {
  elapsedPercent: number;
  pace: UsagePace;
  deltaPoints: number;
  runsOutAt: number | null;
  resetsAt: number;
}

export function usageWindowPace(
  window: {
    kind: "five-hour" | "daily" | "weekly" | "custom";
    usedPercent: number;
    resetsAt: string | null;
  },
  now: number,
): UsageWindowPace | null {
  if (window.kind === "custom" || window.resetsAt === null) return null;
  const resetsAt = Date.parse(window.resetsAt);
  if (!Number.isFinite(resetsAt)) return null;
  const length = USAGE_WINDOW_LENGTH_MS[window.kind];
  const remaining = resetsAt - now;
  if (remaining <= 0 || remaining > length) return null;
  const elapsedMs = length - remaining;
  const elapsedPercent = Math.round((elapsedMs / length) * 100);
  if (elapsedPercent < PACE_TOO_EARLY_PERCENT) return null;
  const usedPercent = Math.round(window.usedPercent);
  const deltaPoints = usedPercent - elapsedPercent;
  const runsOutAt =
    window.usedPercent <= 0
      ? null
      : now + ((100 - window.usedPercent) / window.usedPercent) * elapsedMs;
  return {
    elapsedPercent,
    pace:
      deltaPoints > PACE_TOLERANCE_PERCENT
        ? "ahead"
        : deltaPoints < -PACE_TOLERANCE_PERCENT
          ? "under"
          : "on",
    deltaPoints,
    runsOutAt: runsOutAt !== null && runsOutAt < resetsAt ? runsOutAt : null,
    resetsAt,
  };
}

export const USAGE_PACE_LABELS: Record<UsagePace, string> = {
  ahead: "Ahead of pace",
  on: "On pace",
  under: "Under pace",
};

export function formatUsageDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function describeUsagePace(pace: UsageWindowPace): string[] {
  const gap =
    pace.pace === "on"
      ? "On pace"
      : `${Math.abs(pace.deltaPoints)} pts ${pace.pace === "ahead" ? "ahead of" : "under"} pace`;
  const projection =
    pace.runsOutAt === null
      ? "Lasts until reset"
      : `Runs out ${new Date(pace.runsOutAt).toLocaleString(undefined, {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        })} · ${formatUsageDuration(pace.resetsAt - pace.runsOutAt)} without quota`;
  return [gap, projection];
}

export function currentUsageWindowPace(
  window: Parameters<typeof usageWindowPace>[0],
): UsageWindowPace | null {
  return usageWindowPace(window, Date.now());
}
