import { describe, expect, it } from "vitest";
import { createTestProviderRegistry } from "../helpers/provider-registry.js";
import { getSupportedReasoningLevelsForProvider } from "../../src/services/threads/thread-reasoning-policy.js";

const registry = await createTestProviderRegistry();

describe("getSupportedReasoningLevelsForProvider", () => {
  it("keeps unknown non-ACP providers on the soft-fail path", () => {
    expect(
      getSupportedReasoningLevelsForProvider(registry, "not-a-provider"),
    ).toEqual([]);
  });
});
