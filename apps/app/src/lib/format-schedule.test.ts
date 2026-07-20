import { describe, expect, it } from "vitest";
import {
  formatScheduleStatusLabel,
  getOneShotLifecycle,
  oneShotLifecycleAllowsToggle,
} from "./format-schedule";

describe("formatScheduleStatusLabel", () => {
  it("distinguishes expired and failed one-shot automations", () => {
    const now = 2_000;
    const trigger = { triggerType: "once" as const, runAt: 1_000 };
    const expired = getOneShotLifecycle({
      enabled: false,
      trigger,
      runCount: 0,
      lastRunStatus: null,
      now,
    });

    expect(expired).toBe("expired");
    expect(oneShotLifecycleAllowsToggle(expired)).toBe(false);
    expect(
      formatScheduleStatusLabel({
        enabled: false,
        nextRunAt: null,
        trigger,
        runCount: 1,
        lastRunStatus: "failed",
        now,
      }),
    ).toBe("Failed");
  });
});
