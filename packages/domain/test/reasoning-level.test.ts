import { describe, expect, it } from "vitest";
import { reconcileReasoningLevel } from "../src/reasoning-level.js";

describe("reconcileReasoningLevel", () => {
  it("reconciles ultracode down to xhigh on a model without ultracode", () => {
    // Rank order is load-bearing: ultracode sits between xhigh and max so a
    // model switch lands on its true underlying effort (xhigh), not max.
    expect(
      reconcileReasoningLevel("ultracode", [
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]),
    ).toBe("xhigh");
  });

  it("keeps ultracode when the new model supports it", () => {
    expect(
      reconcileReasoningLevel("ultracode", ["xhigh", "ultracode", "max"]),
    ).toBe("ultracode");
  });


  it("keeps the previous level when the new model supports it", () => {
    expect(
      reconcileReasoningLevel("high", ["low", "medium", "high", "xhigh", "max"]),
    ).toBe("high");
  });

  it("picks the closest lower level when the previous was the absolute max", () => {
    // Max → no Max in new model → pick the next-highest (xhigh).
    expect(
      reconcileReasoningLevel("max", ["low", "medium", "high", "xhigh"]),
    ).toBe("xhigh");
  });

  it("breaks ties by preferring the higher level", () => {
    // Medium (rank 2) — supported {low(1), high(3)} both at distance 1.
    // Prefer the higher one (high).
    expect(reconcileReasoningLevel("medium", ["low", "high"])).toBe("high");
  });

  it("picks the closest level upward when nothing is below the previous", () => {
    // Low (rank 1) — supported {high(3), max(5)}; closest is high (distance 2).
    expect(reconcileReasoningLevel("low", ["high", "max"])).toBe("high");
  });

  it("picks the closest level downward when nothing is above the previous", () => {
    // Max (rank 5) — supported {low(1), medium(2)}; closest is medium (distance 3).
    expect(reconcileReasoningLevel("max", ["low", "medium"])).toBe("medium");
  });

  it("handles a single supported level", () => {
    expect(reconcileReasoningLevel("max", ["low"])).toBe("low");
  });

  it("throws when supported is empty", () => {
    expect(() => reconcileReasoningLevel("medium", [])).toThrow();
  });
});
