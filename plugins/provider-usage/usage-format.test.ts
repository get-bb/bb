import { describe, expect, it } from "vitest";
import { describeUsagePace, usageWindowPace } from "./usage-format.js";

const HOUR = 60 * 60_000;
const NOW = Date.parse("2026-11-21T12:00:00.000Z");

function window(
  kind: "five-hour" | "daily" | "weekly" | "custom",
  usedPercent: number,
  resetsInMs: number | null,
) {
  return {
    kind,
    usedPercent,
    resetsAt:
      resetsInMs === null ? null : new Date(NOW + resetsInMs).toISOString(),
  };
}

describe("usageWindowPace", () => {
  it.each([
    [
      "ahead when use runs past time",
      window("five-hour", 80, 2.5 * HOUR),
      50,
      "ahead",
    ],
    ["on pace within 5 points", window("five-hour", 53, 2.5 * HOUR), 50, "on"],
    [
      "on pace when the shown numbers are 5 apart",
      window("five-hour", 55.4, 2.5 * HOUR),
      50,
      "on",
    ],
    [
      "under when time runs past use",
      window("weekly", 10, 3.5 * 24 * HOUR),
      50,
      "under",
    ],
    ["a daily window", window("daily", 25, 18 * HOUR), 25, "on"],
  ] as const)("is %s", (_, value, elapsedPercent, pace) => {
    expect(usageWindowPace(value, NOW)).toMatchObject({ elapsedPercent, pace });
  });

  it.each([
    ["a custom window", window("custom", 50, HOUR)],
    ["an unknown reset", window("weekly", 50, null)],
    ["a reset in the past", window("weekly", 100, -HOUR)],
    ["a reset farther away than the window", window("five-hour", 10, 6 * HOUR)],
  ])("has no pace for %s", (_, value) => {
    expect(usageWindowPace(value, NOW)).toBeNull();
  });
});

describe("describeUsagePace", () => {
  it("projects the run-out time when use is ahead of pace", () => {
    const pace = usageWindowPace(window("five-hour", 80, 2.5 * HOUR), NOW);
    if (pace === null) throw new Error("expected a pace");
    const [gap, projection] = describeUsagePace(pace);
    expect(gap).toBe("30 pts ahead of pace");
    expect(projection).toMatch(/^Runs out .+ · 1h 53m without quota$/);
  });

  it("says the quota lasts when use is under pace", () => {
    const pace = usageWindowPace(window("weekly", 10, 3.5 * 24 * HOUR), NOW);
    if (pace === null) throw new Error("expected a pace");
    expect(describeUsagePace(pace)).toEqual([
      "40 pts under pace",
      "Lasts until reset",
    ]);
  });

  it("gives no pace in the first 5% of a window", () => {
    expect(
      usageWindowPace(window("weekly", 1, 6.9 * 24 * HOUR), NOW),
    ).toBeNull();
  });
});
