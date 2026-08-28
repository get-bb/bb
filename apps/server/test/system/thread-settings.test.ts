import { describe, expect, it } from "vitest";
import { getThreadSettings } from "@bb/db";
import { defaultThreadSettings, threadSettingsSchema } from "@bb/domain";
import { systemConfigResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("thread settings", () => {
  it("defaults thread settings in /system/config", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      const body = systemConfigResponseSchema.parse(await readJson(response));
      expect(body.threadSettings).toEqual(defaultThreadSettings);
    });
  });

  it("persists a PUT and reflects it in /system/config", async () => {
    await withTestHarness(async (harness) => {
      const settings = { archivedConversationRetention: "30-days" } as const;
      const put = await harness.app.request("/api/v1/settings/threads", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });

      expect(put.status).toBe(200);
      expect(threadSettingsSchema.parse(await readJson(put))).toEqual(settings);
      expect(getThreadSettings(harness.db)).toEqual(settings);

      const config = await harness.app.request("/api/v1/system/config");
      const parsedConfig = systemConfigResponseSchema.parse(
        await readJson(config),
      );
      expect(parsedConfig.threadSettings).toEqual(settings);
    });
  });

  it("rejects unknown or unsupported values", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/settings/threads", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archivedConversationRetention: "90-days" }),
      });
      expect(response.status).toBe(400);
    });
  });
});
