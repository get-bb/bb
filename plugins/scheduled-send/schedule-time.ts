/**
 * Time parsing for "Send later…". The composer offers a few presets plus a
 * freeform field, and both resolve to the epoch-ms `holdUntil` the send route
 * takes.
 *
 * The freeform grammar is the CLI's `--hold-until` grammar (durations and ISO
 * timestamps, `apps/cli/src/commands/thread/hold-time.ts`) plus wall-clock
 * times like `9am` and `tomorrow 09:30`, which are what a person types into a
 * composer. Keeping the CLI's rejections — a bare date is ambiguous, a past
 * time is a mistake — matters more than accepting everything: a scheduled send
 * that lands hours off is worse than an error.
 */

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * A year out is far past any real use and well inside the range where a typo
 * (`2062` for `2026`) stops looking like a schedule and starts looking like a
 * lost message. The server accepts any future timestamp; this is the plugin's
 * own guard.
 */
export const MAX_SCHEDULE_AHEAD_MS = 365 * DAY_MS;

const EVENING_HOUR = 18;
const MORNING_HOUR = 9;

export interface SchedulePreset {
  id: string;
  label: string;
  /** Epoch ms. */
  at: number;
}

/**
 * The quick picks, filtered to the ones that are still ahead: at 8pm there is
 * no "this evening" left to offer, and a preset that resolves to the past
 * would be rejected the moment it was clicked.
 */
export function listSchedulePresets(now: number): SchedulePreset[] {
  const candidates: SchedulePreset[] = [
    { id: "in-1-hour", label: "In 1 hour", at: now + HOUR_MS },
    {
      id: "this-evening",
      label: "This evening",
      at: atLocalTime(now, 0, EVENING_HOUR, 0),
    },
    {
      id: "tomorrow-morning",
      label: "Tomorrow morning",
      at: atLocalTime(now, 1, MORNING_HOUR, 0),
    },
  ];
  return candidates.filter((preset) => preset.at > now);
}

/** Local wall-clock time `dayOffset` days from `now`, as epoch ms. */
function atLocalTime(
  now: number,
  dayOffset: number,
  hour: number,
  minute: number,
): number {
  const date = new Date(now);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

export type ScheduleTimeParse =
  | { ok: true; at: number }
  | { ok: false; message: string };

const DURATION_PATTERN =
  /^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/;

const DURATION_UNIT_MS: Record<string, number> = {
  s: SECOND_MS,
  m: MINUTE_MS,
  h: HOUR_MS,
  d: DAY_MS,
};

/**
 * `9am`, `9:30 pm`, `18:30`. A bare number is deliberately unmatched: `9` is
 * 9am, 9pm, and 9 minutes to three different people.
 */
const CLOCK_PATTERN = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/;

const DAY_PREFIX_PATTERN = /^(today|tonight|tomorrow|tmr|tom)(?:\s+(.*))?$/;

/** A date alone has no time of day, and `Date.parse` reads it as UTC midnight. */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Matched against the lower-cased input, hence the lower-case `t` separator. */
const ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(z|[+-]\d{2}:?\d{2})?$/;

/**
 * Resolves what the user typed to epoch ms, or explains why it cannot be. The
 * clock is a parameter so the preview the banner renders and the value it
 * finally submits are computed the same way at two different instants.
 */
export function parseScheduleTime(
  value: string,
  now: number,
): ScheduleTimeParse {
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (trimmed === "") {
    return { ok: false, message: "Enter a time, such as 30m or 9am." };
  }

  const resolved = resolveScheduleTime(trimmed, now);
  if (!resolved.ok) return resolved;

  if (resolved.at <= now) {
    return {
      ok: false,
      message: `${formatScheduleTime(resolved.at, now)} has already passed.`,
    };
  }
  if (resolved.at > now + MAX_SCHEDULE_AHEAD_MS) {
    return { ok: false, message: "Pick a time within the next year." };
  }
  return resolved;
}

function resolveScheduleTime(trimmed: string, now: number): ScheduleTimeParse {
  const withoutLeadIn = trimmed.replace(/^(in|at|on)\s+/, "");

  const duration = DURATION_PATTERN.exec(withoutLeadIn);
  if (duration) {
    const amount = Number.parseFloat(duration[1]);
    const unitMs = DURATION_UNIT_MS[duration[2].charAt(0)];
    return { ok: true, at: Math.round(now + amount * unitMs) };
  }

  const dayPrefix = DAY_PREFIX_PATTERN.exec(withoutLeadIn);
  if (dayPrefix) {
    const day = dayPrefix[1];
    const rest = (dayPrefix[2] ?? "").replace(/^(at|around)\s+/, "");
    // "tonight" and a bare "tomorrow" name a day but no time; fill in the same
    // hours the presets use rather than guessing midnight.
    if (rest === "") {
      const hour = day === "tonight" ? EVENING_HOUR : MORNING_HOUR;
      return { ok: true, at: atLocalTime(now, dayOffsetFor(day), hour, 0) };
    }
    const clock = parseClock(rest);
    if (clock === null) {
      return {
        ok: false,
        message: `"${rest}" is not a time of day. Try 9am or 14:30.`,
      };
    }
    return {
      ok: true,
      at: atLocalTime(now, dayOffsetFor(day), clock.hour, clock.minute),
    };
  }

  const clock = parseClock(withoutLeadIn);
  if (clock !== null) {
    // A time with no day means the next time it comes around.
    const today = atLocalTime(now, 0, clock.hour, clock.minute);
    return { ok: true, at: today > now ? today : today + DAY_MS };
  }

  if (DATE_ONLY_PATTERN.test(withoutLeadIn)) {
    return {
      ok: false,
      message: "A date alone has no time of day. Try 2026-08-26T09:00.",
    };
  }

  if (ISO_PATTERN.test(withoutLeadIn)) {
    const parsed = Date.parse(withoutLeadIn.replace(" ", "T").toUpperCase());
    if (!Number.isFinite(parsed)) {
      return { ok: false, message: "That is not a real date." };
    }
    return { ok: true, at: parsed };
  }

  return {
    ok: false,
    message: "Try a duration (30m, 2h), a time (9am), or 2026-08-26T09:00.",
  };
}

function dayOffsetFor(day: string): number {
  return day === "today" || day === "tonight" ? 0 : 1;
}

function parseClock(value: string): { hour: number; minute: number } | null {
  const match = CLOCK_PATTERN.exec(value);
  if (!match) return null;

  const meridiem = match[3];
  const minute = match[2] === undefined ? 0 : Number.parseInt(match[2], 10);
  let hour = Number.parseInt(match[1], 10);

  // Without am/pm this is 24-hour, so a bare hour needs a colon to have
  // matched at all — `9` never reaches here, but `9:00` does.
  if (meridiem === undefined) {
    if (match[2] === undefined) return null;
    if (hour > 23) return null;
  } else {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "am") hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  }
  if (minute > 59) return null;
  return { hour, minute };
}

/**
 * How the banner names a time back to the user. Today and tomorrow are said in
 * words because that is how the choice was made ("this evening"), and anything
 * further out gets its date so a week-out schedule is unambiguous.
 */
export function formatScheduleTime(at: number, now: number): string {
  const time = new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const days = calendarDaysBetween(now, at);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days === -1) return `yesterday at ${time}`;
  const date = new Date(at).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year:
      new Date(at).getFullYear() === new Date(now).getFullYear()
        ? undefined
        : "numeric",
  });
  return `${date} at ${time}`;
}

/** Whole local calendar days from `now`'s day to `at`'s day. */
function calendarDaysBetween(now: number, at: number): number {
  const startOfNow = new Date(now);
  startOfNow.setHours(0, 0, 0, 0);
  const startOfAt = new Date(at);
  startOfAt.setHours(0, 0, 0, 0);
  return Math.round((startOfAt.getTime() - startOfNow.getTime()) / DAY_MS);
}
