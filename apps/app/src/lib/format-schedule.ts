import { toString as cronstrueToString } from "cronstrue";
import type { AutomationTrigger } from "@bb/server-contract";

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
}

export interface CompletedOneShotAutomationArgs {
  enabled: boolean;
  trigger: AutomationTrigger;
  runCount: number;
}

/**
 * Human-readable recurrence for a cron expression, e.g.
 * "At 09:00 AM, Monday through Friday". Falls back to a neutral label rather
 * than surfacing the raw cron string when the expression can't be parsed.
 */
export function formatCronCadence(cron: string): string {
  try {
    return cronstrueToString(cron, { verbose: false });
  } catch {
    return "Custom schedule";
  }
}

export function formatAutomationTrigger(trigger: AutomationTrigger): string {
  if (trigger.triggerType === "once") {
    return `Once at ${formatScheduleRunTime(trigger.runAt)}`;
  }
  return `${formatCronCadence(trigger.cron)} · ${trigger.timezone}`;
}

export function isCompletedOneShotAutomation({
  enabled,
  trigger,
  runCount,
}: CompletedOneShotAutomationArgs): boolean {
  return trigger.triggerType === "once" && !enabled && runCount > 0;
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
}: FormatScheduleStatusLabelArgs): string {
  if (
    trigger !== undefined &&
    isCompletedOneShotAutomation({ enabled, trigger, runCount })
  ) {
    return "Completed";
  }
  if (!enabled) {
    return "Paused";
  }
  if (nextRunAt === null) {
    return "Not scheduled";
  }
  return `Next ${formatScheduleRunTime(nextRunAt)}`;
}
