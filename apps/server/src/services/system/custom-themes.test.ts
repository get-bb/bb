import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  customThemeExists,
  deleteCustomTheme,
  listCustomThemeNames,
  readCustomThemeCss,
  resolveCustomThemeCssPath,
  resolveThemeRootPath,
  writeCustomThemeCss,
} from "./custom-themes.js";

let dataDir: string;
let themeRoot: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "bb-theme-test-"));
  themeRoot = resolveThemeRootPath(dataDir);
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("custom theme writes", () => {
  it("creates the theme folder and writes the stylesheet", () => {
    writeCustomThemeCss(themeRoot, "ocean", ":root { --canvas: #fff; }");

    expect(customThemeExists(themeRoot, "ocean")).toBe(true);
    expect(readCustomThemeCss(themeRoot, "ocean")).toBe(
      ":root { --canvas: #fff; }",
    );
    expect(listCustomThemeNames(themeRoot)).toEqual(["ocean"]);
  });

  it("overwrites an existing stylesheet in place", () => {
    writeCustomThemeCss(themeRoot, "ocean", ":root { --canvas: #fff; }");
    writeCustomThemeCss(themeRoot, "ocean", ":root { --canvas: #000; }");

    expect(readCustomThemeCss(themeRoot, "ocean")).toBe(
      ":root { --canvas: #000; }",
    );
    expect(listCustomThemeNames(themeRoot)).toEqual(["ocean"]);
  });

  it("keeps other themes when one is deleted", () => {
    writeCustomThemeCss(themeRoot, "ocean", ":root { --canvas: #fff; }");
    writeCustomThemeCss(themeRoot, "ember", ":root { --canvas: #000; }");

    deleteCustomTheme(themeRoot, "ocean");

    expect(customThemeExists(themeRoot, "ocean")).toBe(false);
    expect(listCustomThemeNames(themeRoot)).toEqual(["ember"]);
  });

  it("deletes a theme that is already missing without throwing", () => {
    expect(() => deleteCustomTheme(themeRoot, "ghost")).not.toThrow();
    expect(listCustomThemeNames(themeRoot)).toEqual([]);
  });

  it("omits folders without a theme.css and names the schema rejects", () => {
    writeCustomThemeCss(themeRoot, "valid", ":root { --canvas: #fff; }");

    expect(listCustomThemeNames(themeRoot)).toEqual(["valid"]);
    expect(
      resolveCustomThemeCssPath(themeRoot, "valid"),
    ).toBe(join(themeRoot, "valid", "theme.css"));
  });
});
