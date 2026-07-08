import { describe, expect, it } from "vitest";
import type { SystemVersionResponse } from "@bb/server-contract";
import type { AppVersionGetSystemVersionArgs } from "../../src/services/system/app-version.js";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

function createStubAppVersionService(
  response: SystemVersionResponse,
  calls?: AppVersionGetSystemVersionArgs[],
) {
  return {
    async getSystemVersion(
      args: AppVersionGetSystemVersionArgs = {},
    ): Promise<SystemVersionResponse> {
      calls?.push(args);
      return response;
    },
  };
}

describe("GET /api/v1/system/version", () => {
  it("returns the response from the app-version service", async () => {
    const expected: SystemVersionResponse = {
      currentVersion: "0.0.5",
      latestVersion: "0.0.6",
      source: "npm",
      updateAvailable: true,
      isDevelopment: false,
      upgradeCommand: "npx bb-app@latest",
    };
    await withTestHarness({
      appVersion: "0.0.5",
      appVersionService: createStubAppVersionService(expected),
      isDevelopment: false,
    }, async (harness) => {
      const response = await harness.app.request("/api/v1/system/version");
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual(expected);
    });
  });

  it("reports updateAvailable=false in development mode", async () => {
    await withTestHarness({
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
    }, async (harness) => {
      const response = await harness.app.request("/api/v1/system/version");
      expect(response.status).toBe(200);
      const body = (await readJson(response)) as SystemVersionResponse;
      expect(body.isDevelopment).toBe(true);
      expect(body.updateAvailable).toBe(false);
      expect(body.latestVersion).toBeNull();
    });
  });

  it("passes force=true through to the app-version service", async () => {
    const calls: AppVersionGetSystemVersionArgs[] = [];
    await withTestHarness({
      appVersion: "0.0.5",
      appVersionService: createStubAppVersionService(
        {
          currentVersion: "0.0.5",
          latestVersion: "0.0.6",
          source: "npm",
          updateAvailable: true,
          isDevelopment: false,
          upgradeCommand: "npx bb-app@latest",
        },
        calls,
      ),
      isDevelopment: false,
    }, async (harness) => {
      const response = await harness.app.request(
        "/api/v1/system/version?force=true",
      );
      expect(response.status).toBe(200);
      expect(calls).toEqual([{ forceRefresh: true }]);
    });
  });
});
