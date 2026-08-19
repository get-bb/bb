import { describe, expect, it } from "vitest";
import { __testing } from "./provider-maintenance.js";

describe("Claude Code provider maintenance", () => {
  it("normalizes aggregate and unique model-scoped usage windows", () => {
    const credentials = {
      accessToken: "token",
      expiresAt: null,
      subscriptionType: "pro",
      rateLimitTier: "max_5x",
    };
    expect(
      __testing.normalizeUsage(
        {
          five_hour: { utilization: 12.4, resets_at: "2026-01-02T03:04:05Z" },
          seven_day: { utilization: 55, resets_at: null },
          limits: [
            {
              kind: "weekly_scoped",
              scope: { model: { display_name: "Sonnet" } },
              percent: 30,
              resets_at: "2026-01-03T00:00:00Z",
            },
            {
              kind: "weekly_scoped",
              scope: { model: { display_name: "sonnet" } },
              percent: 80,
              resets_at: null,
            },
          ],
        },
        credentials,
        "claude@example.com",
      ),
    ).toMatchObject({
      status: "ok",
      accountEmail: "claude@example.com",
      planLabel: "Max (5x)",
      windows: [
        { label: "Current session", usedPercent: 12 },
        { label: "Weekly limit", usedPercent: 55 },
        { label: "Sonnet", usedPercent: 30 },
      ],
    });
  });
});
