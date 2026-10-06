// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOW_FIND_TOP_OFFSET,
  readWindowFindTopOffset,
} from "./bb-desktop";

afterEach(() => {
  document.documentElement.style.removeProperty("--bb-app-chrome-row-height");
  document.documentElement.style.removeProperty("font-size");
});

describe("readWindowFindTopOffset", () => {
  it("resolves the chrome row height against the root font size", () => {
    document.documentElement.style.fontSize = "20px";
    document.documentElement.style.setProperty(
      "--bb-app-chrome-row-height",
      "3rem",
    );

    expect(readWindowFindTopOffset()).toBe(60);
  });

  it("falls back when the chrome row height is missing or unsupported", () => {
    expect(readWindowFindTopOffset()).toBe(DEFAULT_WINDOW_FIND_TOP_OFFSET);

    document.documentElement.style.setProperty(
      "--bb-app-chrome-row-height",
      "4vh",
    );
    expect(readWindowFindTopOffset()).toBe(DEFAULT_WINDOW_FIND_TOP_OFFSET);
  });
});
