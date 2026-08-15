import { describe, expect, it } from "vitest";
import { createTestProviderRegistry } from "../helpers/provider-registry.js";
import { getSupportedReasoningLevelsForProvider } from "../../src/services/threads/thread-reasoning-policy.js";

const registry = await createTestProviderRegistry();

describe("getSupportedReasoningLevelsForProvider", () => {
  it("returns shared ACP reasoning levels for dynamic ACP provider ids", () => {
    expect(
      getSupportedReasoningLevelsForProvider(registry, "acp-my-agent"),
    ).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("keeps unknown non-ACP providers on the soft-fail path", () => {
    expect(
      getSupportedReasoningLevelsForProvider(registry, "not-a-provider"),
    ).toEqual([]);
  });
});
