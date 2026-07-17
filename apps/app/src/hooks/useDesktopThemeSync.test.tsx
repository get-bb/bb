// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BbDesktopInfo, BbDesktopTheme } from "@bb/desktop-contract";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";

const desktopInfo: BbDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

function installColorSchemeMediaQuery(initialDark: boolean): {
  setDark(dark: boolean): void;
} {
  let dark = initialDark;
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const mediaQuery: MediaQueryList = {
    get matches() {
      return dark;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener(
      _type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      listeners.add(listener);
    },
    removeEventListener(
      _type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      listeners.delete(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners) {
        if (typeof listener === "function") {
          listener.call(mediaQuery, event);
        } else {
          listener.handleEvent(event);
        }
      }
      return true;
    },
  };

  window.matchMedia = vi.fn(() => mediaQuery);
  return {
    setDark(nextDark) {
      dark = nextDark;
      mediaQuery.dispatchEvent(new Event("change"));
    },
  };
}

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("desktop theme synchronization", () => {
  it("keeps Electron on system while the resolved theme follows OS changes", async () => {
    const colorScheme = installColorSchemeMediaQuery(true);
    const setThemeCalls: BbDesktopTheme[] = [];
    const desktopApi = createBbDesktopApi(desktopInfo);
    desktopApi.setTheme = (theme) => setThemeCalls.push(theme);
    window.bbDesktop = desktopApi;

    const { useDesktopThemeSync } = await import("./useDesktopThemeSync");
    const { usePreferredTheme } = await import("./useTheme");
    const { result } = renderHook(() => {
      useDesktopThemeSync();
      return usePreferredTheme();
    });

    expect(result.current).toBe("dark");
    expect(setThemeCalls).toEqual(["system"]);

    act(() => colorScheme.setDark(false));

    expect(result.current).toBe("light");
    expect(setThemeCalls).toEqual(["system"]);
  });
});
