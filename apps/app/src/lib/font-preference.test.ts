// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

interface MockSystemConfig {
  generalSettings: {
    bufferFontFamily: string;
    uiFontFamily: string;
  };
}

const systemConfigState = vi.hoisted(
  (): { data: MockSystemConfig | undefined } => ({ data: undefined }),
);

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => systemConfigState,
}));

import {
  applyFontPreferences,
  BUFFER_FONT_CSS_VARIABLES,
  BUFFER_FONT_FAMILY_STORAGE_KEY,
  initializeFontPreferences,
  resolveFontFamilyPreference,
  UI_FONT_CSS_VARIABLES,
  UI_FONT_FAMILY_STORAGE_KEY,
  useAppFontPreferences,
} from "./font-preference";

const ALL_FONT_CSS_VARIABLES = [
  ...UI_FONT_CSS_VARIABLES,
  ...BUFFER_FONT_CSS_VARIABLES,
];

afterEach(() => {
  for (const property of ALL_FONT_CSS_VARIABLES) {
    document.documentElement.style.removeProperty(property);
  }
  window.localStorage.clear();
  systemConfigState.data = undefined;
});

describe("font preferences", () => {
  it("applies separate UI and buffer font stacks", () => {
    applyFontPreferences({
      bufferFontFamily: '"Berkeley Mono", monospace',
      uiFontFamily: '"IBM Plex Sans", sans-serif',
    });

    for (const property of UI_FONT_CSS_VARIABLES) {
      expect(document.documentElement.style.getPropertyValue(property)).toBe(
        '"IBM Plex Sans", sans-serif',
      );
    }
    for (const property of BUFFER_FONT_CSS_VARIABLES) {
      expect(document.documentElement.style.getPropertyValue(property)).toBe(
        '"Berkeley Mono", monospace',
      );
    }
  });

  it("restores theme defaults when a preference is empty", () => {
    applyFontPreferences({
      bufferFontFamily: "JetBrains Mono, monospace",
      uiFontFamily: "system-ui, sans-serif",
    });

    applyFontPreferences({ bufferFontFamily: "", uiFontFamily: "" });

    for (const property of ALL_FONT_CSS_VARIABLES) {
      expect(document.documentElement.style.getPropertyValue(property)).toBe(
        "",
      );
    }
  });

  it("resolves an empty preference from the active theme", () => {
    document.documentElement.style.setProperty(
      "--theme-font-test",
      '"Theme Sans", sans-serif',
    );

    expect(
      resolveFontFamilyPreference("", "--theme-font-test", "fallback"),
    ).toBe('"Theme Sans", sans-serif');

    document.documentElement.style.removeProperty("--theme-font-test");
  });

  it("restores the last server-backed fonts from the start-up cache", () => {
    window.localStorage.setItem(
      UI_FONT_FAMILY_STORAGE_KEY,
      '"IBM Plex Sans", sans-serif',
    );
    window.localStorage.setItem(
      BUFFER_FONT_FAMILY_STORAGE_KEY,
      '"Berkeley Mono", monospace',
    );

    initializeFontPreferences();

    for (const property of UI_FONT_CSS_VARIABLES) {
      expect(document.documentElement.style.getPropertyValue(property)).toBe(
        '"IBM Plex Sans", sans-serif',
      );
    }
    for (const property of BUFFER_FONT_CSS_VARIABLES) {
      expect(document.documentElement.style.getPropertyValue(property)).toBe(
        '"Berkeley Mono", monospace',
      );
    }
  });

  it("applies and caches live server font updates", async () => {
    systemConfigState.data = {
      generalSettings: {
        bufferFontFamily: '"Berkeley Mono", monospace',
        uiFontFamily: '"IBM Plex Sans", sans-serif',
      },
    };
    const { rerender } = renderHook(() => useAppFontPreferences());

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue("--font-sans"),
      ).toBe('"IBM Plex Sans", sans-serif');
      expect(window.localStorage.getItem(UI_FONT_FAMILY_STORAGE_KEY)).toBe(
        '"IBM Plex Sans", sans-serif',
      );
    });

    systemConfigState.data = {
      generalSettings: {
        bufferFontFamily: '"JetBrains Mono", monospace',
        uiFontFamily: "system-ui, sans-serif",
      },
    };
    rerender();

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue("--diffs-font-family"),
      ).toBe('"JetBrains Mono", monospace');
      expect(window.localStorage.getItem(BUFFER_FONT_FAMILY_STORAGE_KEY)).toBe(
        '"JetBrains Mono", monospace',
      );
    });
  });
});
