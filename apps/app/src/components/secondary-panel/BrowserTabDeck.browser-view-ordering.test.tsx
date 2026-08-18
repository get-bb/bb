// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserAttachRequest,
  BbDesktopBrowserSetBoundsRequest,
  BbDesktopBrowserSetVisibleRequest,
  BbDesktopBrowserState,
} from "@bb/desktop-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/bb-desktop-test-utils";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { BrowserTabDeck } from "./BrowserTabDeck";
import { resetBrowserViewPersistence } from "./browserViewVisibilityCoordinator";

type BrowserCall =
  | { type: "attach"; request: BbDesktopBrowserAttachRequest }
  | { type: "setBounds"; request: BbDesktopBrowserSetBoundsRequest }
  | { type: "setVisible"; request: BbDesktopBrowserSetVisibleRequest };

interface RecordingBrowserApi {
  api: BbDesktopBrowserApi;
  calls: BrowserCall[];
  attachments: BbDesktopBrowserAttachRequest[];
  bounds: BbDesktopBrowserSetBoundsRequest[];
  emitState: (state: BbDesktopBrowserState) => void;
  visibility: BbDesktopBrowserSetVisibleRequest[];
}

const BROWSER_PANEL_RECT = new DOMRect(12, 24, 420, 260);

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

function makeBrowserTab(id: string, url: string): BrowserFixedPanelTab {
  return {
    environmentId: "env-1",
    id,
    kind: "browser",
    title: null,
    url,
  };
}

function createRecordingBrowserApi(): RecordingBrowserApi {
  const calls: BrowserCall[] = [];
  const attachments: BbDesktopBrowserAttachRequest[] = [];
  const bounds: BbDesktopBrowserSetBoundsRequest[] = [];
  const stateListeners: Array<(state: BbDesktopBrowserState) => void> = [];
  const visibility: BbDesktopBrowserSetVisibleRequest[] = [];
  const api: BbDesktopBrowserApi = {
    ...createNoopDesktopBrowserApi(),
    attach(request) {
      attachments.push(request);
      calls.push({ type: "attach", request });
    },
    setBounds(request) {
      bounds.push(request);
      calls.push({ type: "setBounds", request });
    },
    setVisible(request) {
      visibility.push(request);
      calls.push({ type: "setVisible", request });
    },
    onState(listener) {
      stateListeners.push(listener);
      return () => {
        const index = stateListeners.indexOf(listener);
        if (index >= 0) {
          stateListeners.splice(index, 1);
        }
      };
    },
  };
  return {
    api,
    calls,
    attachments,
    bounds,
    emitState(state) {
      for (const listener of stateListeners) {
        listener(state);
      }
    },
    visibility,
  };
}

function installDesktopBrowser(api: BbDesktopBrowserApi): void {
  window.bbDesktop = createBbDesktopApi(desktopInfo, api);
}

function createMatchMedia(
  matchesPointerCoarse: boolean,
): typeof window.matchMedia {
  return vi.fn().mockImplementation((query: string) => ({
    matches: query === POINTER_COARSE_QUERY && matchesPointerCoarse,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function renderBrowserDeck({
  canShowNativeBrowserView,
  url = "https://example.com",
}: {
  canShowNativeBrowserView: boolean;
  url?: string;
}) {
  const tab = makeBrowserTab("tab-url", url);
  return render(
    <BrowserTabDeck
      browserTabs={[tab]}
      activeBrowserTabId={tab.id}
      environmentId="env-1"
      canShowNativeBrowserView={canShowNativeBrowserView}
      threadId="thread-1"
      onUpdate={() => {}}
    />,
  );
}

function callIndex(
  calls: readonly BrowserCall[],
  predicate: (call: BrowserCall) => boolean,
): number {
  return calls.findIndex(predicate);
}

function lastCallIndex(
  calls: readonly BrowserCall[],
  predicate: (call: BrowserCall) => boolean,
): number {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (call !== undefined && predicate(call)) return index;
  }
  return -1;
}

describe("BrowserTabDeck native browser first-show ordering", () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    Object.defineProperty(Element.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => BROWSER_PANEL_RECT,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: createMatchMedia(false),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetBrowserViewPersistence();
    window.localStorage.clear();
    delete window.bbDesktop;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
    Object.defineProperty(Element.prototype, "getBoundingClientRect", {
      configurable: true,
      value: originalGetBoundingClientRect,
    });
  });

  it("attaches a URL-bearing tab hidden and shows only after attach plus compact drawer readiness", async () => {
    const { api, calls, attachments, bounds, visibility } =
      createRecordingBrowserApi();
    installDesktopBrowser(api);

    const view = renderBrowserDeck({ canShowNativeBrowserView: false });

    await waitFor(() => {
      expect(attachments).toHaveLength(1);
    });

    expect(attachments[0]).toEqual({
      tabId: "tab-url",
      url: "https://example.com",
      bounds: { x: 12, y: 24, width: 420, height: 260 },
      visible: false,
    });
    expect(visibility.some((request) => request.visible)).toBe(false);
    expect(bounds).toHaveLength(0);

    view.rerender(
      <BrowserTabDeck
        browserTabs={[makeBrowserTab("tab-url", "https://example.com")]}
        activeBrowserTabId="tab-url"
        environmentId="env-1"
        canShowNativeBrowserView={true}
        threadId="thread-1"
        onUpdate={() => {}}
      />,
    );

    await waitFor(() => {
      expect(visibility.some((request) => request.visible)).toBe(true);
    });

    const attachIndex = callIndex(calls, (call) => call.type === "attach");
    const boundsIndex = callIndex(
      calls,
      (call) => call.type === "setBounds" && call.request.tabId === "tab-url",
    );
    const showIndex = callIndex(
      calls,
      (call) =>
        call.type === "setVisible" &&
        call.request.tabId === "tab-url" &&
        call.request.visible,
    );

    expect(attachIndex).toBeGreaterThanOrEqual(0);
    expect(boundsIndex).toBeGreaterThan(attachIndex);
    expect(showIndex).toBeGreaterThan(boundsIndex);
    expect(bounds.at(-1)).toEqual({
      tabId: "tab-url",
      bounds: { x: 12, y: 24, width: 420, height: 260 },
    });
    expect(visibility.at(-1)).toEqual({ tabId: "tab-url", visible: true });

    // Focus leaving the owning pane drives readiness false. Returning focus
    // must recompute bounds before exposing the retained native view again.
    view.rerender(
      <BrowserTabDeck
        browserTabs={[makeBrowserTab("tab-url", "https://example.com")]}
        activeBrowserTabId="tab-url"
        environmentId="env-1"
        canShowNativeBrowserView={false}
        threadId="thread-1"
        onUpdate={() => {}}
      />,
    );
    await waitFor(() => {
      expect(visibility.at(-1)).toEqual({
        tabId: "tab-url",
        visible: false,
      });
    });
    const hideIndex = lastCallIndex(
      calls,
      (call) =>
        call.type === "setVisible" &&
        call.request.tabId === "tab-url" &&
        !call.request.visible,
    );

    view.rerender(
      <BrowserTabDeck
        browserTabs={[makeBrowserTab("tab-url", "https://example.com")]}
        activeBrowserTabId="tab-url"
        environmentId="env-1"
        canShowNativeBrowserView={true}
        threadId="thread-1"
        onUpdate={() => {}}
      />,
    );
    await waitFor(() => {
      const visibleShows = visibility.filter((request) => request.visible);
      expect(visibleShows).toHaveLength(2);
    });
    const restoredBoundsIndex = lastCallIndex(
      calls,
      (call) => call.type === "setBounds" && call.request.tabId === "tab-url",
    );
    const restoredShowIndex = lastCallIndex(
      calls,
      (call) =>
        call.type === "setVisible" &&
        call.request.tabId === "tab-url" &&
        call.request.visible,
    );
    expect(hideIndex).toBeGreaterThan(showIndex);
    expect(restoredBoundsIndex).toBeGreaterThan(hideIndex);
    expect(restoredShowIndex).toBeGreaterThan(restoredBoundsIndex);
  });

  it("destroys the persisted native view when the final Browser tab is removed", async () => {
    const { api, attachments } = createRecordingBrowserApi();
    const detach = vi.fn();
    api.detach = detach;
    installDesktopBrowser(api);
    const view = renderBrowserDeck({ canShowNativeBrowserView: true });

    await waitFor(() => expect(attachments).toHaveLength(1));

    view.rerender(
      <BrowserTabDeck
        browserTabs={[]}
        activeBrowserTabId={null}
        environmentId="env-1"
        canShowNativeBrowserView={false}
        threadId="thread-1"
        onUpdate={() => {}}
      />,
    );

    await waitFor(() => expect(detach).toHaveBeenCalledWith("tab-url"));
  });

  it("focuses the address bar when an empty browser tab requests focus", () => {
    const { api } = createRecordingBrowserApi();
    installDesktopBrowser(api);
    const focusSpy = vi
      .spyOn(HTMLInputElement.prototype, "focus")
      .mockImplementation(() => {});
    const tab = makeBrowserTab("tab-url", "");

    render(
      <BrowserTabDeck
        browserTabs={[tab]}
        activeBrowserTabId={tab.id}
        addressFocusRequest={{ requestId: 1, tabId: tab.id }}
        environmentId="env-1"
        canShowNativeBrowserView={true}
        threadId="thread-1"
        onUpdate={() => {}}
      />,
    );

    expect(screen.getByLabelText("Address and search bar")).toBeTruthy();
    expect(focusSpy).toHaveBeenCalled();
  });

  it("shows a neutral page state and hides the native view after a main-frame load error", async () => {
    const { api, emitState, visibility } = createRecordingBrowserApi();
    installDesktopBrowser(api);

    renderBrowserDeck({
      canShowNativeBrowserView: true,
      url: "http://localhost:12843/",
    });

    await waitFor(() => {
      expect(visibility.some((request) => request.visible)).toBe(true);
    });

    act(() => {
      emitState({
        tabId: "tab-url",
        url: "http://localhost:12843/",
        title: null,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        errorText: "ERR_BLOCKED_BY_CLIENT",
      });
    });

    expect(await screen.findByText("Server not reachable")).toBeTruthy();
    expect(screen.getByText(/Start the server, then reload\./)).toBeTruthy();
    expect(screen.getByText("ERR_BLOCKED_BY_CLIENT")).toBeTruthy();

    await waitFor(() => {
      expect(visibility.at(-1)).toEqual({
        tabId: "tab-url",
        visible: false,
      });
    });
  });
});
