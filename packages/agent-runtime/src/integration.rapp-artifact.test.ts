import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  cleanup,
  createTestRuntime,
} from "./test/runtime-integration-harness.js";
import {
  INTEGRATION_RAPP_MODEL_IDS,
  INTEGRATION_RAPP_MODEL_REQUEST_PATH,
} from "./test/integration-provider-bridges.js";

describe("RAPP provider artifact", () => {
  it("loads the deterministic Consumer catalog from the fake Brainstem", async () => {
    const ctx = createTestRuntime("rapp");
    try {
      const result = await ctx.runtime.listModels({ providerId: "rapp" });
      expect(
        result.models.map((model) => ({
          id: model.id,
          isDefault: model.isDefault,
        })),
      ).toEqual([
        { id: INTEGRATION_RAPP_MODEL_IDS[0], isDefault: true },
        { id: INTEGRATION_RAPP_MODEL_IDS[1], isDefault: false },
      ]);
      expect(
        result.selectedOnlyModels.map((model) => ({
          id: model.id,
          isDefault: model.isDefault,
        })),
      ).toEqual([{ id: "brainstem", isDefault: false }]);
      expect(
        Number.parseInt(
          await readFile(INTEGRATION_RAPP_MODEL_REQUEST_PATH, "utf8"),
          10,
        ),
      ).toBeGreaterThan(0);
    } finally {
      await ctx.runtime.shutdown();
      cleanup(ctx);
    }
  });
});
