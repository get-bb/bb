import { describe, expect, it } from "vitest";
import { __testing } from "./provider-usage.js";

const {
  normalizeCodexUsage,
  normalizeClaudeUsage,
  normalizeCursorUsage,
  codexPlanLabel,
  claudePlanLabel,
} = __testing;

describe("normalizeCodexUsage", () => {
  it("maps primary/secondary windows and plan to the unified shape", () => {
    const primaryReset = 1_780_000_000;
    const secondaryReset = 1_780_500_000;
    const result = normalizeCodexUsage({
      plan_type: "pro",
      rate_limit: {
        primary_window: {
          used_percent: 12,
          reset_at: primaryReset,
          limit_window_seconds: 18_000,
        },
        secondary_window: {
          used_percent: 18,
          reset_at: secondaryReset,
          limit_window_seconds: 604_800,
        },
      },
      // Unknown sibling fields must be ignored, not fatal.
      credits: { has_credits: false, unlimited: false, balance: null },
    });

    expect(result).toEqual({
      status: "ok",
      planLabel: "Pro",
      windows: [
        {
          label: "Current session",
          usedPercent: 12,
          resetsAt: new Date(primaryReset * 1000).toISOString(),
        },
        {
          label: "Weekly limit",
          usedPercent: 18,
          resetsAt: new Date(secondaryReset * 1000).toISOString(),
        },
      ],
    });
  });

  it("clamps and rounds percentages and tolerates a missing reset", () => {
    const result = normalizeCodexUsage({
      plan_type: "team",
      rate_limit: {
        primary_window: { used_percent: 150.6 },
        secondary_window: { used_percent: -5 },
      },
    });

    expect(result).toEqual({
      status: "ok",
      planLabel: "Team",
      windows: [
        { label: "Current session", usedPercent: 100, resetsAt: null },
        { label: "Weekly limit", usedPercent: 0, resetsAt: null },
      ],
    });
  });

  it("returns ok with no windows when rate limits are absent", () => {
    expect(normalizeCodexUsage({ plan_type: "plus" })).toEqual({
      status: "ok",
      planLabel: "Plus",
      windows: [],
    });
  });

  it("flags a malformed payload instead of inventing numbers", () => {
    const result = normalizeCodexUsage({
      rate_limit: { primary_window: { used_percent: "lots" } },
    });
    expect(result.status).toBe("error");
  });
});

describe("normalizeClaudeUsage", () => {
  const credentials = {
    accessToken: "token",
    rateLimitTier: "default_claude_max_20x",
    subscriptionType: "max",
  };

  it("maps the session and weekly windows and derives the plan label", () => {
    const result = normalizeClaudeUsage(
      {
        five_hour: { utilization: 0, resets_at: "2026-06-19T22:00:00.000Z" },
        seven_day: { utilization: 18.4, resets_at: "2026-06-24T14:23:00.000Z" },
        // Model-specific sub-limits are intentionally ignored.
        seven_day_sonnet: { utilization: 0, resets_at: null },
      },
      credentials,
    );

    expect(result).toEqual({
      status: "ok",
      planLabel: "Max (20x)",
      windows: [
        {
          label: "Current session",
          usedPercent: 0,
          resetsAt: "2026-06-19T22:00:00.000Z",
        },
        {
          label: "Weekly limit",
          usedPercent: 18,
          resetsAt: "2026-06-24T14:23:00.000Z",
        },
      ],
    });
  });

  it("drops windows the API omits or leaves without a utilization", () => {
    const result = normalizeClaudeUsage(
      {
        five_hour: { utilization: 7, resets_at: null },
        seven_day: { resets_at: "2026-06-24T14:23:00.000Z" },
      },
      { accessToken: "token" },
    );

    expect(result).toEqual({
      status: "ok",
      planLabel: null,
      windows: [{ label: "Current session", usedPercent: 7, resetsAt: null }],
    });
  });
});

describe("normalizeCursorUsage", () => {
  it("uses Cursor's explicit plan percentage instead of its spend ratio", () => {
    const billingCycleEnd = 1_784_391_684_000;
    const result = normalizeCursorUsage(
      {
        billingCycleEnd: String(billingCycleEnd),
        planUsage: {
          totalSpend: 1_439,
          includedSpend: 1_439,
          remaining: 561,
          limit: 2_000,
          totalPercentUsed: 4.171014492753623,
        },
        spendLimitUsage: {
          individualLimit: 5_000,
          individualUsed: 1_250,
          individualRemaining: 3_750,
          limitType: "user",
        },
      },
      {
        planInfo: {
          planName: "Pro",
          includedAmountCents: 2_000,
        },
      },
    );

    expect(result).toEqual({
      status: "ok",
      planLabel: "Pro",
      windows: [
        {
          label: "Plan usage",
          usedPercent: 4,
          resetsAt: new Date(billingCycleEnd).toISOString(),
        },
        {
          label: "On-demand spend",
          usedPercent: 25,
          resetsAt: new Date(billingCycleEnd).toISOString(),
          cost: {
            usedUsdCents: 1_250,
            limitUsdCents: 5_000,
          },
        },
      ],
    });
  });

  it("uses a zero spend when Cursor omits a zero-valued usage field", () => {
    const result = normalizeCursorUsage(
      {
        planUsage: { limit: 2_000 },
        spendLimitUsage: { individualLimit: 5_000 },
      },
      {},
    );

    expect(result).toEqual({
      status: "ok",
      planLabel: null,
      windows: [
        {
          label: "Plan usage",
          usedPercent: 0,
          resetsAt: null,
        },
        {
          label: "On-demand spend",
          usedPercent: 0,
          resetsAt: null,
          cost: {
            usedUsdCents: 0,
            limitUsdCents: 5_000,
          },
        },
      ],
    });
  });

  it("flags malformed Cursor usage without requiring plan metadata", () => {
    expect(normalizeCursorUsage({ planUsage: "a lot" }, {}).status).toBe(
      "error",
    );
  });
});

describe("plan labels", () => {
  it("derives codex plan labels", () => {
    expect(codexPlanLabel("pro")).toBe("Pro");
    expect(codexPlanLabel("free_workspace")).toBe("Free_workspace");
    expect(codexPlanLabel(null)).toBeNull();
  });

  it("derives claude plan labels from the rate-limit tier first", () => {
    expect(claudePlanLabel({ accessToken: "t", rateLimitTier: "max_5x" })).toBe(
      "Max (5x)",
    );
    expect(claudePlanLabel({ accessToken: "t", subscriptionType: "pro" })).toBe(
      "Pro",
    );
    expect(claudePlanLabel({ accessToken: "t" })).toBeNull();
  });
});
