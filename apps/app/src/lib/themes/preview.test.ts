// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  APP_THEME_CSS_STORAGE_KEY,
  applyAppThemeCss,
  clearAppThemePreview,
  getAppThemeEpoch,
  previewAppThemeCss,
} from "./index";

const COMMITTED = ":root { --canvas: white; }";
const PREVIEW = ":root { --canvas: black; }";

function styleText(): string | null {
  return document.getElementById("bb-app-theme")?.textContent ?? null;
}

afterEach(() => {
  clearAppThemePreview();
  applyAppThemeCss("");
  localStorage.clear();
});

describe("app theme preview", () => {
  it("applies preview CSS to the document without persisting it", () => {
    applyAppThemeCss(COMMITTED);
    const epochBefore = getAppThemeEpoch();

    previewAppThemeCss(PREVIEW);

    expect(styleText()).toBe(PREVIEW);
    expect(getAppThemeEpoch()).toBe(epochBefore + 1);
    expect(localStorage.getItem(APP_THEME_CSS_STORAGE_KEY)).toBe(COMMITTED);
  });

  it("restores the committed CSS when the preview is cleared", () => {
    applyAppThemeCss(COMMITTED);
    previewAppThemeCss(PREVIEW);

    clearAppThemePreview();

    expect(styleText()).toBe(COMMITTED);
    expect(localStorage.getItem(APP_THEME_CSS_STORAGE_KEY)).toBe(COMMITTED);
  });

  it("lets a committed theme supersede an active preview", () => {
    applyAppThemeCss(COMMITTED);
    previewAppThemeCss(PREVIEW);

    applyAppThemeCss(PREVIEW);
    clearAppThemePreview();

    expect(styleText()).toBe(PREVIEW);
    expect(localStorage.getItem(APP_THEME_CSS_STORAGE_KEY)).toBe(PREVIEW);
  });

  it("does not bump the epoch when clearing without a preview", () => {
    applyAppThemeCss(COMMITTED);
    const epochBefore = getAppThemeEpoch();

    clearAppThemePreview();

    expect(getAppThemeEpoch()).toBe(epochBefore);
  });
});
