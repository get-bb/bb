// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { BbDesktopBrowserState } from "@bb/desktop-contract";
import { afterEach, expect, it, vi } from "vitest";
import { createNoopDesktopBrowserApi } from "@/test/bb-desktop-test-utils";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { BrowserTabIcon } from "./BrowserTabIcon";

vi.mock("@/lib/bb-desktop", () => ({ getDesktopBrowserApi: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("keeps icons scoped to their tab and falls back when an image fails or navigation clears it", () => {
  const listeners = new Set<(state: BbDesktopBrowserState) => void>();
  vi.mocked(getDesktopBrowserApi).mockReturnValue({
    ...createNoopDesktopBrowserApi(),
    onState(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  const emit = (tabId: string, faviconUrl: string | null) =>
    act(() => {
      for (const listener of listeners)
        listener({
          tabId,
          faviconUrl,
          url: "https://example.com",
          title: "Example",
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          errorText: null,
        });
    });
  const { container, unmount } = render(<BrowserTabIcon tabId="browser:a" />);
  expect(container.querySelector("img")).toBeNull();
  emit("browser:b", "https://other.example/icon.png");
  expect(container.querySelector("img")).toBeNull();
  emit("browser:a", "https://example.com/icon.png");
  const icon = container.querySelector("img");
  expect(icon?.getAttribute("src")).toBe("https://example.com/icon.png");
  if (icon === null) throw new Error("Missing favicon");
  fireEvent.error(icon);
  expect(container.querySelector("img")).toBeNull();
  emit("browser:a", "https://example.com/next.png");
  expect(container.querySelector("img")?.getAttribute("src")).toBe(
    "https://example.com/next.png",
  );
  emit("browser:a", null);
  expect(container.querySelector("img")).toBeNull();
  unmount();
  expect(listeners.size).toBe(0);
});

it("selects a Retina-sized candidate regardless of load order and ignores obsolete image loads", () => {
  const images: HTMLImageElement[] = [];
  vi.stubGlobal("devicePixelRatio", 2);
  vi.stubGlobal(
    "Image",
    class {
      constructor() {
        const image = document.createElement("img");
        images.push(image);
        return image;
      }
    },
  );
  const listeners = new Set<(state: BbDesktopBrowserState) => void>();
  vi.mocked(getDesktopBrowserApi).mockReturnValue({
    ...createNoopDesktopBrowserApi(),
    onState(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  const emit = (faviconUrls: string[]) =>
    act(() => {
      for (const listener of listeners)
        listener({
          tabId: "browser:a",
          url: "https://example.com",
          title: null,
          faviconUrl: faviconUrls[0] ?? null,
          faviconUrls,
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          errorText: null,
        });
    });
  let rendered = render(<BrowserTabIcon tabId="browser:a" />);
  const urls = [16, 32, 64].map((size) => `https://example.com/${size}.png`);
  emit(urls);
  const load = (size: number) => {
    const image = images.find(
      (image) => image.src === `https://example.com/${size}.png`,
    );
    if (!image) throw new Error("Missing candidate image");
    Object.defineProperties(image, {
      naturalWidth: { value: size },
      naturalHeight: { value: size },
    });
    fireEvent.load(image);
  };
  load(64);
  load(32);
  load(16);
  expect(rendered.container.querySelector("img")?.getAttribute("src")).toBe(
    urls[1],
  );
  rendered.unmount();
  const probeCount = images.length;
  rendered = render(<BrowserTabIcon tabId="browser:a" />);
  emit(urls);
  expect(rendered.container.querySelector("img")?.getAttribute("src")).toBe(
    urls[1],
  );
  expect(images).toHaveLength(probeCount);
  emit(["https://example.com/missing.ico", ...urls]);
  fireEvent.error(images.at(-1)!);
  expect(rendered.container.querySelector("img")?.getAttribute("src")).toBe(
    urls[1],
  );
  emit(["https://example.com/replacement.png", ...urls]);
  const replacement = images.at(-1)!;
  Object.defineProperties(replacement, {
    naturalWidth: { value: 32 },
    naturalHeight: { value: 32 },
  });
  fireEvent.load(replacement);
  expect(rendered.container.querySelector("img")?.getAttribute("src")).toBe(
    "https://example.com/replacement.png",
  );

  emit([]);
  for (const image of images) fireEvent.load(image);
  expect(rendered.container.querySelector("img")).toBeNull();
});
