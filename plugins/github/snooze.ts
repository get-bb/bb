import type { PullStatus } from "./pull-status.js";

export type SnoozeRule = "checks" | "push" | "time";

export interface Snooze {
  rule: SnoozeRule;
  until: string | null;
  createdAt: string;
  checks: string | null;
  headRefOid: string | null;
}

export interface SnoozeSubject {
  pr: PullStatus | null;
}

export function snoozeWakes(
  snooze: Snooze,
  subject: SnoozeSubject,
  now: Date,
): boolean {
  if (subject.pr === null) return true;
  if (subject.pr.state === "merged" || subject.pr.state === "closed") {
    return true;
  }
  switch (snooze.rule) {
    case "checks":
      return subject.pr.checks.state !== snooze.checks;
    case "push":
      return (
        subject.pr.headRefOid !== null &&
        subject.pr.headRefOid !== snooze.headRefOid
      );
    case "time":
      return snooze.until === null || Date.parse(snooze.until) <= now.getTime();
  }
}

export function snoozeFor(
  rule: SnoozeRule,
  until: string | null,
  subject: SnoozeSubject,
  now: Date,
): Snooze {
  return {
    rule,
    until: rule === "time" ? until : null,
    createdAt: now.toISOString(),
    checks: subject.pr?.checks.state ?? null,
    headRefOid: subject.pr?.headRefOid ?? null,
  };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function clock(date: Date): string {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function snoozeLabel(
  snooze: Pick<Snooze, "rule" | "until">,
  now: Date,
): string {
  switch (snooze.rule) {
    case "checks":
      return "until checks change";
    case "push":
      return "until a new push";
    case "time": {
      if (snooze.until === null) return "until later";
      const at = new Date(snooze.until);
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      if (at.toDateString() === now.toDateString()) return `until ${clock(at)}`;
      if (at.toDateString() === tomorrow.toDateString()) {
        return `until tomorrow ${clock(at)}`;
      }
      const days = (at.getTime() - now.getTime()) / 86_400_000;
      if (days < 7) return `until ${WEEKDAYS[at.getDay()]} ${clock(at)}`;
      return `until ${at.toISOString().slice(0, 10)}`;
    }
  }
}

export function tomorrowMorning(now: Date): Date {
  const at = new Date(now);
  at.setDate(now.getDate() + 1);
  at.setHours(8, 0, 0, 0);
  return at;
}

export function nextMondayMorning(now: Date): Date {
  const at = new Date(now);
  at.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  at.setHours(8, 0, 0, 0);
  return at;
}
