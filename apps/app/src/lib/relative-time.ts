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

interface FormatScheduledTimeArgs {
  /** The future instant being described, in epoch milliseconds. */
  timestamp: number;
  /** The reference "now", in epoch milliseconds. Passed in for testability. */
  now: number;
}

/**
 * Formats a scheduled instant as a clock time ("9:00"), qualified by day once
 * it is not today ("Tomorrow 9:00", "Mar 4 9:00"). The counterpart to
 * {@link formatRelativeTime}, which describes the past.
 */
export function formatScheduledTime({
  timestamp,
  now,
}: FormatScheduledTimeArgs): string {
  const target = new Date(timestamp);
  const clock = target.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const daysAhead = Math.floor(
    (target.getTime() - startOfToday.getTime()) / DAY_MS,
  );
  if (daysAhead === 0) {
    return clock;
  }
  if (daysAhead === 1) {
    return `Tomorrow ${clock}`;
  }
  const date = target.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${date} ${clock}`;
}
