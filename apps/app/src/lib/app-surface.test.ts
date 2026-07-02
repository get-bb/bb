import { APP_SURFACE_HEADER_NAME } from "@bb/config/app-surface";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import { appSurfaceRequestInit, getAppSurface } from "./app-surface";

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
} as const;

describe("app surface request metadata", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults browser requests to the web app surface", () => {
    const init = appSurfaceRequestInit({
      headers: { "x-existing": "kept" },
    });

    const headers = new Headers(init.headers);
    expect(getAppSurface()).toBe("web");
    expect(headers.get(APP_SURFACE_HEADER_NAME)).toBe("web");
    expect(headers.get("x-existing")).toBe("kept");
  });

  it("marks Electron preload requests as desktop", () => {
    vi.stubGlobal("window", {
      bbDesktop: createBbDesktopApi(desktopInfo),
    });

    const init = appSurfaceRequestInit();

    expect(getAppSurface()).toBe("desktop");
    expect(new Headers(init.headers).get(APP_SURFACE_HEADER_NAME)).toBe(
      "desktop",
    );
  });
});
