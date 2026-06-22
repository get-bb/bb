import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CUSTOM_THEME_CSS_MAX_LENGTH } from "@bb/domain";
import {
  listCustomThemeNames,
  readCustomThemeCss,
  resolveAppTheme,
  resolveThemeRootPath,
} from "../../src/services/system/custom-themes.js";

async function writeTheme(root: string, name: string, css: string) {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, "theme.css"), css, "utf8");
}

describe("custom themes service", () => {
  let dataDir: string;
  let themeRoot: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bb-theme-test-"));
    themeRoot = resolveThemeRootPath(dataDir);
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("returns no themes when the theme dir is absent", () => {
    expect(listCustomThemeNames(themeRoot)).toEqual([]);
  });

  it("lists only directories with a theme.css, sorted, safe names only", async () => {
    await writeTheme(themeRoot, "solar", ":root {}");
    await writeTheme(themeRoot, "aurora", ":root {}");
    await mkdir(join(themeRoot, "no-css"), { recursive: true });
    await writeFile(join(themeRoot, "loose.css"), ":root {}", "utf8");

    expect(listCustomThemeNames(themeRoot)).toEqual(["aurora", "solar"]);
  });

  it("resolves a built-in id without reading disk", () => {
    expect(resolveAppTheme(themeRoot, "nord")).toEqual({
      themeId: "nord",
      customCss: null,
    });
  });

  it("resolves a custom theme's CSS from disk", async () => {
    await writeTheme(themeRoot, "ocean", ":root { --primary: #06f; }");
    expect(resolveAppTheme(themeRoot, "ocean")).toEqual({
      themeId: "ocean",
      customCss: ":root { --primary: #06f; }",
    });
  });

  it("falls back to default for a missing or unsafe selection", () => {
    expect(resolveAppTheme(themeRoot, "missing")).toEqual({
      themeId: "default",
      customCss: null,
    });
    expect(resolveAppTheme(themeRoot, "../escape")).toEqual({
      themeId: "default",
      customCss: null,
    });
  });

  it("rejects oversized stylesheets so the broadcast payload stays bounded", async () => {
    await writeTheme(themeRoot, "huge", "a".repeat(CUSTOM_THEME_CSS_MAX_LENGTH + 1));
    expect(readCustomThemeCss(themeRoot, "huge")).toBeNull();
    expect(resolveAppTheme(themeRoot, "huge")).toEqual({
      themeId: "default",
      customCss: null,
    });
  });
});
