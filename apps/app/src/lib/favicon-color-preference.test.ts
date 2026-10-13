// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppTheme } from "@bb/domain";
import {
  FAVICON_COLOR_STORAGE_KEY,
  useFaviconColorSync,
} from "./favicon-color-preference";

const mocks = vi.hoisted(() => ({
  useSystemConfig: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: mocks.useSystemConfig,
}));

function setSystemFaviconColor(
  faviconColor: typeof defaultAppTheme.faviconColor,
): void {
  mocks.useSystemConfig.mockReturnValue({
    data: {
      appearance: {
        ...defaultAppTheme,
        faviconColor,
      },
    },
  });
}

describe("favicon color server sync", () => {
  afterEach(() => {
    window.localStorage.clear();
    cleanup();
    vi.clearAllMocks();
  });

  it("mirrors the server tint into the first-paint cache", async () => {
    window.localStorage.setItem(FAVICON_COLOR_STORAGE_KEY, "teal");
    setSystemFaviconColor("purple");
    const { rerender } = renderHook(() => useFaviconColorSync());

    await waitFor(() =>
      expect(window.localStorage.getItem(FAVICON_COLOR_STORAGE_KEY)).toBe(
        "purple",
      ),
    );

    setSystemFaviconColor("default");
    rerender();

    await waitFor(() =>
      expect(window.localStorage.getItem(FAVICON_COLOR_STORAGE_KEY)).toBeNull(),
    );
  });
});

describe("favicon rendering", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => null,
    });
  });

  afterEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: originalGetContext,
    });
    cleanup();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function stubDisplayMode(standalone: boolean): void {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(display-mode: standalone)" ? standalone : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
  }

  class FakeImage {
    static created = 0;
    naturalWidth = 32;
    naturalHeight = 32;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      FakeImage.created += 1;
      queueMicrotask(() => this.onload?.());
    }
  }

  async function loadFreshModule() {
    return import("./favicon-color-preference");
  }

  it("decodes each base glyph once across badge flips", async () => {
    stubDisplayMode(false);
    FakeImage.created = 0;
    vi.stubGlobal("Image", FakeImage);
    const module = await loadFreshModule();
    module.initializeFavicon();

    const initialProps: { badge: "none" | "unread" } = { badge: "unread" };
    const { rerender, unmount } = renderHook(
      ({ badge }: { badge: "none" | "unread" }) =>
        module.useFaviconBadge(badge),
      { initialProps },
    );
    await waitFor(() => expect(FakeImage.created).toBe(2));

    rerender({ badge: "none" });
    rerender({ badge: "unread" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(FakeImage.created).toBe(2);
    unmount();
  });

  it("skips favicon image work in standalone display mode", async () => {
    stubDisplayMode(true);
    FakeImage.created = 0;
    vi.stubGlobal("Image", FakeImage);
    const module = await loadFreshModule();
    module.initializeFavicon();

    const { unmount } = renderHook(() => module.useFaviconBadge("unread"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(FakeImage.created).toBe(0);
    unmount();
  });
});
