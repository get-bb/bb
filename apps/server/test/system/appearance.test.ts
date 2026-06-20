import { describe, expect, it } from "vitest";
import { getAppTheme } from "@bb/db";
import { appThemeSchema } from "@bb/domain";
import { systemConfigResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("appearance settings", () => {
  it("defaults appearance to the default palette in /system/config", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      const body = systemConfigResponseSchema.parse(await readJson(response));
      expect(body.appearance).toEqual({ themeId: "default", customCss: null });
    });
  });

  it("persists a built-in theme and reflects it in /system/config", async () => {
    await withTestHarness(async (harness) => {
      const put = await harness.app.request("/api/v1/settings/appearance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeId: "nord", customCss: null }),
      });
      expect(put.status).toBe(200);
      expect(appThemeSchema.parse(await readJson(put))).toEqual({
        themeId: "nord",
        customCss: null,
      });
      expect(getAppTheme(harness.db)).toEqual({
        themeId: "nord",
        customCss: null,
      });

      const config = await harness.app.request("/api/v1/system/config");
      expect(
        systemConfigResponseSchema.parse(await readJson(config)).appearance,
      ).toEqual({ themeId: "nord", customCss: null });
    });
  });

  it("persists a custom stylesheet", async () => {
    await withTestHarness(async (harness) => {
      const customCss = ":root { --primary: #ff00ff; }";
      const put = await harness.app.request("/api/v1/settings/appearance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeId: "custom", customCss }),
      });
      expect(put.status).toBe(200);
      expect(getAppTheme(harness.db)).toEqual({ themeId: "custom", customCss });
    });
  });

  it("rejects an unknown theme id", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/settings/appearance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeId: "neon", customCss: null }),
      });
      expect(response.status).toBe(400);
    });
  });

  it("rejects a custom theme without customCss", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/settings/appearance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeId: "custom", customCss: null }),
      });
      expect(response.status).toBe(400);
    });
  });
});
