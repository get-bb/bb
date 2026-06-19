import { CronExpressionParser } from "cron-parser";

const MINIMUM_SCHEDULE_INTERVAL_MINUTES = 5;
const MINIMUM_SCHEDULE_INTERVAL_MS = MINIMUM_SCHEDULE_INTERVAL_MINUTES * 60_000;
// Bound the gap sampling so a degenerate expression cannot loop forever; two
// days of occurrences is plenty to catch any sub-5-minute cadence.
const GAP_SAMPLE_MAX_OCCURRENCES = 256;
const GAP_SAMPLE_WINDOW_MS = 2 * 24 * 60 * 60_000;
const CRON_FIELD_COUNT = 5;

interface ScheduleAtTimeArgs {
  cron: string;
  now: number;
  timezone: string;
}

interface CronScheduleArgs {
  cron: string;
  timezone: string;
}

export class ScheduleValidationError extends Error {}

function parseExpression(args: {
  cron: string;
  now: number;
  timezone: string;
}) {
  try {
    return CronExpressionParser.parse(args.cron, {
      currentDate: new Date(args.now),
      tz: args.timezone,
    });
  } catch (error) {
    throw new ScheduleValidationError(
      error instanceof Error ? error.message : "Invalid cron expression",
    );
  }
}

function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
    }).format(new Date(0));
  } catch {
    throw new ScheduleValidationError("Invalid timezone");
  }
}

/**
 * Walk consecutive occurrences from a fixed reference time and reject any
 * expression whose runs are less than 5 minutes apart (every-minute or
 * every-2-minute steps). A 5-minute step (exactly 5-minute gaps) passes.
 * Sampling stops at the first of: a sub-minimum gap, ~256 occurrences, or
 * ~2 days elapsed.
 */
function assertMinimumGapBetweenOccurrences(args: CronScheduleArgs): void {
  // A fixed reference avoids edge effects from "now" landing mid-interval.
  const referenceNow = Date.UTC(2024, 0, 1, 0, 0, 0);
  const expression = parseExpression({
    cron: args.cron,
    now: referenceNow,
    timezone: args.timezone,
  });
  let previous = expression.next().getTime();
  for (let index = 1; index < GAP_SAMPLE_MAX_OCCURRENCES; index += 1) {
    let current: number;
    try {
      current = expression.next().getTime();
    } catch {
      // Finite schedule with fewer occurrences than the cap; nothing more to
      // check.
      return;
    }
    if (current - previous < MINIMUM_SCHEDULE_INTERVAL_MS) {
      throw new ScheduleValidationError(
        "Schedule must not run more frequently than every 5 minutes",
      );
    }
    if (current - referenceNow >= GAP_SAMPLE_WINDOW_MS) {
      return;
    }
    previous = current;
  }
}

/**
 * Validate a standard 5-field cron expression + timezone:
 * - exactly 5 whitespace-separated fields,
 * - a resolvable IANA timezone,
 * - parseable by cron-parser (accepts steps like `*\/5`, ranges, lists),
 * - runs no more often than every 5 minutes.
 */
export function validateScheduleDefinition(args: CronScheduleArgs): void {
  const fields = args.cron.trim().split(/\s+/u);
  if (fields.length !== CRON_FIELD_COUNT) {
    throw new ScheduleValidationError(
      "Cron expression must have exactly 5 fields (minute hour day-of-month month day-of-week)",
    );
  }
  assertValidTimezone(args.timezone);
  // Parse first so syntax errors surface as a clear message before gap checks.
  parseExpression({ cron: args.cron, now: Date.now(), timezone: args.timezone });
  assertMinimumGapBetweenOccurrences(args);
}

export function computeNextScheduledTime(args: ScheduleAtTimeArgs): number {
  validateScheduleDefinition({
    cron: args.cron,
    timezone: args.timezone,
  });
  return parseExpression({
    cron: args.cron,
    now: args.now,
    timezone: args.timezone,
  })
    .next()
    .getTime();
}
