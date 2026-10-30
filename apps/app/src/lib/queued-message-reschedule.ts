import type { ThreadQueuedMessage } from "@bb/domain";

export interface QueuedMessageScheduleFields {
  date: string;
  time: string;
}

export type QueuedMessageScheduleParse =
  | { ok: true; at: number }
  | { ok: false; message: string };

const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_INPUT_PATTERN = /^(\d{2}):(\d{2})$/;

export function isQueuedMessageReschedulable(
  queuedMessage: Pick<ThreadQueuedMessage, "sendAt" | "state">,
): boolean {
  return queuedMessage.state === "scheduled" && queuedMessage.sendAt !== null;
}

function padded(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

export function queuedMessageScheduleFields(
  at: number,
): QueuedMessageScheduleFields {
  const date = new Date(at);
  return {
    date: [
      padded(date.getFullYear(), 4),
      padded(date.getMonth() + 1, 2),
      padded(date.getDate(), 2),
    ].join("-"),
    time: `${padded(date.getHours(), 2)}:${padded(date.getMinutes(), 2)}`,
  };
}

export function parseQueuedMessageScheduleFields(
  fields: QueuedMessageScheduleFields,
  now: number,
): QueuedMessageScheduleParse {
  const dateMatch = DATE_INPUT_PATTERN.exec(fields.date);
  if (dateMatch === null) return { ok: false, message: "Choose a date." };
  const timeMatch = TIME_INPUT_PATTERN.exec(fields.time);
  if (timeMatch === null) return { ok: false, message: "Choose a time." };

  const year = Number.parseInt(dateMatch[1], 10);
  const month = Number.parseInt(dateMatch[2], 10);
  const day = Number.parseInt(dateMatch[3], 10);
  const hour = Number.parseInt(timeMatch[1], 10);
  const minute = Number.parseInt(timeMatch[2], 10);
  const scheduled = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    scheduled.getFullYear() !== year ||
    scheduled.getMonth() !== month - 1 ||
    scheduled.getDate() !== day ||
    scheduled.getHours() !== hour ||
    scheduled.getMinutes() !== minute
  ) {
    return { ok: false, message: "Choose a real date and time." };
  }
  const at = scheduled.getTime();
  if (at <= now) return { ok: false, message: "Choose a future time." };
  return { ok: true, at };
}
