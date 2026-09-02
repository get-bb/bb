import { describe, expect, it } from "vitest";
import {
  cleanup,
  createTestRuntime,
} from "./test/runtime-integration-harness.js";

describe("RAPP provider artifact", () => {
  it("lists the deterministic Business Grail model without a live Brainstem", async () => {
    const ctx = createTestRuntime("rapp");
    try {
      await expect(
        ctx.runtime.listModels({ providerId: "rapp" }),
      ).resolves.toMatchObject({
        models: [
          {
            id: "business-grail",
            isDefault: true,
            model: "business-grail",
          },
        ],
      });
    } finally {
      await ctx.runtime.shutdown();
      cleanup(ctx);
    }
  });
});
