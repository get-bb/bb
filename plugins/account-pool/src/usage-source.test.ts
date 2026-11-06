import { describe, expect, it } from "vitest";
import { usagePlan, usageWindowLabel } from "./usage-source.js";

describe("usage presentation labels", () => {
  it("names known windows consistently and retains other durations", () => {
    expect(usageWindowLabel(10_080, "primary")).toBe("Weekly limit");
    expect(usageWindowLabel(300, "secondary")).toBe("Five-hour limit");
    expect(usageWindowLabel(1_440, "primary")).toBe("Daily limit");
    expect(usageWindowLabel(2_880, "primary")).toBe("2 day limit");
    expect(usageWindowLabel(null, "Custom limit")).toBe("Custom limit");
  });
  it("names Claude plans after the Max and Ultra rename", () => {
    expect(
      usagePlan({
        subscriptionType: "max",
        rateLimitTier: "default_claude_max_20x",
      }),
    ).toEqual({ id: "ultra", label: "Ultra" });
    expect(
      usagePlan({
        subscriptionType: "max",
        rateLimitTier: "default_claude_max_5x",
      }),
    ).toEqual({ id: "max", label: "Max" });
    expect(usagePlan({ subscriptionType: "max", rateLimitTier: null })).toEqual(
      { id: "max", label: "Max" },
    );
    expect(usagePlan({ subscriptionType: "pro", rateLimitTier: null })).toEqual(
      { id: "pro", label: "Pro" },
    );
    expect(
      usagePlan({ subscriptionType: null, rateLimitTier: null }),
    ).toBeNull();
  });
});
