import { describe, expect, it } from "vitest";
import { getExperiments } from "@bb/db";
import { experimentsSchema } from "@bb/domain";
import { systemConfigResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("experiments settings", () => {
  it("defaults experiments to off in /system/config", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      const body = systemConfigResponseSchema.parse(await readJson(response));
      expect(body.experiments).toEqual({
        claudeCodeMockCliTraffic: false,
        multiMachine: false,
        popoutChat: false,
        popoutChatHotkey: "Alt+Space",
        plugins: false,
        uiForking: false,
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
          multiMachine: true,
          popoutChat: true,
          popoutChatHotkey: "CommandOrControl+Shift+P",
          plugins: false,
          uiForking: true,
        }),
      });
      expect(put.status).toBe(200);
      expect(experimentsSchema.parse(await readJson(put))).toEqual({
        claudeCodeMockCliTraffic: true,
        multiMachine: true,
        popoutChat: true,
        popoutChatHotkey: "CommandOrControl+Shift+P",
        plugins: false,
        uiForking: true,
      });
      expect(getExperiments(harness.db)).toEqual({
        claudeCodeMockCliTraffic: true,
        multiMachine: true,
        popoutChat: true,
        popoutChatHotkey: "CommandOrControl+Shift+P",
        plugins: false,
        uiForking: true,
      });

      const config = await harness.app.request("/api/v1/system/config");
      expect(
        systemConfigResponseSchema.parse(await readJson(config)).experiments,
      ).toEqual({
        claudeCodeMockCliTraffic: true,
        multiMachine: true,
        popoutChat: true,
        popoutChatHotkey: "CommandOrControl+Shift+P",
        plugins: false,
        uiForking: true,
      });
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
