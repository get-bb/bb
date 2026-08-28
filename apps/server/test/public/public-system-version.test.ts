import { describe, expect, it } from "vitest";
import {
  systemVersionResponseSchema,
  type SystemVersionResponse,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

function createStubAppVersionService(response: SystemVersionResponse) {
  return {
    async getSystemVersion(): Promise<SystemVersionResponse> {
      return response;
    },
  };
}

describe("GET /api/v1/system/version", () => {
  it("reports updateAvailable=false in development mode", async () => {
    await withTestHarness(
      {
        appVersion: "0.0.5",
        appVersionService: createStubAppVersionService({
          currentVersion: "0.0.5",
          latestVersion: null,
          source: "npm",
          updateAvailable: false,
          isDevelopment: true,
          upgradeCommand: "npx bb-app@latest",
        }),
        isDevelopment: true,
      },
      async (harness) => {
        const response = await harness.app.request("/api/v1/system/version");
        expect(response.status).toBe(200);
        const body = systemVersionResponseSchema.parse(
          await readJson(response),
        );
        expect(body.isDevelopment).toBe(true);
        expect(body.updateAvailable).toBe(false);
        expect(body.latestVersion).toBeNull();
      },
    );
  });
});
