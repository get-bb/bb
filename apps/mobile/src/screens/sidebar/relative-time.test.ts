import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./relative-time";

const NOW = Date.UTC(2026, 7, 19, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRelativeTime", () => {
  it("rounds down through the minute/hour/day buckets", () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe("now");
    expect(formatRelativeTime(NOW - MINUTE, NOW)).toBe("1m");
    expect(formatRelativeTime(NOW - 59 * MINUTE - 59_000, NOW)).toBe("59m");
    expect(formatRelativeTime(NOW - HOUR, NOW)).toBe("1h");
    expect(formatRelativeTime(NOW - 23 * HOUR - 59 * MINUTE, NOW)).toBe("23h");
    expect(formatRelativeTime(NOW - DAY, NOW)).toBe("1d");
    expect(formatRelativeTime(NOW - 6 * DAY - 23 * HOUR, NOW)).toBe("6d");
  });

  it("treats future timestamps as now (clock skew)", () => {
    expect(formatRelativeTime(NOW + 5 * MINUTE, NOW)).toBe("now");
  });

  it("falls back to a short date after a week, adding the year across years", () => {
    const sameYear = new Date(2026, 2, 4, 9).getTime();
    expect(formatRelativeTime(sameYear, NOW)).toBe("Mar 4");
    const lastYear = new Date(2025, 11, 31, 9).getTime();
    expect(formatRelativeTime(lastYear, NOW)).toBe("Dec 31, 2025");
  });
});
