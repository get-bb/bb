import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime, formatScheduledTime } from "./relative-time";

const NOW = 1_700_000_000_000;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatScheduledTime", () => {
  beforeEach(() => {
    vi.stubEnv("TZ", "America/Los_Angeles");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    { month: 2, day: 8, hours: 23 },
    { month: 10, day: 1, hours: 25 },
  ])("uses calendar dates on a $hours-hour day", ({ month, day, hours }) => {
    const start = new Date(2026, month, day);
    const next = new Date(2026, month, day + 1);
    expect((next.getTime() - start.getTime()) / HOUR).toBe(hours);

    const now = new Date(2026, month, day, 12).getTime();
    for (const [offset, hour, minute, prefix] of [
      [0, 23, 30, ""],
      [1, 0, 0, "Tomorrow "],
      [1, 0, 30, "Tomorrow "],
      [1, 9, 0, "Tomorrow "],
      [1, 23, 30, "Tomorrow "],
    ] as const) {
      const target = new Date(2026, month, day + offset, hour, minute);
      const clock = target.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
      expect(formatScheduledTime({ timestamp: target.getTime(), now })).toBe(
        `${prefix}${clock}`,
      );
    }

    for (const offset of [-1, 2]) {
      const target = new Date(2026, month, day + offset, 0, 30);
      const date = target.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      const clock = target.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
      expect(formatScheduledTime({ timestamp: target.getTime(), now })).toBe(
        `${date} ${clock}`,
      );
    }
  });
});

describe("formatRelativeTime", () => {
  it("collapses sub-minute and future gaps to 'just now'", () => {
    expect(formatRelativeTime({ timestamp: NOW, now: NOW })).toBe("just now");
    expect(formatRelativeTime({ timestamp: NOW - 30 * 1000, now: NOW })).toBe(
      "just now",
    );
    expect(formatRelativeTime({ timestamp: NOW + 5 * 1000, now: NOW })).toBe(
      "just now",
    );
  });

  it("renders minutes and hours", () => {
    expect(formatRelativeTime({ timestamp: NOW - 2 * MINUTE, now: NOW })).toBe(
      "2m ago",
    );
    expect(formatRelativeTime({ timestamp: NOW - 59 * MINUTE, now: NOW })).toBe(
      "59m ago",
    );
    expect(formatRelativeTime({ timestamp: NOW - 3 * HOUR, now: NOW })).toBe(
      "3h ago",
    );
  });

  it("renders Yesterday, days, and weeks", () => {
    expect(formatRelativeTime({ timestamp: NOW - 25 * HOUR, now: NOW })).toBe(
      "Yesterday",
    );
    expect(formatRelativeTime({ timestamp: NOW - 2 * DAY, now: NOW })).toBe(
      "2d ago",
    );
    expect(formatRelativeTime({ timestamp: NOW - 6 * DAY, now: NOW })).toBe(
      "6d ago",
    );
    expect(formatRelativeTime({ timestamp: NOW - 14 * DAY, now: NOW })).toBe(
      "2w ago",
    );
  });

  it("falls back to a short absolute date beyond a few weeks", () => {
    const timestamp = NOW - 60 * DAY;
    expect(formatRelativeTime({ timestamp, now: NOW })).toBe(
      new Date(timestamp).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
    );
  });
});
