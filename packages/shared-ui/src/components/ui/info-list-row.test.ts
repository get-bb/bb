import { describe, expect, it } from "vitest";
import { formatCompactRelativeTime } from "./info-list-row";

const NOW = 1_700_000_000_000;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatCompactRelativeTime", () => {
  it.each([
    { ago: 30 * 1000, expected: "now" },
    { ago: 5 * MINUTE, expected: "5m" },
    { ago: 5 * HOUR, expected: "5h" },
    { ago: 3 * DAY, expected: "3d" },
    { ago: 15 * DAY, expected: "2w" },
  ])("shows $expected for a timestamp $ago ms old", ({ ago, expected }) => {
    expect(formatCompactRelativeTime({ timestamp: NOW - ago, now: NOW })).toBe(
      expected,
    );
  });

  it("includes the year only for dates before the current year", () => {
    const now = new Date(2026, 10, 2).getTime();
    const previousYear = new Date(2025, 9, 4);
    const currentYear = new Date(2026, 8, 4);
    expect(
      formatCompactRelativeTime({ timestamp: previousYear.getTime(), now }),
    ).toBe(
      previousYear.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    );
    expect(
      formatCompactRelativeTime({ timestamp: currentYear.getTime(), now }),
    ).toBe(
      currentYear.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
    );
  });
});
