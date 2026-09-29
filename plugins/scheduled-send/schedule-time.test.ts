import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultCustomSchedule,
  formatDateInputValue,
  formatScheduleTime,
  formatScheduleTimeZone,
  isSchedulePresetId,
  listSchedulePresets,
  MAX_SCHEDULE_AHEAD_MS,
  parseCustomScheduleTime,
} from "./schedule-time";

function localTime(
  from: number,
  dayOffset: number,
  hour: number,
  minute = 0,
): number {
  const date = new Date(from);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

function at(hour: number, minute = 0): number {
  return localTime(
    new Date(2026, 7, 25, 12, 0, 0, 0).getTime(),
    0,
    hour,
    minute,
  );
}

const NOON = at(12);

describe("listSchedulePresets", () => {
  it("offers relative and useful wall-clock choices", () => {
    expect(listSchedulePresets(NOON)).toEqual([
      {
        id: "in-30-minutes",
        label: "In 30 minutes",
        at: NOON + 30 * 60 * 1000,
      },
      {
        id: "in-1-hour",
        label: "In 1 hour",
        at: NOON + 60 * 60 * 1000,
      },
      {
        id: "in-2-hours",
        label: "In 2 hours",
        at: NOON + 2 * 60 * 60 * 1000,
      },
      { id: "this-evening", label: "This evening", at: at(18) },
      {
        id: "tomorrow-morning",
        label: "Tomorrow morning",
        at: localTime(NOON, 1, 9),
      },
    ]);
  });

  it("drops this evening once it has passed", () => {
    const lateNight = at(23, 30);
    expect(listSchedulePresets(lateNight).map((preset) => preset.id)).toEqual([
      "in-30-minutes",
      "in-1-hour",
      "in-2-hours",
      "tomorrow-morning",
    ]);
  });

  it("narrows only known preset ids", () => {
    expect(isSchedulePresetId("in-1-hour")).toBe(true);
    expect(isSchedulePresetId("custom")).toBe(false);
  });
});

describe("custom schedules", () => {
  it("starts at tomorrow morning each time the dialog opens", () => {
    expect(defaultCustomSchedule(NOON)).toEqual({
      date: formatDateInputValue(localTime(NOON, 1, 9)),
      time: "09:00",
    });
  });

  it("combines the date and time as a local wall-clock timestamp", () => {
    const target = localTime(NOON, 2, 14, 30);
    expect(
      parseCustomScheduleTime(
        { date: formatDateInputValue(target), time: "14:30" },
        NOON,
      ),
    ).toEqual({ ok: true, at: target });
  });

  it("rejects missing, impossible, and past choices", () => {
    expect(parseCustomScheduleTime({ date: "", time: "09:00" }, NOON)).toEqual({
      ok: false,
      message: "Choose a date.",
    });
    expect(
      parseCustomScheduleTime({ date: "2026-08-26", time: "" }, NOON),
    ).toEqual({ ok: false, message: "Choose a time." });
    expect(
      parseCustomScheduleTime({ date: "2026-02-30", time: "09:00" }, NOON),
    ).toEqual({ ok: false, message: "Choose a real date and time." });
    expect(
      parseCustomScheduleTime(
        { date: formatDateInputValue(NOON), time: "09:00" },
        NOON,
      ),
    ).toEqual({ ok: false, message: "Choose a future time." });
  });

  it("rejects a choice more than one year out", () => {
    const beyondLimit = NOON + MAX_SCHEDULE_AHEAD_MS + 2 * 24 * 60 * 60 * 1000;
    expect(
      parseCustomScheduleTime(
        { date: formatDateInputValue(beyondLimit), time: "12:00" },
        NOON,
      ),
    ).toEqual({ ok: false, message: "Pick a time within the next year." });
  });
});

describe("schedule confirmation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names today, tomorrow, and later dates unambiguously", () => {
    expect(formatScheduleTime(at(18), NOON)).toMatch(/^today at /);
    expect(formatScheduleTime(localTime(NOON, 1, 9), NOON)).toMatch(
      /^tomorrow at /,
    );
    const later = formatScheduleTime(localTime(NOON, 5, 9), NOON);
    expect(later).not.toMatch(/today|tomorrow/);
    expect(later).toMatch(/ at /);
  });

  it("counts local calendar days instead of elapsed hours", () => {
    const lateNight = at(23);
    expect(formatScheduleTime(localTime(lateNight, 1, 1), lateNight)).toMatch(
      /^tomorrow at /,
    );
  });

  it("formats exactly like the per-call locale APIs", () => {
    const legacyFormat = (scheduledAt: number, now: number): string => {
      const time = new Date(scheduledAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });
      const dayOffset = Math.round(
        (new Date(scheduledAt).setHours(0, 0, 0, 0) -
          new Date(now).setHours(0, 0, 0, 0)) /
          86_400_000,
      );
      if (dayOffset === 0) return `today at ${time}`;
      if (dayOffset === 1) return `tomorrow at ${time}`;
      if (dayOffset === -1) return `yesterday at ${time}`;
      const date = new Date(scheduledAt).toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year:
          new Date(scheduledAt).getFullYear() === new Date(now).getFullYear()
            ? undefined
            : "numeric",
      });
      return `${date} at ${time}`;
    };
    for (const scheduledAt of [
      at(18, 30),
      localTime(NOON, 1, 9),
      localTime(NOON, -1, 9),
      localTime(NOON, 5, 21, 45),
      localTime(NOON, 200, 7, 5),
    ]) {
      expect(formatScheduleTime(scheduledAt, NOON)).toBe(
        legacyFormat(scheduledAt, NOON),
      );
    }
  });

  it("reuses its formatters across renders", () => {
    formatScheduleTime(localTime(NOON, 5, 9), NOON);
    formatScheduleTime(localTime(NOON, 400, 9), NOON);
    formatScheduleTimeZone(NOON);
    const constructor = vi.spyOn(Intl, "DateTimeFormat");

    for (let minute = 0; minute < 5; minute += 1) {
      formatScheduleTime(localTime(NOON, 5, 9, minute), NOON);
      formatScheduleTime(localTime(NOON, 400, 9, minute), NOON);
      formatScheduleTimeZone(NOON + minute);
    }

    expect(constructor).not.toHaveBeenCalled();
  });

  it("makes the browser timezone explicit", () => {
    const label = formatScheduleTimeZone(NOON);
    expect(label).toContain("Local time");
    expect(label).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
