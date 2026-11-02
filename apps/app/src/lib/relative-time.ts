export { formatCompactRelativeTime as formatRelativeTime } from "@bb/shared-ui/relative-time";

const DAY_MS = 24 * 60 * 60 * 1000;

interface FormatScheduledTimeArgs {
  timestamp: number;
  now: number;
}

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
  const startOfTarget = new Date(timestamp);
  startOfTarget.setHours(0, 0, 0, 0);
  const daysAhead = Math.round(
    (startOfTarget.getTime() - startOfToday.getTime()) / DAY_MS,
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
