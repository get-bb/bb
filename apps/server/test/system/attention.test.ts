import { describe, expect, it } from "vitest";
import { systemAttentionResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("system attention", () => {
  it("returns the cross-server favicon attention summary", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/system/attention");
      expect(response.status).toBe(200);
      expect(
        systemAttentionResponseSchema.parse(await readJson(response)),
      ).toEqual({ hasAttention: false });
    });
  });
});
