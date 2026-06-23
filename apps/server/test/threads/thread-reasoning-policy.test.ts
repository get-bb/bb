import { describe, expect, it } from "vitest";
import { getSupportedReasoningLevelsForProvider } from "../../src/services/threads/thread-reasoning-policy.js";

describe("getSupportedReasoningLevelsForProvider", () => {
  it("returns shared ACP reasoning levels for dynamic ACP provider ids", () => {
    expect(getSupportedReasoningLevelsForProvider("acp-my-agent")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  it("keeps unknown non-ACP providers on the soft-fail path", () => {
    expect(getSupportedReasoningLevelsForProvider("not-a-provider")).toEqual(
      [],
    );
  });
});
