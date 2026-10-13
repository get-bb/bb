import { describe, expect, it } from "vitest";
import {
  formatAutomationTrigger,
  formatDetailScheduleStatusLabel,
  formatOverviewScheduleMetadata,
  formatScheduleStatusLabel,
  getOneShotLifecycle,
  matchesAutomationStatusFilters,
  oneShotLifecycleAllowsToggle,
} from "../lib/format-schedule.js";

describe("automation schedule cadence", () => {
  it.each([
    ["*/5 9-17 * * *", "Every 5 min, 9AM-5:59PM"],
    ["0 9-17 * * 1-5", "Every hour, 9AM-5PM Mon-Fri"],
    ["15 9-17 * * *", "15 min past the hour, 9AM-5:59PM"],
    ["0 0-2 * * *", "Every hour, 12AM-2AM"],
    ["0 9,17 * * 1,3,5", "9AM, 5PM Mon, Wed, Fri"],
    ["30 9,12,17 * * *", "9:30AM, 12:30PM, 5:30PM"],
    ["10-20 * * * *", "Minutes 10-20 past the hour"],
    ["*/5 * * * *", "Every 5 min"],
    ["0 9 * * 1-5", "9AM Mon-Fri"],
    ["invalid", "Custom schedule"],
  ])("formats %s as %s", (cron, expected) => {
    expect(
      formatAutomationTrigger({
        triggerType: "schedule",
        cron,
        timezone: "UTC",
      }),
    ).toBe(expected);
  });

  it("formats one-shot schedules", () => {
    expect(formatAutomationTrigger({ triggerType: "once", runAt: 2_000 })).toBe(
      "One time",
    );
  });
});

const NOW = 2_000;

describe("automation list and detail states", () => {
  it("omits paused detail metadata without hiding an active next run", () => {
    const pausedSchedule = {
      enabled: false,
      nextRunAt: null,
      trigger: {
        triggerType: "schedule" as const,
        cron: "0 * * * *",
        timezone: "UTC",
      },
      now: NOW,
    };

    expect(formatDetailScheduleStatusLabel(pausedSchedule)).toBeNull();
    expect(
      formatDetailScheduleStatusLabel({
        ...pausedSchedule,
        enabled: true,
        nextRunAt: NOW + 60_000,
      }),
    ).toMatch(/^Next /);
  });

  it("filters active versus paused automations", () => {
    expect(
      matchesAutomationStatusFilters({ enabled: true, nextRunAt: NOW }, []),
    ).toBe(true);
    expect(
      matchesAutomationStatusFilters({ enabled: true, nextRunAt: NOW }, [
        "active",
      ]),
    ).toBe(true);
    expect(
      matchesAutomationStatusFilters({ enabled: false, nextRunAt: null }, [
        "paused",
      ]),
    ).toBe(true);
    expect(
      matchesAutomationStatusFilters(
        {
          enabled: false,
          nextRunAt: null,
          trigger: { triggerType: "once", runAt: NOW - 1 },
          runCount: 1,
          lastRunStatus: "running",
          now: NOW,
        },
        ["active"],
      ),
    ).toBe(true);
    expect(
      matchesAutomationStatusFilters(
        {
          enabled: false,
          nextRunAt: null,
          trigger: { triggerType: "once", runAt: NOW - 1 },
          runCount: 1,
          lastRunStatus: "succeeded",
          now: NOW,
        },
        ["paused"],
      ),
    ).toBe(true);
    expect(
      matchesAutomationStatusFilters(
        {
          enabled: false,
          nextRunAt: null,
          trigger: { triggerType: "once", runAt: NOW - 1 },
          runCount: 0,
          lastRunStatus: null,
          now: NOW,
        },
        ["paused"],
      ),
    ).toBe(false);
    expect(
      matchesAutomationStatusFilters({ enabled: false, nextRunAt: null }, [
        "active",
        "paused",
      ]),
    ).toBe(true);
  });
});

describe("one-shot automation lifecycle", () => {
  it("omits row state repeated by icons or controls and separates the next-run label", () => {
    expect(
      formatOverviewScheduleMetadata({
        enabled: false,
        nextRunAt: null,
        trigger: { triggerType: "once", runAt: NOW - 1_000 },
        runCount: 1,
        lastRunStatus: "failed",
        now: NOW,
      }),
    ).toBeNull();

    expect(
      formatOverviewScheduleMetadata({
        enabled: false,
        nextRunAt: null,
        trigger: { triggerType: "once", runAt: NOW - 1_000 },
        runCount: 1,
        lastRunStatus: "succeeded",
        now: NOW,
      }),
    ).toBeNull();

    expect(
      formatOverviewScheduleMetadata({
        enabled: false,
        nextRunAt: NOW + 60_000,
        trigger: {
          triggerType: "schedule",
          cron: "0 * * * *",
          timezone: "UTC",
        },
        now: NOW,
      }),
    ).toBeNull();

    expect(
      formatOverviewScheduleMetadata({
        enabled: false,
        nextRunAt: null,
        trigger: { triggerType: "once", runAt: NOW - 1 },
        runCount: 0,
        lastRunStatus: null,
        now: NOW,
      }),
    ).toBeNull();

    const next = formatOverviewScheduleMetadata({
      enabled: true,
      nextRunAt: NOW + 60_000,
      trigger: {
        triggerType: "schedule",
        cron: "0 * * * *",
        timezone: "UTC",
      },
      now: NOW,
    });
    expect(next?.isNextRun).toBe(true);
    expect(next?.text).not.toContain("Next");
  });

  it("allows pausing a scheduled run and resuming a future paused run", () => {
    const trigger = { triggerType: "once" as const, runAt: NOW + 1_000 };

    expect(
      getOneShotLifecycle({
        enabled: true,
        trigger,
        runCount: 0,
        lastRunStatus: null,
        now: NOW,
      }),
    ).toBe("scheduled");
    expect(
      getOneShotLifecycle({
        enabled: false,
        trigger,
        runCount: 0,
        lastRunStatus: null,
        now: NOW,
      }),
    ).toBe("paused");
    expect(oneShotLifecycleAllowsToggle("scheduled")).toBe(true);
    expect(oneShotLifecycleAllowsToggle("paused")).toBe(true);
  });

  it("locks a paused run once its deadline has expired", () => {
    const trigger = { triggerType: "once" as const, runAt: NOW - 1 };
    const lifecycle = getOneShotLifecycle({
      enabled: false,
      trigger,
      runCount: 0,
      lastRunStatus: null,
      now: NOW,
    });

    expect(lifecycle).toBe("expired");
    expect(oneShotLifecycleAllowsToggle(lifecycle)).toBe(false);
    expect(
      formatScheduleStatusLabel({
        enabled: false,
        nextRunAt: null,
        trigger,
        runCount: 0,
        lastRunStatus: null,
        now: NOW,
      }),
    ).toBe("Expired — edit to reschedule");
  });

  it.each([
    ["running", "running", "Running"],
    ["succeeded", "completed", "Completed"],
    ["failed", "failed", "Failed"],
    ["skipped", "skipped", "Skipped"],
  ] as const)(
    "shows a terminal %s run truthfully",
    (lastRunStatus, expectedLifecycle, expectedLabel) => {
      const trigger = { triggerType: "once" as const, runAt: NOW - 1 };
      const lifecycle = getOneShotLifecycle({
        enabled: false,
        trigger,
        runCount: 1,
        lastRunStatus,
        now: NOW,
      });

      expect(lifecycle).toBe(expectedLifecycle);
      expect(oneShotLifecycleAllowsToggle(lifecycle)).toBe(false);
      expect(
        formatScheduleStatusLabel({
          enabled: false,
          nextRunAt: null,
          trigger,
          runCount: 1,
          lastRunStatus,
          now: NOW,
        }),
      ).toBe(expectedLabel);
    },
  );
});
