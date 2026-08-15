import { describe, expect, it } from "vitest";
import { getExperiments } from "@bb/db";
import { experimentsSchema } from "@bb/domain";
import { systemConfigResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { internalAuthHeaders } from "../helpers/commands.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("experiments settings", () => {
  it("serves the shipped experiment defaults in /system/config", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      const body = systemConfigResponseSchema.parse(await readJson(response));
      expect(body.experiments).toEqual({
        claudeCodeMockCliTraffic: false,
        editMessages: true,
        newOnboarding: false,
        providerSessionReaping: false,
      });
    });
  });

  it("persists a PUT and reflects it in /system/config", async () => {
    await withTestHarness(async (harness) => {
      const put = await harness.app.request("/api/v1/settings/experiments", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          claudeCodeMockCliTraffic: true,
          editMessages: true,
          newOnboarding: true,
            providerSessionReaping: true,
        }),
      });
      expect(put.status).toBe(200);
      expect(experimentsSchema.parse(await readJson(put))).toEqual({
        claudeCodeMockCliTraffic: true,
        editMessages: true,
        newOnboarding: true,
        providerSessionReaping: true,
      });
      expect(getExperiments(harness.db)).toEqual({
        claudeCodeMockCliTraffic: true,
        editMessages: true,
        newOnboarding: true,
        providerSessionReaping: true,
      });

      const config = await harness.app.request("/api/v1/system/config");
      expect(
        systemConfigResponseSchema.parse(await readJson(config)).experiments,
      ).toEqual({
        claudeCodeMockCliTraffic: true,
        editMessages: true,
        newOnboarding: true,
        providerSessionReaping: true,
      });
    });
  });

  it("serves the current provider session policy to the daemon", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-runtime-policy",
      });
      const headers = internalAuthHeaders(harness, { hostId: host.id });

      const initial = await harness.app.request("/internal/runtime-policy", {
        headers,
      });
      expect(initial.status).toBe(200);
      await expect(readJson(initial)).resolves.toEqual({
        providerSessionReaping: false,
      });
      await harness.app.request("/api/v1/settings/experiments", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          claudeCodeMockCliTraffic: false,
          editMessages: true,
          newOnboarding: false,
            providerSessionReaping: true,
        }),
      });
      const updated = await harness.app.request("/internal/runtime-policy", {
        headers,
      });
      await expect(readJson(updated)).resolves.toEqual({
        providerSessionReaping: true,
      });
    });
  });

  it("does not expose legacy direct bb connect routes", async () => {
    await withTestHarness(async (harness) => {
      const disabled = await harness.app.request("/api/v1/connect/status");
      expect(disabled.status).toBe(404);

      const put = await harness.app.request("/api/v1/settings/experiments", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          claudeCodeMockCliTraffic: false,
          editMessages: false,
          newOnboarding: false,
          providerSessionReaping: false,
        }),
      });
      expect(put.status).toBe(200);

      const enabled = await harness.app.request("/api/v1/connect/status");
      expect(enabled.status).toBe(404);
    });
  });

  it("rejects payloads that are not the full experiments object", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        "/api/v1/settings/experiments",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      expect(response.status).toBe(400);
    });
  });
});
