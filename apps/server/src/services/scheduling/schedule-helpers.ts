import { CronExpressionParser } from "cron-parser";

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

interface OnceScheduleArgs {
  runAt: number;
  now: number;
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
 * Validate a standard 5-field cron expression + timezone:
 * - exactly 5 whitespace-separated fields,
 * - a resolvable IANA timezone,
 * - parseable by cron-parser (accepts steps like `*\/5`, ranges, lists).
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

export function validateOnceDefinition(args: OnceScheduleArgs): void {
  if (args.runAt <= args.now) {
    throw new ScheduleValidationError("One-shot run time must be in the future");
  }
}
