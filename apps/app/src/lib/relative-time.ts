interface FormatRelativeTimeArgs {
  timestamp: number;
  now: number;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export function formatRelativeTime({
  timestamp,
  now,
}: FormatRelativeTimeArgs): string {
  const diffMs = now - timestamp;
  if (diffMs < MINUTE_MS) {
    return "just now";
  }
  if (diffMs < HOUR_MS) {
    return `${Math.floor(diffMs / MINUTE_MS)}m ago`;
  }
  if (diffMs < DAY_MS) {
    return `${Math.floor(diffMs / HOUR_MS)}h ago`;
  }
  const days = Math.floor(diffMs / DAY_MS);
  if (days === 1) {
    return "Yesterday";
  }
  if (diffMs < WEEK_MS) {
    return `${days}d ago`;
  }
  if (diffMs < 5 * WEEK_MS) {
    return `${Math.floor(diffMs / WEEK_MS)}w ago`;
  }
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
