import { describe, expect, it } from "vitest";
import {
  computeNextScheduledTime,
  ScheduleValidationError,
  validateOnceDefinition,
  validateScheduleDefinition,
} from "./schedule-helpers.js";

const TZ = "America/New_York";

describe("validateScheduleDefinition", () => {
  it("accepts standard 5-field cron expressions including step minutes", () => {
    for (const cron of [
      "*/5 * * * *",
      "* * * * *",
      "*/2 * * * *",
      "*/15 * * * *",
      "0 9 * * 1-5",
      "0 * * * *",
      "30 8,17 * * *",
    ]) {
      expect(() =>
        validateScheduleDefinition({ cron, timezone: TZ }),
      ).not.toThrow();
    }
  });

  it("rejects expressions without exactly 5 fields", () => {
    expect(() =>
      validateScheduleDefinition({ cron: "0 * * *", timezone: TZ }),
    ).toThrow(ScheduleValidationError);
    expect(() =>
      validateScheduleDefinition({ cron: "0 0 * * * *", timezone: TZ }),
    ).toThrow(ScheduleValidationError);
  });

  it("rejects an invalid timezone", () => {
    expect(() =>
      validateScheduleDefinition({ cron: "0 9 * * *", timezone: "Not/AZone" }),
    ).toThrowError(new ScheduleValidationError("Invalid timezone"));
  });

  it("rejects unparseable cron syntax", () => {
    expect(() =>
      validateScheduleDefinition({ cron: "0 99 * * *", timezone: TZ }),
    ).toThrow(ScheduleValidationError);
  });
});

describe("validateOnceDefinition", () => {
  it("accepts a future one-shot run time", () => {
    expect(() =>
      validateOnceDefinition({ runAt: 2_000, now: 1_000 }),
    ).not.toThrow();
  });

  it("rejects a past or immediate one-shot run time", () => {
    expect(() =>
      validateOnceDefinition({ runAt: 1_000, now: 1_000 }),
    ).toThrowError(
      new ScheduleValidationError("One-shot run time must be in the future"),
    );
  });
});

describe("computeNextScheduledTime", () => {
  it("returns a strictly-future time for every-minute cron", () => {
    const now = Date.UTC(2026, 0, 1, 12, 1, 30);
    const next = computeNextScheduledTime({
      cron: "* * * * *",
      now,
      timezone: TZ,
    });
    expect(next).toBeGreaterThan(now);
    expect(next).toBe(Date.UTC(2026, 0, 1, 12, 2, 0));
  });
});
