import { describe, expect, it } from "vitest";
import { __testing } from "./provider-maintenance.js";

describe("Codex provider maintenance", () => {
  it("normalizes subscription windows and plan labels at the plugin boundary", () => {
    expect(
      __testing.normalizeUsage(
        {
          plan_type: "plus",
          rate_limit: {
            primary_window: {
              used_percent: 42.4,
              reset_at: 1_750_000_000,
              limit_window_seconds: 18_000,
            },
            secondary_window: {
              used_percent: 120,
              reset_at: null,
              limit_window_seconds: 604_800,
            },
          },
        },
        "codex@example.com",
      ),
    ).toEqual({
      status: "ok",
      accountEmail: "codex@example.com",
      planLabel: "Plus",
      windows: [
        {
          label: "Current session",
          usedPercent: 42,
          resetsAt: "2025-06-15T15:06:40.000Z",
        },
        { label: "Weekly limit", usedPercent: 100, resetsAt: null },
      ],
    });
  });

  it("compares the numeric core of CLI versions", () => {
    expect(__testing.compareVersions("0.135.9", "0.136.0")).toBeLessThan(0);
    expect(__testing.compareVersions("0.136.0-beta.1", "0.136.0")).toBeLessThan(
      0,
    );
    expect(__testing.compareVersions("1.0.0", "0.136.0")).toBeGreaterThan(0);
  });
});
