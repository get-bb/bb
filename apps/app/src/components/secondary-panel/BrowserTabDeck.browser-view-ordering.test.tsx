// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserAttachRequest,
  BbDesktopBrowserSetBoundsRequest,
  BbDesktopBrowserSetVisibleRequest,
} from "@bb/desktop-contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/bb-desktop-test-utils";
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
  };
  return { api, calls, attachments, bounds, visibility };
}

function installDesktopBrowser(api: BbDesktopBrowserApi): void {
  window.bbDesktop = createBbDesktopApi(desktopInfo, api);
}

function renderBrowserDeck({
  canShowNativeBrowserView,
}: {
  canShowNativeBrowserView: boolean;
}) {
  const tab = makeBrowserTab("tab-url", "https://example.com");
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

describe("BrowserTabDeck native browser first-show ordering", () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

  beforeEach(() => {
    Object.defineProperty(Element.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => BROWSER_PANEL_RECT,
    });
  });

  afterEach(() => {
    cleanup();
    resetBrowserViewPersistence();
    window.localStorage.clear();
    delete window.bbDesktop;
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
      (call) =>
        call.type === "setBounds" && call.request.tabId === "tab-url",
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
  });
});
