// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  BbDesktopApi,
  BbDesktopBrowserApi,
  BbDesktopInfo,
  BbDesktopInfoChangeHandler,
} from "@bb/server-contract";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { BrowserTabDeck } from "./BrowserTabDeck";

interface RecordedBrowserCall {
  method: "attach" | "detach" | "setVisible" | "setBounds" | "navigate";
  tabId: string;
  visible: boolean | null;
}

interface RecordingBrowserApi {
  api: BbDesktopBrowserApi;
  calls: RecordedBrowserCall[];
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
  const api: BbDesktopBrowserApi = {
    attach(request) {
      calls.push({
        method: "attach",
        tabId: request.tabId,
        visible: request.visible,
      });
    },
    detach(tabId) {
      calls.push({ method: "detach", tabId, visible: null });
    },
    navigate(request) {
      calls.push({ method: "navigate", tabId: request.tabId, visible: null });
    },
    goBack() {},
    goForward() {},
    reload() {},
    stop() {},
    setBounds(request) {
      calls.push({ method: "setBounds", tabId: request.tabId, visible: null });
    },
    setVisible(request) {
      calls.push({
        method: "setVisible",
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
  };
  return { api, calls };
}

function installDesktopBrowserApi(browser: BbDesktopBrowserApi): void {
  const desktop: BbDesktopApi = {
    ...DESKTOP_INFO,
    browser,
    async checkForUpdates() {
      return DESKTOP_INFO;
    },
    async getInfo() {
      return DESKTOP_INFO;
    },
    async installUpdate() {
      return undefined;
    },
    onChange(_listener: BbDesktopInfoChangeHandler) {
      return () => undefined;
    },
    setTheme() {},
  };
  window.bbDesktop = desktop;
}

function browserTab(id: string, url: string): BrowserFixedPanelTab {
  return { id, kind: "browser", title: null, url };
}

const TAB_A = browserTab("browser:a", "https://a.example/");
const TAB_B = browserTab("browser:b", "https://b.example/");

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

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
  window.localStorage.clear();
});

describe("BrowserTabDeck", () => {
  it("creates a live view for every open browser tab and shows only the active one", () => {
    const { api, calls } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);

    render(
      <BrowserTabDeck
        browserTabs={[TAB_A, TAB_B]}
        activeBrowserTabId={TAB_A.id}
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
        isPanelOpen
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );
    rerender(
      <BrowserTabDeck
        browserTabs={[TAB_A, TAB_B]}
        activeBrowserTabId={TAB_A.id}
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

  it("syncs bounds before showing a newly-activated view (no stale-bounds flash)", () => {
    const { api, calls } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);

    const { rerender } = render(
      <BrowserTabDeck
        browserTabs={[TAB_A, TAB_B]}
        activeBrowserTabId={TAB_A.id}
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

  it("hides the later view before showing the earlier one when switching B -> A", () => {
    const { api, calls } = createRecordingBrowserApi();
    installDesktopBrowserApi(api);

    const { rerender } = render(
      <BrowserTabDeck
        browserTabs={[TAB_A, TAB_B]}
        activeBrowserTabId={TAB_A.id}
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
        isPanelOpen={false}
        threadId="thr_test"
        onUpdate={() => {}}
      />,
    );

    expect(calls.some((call) => call.method === "detach")).toBe(false);
    expect(visibilityFor(calls, TAB_A.id)).toBe(false);
  });
});
