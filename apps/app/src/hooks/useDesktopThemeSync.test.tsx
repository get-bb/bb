// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BbDesktopApi,
  BbDesktopInfo,
  BbDesktopInfoChangeHandler,
  BbDesktopTheme,
} from "@bb/server-contract";
import { createNoopDesktopBrowserApi } from "@/test/bb-desktop-test-utils";

interface DesktopApiStub {
  api: BbDesktopApi;
  setThemeCalls: BbDesktopTheme[];
}

function createDesktopApiStub(): DesktopApiStub {
  const setThemeCalls: BbDesktopTheme[] = [];
  const initialInfo: BbDesktopInfo = {
    lastCheckedAt: null,
    latestVersion: null,
    pendingVersion: null,
    platform: "macos",
    updateAvailable: false,
    updateDownloaded: false,
    version: "0.0.1",
  };
  const api: BbDesktopApi = {
    browser: createNoopDesktopBrowserApi(),
    get lastCheckedAt() {
      return initialInfo.lastCheckedAt;
    },
    get latestVersion() {
      return initialInfo.latestVersion;
    },
    get pendingVersion() {
      return initialInfo.pendingVersion;
    },
    platform: "macos",
    get updateAvailable() {
      return initialInfo.updateAvailable;
    },
    get updateDownloaded() {
      return initialInfo.updateDownloaded;
    },
    get version() {
      return initialInfo.version;
    },
    async checkForUpdates() {
      return initialInfo;
    },
    async getInfo() {
      return initialInfo;
    },
    async installUpdate() {
      // no-op
    },
    onChange(_listener: BbDesktopInfoChangeHandler) {
      return () => {
        // no-op
      };
    },
    setTheme(theme: BbDesktopTheme): void {
      setThemeCalls.push(theme);
    },
  };
  return { api, setThemeCalls };
}

async function loadModules() {
  const { useDesktopThemeSync } = await import("./useDesktopThemeSync");
  const { setPreferredTheme } = await import("./useTheme");
  return { setPreferredTheme, useDesktopThemeSync };
}

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
  window.localStorage.clear();
  vi.resetModules();
});

describe("useDesktopThemeSync", () => {
  beforeEach(() => {
    delete window.bbDesktop;
    window.localStorage.clear();
  });

  it("pushes the resolved theme to the desktop bridge on mount", async () => {
    const desktopStub = createDesktopApiStub();
    window.bbDesktop = desktopStub.api;

    const { useDesktopThemeSync } = await loadModules();
    renderHook(() => useDesktopThemeSync());

    expect(desktopStub.setThemeCalls).toEqual(["light"]);
  });

  it("pushes the new resolved theme when the preference changes", async () => {
    const desktopStub = createDesktopApiStub();
    window.bbDesktop = desktopStub.api;

    const { setPreferredTheme, useDesktopThemeSync } = await loadModules();
    renderHook(() => useDesktopThemeSync());

    expect(desktopStub.setThemeCalls).toEqual(["light"]);

    act(() => {
      setPreferredTheme("dark");
    });

    expect(desktopStub.setThemeCalls).toEqual(["light", "dark"]);
  });

  it("no-ops when the desktop bridge is absent", async () => {
    const { useDesktopThemeSync } = await loadModules();
    expect(window.bbDesktop).toBeUndefined();

    expect(() =>
      renderHook(() => useDesktopThemeSync()),
    ).not.toThrow();
  });
});
