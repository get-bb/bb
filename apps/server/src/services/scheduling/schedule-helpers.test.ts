import { describe, expect, it } from "vitest";
import {
  computeNextScheduledTime,
  ScheduleValidationError,
  validateScheduleDefinition,
} from "./schedule-helpers.js";

const TZ = "America/New_York";

describe("validateScheduleDefinition", () => {
  it("accepts standard 5-field cron expressions including step minutes", () => {
    for (const cron of [
      "*/5 * * * *",
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

  it("rejects schedules that run more often than every 5 minutes", () => {
    for (const cron of ["* * * * *", "*/2 * * * *"]) {
      expect(() =>
        validateScheduleDefinition({ cron, timezone: TZ }),
      ).toThrowError(
        new ScheduleValidationError(
          "Schedule must not run more frequently than every 5 minutes",
        ),
      );
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

describe("computeNextScheduledTime", () => {
  it("returns a strictly-future time for */5 * * * *", () => {
    const now = Date.UTC(2026, 0, 1, 12, 1, 30);
    const next = computeNextScheduledTime({
      cron: "*/5 * * * *",
      now,
      timezone: TZ,
    });
    expect(next).toBeGreaterThan(now);
    // Next */5 occurrence after 12:01:30 UTC is 12:05:00 UTC.
    expect(next).toBe(Date.UTC(2026, 0, 1, 12, 5, 0));
  });
});
