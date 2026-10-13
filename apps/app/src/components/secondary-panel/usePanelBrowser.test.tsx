// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePanelBrowser } from "./usePanelBrowser";

const desktop = vi.hoisted(() => ({
  scopedOpenTab: null as
    | null
    | ((event: { tabId: string; url: string }) => void),
  openTab: null as null | ((event: { url: string }) => void),
  scoped: true,
}));
const external = vi.hoisted(() => vi.fn());

vi.mock("@/lib/bb-desktop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bb-desktop")>()),
  getDesktopBrowserApi: () => ({
    onScopedOpenTab: desktop.scoped
      ? (listener: (event: { tabId: string; url: string }) => void) => {
          desktop.scopedOpenTab = listener;
          return () => undefined;
        }
      : undefined,
    onOpenTab: (listener: (event: { url: string }) => void) => {
      desktop.openTab = listener;
      return () => undefined;
    },
  }),
}));

vi.mock("@/lib/url-open-routing", () => ({
  openUrlInExternalBrowser: external,
}));

interface SurfaceCase {
  name: string;
  available: boolean;
}

const SURFACES: readonly SurfaceCase[] = [
  { name: "thread view", available: true },
  { name: "New thread screen without a thread", available: false },
  { name: "plugin page", available: true },
];

function renderSurface(surface: SurfaceCase, isFocused = true) {
  const openTab = vi.fn(({ url }: { url?: string }) => ({
    id: `browser:${url ?? ""}`,
    kind: "browser",
  }));
  const reveal = vi.fn();
  const { result } = renderHook(() =>
    usePanelBrowser({
      available: surface.available,
      browserTabs: [{ id: "browser:mine" }],
      isFocused,
      openTab: (request) =>
        openTab(request.kind === "browser" ? request : { url: undefined }),
      reveal,
    }),
  );
  return { openTab, result, reveal };
}

afterEach(() => {
  cleanup();
  external.mockReset();
  desktop.scopedOpenTab = null;
  desktop.openTab = null;
  desktop.scoped = true;
});

describe.each(SURFACES)("panel browser on the $name", (surface) => {
  it("opens a blank tab with address focus only when available", () => {
    const { openTab, result, reveal } = renderSurface(surface);
    expect(result.current.open === null).toBe(!surface.available);
    if (result.current.open === null) return;

    act(() => result.current.open?.());

    expect(openTab).toHaveBeenCalledWith({ kind: "browser", url: "" });
    expect(reveal).toHaveBeenCalledTimes(1);
    const request = result.current.addressFocusRequest;
    expect(request?.tabId).toBe("browser:");
    act(() => {
      if (request !== null)
        result.current.handleAddressFocusRequestConsumed(request);
    });
    expect(result.current.addressFocusRequest).toBeNull();
  });

  it("routes desktop new-tab requests through the link preference", () => {
    const { openTab } = renderSurface(surface);

    act(() =>
      desktop.scopedOpenTab?.({
        tabId: "browser:other",
        url: "https://a.test",
      }),
    );
    expect(openTab).not.toHaveBeenCalled();
    expect(external).not.toHaveBeenCalled();

    act(() =>
      desktop.scopedOpenTab?.({ tabId: "browser:mine", url: "https://a.test" }),
    );
    if (surface.available) {
      expect(openTab.mock.calls.length + external.mock.calls.length).toBe(1);
    } else {
      expect(openTab).not.toHaveBeenCalled();
      expect(external).toHaveBeenCalledWith("https://a.test");
    }
  });

  it("listens to unscoped desktop requests only while focused", () => {
    desktop.scoped = false;
    renderSurface(surface, false);
    expect(desktop.openTab).toBeNull();

    cleanup();
    renderSurface(surface, true);
    expect(desktop.openTab).not.toBeNull();
  });
});
