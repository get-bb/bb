// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserSnapshot,
  BbDesktopBrowserSnapshotHandler,
  BbDesktopBrowserViewBounds,
  BbDesktopInfo,
} from "@bb/server-contract";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { BROWSER_VIEW_BOUNDS_SYNC_EVENT } from "@/lib/browser-view-bounds-sync";
import { BrowserTabDeck } from "./BrowserTabDeck";
import { SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS } from "./panelChromeClasses";
import { resetBrowserViewPersistence } from "./browserViewVisibilityCoordinator";
import { threadSecondaryPanelResizingAtom } from "./threadSecondaryPanelAtoms";

interface RecordedBrowserCall {
  method: "attach" | "detach" | "setVisible" | "setBounds" | "navigate";
  bounds: BbDesktopBrowserViewBounds | null;
  tabId: string;
  visible: boolean | null;
}

interface RecordingBrowserApi {
  api: BbDesktopBrowserApi;
  calls: RecordedBrowserCall[];
  emitSnapshot: (snapshot: BbDesktopBrowserSnapshot) => void;
}

const DESKTOP_INFO: BbDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.1",
};

function createRecordingBrowserApi(): RecordingBrowserApi {
  const calls: RecordedBrowserCall[] = [];
  const snapshotListeners = new Set<BbDesktopBrowserSnapshotHandler>();
  const api: BbDesktopBrowserApi = {
    attach(request) {
      calls.push({
        method: "attach",
        bounds: request.bounds,
        tabId: request.tabId,
        visible: request.visible,
      });
    },
    detach(tabId) {
      calls.push({
        method: "detach",
        bounds: null,
        tabId,
        visible: null,
      });
    },
    navigate(request) {
      calls.push({
        method: "navigate",
        bounds: null,
        tabId: request.tabId,
        visible: null,
      });
    },
    goBack() {},
    goForward() {},
    reload() {},
    stop() {},
    setBounds(request) {
      calls.push({
        method: "setBounds",
        bounds: request.bounds,
        tabId: request.tabId,
        visible: null,
      });
    },
    setVisible(request) {
      calls.push({
        method: "setVisible",
        bounds: null,
        tabId: request.tabId,
        visible: request.visible,
      });
    },
    onState() {
      return () => {};
    },
    onOpenTab() {
      return () => {};
    },
    onSnapshot(listener) {
      snapshotListeners.add(listener);
      return () => {
        snapshotListeners.delete(listener);
      };
    },
  };
  return {
    api,
    calls,
    emitSnapshot(snapshot) {
      for (const listener of snapshotListeners) {
        listener(snapshot);
      }
    },
  };
}

function installDesktopBrowserApi(browser: BbDesktopBrowserApi): void {
  window.bbDesktop = createBbDesktopApi(DESKTOP_INFO, browser);
}

function browserTab(id: string, url: string): BrowserFixedPanelTab {
  return { id, kind: "browser", title: null, url };
}

const TAB_A = browserTab("browser:a", "https://a.example/");
const TAB_B = browserTab("browser:b", "https://b.example/");
const TAB_C = browserTab("browser:c", "https://c.example/");
const TAB_EMPTY = browserTab("browser:empty", "");

type RestoreHandler = () => void;

interface BrowserContentRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface BrowserViewportSize {
  height: number;
  width: number;
}

interface ThreadDeckHostProps {
  activeBrowserTabId: string | null;
  browserTabs: readonly BrowserFixedPanelTab[];
  threadId: string;
}

function ThreadDeckHost({
  activeBrowserTabId,
  browserTabs,
  threadId,
}: ThreadDeckHostProps) {
  return (
    <BrowserTabDeck
      key={threadId}
      browserTabs={browserTabs}
      activeBrowserTabId={activeBrowserTabId}
      environmentId="env_test"
      isPanelOpen
      threadId={threadId}
      onUpdate={() => {}}
    />
  );
}

function visibilityFor(
  calls: readonly RecordedBrowserCall[],
  tabId: string,
): boolean | null {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (
      call &&
      call.tabId === tabId &&
      (call.method === "setVisible" || call.method === "attach")
    ) {
      return call.visible;
    }
  }
  return null;
}

// Replays the recorded calls and returns the largest number of native views
// that were visible at the same time. Must always be ≤ 1: a native overlay is
// not hidden by `display:none`, so two visible views would overlap on screen.
function maxConcurrentVisible(calls: readonly RecordedBrowserCall[]): number {
  const visible = new Set<string>();
  let max = 0;
  for (const call of calls) {
    if (call.method === "attach" || call.method === "setVisible") {
      if (call.visible === true) {
        visible.add(call.tabId);
      } else if (call.visible === false) {
        visible.delete(call.tabId);
      }
    } else if (call.method === "detach") {
      visible.delete(call.tabId);
    }
    max = Math.max(max, visible.size);
  }
  return max;
}

function installBrowserContentRect(rect: BrowserContentRect): RestoreHandler {
  const rectMock = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(
      () => new DOMRect(rect.left, rect.top, rect.width, rect.height),
    );
  return () => rectMock.mockRestore();
}

function installViewportSize(size: BrowserViewportSize): RestoreHandler {
  const previousWidth = window.innerWidth;
  const previousHeight = window.innerHeight;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: size.width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: size.height,
  });
  return () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: previousWidth,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: previousHeight,
    });
  };
}

function lastSetBoundsFor(
  calls: readonly RecordedBrowserCall[],
  tabId: string,
): BbDesktopBrowserViewBounds | null {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (call?.method === "setBounds" && call.tabId === tabId) {
      return call.bounds;
    }
  }
  return null;
}

function attachBoundsFor(
  calls: readonly RecordedBrowserCall[],
  tabId: string,
): BbDesktopBrowserViewBounds | null {
  const call = calls.find(
    (candidate) => candidate.method === "attach" && candidate.tabId === tabId,
  );
  return call?.bounds ?? null;
}

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
  resetBrowserViewPersistence();
  window.localStorage.clear();
  // The resizing flag lives in the default jotai store, which persists across
  // tests in this module; reset it so a resize test never leaks into the next.
  getDefaultStore().set(threadSecondaryPanelResizingAtom, false);
});

describe("BrowserTabDeck", () => {
  it("uses the shared panel top chrome background for the browser nav bar", () => {
    const { api } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);

    render(
      <BrowserTabDeck
        browserTabs={[TAB_EMPTY]}
        activeBrowserTabId={TAB_EMPTY.id}
        environmentId="env_test"
        isPanelOpen
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );

    const navBar = screen.getByTestId("browser-tab-nav-bar");

    expect(navBar.className).toContain(
      SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS,
    );
    expect(navBar.className).toContain("border-border-seam");
    expect(navBar.className).not.toContain("bg-card");
  });

  it("uses the requested address placeholder and no empty-state message", () => {
    const { api } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);

    render(
      <BrowserTabDeck
        browserTabs={[TAB_EMPTY]}
        activeBrowserTabId={TAB_EMPTY.id}
        environmentId="env_test"
        isPanelOpen
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );

    expect(screen.getByLabelText("Address and search bar")).toHaveProperty(
      "placeholder",
      "Enter a URL",
    );
    expect(screen.queryByText(/Pages you visit appear here/u)).toBeNull();
  });

  it("creates a live view for every open browser tab and shows only the active one", () => {
    const { api, calls } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);

    render(
      <BrowserTabDeck
        browserTabs={[TAB_A, TAB_B]}
        activeBrowserTabId={TAB_A.id}
        environmentId="env_test"
        isPanelOpen
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );

    const attached = calls.filter((call) => call.method === "attach");
    expect(attached.map((call) => call.tabId).sort()).toEqual([
      TAB_A.id,
      TAB_B.id,
    ]);
    // The active tab is shown; the background tab stays attached but hidden.
    expect(visibilityFor(calls, TAB_A.id)).toBe(true);
    expect(visibilityFor(calls, TAB_B.id)).toBe(false);
  });

  it("keeps both views alive across a tab switch — no detach, no re-attach", () => {
    const { api, calls } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);

    const { rerender } = render(
      <BrowserTabDeck
        browserTabs={[TAB_A, TAB_B]}
        activeBrowserTabId={TAB_A.id}
        environmentId="env_test"
        isPanelOpen
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );

    calls.length = 0;

    // Switch the active tab from A to B and back to A.
    rerender(
      <BrowserTabDeck
        browserTabs={[TAB_A, TAB_B]}
        activeBrowserTabId={TAB_B.id}
        environmentId="env_test"
        isPanelOpen
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );
    rerender(
      <BrowserTabDeck
        browserTabs={[TAB_A, TAB_B]}
        activeBrowserTabId={TAB_A.id}
        environmentId="env_test"
        isPanelOpen
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );

    // Deactivation must never tear a view down or recreate it.
    expect(calls.some((call) => call.method === "detach")).toBe(false);
    expect(calls.some((call) => call.method === "attach")).toBe(false);
    // Visibility tracks the active tab: A ends up visible, B hidden.
    expect(visibilityFor(calls, TAB_A.id)).toBe(true);
    expect(visibilityFor(calls, TAB_B.id)).toBe(false);
  });

  it("hides but does not destroy the active view when a thread deck unmounts", () => {
    const { api, calls } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);

    const { unmount } = render(
      <BrowserTabDeck
        browserTabs={[TAB_A]}
        activeBrowserTabId={TAB_A.id}
        environmentId="env_test"
        isPanelOpen
        threadId="thr_one"
        onUpdate={() => {}}
      />,
    );

    calls.length = 0;

    unmount();

    expect(calls.some((call) => call.method === "detach")).toBe(false);
    expect(visibilityFor(calls, TAB_A.id)).toBe(false);
  });

  it("switches thread decks by hiding the old thread before showing the new one", () => {
    const { api, calls } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);

    const { rerender } = render(
      <ThreadDeckHost
        browserTabs={[TAB_A]}
        activeBrowserTabId={TAB_A.id}
        threadId="thr_one"
      />,
    );

    calls.length = 0;

    rerender(
      <ThreadDeckHost
        browserTabs={[TAB_C]}
        activeBrowserTabId={TAB_C.id}
        threadId="thr_two"
      />,
    );

    const hideOldThread = calls.findIndex(
      (call) =>
        call.method === "setVisible" &&
        call.tabId === TAB_A.id &&
        call.visible === false,
    );
    const newThreadBounds = calls.findIndex(
      (call) => call.method === "setBounds" && call.tabId === TAB_C.id,
    );
    const showNewThread = calls.findIndex(
      (call) =>
        call.method === "setVisible" &&
        call.tabId === TAB_C.id &&
        call.visible === true,
    );

    expect(hideOldThread).toBeGreaterThanOrEqual(0);
    expect(newThreadBounds).toBeGreaterThanOrEqual(0);
    expect(showNewThread).toBeGreaterThanOrEqual(0);
    expect(hideOldThread).toBeLessThan(showNewThread);
    expect(newThreadBounds).toBeLessThan(showNewThread);
    expect(calls.some((call) => call.method === "detach")).toBe(false);
    expect(maxConcurrentVisible(calls)).toBe(1);
  });

  it("syncs bounds before showing a newly-activated view (no stale-bounds flash)", () => {
    const { api, calls } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);

    const { rerender } = render(
      <BrowserTabDeck
        browserTabs={[TAB_A, TAB_B]}
        activeBrowserTabId={TAB_A.id}
        environmentId="env_test"
        isPanelOpen
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );

    calls.length = 0;

    rerender(
      <BrowserTabDeck
        browserTabs={[TAB_A, TAB_B]}
        activeBrowserTabId={TAB_B.id}
        environmentId="env_test"
        isPanelOpen
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );

    const bTabCalls = calls.filter((call) => call.tabId === TAB_B.id);
    const setBoundsIndex = bTabCalls.findIndex(
      (call) => call.method === "setBounds",
    );
    const showIndex = bTabCalls.findIndex(
      (call) => call.method === "setVisible" && call.visible === true,
    );
    expect(setBoundsIndex).toBeGreaterThanOrEqual(0);
    expect(showIndex).toBeGreaterThanOrEqual(0);
    expect(setBoundsIndex).toBeLessThan(showIndex);
  });

  it("resyncs bounds when the panel position changes without resizing", () => {
    const { api, calls } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);
    const restoreViewport = installViewportSize({ width: 1000, height: 700 });
    const rect: BrowserContentRect = {
      left: 320,
      top: 96,
      width: 480,
      height: 360,
    };
    const restoreRect = installBrowserContentRect(rect);
    try {
      render(
        <BrowserTabDeck
          browserTabs={[TAB_A]}
          activeBrowserTabId={TAB_A.id}
          environmentId="env_test"
          isPanelOpen
          threadId="thr_test"
          onUpdate={() => {}}
        />,
      );

      calls.length = 0;

      rect.left = 248;
      rect.top = 88;

      act(() => {
        window.dispatchEvent(new Event(BROWSER_VIEW_BOUNDS_SYNC_EVENT));
      });

      expect(lastSetBoundsFor(calls, TAB_A.id)).toEqual({
        x: 248,
        y: 88,
        width: 480,
        height: 360,
      });
    } finally {
      restoreRect();
      restoreViewport();
    }
  });

  it("anchors browser bounds to the content left edge and clamps them to the viewport", () => {
    const { api, calls } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);
    const restoreViewport = installViewportSize({ width: 500, height: 360 });
    const restoreRect = installBrowserContentRect({
      left: 180,
      top: 48,
      width: 400,
      height: 420,
    });

    try {
      render(
        <BrowserTabDeck
          browserTabs={[TAB_A]}
          activeBrowserTabId={TAB_A.id}
          environmentId="env_test"
          isPanelOpen
          threadId="thr_test"
          onUpdate={() => {}}
        />,
      );

      const expectedBounds: BbDesktopBrowserViewBounds = {
        x: 180,
        y: 48,
        width: 320,
        height: 312,
      };
      expect(attachBoundsFor(calls, TAB_A.id)).toEqual(expectedBounds);
      expect(lastSetBoundsFor(calls, TAB_A.id)).toEqual(expectedBounds);
    } finally {
      restoreRect();
      restoreViewport();
    }
  });

  it("streams fresh bounds from the window resize listener when the panel rect moves", () => {
    const { api, calls } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);
    const restoreViewport = installViewportSize({ width: 1000, height: 700 });
    const rect: BrowserContentRect = {
      left: 520,
      top: 96,
      width: 480,
      height: 604,
    };
    const restoreRect = installBrowserContentRect(rect);

    try {
      render(
        <BrowserTabDeck
          browserTabs={[TAB_A]}
          activeBrowserTabId={TAB_A.id}
          environmentId="env_test"
          isPanelOpen
          threadId="thr_test"
          onUpdate={() => {}}
        />,
      );

      calls.length = 0;

      // A native window resize translates a proportionally-laid-out panel:
      // ResizeObserver alone misses position-only moves, so the window resize
      // listener must re-measure and push the moved rect. The desktop main
      // process never extrapolates this itself — without this push the native
      // view would stay where the pre-resize layout put it.
      const restoreResizedViewport = installViewportSize({
        width: 1200,
        height: 700,
      });
      try {
        rect.left = 720;

        act(() => {
          window.dispatchEvent(new Event("resize"));
        });

        expect(lastSetBoundsFor(calls, TAB_A.id)).toEqual({
          x: 720,
          y: 96,
          width: 480,
          height: 604,
        });
      } finally {
        restoreResizedViewport();
      }
    } finally {
      restoreRect();
      restoreViewport();
    }
  });

  it("does not stream bounds IPC when a window resize leaves the panel rect unchanged", () => {
    const { api, calls } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);
    const restoreViewport = installViewportSize({ width: 1000, height: 700 });
    const restoreRect = installBrowserContentRect({
      left: 520,
      top: 96,
      width: 480,
      height: 604,
    });

    try {
      render(
        <BrowserTabDeck
          browserTabs={[TAB_A]}
          activeBrowserTabId={TAB_A.id}
          environmentId="env_test"
          isPanelOpen
          threadId="thr_test"
          onUpdate={() => {}}
        />,
      );

      calls.length = 0;

      // The viewport grows but the measured rect is identical, so the view has
      // nowhere to move: the bounds dedupe must drop the no-op tick instead of
      // streaming redundant IPC for every resize event.
      const restoreResizedViewport = installViewportSize({
        width: 1200,
        height: 700,
      });
      try {
        act(() => {
          window.dispatchEvent(new Event("resize"));
        });

        expect(
          calls.some(
            (call) => call.method === "setBounds" && call.tabId === TAB_A.id,
          ),
        ).toBe(false);
      } finally {
        restoreResizedViewport();
      }
    } finally {
      restoreRect();
      restoreViewport();
    }
  });

  it("hides the later view before showing the earlier one when switching B -> A", () => {
    const { api, calls } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);

    const { rerender } = render(
      <BrowserTabDeck
        browserTabs={[TAB_A, TAB_B]}
        activeBrowserTabId={TAB_A.id}
        environmentId="env_test"
        isPanelOpen
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );

    // Forward to the later tab, then back to the earlier one — the case where
    // the newly-active child's effect runs before the previously-active one's.
    rerender(
      <BrowserTabDeck
        browserTabs={[TAB_A, TAB_B]}
        activeBrowserTabId={TAB_B.id}
        environmentId="env_test"
        isPanelOpen
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );

    calls.length = 0;

    rerender(
      <BrowserTabDeck
        browserTabs={[TAB_A, TAB_B]}
        activeBrowserTabId={TAB_A.id}
        environmentId="env_test"
        isPanelOpen
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );

    const hideB = calls.findIndex(
      (call) =>
        call.method === "setVisible" &&
        call.tabId === TAB_B.id &&
        call.visible === false,
    );
    const showA = calls.findIndex(
      (call) =>
        call.method === "setVisible" &&
        call.tabId === TAB_A.id &&
        call.visible === true,
    );
    expect(hideB).toBeGreaterThanOrEqual(0);
    expect(showA).toBeGreaterThanOrEqual(0);
    expect(hideB).toBeLessThan(showA);
    expect(calls.some((call) => call.method === "detach")).toBe(false);
  });

  it("never has two browser views visible at once across repeated switches", () => {
    const { api, calls } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);

    const { rerender } = render(
      <BrowserTabDeck
        browserTabs={[TAB_A, TAB_B]}
        activeBrowserTabId={TAB_A.id}
        environmentId="env_test"
        isPanelOpen
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );

    for (const activeId of [TAB_B.id, TAB_A.id, TAB_B.id, TAB_A.id]) {
      rerender(
        <BrowserTabDeck
          browserTabs={[TAB_A, TAB_B]}
          activeBrowserTabId={activeId}
          environmentId="env_test"
          isPanelOpen
          threadId="thr_test"
          onUpdate={() => {}}
        />,
      );
    }

    expect(maxConcurrentVisible(calls)).toBe(1);
  });

  it("destroys a view only when its tab is closed", () => {
    const { api, calls } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);

    const { rerender } = render(
      <BrowserTabDeck
        browserTabs={[TAB_A, TAB_B]}
        activeBrowserTabId={TAB_B.id}
        environmentId="env_test"
        isPanelOpen
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );

    calls.length = 0;

    // Close tab A (it leaves the open-tabs list); B remains active.
    rerender(
      <BrowserTabDeck
        browserTabs={[TAB_B]}
        activeBrowserTabId={TAB_B.id}
        environmentId="env_test"
        isPanelOpen
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );

    const detached = calls.filter((call) => call.method === "detach");
    expect(detached.map((call) => call.tabId)).toEqual([TAB_A.id]);
  });

  it("hides the active view while the panel is closed without tearing it down", () => {
    const { api, calls } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);

    const { rerender } = render(
      <BrowserTabDeck
        browserTabs={[TAB_A]}
        activeBrowserTabId={TAB_A.id}
        environmentId="env_test"
        isPanelOpen
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );

    calls.length = 0;

    rerender(
      <BrowserTabDeck
        browserTabs={[TAB_A]}
        activeBrowserTabId={TAB_A.id}
        environmentId="env_test"
        isPanelOpen={false}
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );

    expect(calls.some((call) => call.method === "detach")).toBe(false);
    expect(visibilityFor(calls, TAB_A.id)).toBe(false);
  });

  it("keeps the active view visible and tracks its bounds while the panel is resized (no flash)", () => {
    const { api, calls } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);
    const store = getDefaultStore();
    const restoreViewport = installViewportSize({ width: 1000, height: 700 });
    const rect: BrowserContentRect = {
      left: 520,
      top: 96,
      width: 280,
      height: 360,
    };
    const restoreRect = installBrowserContentRect(rect);

    // Capture the callback the component subscribes its ResizeObserver with —
    // the drag-resize path runs through THIS (the panel handle shrinks/grows the
    // content element), not through `window.resize`. The shared jsdom polyfill
    // never fires, so we drive the real path by invoking the captured callback.
    const resizeCallbacks: Array<() => void> = [];
    class CapturingResizeObserver {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", CapturingResizeObserver);

    try {
      render(
        <BrowserTabDeck
          browserTabs={[TAB_A]}
          activeBrowserTabId={TAB_A.id}
          environmentId="env_test"
          isPanelOpen
          threadId="thr_test"
          onUpdate={() => {}}
        />,
      );
      expect(resizeCallbacks.length).toBeGreaterThan(0);

      const resizeStart = calls.length;
      act(() => {
        // Begin a drag-resize, then fire a ResizeObserver tick exactly as dragging
        // the panel handle resizes the content element.
        store.set(threadSecondaryPanelResizingAtom, true);
        rect.width = 340;
        for (const fireResizeTick of resizeCallbacks) {
          fireResizeTick();
        }
      });
      const duringResize = calls.slice(resizeStart);

      // The overlay must NOT be blanked mid-resize — hiding it for the whole drag
      // was the flash this fixes.
      expect(
        duringResize.some(
          (call) =>
            call.method === "setVisible" &&
            call.tabId === TAB_A.id &&
            call.visible === false,
        ),
      ).toBe(false);
      // Instead, the ResizeObserver tick pushes the freshly measured rect in
      // the same frame, keeping the native view in lockstep with the chrome.
      expect(
        duringResize.some(
          (call) => call.method === "setBounds" && call.tabId === TAB_A.id,
        ),
      ).toBe(true);
      // Net effect: the active view stays visible throughout the resize.
      expect(visibilityFor(calls, TAB_A.id)).toBe(true);
    } finally {
      restoreRect();
      restoreViewport();
      vi.unstubAllGlobals();
    }
  });

  it("paints the pushed resize snapshot over the panel and clears it on the null push", () => {
    const { api, emitSnapshot } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);

    render(
      <BrowserTabDeck
        browserTabs={[TAB_A]}
        activeBrowserTabId={TAB_A.id}
        environmentId="env_test"
        isPanelOpen
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );

    // While the native view is hidden for a window resize, the pushed bitmap
    // is the panel's stand-in.
    const dataUrl = "data:image/jpeg;base64,c25hcA==";
    act(() => {
      emitSnapshot({ tabId: TAB_A.id, dataUrl });
    });
    const placeholder = document.querySelector("img");
    expect(placeholder?.getAttribute("src")).toBe(dataUrl);

    // The resize settled and the live view is back: the null push removes the
    // stand-in underneath it.
    act(() => {
      emitSnapshot({ tabId: TAB_A.id, dataUrl: null });
    });
    expect(document.querySelector("img")).toBeNull();
  });
});
