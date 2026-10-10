import { describe, expect, it } from "vitest";
import {
  calculateContextWindowUsagePercent,
  formatUsageCost,
} from "./thread-context-window-usage";

describe("calculateContextWindowUsagePercent", () => {
  it.each([
    { usedTokens: 1000, modelContextWindow: 10000, expected: 10 },
    { usedTokens: 1234, modelContextWindow: 10000, expected: 12 },
    { usedTokens: 15000, modelContextWindow: 10000, expected: 100 },
    { usedTokens: 1000, modelContextWindow: 0, expected: 0 },
  ])(
    "reports $usedTokens of $modelContextWindow tokens as $expected%",
    ({ usedTokens, modelContextWindow, expected }) => {
      expect(
        calculateContextWindowUsagePercent({
          usedTokens,
          modelContextWindow,
          estimated: false,
        }),
      ).toBe(expected);
    },
  );
});

describe("formatUsageCost", () => {
  it("formats a reported session cost with two decimals", () => {
    expect(formatUsageCost({ amount: 1.5, currency: "USD" })).toMatch(/1\.50/);
  });
});
