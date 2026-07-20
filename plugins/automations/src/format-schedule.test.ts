import { describe, expect, it } from "vitest";
import {
  formatScheduleStatusLabel,
  getOneShotLifecycle,
  oneShotLifecycleAllowsToggle,
} from "../lib/format-schedule.js";

const NOW = 2_000;

describe("one-shot automation lifecycle", () => {
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
