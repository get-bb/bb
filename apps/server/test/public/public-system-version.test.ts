import { describe, expect, it } from "vitest";
import { systemVersionResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("GET /api/v1/system/version", () => {
  it("serves the app version service's development report", async () => {
    await withTestHarness(
      { appVersion: "0.0.5", isDevelopment: true },
      async (harness) => {
        const response = await harness.app.request("/api/v1/system/version");
        expect(response.status).toBe(200);
        expect(
          systemVersionResponseSchema.parse(await readJson(response)),
        ).toMatchObject({
          currentVersion: "0.0.5",
          isDevelopment: true,
          latestVersion: null,
          updateAvailable: false,
        });
      },
    );
  });
});
