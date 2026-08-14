import { describe, expect, it } from "vitest";
import { createProviderRegistryService } from "../../src/services/providers/provider-registry.js";
import { getSupportedReasoningLevelsForProvider } from "../../src/services/threads/thread-reasoning-policy.js";

const registry = createProviderRegistryService();

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
