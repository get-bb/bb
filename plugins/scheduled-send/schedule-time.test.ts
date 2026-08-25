// Time parsing is the whole of this plugin's logic: everything else is one SDK
// call. Expected values are built with local `Date` arithmetic rather than
// literals so the suite means the same thing in every timezone.
import { describe, expect, it } from "vitest";
import {
  formatScheduleTime,
  listSchedulePresets,
  MAX_SCHEDULE_AHEAD_MS,
  parseScheduleTime,
} from "./schedule-time";

/** Local wall-clock helper mirroring what a user means by "9am tomorrow". */
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

function parsed(value: string, now = NOON): number {
  const result = parseScheduleTime(value, now);
  if (!result.ok) throw new Error(`expected a time, got: ${result.message}`);
  return result.at;
}

function rejection(value: string, now = NOON): string {
  const result = parseScheduleTime(value, now);
  if (result.ok) {
    throw new Error(
      `expected a rejection, got ${new Date(result.at).toISOString()}`,
    );
  }
  return result.message;
}

describe("listSchedulePresets", () => {
  it("offers this evening and tomorrow morning at local wall-clock times", () => {
    expect(listSchedulePresets(NOON)).toEqual([
      { id: "in-1-hour", label: "In 1 hour", at: NOON + 60 * 60 * 1000 },
      { id: "this-evening", label: "This evening", at: at(18) },
      {
        id: "tomorrow-morning",
        label: "Tomorrow morning",
        at: localTime(NOON, 1, 9),
      },
    ]);
  });

  it("drops this evening once the evening has passed", () => {
    const lateNight = at(23, 30);
    expect(listSchedulePresets(lateNight).map((preset) => preset.id)).toEqual([
      "in-1-hour",
      "tomorrow-morning",
    ]);
  });

  it("keeps tomorrow morning ahead of a pre-dawn now", () => {
    const preDawn = at(3);
    const tomorrowMorning = listSchedulePresets(preDawn).find(
      (preset) => preset.id === "tomorrow-morning",
    );
    // 9am *tomorrow*, not the 9am six hours from now — "tomorrow" is a day,
    // not a duration.
    expect(tomorrowMorning?.at).toBe(localTime(preDawn, 1, 9));
  });
});

describe("parseScheduleTime durations", () => {
  it("accepts the CLI's compact units", () => {
    expect(parsed("30s")).toBe(NOON + 30_000);
    expect(parsed("10m")).toBe(NOON + 10 * 60_000);
    expect(parsed("2h")).toBe(NOON + 2 * 3_600_000);
    expect(parsed("7d")).toBe(NOON + 7 * 86_400_000);
  });

  it("accepts spelled-out units, spacing, and a leading 'in'", () => {
    const ninetyMinutes = NOON + 90 * 60_000;
    expect(parsed("90 minutes")).toBe(ninetyMinutes);
    expect(parsed("in 90 min")).toBe(ninetyMinutes);
    expect(parsed("  IN   90   Mins  ")).toBe(ninetyMinutes);
  });

  it("accepts fractional durations", () => {
    expect(parsed("1.5h")).toBe(NOON + 90 * 60_000);
  });

  it("rejects a zero duration as already passed", () => {
    expect(rejection("0m")).toMatch(/already passed/);
  });
});

describe("parseScheduleTime clock times", () => {
  it("resolves a 12-hour time to today when it is still ahead", () => {
    expect(parsed("6pm")).toBe(at(18));
    expect(parsed("6:30 PM")).toBe(at(18, 30));
  });

  it("rolls a time that has already passed today to tomorrow", () => {
    // 9am at noon means tomorrow's 9am: the user is scheduling, not erroring.
    expect(parsed("9am")).toBe(localTime(NOON, 1, 9));
  });

  it("reads a colon time without a meridiem as 24-hour", () => {
    expect(parsed("14:30")).toBe(at(14, 30));
    expect(parsed("23:59")).toBe(at(23, 59));
  });

  it("handles the midnight and noon meridiem corners", () => {
    expect(parsed("12am")).toBe(localTime(NOON, 1, 0));
    expect(parsed("12:30pm")).toBe(at(12, 30));
  });

  it("honors an explicit day prefix", () => {
    expect(parsed("tomorrow 9am")).toBe(localTime(NOON, 1, 9));
    expect(parsed("tomorrow at 09:30")).toBe(localTime(NOON, 1, 9, 30));
    expect(parsed("today 6pm")).toBe(at(18));
  });

  it("fills in a time of day for a bare day word", () => {
    expect(parsed("tomorrow")).toBe(localTime(NOON, 1, 9));
    expect(parsed("tonight")).toBe(at(18));
  });

  it("rejects an explicit today that has already passed", () => {
    expect(rejection("today 9am")).toMatch(/already passed/);
  });

  it("rejects a bare number as ambiguous", () => {
    // "9" is 9am, 9pm, and nine minutes to three different people.
    expect(rejection("9")).toMatch(/Try a duration/);
  });

  it("rejects impossible clock values", () => {
    expect(rejection("25:00")).toMatch(/Try a duration/);
    expect(rejection("13pm")).toMatch(/Try a duration/);
    expect(rejection("10:75")).toMatch(/Try a duration/);
  });
});

describe("parseScheduleTime timestamps", () => {
  it("accepts a local ISO date-time, with a space or a T", () => {
    const expected = new Date(2026, 7, 26, 9, 0, 0, 0).getTime();
    expect(parsed("2026-08-26T09:00")).toBe(expected);
    expect(parsed("2026-08-26 09:00")).toBe(expected);
  });

  it("accepts an explicit offset", () => {
    expect(parsed("2026-08-26T09:00:00Z")).toBe(
      Date.parse("2026-08-26T09:00:00Z"),
    );
  });

  it("rejects a bare date because midnight where is ambiguous", () => {
    expect(rejection("2026-08-26")).toMatch(/no time of day/);
  });

  it("rejects an unparseable value", () => {
    expect(rejection("")).toMatch(/Enter a time/);
    expect(rejection("next tuesday")).toMatch(/Try a duration/);
  });
});

describe("parseScheduleTime bounds", () => {
  it("rejects a past timestamp", () => {
    expect(rejection("2020-01-01T09:00")).toMatch(/already passed/);
  });

  it("rejects a schedule more than a year out", () => {
    expect(rejection("400d")).toMatch(/within the next year/);
    // The boundary itself is still allowed.
    expect(parsed("365d")).toBe(NOON + MAX_SCHEDULE_AHEAD_MS);
  });
});

describe("formatScheduleTime", () => {
  it("names today and tomorrow in words", () => {
    expect(formatScheduleTime(at(18), NOON)).toMatch(/^today at /);
    expect(formatScheduleTime(localTime(NOON, 1, 9), NOON)).toMatch(
      /^tomorrow at /,
    );
  });

  it("dates anything further out", () => {
    const formatted = formatScheduleTime(localTime(NOON, 5, 9), NOON);
    expect(formatted).not.toMatch(/today|tomorrow/);
    expect(formatted).toMatch(/ at /);
  });

  it("counts calendar days, not elapsed hours", () => {
    // 11pm to 1am is two hours but a different day, and calling that "today"
    // would be a lie the user acts on.
    const lateNight = at(23);
    expect(formatScheduleTime(localTime(lateNight, 1, 1), lateNight)).toMatch(
      /^tomorrow at /,
    );
  });
});
