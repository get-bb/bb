import { renderHookStatically } from "@/test/render-hook-statically";
import { describe, expect, it, vi } from "vitest";
import {
  subscribeDesktopOpenRequests,
  usePanelBrowser,
  type PanelBrowser,
} from "./usePanelBrowser";

type ScopedListener = (event: { tabId: string; url: string }) => void;
type OpenListener = (event: { url: string }) => void;

function fakeBrowserApi({ scoped }: { scoped: boolean }) {
  const listeners: { open: OpenListener[]; scoped: ScopedListener[] } = {
    open: [],
    scoped: [],
  };
  return {
    listeners,
    api: {
      onOpenTab: (listener: OpenListener) => {
        listeners.open.push(listener);
        return () => undefined;
      },
      onScopedOpenTab: scoped
        ? (listener: ScopedListener) => {
            listeners.scoped.push(listener);
            return () => undefined;
          }
        : undefined,
    },
  };
}

function readPanelBrowser(available: boolean): PanelBrowser {
  return renderHookStatically(() =>
    usePanelBrowser({
      available,
      browserTabs: [],
      isFocused: true,
      openTab: () => null,
      reveal: () => undefined,
    }),
  );
}

describe("usePanelBrowser", () => {
  it("offers a blank-tab opener only where the panel browser is available", () => {
    expect(readPanelBrowser(true).open).toEqual(expect.any(Function));
    expect(readPanelBrowser(false).open).toBeNull();
  });
});

describe("subscribeDesktopOpenRequests", () => {
  it("opens scoped desktop new-tab requests only for the surface's own tabs", () => {
    const { api, listeners } = fakeBrowserApi({ scoped: true });
    const openUrl = vi.fn();
    subscribeDesktopOpenRequests(api, {
      browserTabIds: new Set(["browser:mine"]),
      isFocused: false,
      openUrl,
    });

    listeners.scoped.forEach((listener) =>
      listener({ tabId: "browser:other", url: "https://a.test" }),
    );
    expect(openUrl).not.toHaveBeenCalled();

    listeners.scoped.forEach((listener) =>
      listener({ tabId: "browser:mine", url: "https://a.test" }),
    );
    expect(openUrl).toHaveBeenCalledWith("https://a.test");
    expect(listeners.open).toHaveLength(0);
  });

  it("listens to unscoped desktop requests only while focused", () => {
    const unfocused = fakeBrowserApi({ scoped: false });
    subscribeDesktopOpenRequests(unfocused.api, {
      browserTabIds: new Set(),
      isFocused: false,
      openUrl: vi.fn(),
    });
    expect(unfocused.listeners.open).toHaveLength(0);

    const focused = fakeBrowserApi({ scoped: false });
    const openUrl = vi.fn();
    subscribeDesktopOpenRequests(focused.api, {
      browserTabIds: new Set(),
      isFocused: true,
      openUrl,
    });
    focused.listeners.open.forEach((listener) =>
      listener({ url: "https://a.test" }),
    );
    expect(openUrl).toHaveBeenCalledWith("https://a.test");
  });
});
