const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The compact age label on a card: "now", "5m", "2h", "3d", "2w".
 *
 * Deliberately coarse. The exact minute does not help you decide what to look
 * at next, and a precise label would change on every render.
 *
 * Callers pass a cached `now` (the card quantizes it to the minute), so a
 * timestamp sitting exactly on a bucket boundary can read one unit low for up
 * to a minute. That is the accepted cost of a clock that does not churn.
 */
export function relativeTimeLabel(timestamp: number, now: number): string {
  const elapsed = now - timestamp;
  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;
  return `${Math.floor(elapsed / (7 * DAY))}w`;
}
