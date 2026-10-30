import { describe, expect, it } from "vitest";
import { getExperiments } from "@bb/db";
import {
  defaultAppSettings,
  defaultExperiments,
  earlyAdopterExperiments,
  experimentsSchema,
} from "@bb/domain";
import { systemConfigResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { type TestAppHarness, withTestHarness } from "../helpers/test-app.js";

function putExperiments(harness: TestAppHarness, body: object) {
  return harness.app.request("/api/v1/settings/experiments", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function putGeneralSettings(harness: TestAppHarness, body: object) {
  return harness.app.request("/api/v1/settings/general", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function configExperiments(harness: TestAppHarness) {
  const response = await harness.app.request("/api/v1/system/config");
  return systemConfigResponseSchema.parse(await readJson(response)).experiments;
}

describe("experiments settings", () => {
  it("serves the shipped experiment defaults in /system/config", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      const body = systemConfigResponseSchema.parse(await readJson(response));
      expect(body.experiments).toEqual({
        applicationLinks: false,
        changelogPreview: false,
        compactExpiredCache: false,
        serverMove: false,
        performanceDiagnostics: false,
        pluginUpdates: false,
        sidebarMultiSelect: false,
        skipFocusedThreadNotifications: false,
        threadContextCard: false,
        threadRowMetadata: false,
        timelinePush: false,
        unreadDividerAtAnswer: false,
        websocketCompression: false,
      });
    });
  });

  it.each([false, true])(
    "reports startup permission %s independently of the experiment",
    async (available) => {
      await withTestHarness(async (harness) => {
        harness.deps.config.performanceDiagnosticsAvailable = available;
        await putExperiments(harness, { performanceDiagnostics: true });
        const response = await harness.app.request("/api/v1/system/config");
        const body = systemConfigResponseSchema.parse(await readJson(response));
        expect(body.performanceDiagnosticsAvailable).toBe(available);
        expect(body.experiments.performanceDiagnostics).toBe(true);
      });
    },
  );

  it("persists a PUT and reflects it in /system/config", async () => {
    await withTestHarness(async (harness) => {
      const put = await harness.app.request("/api/v1/settings/experiments", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicationLinks: true,
          changelogPreview: true,
          compactExpiredCache: true,
          serverMove: true,
          performanceDiagnostics: true,
          pluginUpdates: true,
          sidebarMultiSelect: true,
          skipFocusedThreadNotifications: true,
          threadContextCard: true,
          threadRowMetadata: true,
          timelinePush: true,
          unreadDividerAtAnswer: true,
          websocketCompression: true,
        }),
      });
      expect(put.status).toBe(200);
      expect(experimentsSchema.parse(await readJson(put))).toEqual({
        applicationLinks: true,
        changelogPreview: true,
        compactExpiredCache: true,
        serverMove: true,
        performanceDiagnostics: true,
        pluginUpdates: true,
        sidebarMultiSelect: true,
        skipFocusedThreadNotifications: true,
        threadContextCard: true,
        threadRowMetadata: true,
        timelinePush: true,
        unreadDividerAtAnswer: true,
        websocketCompression: true,
      });
      expect(getExperiments(harness.db)).toEqual({
        applicationLinks: true,
        changelogPreview: true,
        compactExpiredCache: true,
        serverMove: true,
        performanceDiagnostics: true,
        pluginUpdates: true,
        sidebarMultiSelect: true,
        skipFocusedThreadNotifications: true,
        threadContextCard: true,
        threadRowMetadata: true,
        timelinePush: true,
        unreadDividerAtAnswer: true,
        websocketCompression: true,
      });

      const config = await harness.app.request("/api/v1/system/config");
      expect(
        systemConfigResponseSchema.parse(await readJson(config)).experiments,
      ).toEqual({
        applicationLinks: true,
        changelogPreview: true,
        compactExpiredCache: true,
        serverMove: true,
        performanceDiagnostics: true,
        pluginUpdates: true,
        sidebarMultiSelect: true,
        skipFocusedThreadNotifications: true,
        threadContextCard: true,
        threadRowMetadata: true,
        timelinePush: true,
        unreadDividerAtAnswer: true,
        websocketCompression: true,
      });
    });
  });

  it("changes only the experiments a PUT names", async () => {
    await withTestHarness(async (harness) => {
      await putExperiments(harness, { serverMove: true });
      const put = await putExperiments(harness, { changelogPreview: true });
      expect(put.status).toBe(200);
      expect(experimentsSchema.parse(await readJson(put))).toEqual({
        applicationLinks: false,
        changelogPreview: true,
        compactExpiredCache: false,
        serverMove: true,
        performanceDiagnostics: false,
        pluginUpdates: false,
        sidebarMultiSelect: false,
        skipFocusedThreadNotifications: false,
        threadContextCard: false,
        threadRowMetadata: false,
        timelinePush: false,
        unreadDividerAtAnswer: false,
        websocketCompression: false,
      });
      expect(
        harness.db.$client
          .prepare<[], { key: string }>(
            "SELECT key FROM system_experiments ORDER BY key",
          )
          .all()
          .map((row) => row.key),
      ).toEqual(["changelogPreview", "serverMove"]);
    });
  });

  it.each([
    ["an unknown experiment", { futureExperiment: true }],
    ["a non-boolean value", { serverMove: "yes" }],
  ])("rejects %s", async (_label, body) => {
    await withTestHarness(async (harness) => {
      const response = await putExperiments(harness, body);
      expect(response.status).toBe(400);
      expect(getExperiments(harness.db)).toEqual(defaultExperiments);
    });
  });

  it("serves the early adopter defaults while the setting is on and keeps experiments the user set", async () => {
    await withTestHarness(async (harness) => {
      await putExperiments(harness, {
        timelinePush: false,
        applicationLinks: false,
      });
      expect(
        (
          await putGeneralSettings(harness, {
            ...defaultAppSettings,
            earlyAdopter: true,
          })
        ).status,
      ).toBe(200);
      expect(await configExperiments(harness)).toEqual({
        ...earlyAdopterExperiments,
        timelinePush: false,
        applicationLinks: false,
      });

      harness.db.$client.prepare("DELETE FROM system_experiments").run();
      expect(await configExperiments(harness)).toEqual(earlyAdopterExperiments);
      expect((await configExperiments(harness)).applicationLinks).toBe(true);

      const { earlyAdopter: omitted, ...legacy } = defaultAppSettings;
      expect(omitted).toBe(false);
      expect((await putGeneralSettings(harness, legacy)).status).toBe(200);
      expect(await configExperiments(harness)).toEqual(earlyAdopterExperiments);

      await putGeneralSettings(harness, {
        ...defaultAppSettings,
        earlyAdopter: false,
      });
      expect(await configExperiments(harness)).toEqual(defaultExperiments);
    });
  });
});
