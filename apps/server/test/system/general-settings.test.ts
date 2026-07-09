import { describe, expect, it, vi } from "vitest";
import { getAppSettings, setAppSettings } from "@bb/db";
import { appSettingsSchema } from "@bb/domain";
import { systemConfigResponseSchema } from "@bb/server-contract";
import { schedulePrimaryHostCaffeinateReconciliation } from "../../src/services/system/app-settings.js";
import { readJson } from "../helpers/json.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { seedHostSession, seedPrimaryHost } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("general settings", () => {
  it("defaults general settings in /system/config", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      const body = systemConfigResponseSchema.parse(await readJson(response));
      expect(body.generalSettings).toEqual({ caffeinate: false });
    });
  });

  it("persists a PUT, reflects it in /system/config, and asks the daemon to reconcile", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          expect(request.command).toEqual({
            type: "host.caffeinate",
            enabled: true,
          });
          return {
            ok: true,
            result: { enabled: true, supported: true },
          };
        },
      });

      const put = await harness.app.request("/api/v1/settings/general", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caffeinate: true }),
      });
      expect(put.status).toBe(200);
      expect(appSettingsSchema.parse(await readJson(put))).toEqual({
        caffeinate: true,
      });
      expect(getAppSettings(harness.db)).toEqual({ caffeinate: true });

      const config = await harness.app.request("/api/v1/system/config");
      const parsedConfig = systemConfigResponseSchema.parse(
        await readJson(config),
      );
      expect(parsedConfig.generalSettings).toEqual({ caffeinate: true });
      expect(parsedConfig.primaryHostPlatform).toBe("darwin");
      await vi.waitFor(() => {
        expect(responder.requests).toHaveLength(1);
      });
    });
  });

  it("reconciles the saved caffeinate setting for a connected primary daemon", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      setAppSettings(harness.db, { caffeinate: true });

      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          expect(request.command).toEqual({
            type: "host.caffeinate",
            enabled: true,
          });
          return {
            ok: true,
            result: { enabled: true, supported: true },
          };
        },
      });
      schedulePrimaryHostCaffeinateReconciliation(harness.deps, {
        reason: "daemon-open",
      });

      await vi.waitFor(() => {
        expect(responder.requests).toHaveLength(1);
      });
    });
  });

  it("rejects payloads that are not the full general settings object", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/settings/general", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
    });
  });

  it("rejects unknown general settings fields", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/settings/general", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caffeinate: true, unused: true }),
      });
      expect(response.status).toBe(400);
    });
  });
});
