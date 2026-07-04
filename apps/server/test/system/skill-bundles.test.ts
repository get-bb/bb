import { describe, expect, it } from "vitest";
import {
  skillBundleListResponseSchema,
  skillBundleSchema,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("skill bundle settings", () => {
  it("creates and lists chained skills through the system route", async () => {
    await withTestHarness(async (harness) => {
      const createResponse = await harness.app.request(
        "/api/v1/system/skill-bundles",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "PR review",
            steps: [
              { text: "/simplify" },
              { text: "/ensure-consistency" },
              { text: "/review" },
            ],
          }),
        },
      );
      expect(createResponse.status).toBe(201);
      const created = skillBundleSchema.parse(await readJson(createResponse));
      expect(created).toMatchObject({
        name: "PR review",
        steps: [
          { text: "/simplify" },
          { text: "/ensure-consistency" },
          { text: "/review" },
        ],
      });

      const listResponse = await harness.app.request(
        "/api/v1/system/skill-bundles",
      );
      expect(listResponse.status).toBe(200);
      const list = skillBundleListResponseSchema.parse(
        await readJson(listResponse),
      );
      expect(list.bundles).toHaveLength(1);
      expect(list.bundles[0]?.id).toBe(created.id);
    });
  });
});
