import { toString as cronstrueToString } from "cronstrue";

export type AutomationTrigger =
  | { triggerType: "schedule"; cron: string; timezone: string }
  | { triggerType: "once"; runAt: number };

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

export function formatCronCadence(cron: string): string {
  let text: string;
  try {
    text = cronstrueToString(cron, { verbose: false });
  } catch {
    return "Custom schedule";
  }
  return text
    .replace(/^At /u, "")
    .replace(
      /\b0?(\d{1,2}):(\d{2})\s*(AM|PM)\b/gu,
      (_all, hour, minute, meridiem) =>
        minute === "00" ? `${hour}${meridiem}` : `${hour}:${minute}${meridiem}`,
    )
    .replace(
      /\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/gu,
      (day) => DAY_ABBREVIATION[day] ?? day,
    )
    .replace(/ through /gu, "-")
    .replace(/,? only on /gu, " ")
    .replace(/,? and /gu, ", ")
    .replace(/\bminutes?\b/gu, "min")
    .replace(/\bseconds?\b/gu, "sec")
    .replace(/([AP]M),\s+/gu, "$1 ")
    .trim();
}

export function formatAutomationTrigger(trigger: AutomationTrigger): string {
  if (trigger.triggerType === "once") {
    return `Once at ${formatScheduleRunTime(trigger.runAt)}`;
  }
  return `${formatCronCadence(trigger.cron)} · ${trigger.timezone}`;
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

export function formatScheduleRunTime(timestamp: number): string {
  return SCHEDULE_RUN_FORMATTER.format(new Date(timestamp));
}

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
  if (!enabled) return "Paused";
  if (nextRunAt === null) return "Not scheduled";
  return `Next ${formatScheduleRunTime(nextRunAt)}`;
}
