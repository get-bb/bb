import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getStoredThemeId } from "@bb/db";
import { appThemeSchema } from "@bb/domain";
import {
  themeCatalogResponseSchema,
  systemConfigResponseSchema,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

/** Write a custom theme's `theme.css` under `<dataDir>/theme/<name>/`. */
async function writeCustomTheme(
  dataDir: string,
  name: string,
  css: string,
): Promise<void> {
  const dir = join(dataDir, "theme", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "theme.css"), css, "utf8");
}

describe("appearance settings", () => {
  it("defaults appearance to the default palette in /system/config", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      const body = systemConfigResponseSchema.parse(await readJson(response));
      expect(body.appearance).toEqual({ themeId: "default", customCss: null });
      expect(body.customThemes).toEqual([]);
    });
  });

  it("persists a built-in theme and reflects it in /system/config", async () => {
    await withTestHarness(async (harness) => {
      const put = await harness.app.request("/api/v1/settings/appearance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeId: "nord" }),
      });
      expect(put.status).toBe(200);
      expect(appThemeSchema.parse(await readJson(put))).toEqual({
        themeId: "nord",
        customCss: null,
      });
      expect(getStoredThemeId(harness.db)).toBe("nord");

      const config = await harness.app.request("/api/v1/system/config");
      expect(
        systemConfigResponseSchema.parse(await readJson(config)).appearance,
      ).toEqual({ themeId: "nord", customCss: null });
    });
  });

  it("activates a custom theme discovered on disk", async () => {
    await withTestHarness(async (harness) => {
      const css = ":root { --primary: #ff00ff; }";
      await writeCustomTheme(harness.config.dataDir, "midnight", css);

      const put = await harness.app.request("/api/v1/settings/appearance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeId: "midnight" }),
      });
      expect(put.status).toBe(200);
      expect(appThemeSchema.parse(await readJson(put))).toEqual({
        themeId: "midnight",
        customCss: css,
      });
      expect(getStoredThemeId(harness.db)).toBe("midnight");

      const config = systemConfigResponseSchema.parse(
        await readJson(await harness.app.request("/api/v1/system/config")),
      );
      expect(config.appearance).toEqual({ themeId: "midnight", customCss: css });
      expect(config.customThemes).toEqual(["midnight"]);
    });
  });

  it("lists discovered custom themes in the theme catalog", async () => {
    await withTestHarness(async (harness) => {
      await writeCustomTheme(harness.config.dataDir, "zephyr", ":root {}");
      await writeCustomTheme(harness.config.dataDir, "amber", ":root {}");
      // A directory without a theme.css is not a theme.
      await mkdir(join(harness.config.dataDir, "theme", "incomplete"), {
        recursive: true,
      });

      const response = await harness.app.request("/api/v1/settings/themes");
      expect(response.status).toBe(200);
      const catalog = themeCatalogResponseSchema.parse(
        await readJson(response),
      );
      expect(catalog.dir).toBe(join(harness.config.dataDir, "theme"));
      expect(catalog.custom).toEqual(["amber", "zephyr"]);
      expect(catalog.active).toEqual({ themeId: "default", customCss: null });
    });
  });

  it("falls back to default when the active custom theme is deleted", async () => {
    await withTestHarness(async (harness) => {
      await writeCustomTheme(harness.config.dataDir, "ghost", ":root {}");
      await harness.app.request("/api/v1/settings/appearance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeId: "ghost" }),
      });

      await rm(join(harness.config.dataDir, "theme", "ghost"), {
        recursive: true,
        force: true,
      });

      const config = systemConfigResponseSchema.parse(
        await readJson(await harness.app.request("/api/v1/system/config")),
      );
      // The selection is still stored, but resolution falls back gracefully.
      expect(getStoredThemeId(harness.db)).toBe("ghost");
      expect(config.appearance).toEqual({ themeId: "default", customCss: null });
      expect(config.customThemes).toEqual([]);
    });
  });

  it("rejects selecting a custom theme that does not exist", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/settings/appearance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeId: "nonexistent" }),
      });
      expect(response.status).toBe(404);
    });
  });

  it("rejects a theme id that is not a safe path segment", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/settings/appearance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeId: "../evil" }),
      });
      expect(response.status).toBe(400);
    });
  });
});
