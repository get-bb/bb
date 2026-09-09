// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BbDesktopBrowserRevealRequest } from "@bb/desktop-contract";
import { useDesktopBrowserReveal } from "./use-desktop-browser-reveal";

const listeners = vi.hoisted(
  () => new Set<(request: BbDesktopBrowserRevealRequest) => void>(),
);

vi.mock("./bb-desktop", () => ({
  getDesktopBrowserApi: () => ({
    onReveal: (listener: (request: BbDesktopBrowserRevealRequest) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  }),
}));

afterEach(() => {
  cleanup();
  listeners.clear();
});

function reveal(threadId = "thread-a") {
  act(() => {
    for (const listener of listeners)
      listener({
        threadId,
        tabId: "browser-a",
        desktopTarget: {
          hostId: "host",
          instanceId: "desktop",
          generation: "1",
        },
      });
  });
}

describe("desktop browser reveal focus", () => {
  it("selects the focused thread's tab once it arrives", () => {
    const activateTab = vi.fn();
    const { rerender } = renderHook(
      ({ browserTabs }) =>
        useDesktopBrowserReveal({
          threadId: "thread-a",
          isFocused: true,
          browserTabs,
          activateTab,
        }),
      { initialProps: { browserTabs: [] as { id: string }[] } },
    );
    reveal();
    expect(activateTab).not.toHaveBeenCalled();
    rerender({ browserTabs: [{ id: "browser-a" }] });
    expect(activateTab).toHaveBeenCalledExactlyOnceWith("browser-a");
  });

  it("ignores other threads and does not replay background requests on focus", () => {
    const activateTab = vi.fn();
    const { rerender } = renderHook(
      ({ isFocused }) =>
        useDesktopBrowserReveal({
          threadId: "thread-a",
          isFocused,
          browserTabs: [{ id: "browser-a" }],
          activateTab,
        }),
      { initialProps: { isFocused: false } },
    );
    reveal();
    rerender({ isFocused: true });
    reveal("thread-b");
    expect(activateTab).not.toHaveBeenCalled();
    reveal();
    expect(activateTab).toHaveBeenCalledExactlyOnceWith("browser-a");
  });

  it("discards a pending reveal when focus leaves before the tab arrives", () => {
    const activateTab = vi.fn();
    const { rerender } = renderHook(
      ({ isFocused, browserTabs }) =>
        useDesktopBrowserReveal({
          threadId: "thread-a",
          isFocused,
          browserTabs,
          activateTab,
        }),
      {
        initialProps: { isFocused: true, browserTabs: [] as { id: string }[] },
      },
    );
    reveal();
    rerender({ isFocused: false, browserTabs: [] });
    rerender({ isFocused: true, browserTabs: [{ id: "browser-a" }] });
    expect(activateTab).not.toHaveBeenCalled();
  });
});
