const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const MONTH_ABBREVIATIONS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Compact age label for list rows: `now`, `5m`, `3h`, `2d`, then a short
 * date (`Mar 4`, or `Mar 4, 2024` outside the current year). Timestamps in
 * the future (clock skew) read as `now`. No Intl dependency so the output is
 * identical on every device and in tests.
 */
export function formatRelativeTime(timestampMs: number, nowMs: number): string {
  const elapsed = nowMs - timestampMs;
  if (elapsed < MINUTE_MS) return "now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h`;
  if (elapsed < WEEK_MS) return `${Math.floor(elapsed / DAY_MS)}d`;
  const date = new Date(timestampMs);
  const now = new Date(nowMs);
  const month = MONTH_ABBREVIATIONS[date.getMonth()];
  const day = date.getDate();
  return date.getFullYear() === now.getFullYear()
    ? `${month} ${day}`
    : `${month} ${day}, ${date.getFullYear()}`;
}

/**
 * How long a label computed at `nowMs` stays correct, so a list can schedule
 * its next re-render instead of ticking every second.
 */
export function getRelativeTimeRefreshIntervalMs(): number {
  return MINUTE_MS;
}
