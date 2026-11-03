const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export function formatCompactRelativeTime({
  timestamp,
  now,
}: {
  timestamp: number;
  now: number;
}): string {
  const diffMs = now - timestamp;
  if (diffMs < MINUTE_MS) {
    return "now";
  }
  if (diffMs < HOUR_MS) {
    return `${Math.floor(diffMs / MINUTE_MS)}m`;
  }
  if (diffMs < DAY_MS) {
    return `${Math.floor(diffMs / HOUR_MS)}h`;
  }
  if (diffMs < WEEK_MS) {
    return `${Math.floor(diffMs / DAY_MS)}d`;
  }
  if (diffMs < 5 * WEEK_MS) {
    return `${Math.floor(diffMs / WEEK_MS)}w`;
  }
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() < new Date(now).getFullYear()
      ? { year: "numeric" }
      : {}),
  });
}
