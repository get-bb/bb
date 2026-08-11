/**
 * The settled / snoozed lifecycle, as pure functions over stored rows.
 *
 * This state lives in the PLUGIN's own database, never on bb's thread. That
 * keeps a plugin concept out of bb's schema and out of the host-daemon
 * protocol, and uninstalling the plugin takes its state with it.
 */

export interface ThreadLifecycleRow {
  threadId: string;
  /** When the user settled it; null when it is active. */
  settledAt: number | null;
  /** Wake time for a snooze; null when it is not snoozed. */
  snoozedUntil: number | null;
  /** When the snooze was set — used to detect activity since. */
  snoozedAt: number | null;
}

/** The activity signals that outrank a user's parking decision. */
export interface ThreadActivitySignals {
  hasPendingInteraction: boolean;
  /** Any live work: runtime, workflows, background agents, plan, goals. */
  isWorking: boolean;
  isUnread: boolean;
  /** Newest attention timestamp bb reports for the thread. */
  latestAttentionAt: number;
}

export type ThreadShelf = "active" | "snoozed" | "settled";

/**
 * Whether a thread may be parked at all.
 *
 * bb has more kinds of live work than a single session status — workflows,
 * background agents, background commands, plan mode, goals — and every one of
 * them must block parking. Hiding a thread that is still working is the one
 * failure this feature cannot afford.
 */
export function canPark(signals: ThreadActivitySignals): boolean {
  return !signals.hasPendingInteraction && !signals.isWorking;
}

/**
 * Which shelf a thread belongs on right now.
 *
 * Order matters. Live work and a raised hand always win, so a parked thread
 * that starts working or asks a question comes straight back. Then snooze,
 * because a wake time is a stronger statement than a settle. Then settled.
 */
export function resolveShelf(
  row: ThreadLifecycleRow | undefined,
  signals: ThreadActivitySignals,
  now: number,
): ThreadShelf {
  if (row === undefined) return "active";
  if (!canPark(signals)) return "active";

  if (row.snoozedUntil !== null) {
    // A timer that has elapsed wakes the thread; so does anything that
    // happened after the snooze was set.
    const wokeOnTimer = row.snoozedUntil <= now;
    const wokeOnActivity =
      row.snoozedAt !== null && signals.latestAttentionAt > row.snoozedAt;
    if (!wokeOnTimer && !wokeOnActivity) return "snoozed";
    return "active";
  }

  if (row.settledAt !== null) {
    // New attention since the settle un-settles it: the thread has more to
    // say than it did when the user filed it away.
    if (signals.latestAttentionAt > row.settledAt) return "active";
    return "settled";
  }

  return "active";
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Compact "wakes in" label: "5m", "2h", "3d". Minutes round up so a snooze
 * never reads "0m" while the thread is still hidden.
 */
export function snoozeWakeLabel(snoozedUntil: number, now: number): string {
  const remaining = snoozedUntil - now;
  if (remaining <= 0) return "now";
  if (remaining < HOUR_MS) {
    return `${Math.max(1, Math.ceil(remaining / MINUTE_MS))}m`;
  }
  if (remaining < DAY_MS) return `${Math.ceil(remaining / HOUR_MS)}h`;
  return `${Math.ceil(remaining / DAY_MS)}d`;
}

export type SnoozePresetId = "hour" | "evening" | "tomorrow" | "next-week";

export interface SnoozePreset {
  id: SnoozePresetId;
  label: string;
  snoozedUntil: number;
}

const EVENING_HOUR = 18;
const MORNING_HOUR = 9;

/**
 * Calendar-day arithmetic, not fixed millisecond offsets: adding 24 hours
 * lands on the wrong local day across a daylight-saving change, because a
 * spring-forward day is 23 hours long.
 */
function atHour(base: Date, hour: number, addDays = 0): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + addDays);
  next.setHours(hour, 0, 0, 0);
  return next;
}

/** "This evening" only appears while it is meaningfully before evening. */
export function resolveSnoozePresets(now: Date): SnoozePreset[] {
  const presets: SnoozePreset[] = [
    { id: "hour", label: "In 1 hour", snoozedUntil: now.getTime() + HOUR_MS },
  ];

  const evening = atHour(now, EVENING_HOUR);
  if (evening.getTime() - now.getTime() > HOUR_MS) {
    presets.push({
      id: "evening",
      label: "This evening",
      snoozedUntil: evening.getTime(),
    });
  }

  presets.push({
    id: "tomorrow",
    label: "Tomorrow",
    snoozedUntil: atHour(now, MORNING_HOUR, 1).getTime(),
  });

  const daysUntilMonday = (1 - now.getDay() + 7) % 7 || 7;
  presets.push({
    id: "next-week",
    label: "Next week",
    snoozedUntil: atHour(now, MORNING_HOUR, daysUntilMonday).getTime(),
  });

  return presets;
}

/**
 * `setTimeout` delays are signed 32-bit: a far-future wake overflows and fires
 * immediately, which turns one snooze into a tight re-arm loop. Clamped, the
 * timer simply re-arms every ~24.8 days until the wake is in range.
 */
export const MAX_TIMEOUT_MS = 2_147_483_647;

export function nextWakeDelayMs(
  snoozedUntilValues: readonly number[],
  now: number,
): number | null {
  const upcoming = snoozedUntilValues.filter((value) => value > now);
  if (upcoming.length === 0) return null;
  const soonest = Math.min(...upcoming);
  return Math.min(Math.max(0, soonest - now) + 50, MAX_TIMEOUT_MS);
}
