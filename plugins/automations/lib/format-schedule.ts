// Cron/timezone humanization for the automations panel. Ported from the
// kernel's apps/app/src/lib/format-schedule.ts so the plugin bundle is
// self-contained (plugin code must not import from apps/app).
import { toString as cronstrueToString } from "cronstrue";
import type { AutomationTrigger } from "../src/rpc-types";

const SCHEDULE_RUN_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export interface FormatScheduleStatusLabelArgs {
  enabled: boolean;
  nextRunAt: number | null;
  trigger?: AutomationTrigger;
  runCount?: number;
  lastRunStatus?: "running" | "succeeded" | "failed" | "skipped" | null;
  now?: number;
}

export interface OneShotLifecycleArgs {
  enabled: boolean;
  trigger: AutomationTrigger;
  runCount: number;
  lastRunStatus: "running" | "succeeded" | "failed" | "skipped" | null;
  now?: number;
}

export type OneShotLifecycle =
  | "scheduled"
  | "paused"
  | "expired"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

const DAY_ABBREVIATION: Record<string, string> = {
  Sunday: "Sun",
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
};

/**
 * Compact human-readable recurrence for a cron expression, tuned for dense
 * lists: "9AM Mon-Fri", "5PM Fri", "Every 15 min". Post-processes cronstrue's
 * verbose phrasing. Falls back to a neutral label when the expression can't be
 * parsed.
 */
export function formatCronCadence(cron: string): string {
  let text: string;
  try {
    text = cronstrueToString(cron, { verbose: false });
  } catch {
    return "Custom schedule";
  }
  return (
    text
      // Drop cronstrue's leading "At " ("At 09:00 AM, …").
      .replace(/^At /, "")
      // Compact clock times: "09:00 AM" -> "9AM", "09:30 PM" -> "9:30PM".
      .replace(
        /\b0?(\d{1,2}):(\d{2})\s*(AM|PM)\b/g,
        (_all, hour, minute, meridiem) =>
          minute === "00"
            ? `${hour}${meridiem}`
            : `${hour}:${minute}${meridiem}`,
      )
      // Abbreviate day names to three letters.
      .replace(
        /\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/g,
        (day) => DAY_ABBREVIATION[day] ?? day,
      )
      // Ranges, list joins, and filler.
      .replace(/ through /g, "-")
      .replace(/,? only on /g, " ")
      .replace(/,? and /g, ", ")
      // Units.
      .replace(/\bminutes?\b/g, "min")
      .replace(/\bseconds?\b/g, "sec")
      // Collapse the comma between the time and the day spec into a space.
      .replace(/([AP]M),\s+/g, "$1 ")
      .trim()
  );
}

export function formatAutomationTrigger(trigger: AutomationTrigger): string {
  if (trigger.triggerType === "once") {
    return "One time";
  }
  return formatCronCadence(trigger.cron);
}

export function getOneShotLifecycle({
  enabled,
  trigger,
  runCount,
  lastRunStatus,
  now = Date.now(),
}: OneShotLifecycleArgs): OneShotLifecycle | null {
  if (trigger.triggerType !== "once") return null;
  if (enabled) return "scheduled";
  if (runCount > 0) {
    if (lastRunStatus === "running") return "running";
    if (lastRunStatus === "failed") return "failed";
    if (lastRunStatus === "skipped") return "skipped";
    return "completed";
  }
  return trigger.runAt <= now ? "expired" : "paused";
}

export function oneShotLifecycleAllowsToggle(
  lifecycle: OneShotLifecycle | null,
): boolean {
  return (
    lifecycle === null || lifecycle === "scheduled" || lifecycle === "paused"
  );
}

/** Compact absolute time for an upcoming run, e.g. "Jun 6, 9:00 AM". */
export function formatScheduleRunTime(timestamp: number): string {
  return SCHEDULE_RUN_FORMATTER.format(new Date(timestamp));
}

/**
 * Right-aligned status text for an automation row: the next scheduled run when
 * enabled and scheduled, otherwise a neutral "Paused"/"Not scheduled" label.
 */
export function formatScheduleStatusLabel({
  enabled,
  nextRunAt,
  trigger,
  runCount = 0,
  lastRunStatus = null,
  now = Date.now(),
}: FormatScheduleStatusLabelArgs): string {
  if (trigger !== undefined) {
    const oneShotLifecycle = getOneShotLifecycle({
      enabled,
      trigger,
      runCount,
      lastRunStatus,
      now,
    });
    if (oneShotLifecycle === "running") return "Running";
    if (oneShotLifecycle === "failed") return "Failed";
    if (oneShotLifecycle === "skipped") return "Skipped";
    if (oneShotLifecycle === "completed") return "Completed";
    if (oneShotLifecycle === "expired") return "Expired — edit to reschedule";
  }
  if (!enabled) {
    return "Paused";
  }
  if (nextRunAt === null) {
    return "Not scheduled";
  }
  return `Next ${formatScheduleRunTime(nextRunAt)}`;
}
