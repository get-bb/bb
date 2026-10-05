// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
import { sdk } from "@/lib/sdk";
import { BrowserTabDeck } from "./BrowserTabDeck";
import { BrowserTabLifecycleObserver } from "./BrowserTabLifecycleObserver";
import {
  allowBrowserViewRecreation,
  resetBrowserViewPersistence,
} from "./browserViewVisibilityCoordinator";

type BrowserCall =
  | { type: "attach"; request: BbDesktopBrowserAttachRequest }
  | { type: "detach"; tabId: string }
  | { type: "setBounds"; request: BbDesktopBrowserSetBoundsRequest }
  | { type: "setVisible"; request: BbDesktopBrowserSetVisibleRequest }
  | {
      type: "setVisibleWithoutFocus";
      request: BbDesktopBrowserSetVisibleRequest;
    };

interface RecordingBrowserApi {
  api: BbDesktopBrowserApi;
  calls: BrowserCall[];
  detachments: string[];
  attachments: BbDesktopBrowserAttachRequest[];
  bounds: BbDesktopBrowserSetBoundsRequest[];
  emitState: (state: BbDesktopBrowserState) => void;
  visibility: BbDesktopBrowserSetVisibleRequest[];
  visibilityWithoutFocus: BbDesktopBrowserSetVisibleRequest[];
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
  const detachments: string[] = [];
  const stateListeners: Array<(state: BbDesktopBrowserState) => void> = [];
  const visibility: BbDesktopBrowserSetVisibleRequest[] = [];
  const visibilityWithoutFocus: BbDesktopBrowserSetVisibleRequest[] = [];
  const api: BbDesktopBrowserApi = {
    ...createNoopDesktopBrowserApi(),
    attach(request) {
      attachments.push(request);
      calls.push({ type: "attach", request });
    },
    detach(tabId) {
      detachments.push(tabId);
      calls.push({ type: "detach", tabId });
    },
    setBounds(request) {
      bounds.push(request);
      calls.push({ type: "setBounds", request });
    },
    setVisible(request) {
      visibility.push(request);
      calls.push({ type: "setVisible", request });
    },
    setVisibleWithoutFocus(request) {
      visibilityWithoutFocus.push(request);
      calls.push({ type: "setVisibleWithoutFocus", request });
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
    detachments,
    emitState(state) {
      for (const listener of stateListeners) {
        listener(state);
      }
    },
    visibility,
    visibilityWithoutFocus,
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

describe("BrowserTabLifecycleObserver", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetBrowserViewPersistence();
    delete window.bbDesktop;
  });

  it("destroys a closed browser view exactly once without an active deck", async () => {
    const { api, detachments, visibility } = createRecordingBrowserApi();
    installDesktopBrowser(api);
    const tab = makeBrowserTab("tab-closed", "https://example.com");
    const view = render(
      <BrowserTabLifecycleObserver browserTabs={[tab]} threadId="thread-1" />,
    );

    await waitFor(() => expect(detachments).toHaveLength(0));
    view.rerender(
      <BrowserTabLifecycleObserver browserTabs={[]} threadId="thread-1" />,
    );

    await waitFor(() => expect(detachments).toEqual(["tab-closed"]));
    expect(
      visibility.filter((request) => request.tabId === "tab-closed"),
    ).toEqual([{ tabId: "tab-closed", visible: false }]);
  });
});

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

  const desktopTarget = {
    hostId: "host-1",
    instanceId: "instance-1",
    generation: "generation-1",
  };
  const renderTargetDeck = (browserTab: BrowserFixedPanelTab) => (
    <BrowserTabDeck
      browserTabs={[browserTab]}
      activeBrowserTabId={browserTab.id}
      environmentId="env-1"
      canShowNativeBrowserView
      threadId="thread-1"
      onUpdate={() => {}}
    />
  );
  const savedTab = (saved: Partial<typeof desktopTarget>) => ({
    ...makeBrowserTab("native-tab", "https://example.com/saved"),
    desktopTarget: { ...desktopTarget, ...saved },
  });

  it("shows the saved URL instead of attaching a tab from another machine", async () => {
    const { api, attachments } = createRecordingBrowserApi();
    api.getTarget = async () => desktopTarget;
    installDesktopBrowser(api);
    const tab = savedTab({ hostId: "host-2" });
    const view = render(renderTargetDeck(tab));
    await screen.findByText("This tab is open on another computer");
    expect(screen.getByText("https://example.com/saved")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Open in browser" }),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Copy link" })).not.toBeNull();
    expect(attachments).toEqual([]);
    view.rerender(renderTargetDeck({ ...tab, desktopTarget }));
    await waitFor(() => expect(attachments).toHaveLength(1));
    expect(attachments[0]?.existingOnly).toBe(true);
  });

  it("does not clone a tab that another live window still owns", async () => {
    const { api, attachments } = createRecordingBrowserApi();
    api.getTarget = async () => desktopTarget;
    installDesktopBrowser(api);
    vi.spyOn(
      sdk.experimental_desktopBrowsers,
      "listInstances",
    ).mockResolvedValue({
      instances: [
        { ...desktopTarget, label: "BB window 1" },
        { ...desktopTarget, instanceId: "elsewhere", label: "BB window 2" },
      ],
    });
    render(renderTargetDeck(savedTab({ instanceId: "elsewhere" })));
    await screen.findByText("This tab is open in another bb window");
    expect(attachments).toEqual([]);
  });

  it.each(["select another tab", "retry"] as const)(
    "rechecks a previously live window when users %s after it closes",
    async (action) => {
      const { api, attachments } = createRecordingBrowserApi();
      api.getTarget = async () => desktopTarget;
      installDesktopBrowser(api);
      const list = vi.spyOn(sdk.experimental_desktopBrowsers, "listInstances");
      list.mockResolvedValue({
        instances: [
          { ...desktopTarget, label: "Current" },
          { ...desktopTarget, instanceId: "elsewhere", label: "Other" },
        ],
      });
      const tab = savedTab({ instanceId: "elsewhere" });
      const view = render(renderTargetDeck(tab));
      await screen.findByText("This tab is open in another bb window");
      expect(attachments).toEqual([]);
      list.mockResolvedValue({
        instances: [{ ...desktopTarget, label: "Current" }],
      });
      const selected =
        action === "retry" ? tab : { ...tab, id: "another-saved-tab" };
      if (action === "retry")
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      else view.rerender(renderTargetDeck(selected));
      await waitFor(() => expect(attachments).toHaveLength(1));
      expect(attachments[0]).toMatchObject({
        tabId: selected.id,
        url: selected.url,
      });
      expect(attachments[0]?.existingOnly).toBeUndefined();
    },
  );

  it("reopens the saved URL when the window that owned the tab is gone", async () => {
    const { api, attachments } = createRecordingBrowserApi();
    api.getTarget = async () => desktopTarget;
    installDesktopBrowser(api);
    vi.spyOn(
      sdk.experimental_desktopBrowsers,
      "listInstances",
    ).mockResolvedValue({
      instances: [{ ...desktopTarget, label: "BB window 1" }],
    });
    render(renderTargetDeck(savedTab({ instanceId: "closed-window" })));
    await waitFor(() => expect(attachments).toHaveLength(1));
    expect(attachments[0]).toMatchObject({
      tabId: "native-tab",
      url: "https://example.com/saved",
    });
    expect(attachments[0]?.existingOnly).toBeUndefined();
    expect(
      screen.queryByText("This tab is open in another bb window"),
    ).toBeNull();
  });

  it("keeps a reopened tab visible after the server moves it to this window", async () => {
    const { api, calls } = createRecordingBrowserApi();
    api.getTarget = async () => desktopTarget;
    installDesktopBrowser(api);
    vi.spyOn(
      sdk.experimental_desktopBrowsers,
      "listInstances",
    ).mockResolvedValue({
      instances: [{ ...desktopTarget, label: "BB window 1" }],
    });
    const orphan = savedTab({ instanceId: "closed-window" });
    const view = render(renderTargetDeck(orphan));
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.type === "setVisibleWithoutFocus" && call.request.visible,
        ),
      ).toBe(true),
    );
    const shownAt = calls.length;
    view.rerender(renderTargetDeck({ ...orphan, desktopTarget }));
    await act(async () => {});
    const after = calls.slice(shownAt);
    expect(after.some((call) => call.type === "attach")).toBe(false);
    expect(
      after.some(
        (call) =>
          (call.type === "setVisible" ||
            call.type === "setVisibleWithoutFocus") &&
          !call.request.visible,
      ),
    ).toBe(false);
  });

  it("waits for the desktop connection after a relaunch instead of falling back", async () => {
    const { api, attachments } = createRecordingBrowserApi();
    const getTarget = vi
      .fn<() => Promise<typeof desktopTarget | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(desktopTarget);
    api.getTarget = getTarget;
    installDesktopBrowser(api);
    vi.spyOn(
      sdk.experimental_desktopBrowsers,
      "listInstances",
    ).mockResolvedValue({
      instances: [{ ...desktopTarget, label: "BB window 1" }],
    });
    render(renderTargetDeck(savedTab({ instanceId: "closed-window" })));
    expect(screen.queryByText("Reconnecting to this tab")).toBeNull();
    await waitFor(() => expect(attachments).toHaveLength(1), { timeout: 3000 });
    expect(getTarget).toHaveBeenCalledTimes(3);
    expect(attachments[0]?.existingOnly).toBeUndefined();
    expect(screen.queryByText("Reconnecting to this tab")).toBeNull();
  });

  it("says it is reconnecting, not that the tab is elsewhere, while the desktop stays offline", async () => {
    const { api, attachments } = createRecordingBrowserApi();
    api.getTarget = async () => null;
    installDesktopBrowser(api);
    render(renderTargetDeck(savedTab({})));
    await screen.findByText("Reconnecting to this tab", undefined, {
      timeout: 4000,
    });
    expect(
      screen.queryByText("This tab is open on another computer"),
    ).toBeNull();
    expect(attachments).toEqual([]);
  });

  it("stops checking after about a minute and lets the user try again", async () => {
    vi.useFakeTimers();
    try {
      const { api } = createRecordingBrowserApi();
      const getTarget = vi.fn(async () => null);
      api.getTarget = getTarget;
      installDesktopBrowser(api);
      render(renderTargetDeck(savedTab({})));
      await act(() => vi.advanceTimersByTimeAsync(70_000));
      const stoppedAt = getTarget.mock.calls.length;
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      expect(getTarget).toHaveBeenCalledTimes(stoppedAt);
      expect(screen.getByText("Can't reach this tab")).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await act(() => vi.advanceTimersByTimeAsync(1_000));
      expect(getTarget.mock.calls.length).toBeGreaterThan(stoppedAt);
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries the open-window check when it fails", async () => {
    const { api, attachments } = createRecordingBrowserApi();
    api.getTarget = async () => desktopTarget;
    installDesktopBrowser(api);
    const listInstances = vi
      .spyOn(sdk.experimental_desktopBrowsers, "listInstances")
      .mockRejectedValueOnce(new Error("host busy"))
      .mockRejectedValueOnce(new Error("host busy"))
      .mockResolvedValue({
        instances: [{ ...desktopTarget, label: "BB window 1" }],
      });
    render(renderTargetDeck(savedTab({ instanceId: "closed-window" })));
    await waitFor(() => expect(attachments).toHaveLength(1), { timeout: 3000 });
    expect(listInstances).toHaveBeenCalledTimes(3);
    expect(attachments[0]?.existingOnly).toBeUndefined();
  });

  it("reattaches its own window's tab after a reconnect rotates the generation", async () => {
    const { api, attachments } = createRecordingBrowserApi();
    api.getTarget = async () => desktopTarget;
    installDesktopBrowser(api);
    render(renderTargetDeck(savedTab({ generation: "before-reconnect" })));
    await waitFor(() => expect(attachments).toHaveLength(1));
    expect(attachments[0]?.existingOnly).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///tmp/private",
  ])(
    "shows a saved %s URL without offering to open it externally",
    async (url) => {
      render(renderTargetDeck({ ...savedTab({}), url }));
      await screen.findByText("Browser tabs need the desktop app");
      expect(screen.getByText(url)).not.toBeNull();
      expect(
        screen.queryByRole("button", { name: "Open in browser" }),
      ).toBeNull();
      expect(screen.getByRole("button", { name: "Copy link" })).not.toBeNull();
    },
  );

  it("explains that desktop tabs need the desktop app on web", async () => {
    render(renderTargetDeck(savedTab({})));
    await screen.findByText("Browser tabs need the desktop app");
    expect(screen.getByText("https://example.com/saved")).not.toBeNull();
  });

  it("recreates an explicitly reopened page once when its owning desktop activates it", async () => {
    const { api, attachments } = createRecordingBrowserApi();
    const desktopTarget = {
      hostId: "host-1",
      instanceId: "instance-1",
      generation: "generation-1",
    };
    api.getTarget = async () => desktopTarget;
    installDesktopBrowser(api);
    const tab = {
      ...makeBrowserTab("reopened-native-tab", "https://latest.example"),
      desktopTarget,
    };
    allowBrowserViewRecreation(tab.id, desktopTarget);
    const deck = (activeBrowserTabId: string | null) => (
      <BrowserTabDeck
        browserTabs={[tab]}
        activeBrowserTabId={activeBrowserTabId}
        environmentId="env-1"
        canShowNativeBrowserView
        threadId="thread-1"
        onUpdate={() => {}}
      />
    );
    const view = render(deck(null));
    await act(async () => {});
    expect(attachments).toEqual([]);
    view.rerender(deck(tab.id));
    await waitFor(() => expect(attachments).toHaveLength(1));
    expect(attachments[0]?.existingOnly).toBeUndefined();
    expect(attachments[0]?.url).toBe("https://latest.example");
    view.rerender(deck(null));
    view.rerender(deck(tab.id));
    await waitFor(() => expect(attachments).toHaveLength(2));
    expect(attachments[1]?.existingOnly).toBe(true);
  });

  it("attaches a URL-bearing tab hidden and shows only after attach plus compact drawer readiness", async () => {
    const {
      api,
      calls,
      attachments,
      bounds,
      visibility,
      visibilityWithoutFocus,
    } = createRecordingBrowserApi();
    installDesktopBrowser(api);

    const view = renderBrowserDeck({ canShowNativeBrowserView: false });

    await waitFor(() => {
      expect(attachments).toHaveLength(1);
    });

    expect(attachments[0]).toEqual({
      tabId: "tab-url",
      threadId: "thread-1",
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
      expect(visibilityWithoutFocus.some((request) => request.visible)).toBe(
        true,
      );
      expect(visibility.some((request) => request.visible)).toBe(false);
    });

    const attachIndex = callIndex(calls, (call) => call.type === "attach");
    const boundsIndex = callIndex(
      calls,
      (call) => call.type === "setBounds" && call.request.tabId === "tab-url",
    );
    const showIndex = callIndex(
      calls,
      (call) =>
        call.type === "setVisibleWithoutFocus" &&
        call.request.tabId === "tab-url" &&
        call.request.visible,
    );

    expect(attachIndex).toBeGreaterThanOrEqual(0);
    expect(attachments[0]?.threadId).toBe("thread-1");
    expect(boundsIndex).toBeGreaterThan(attachIndex);
    expect(showIndex).toBeGreaterThan(boundsIndex);
    expect(bounds.at(-1)).toEqual({
      tabId: "tab-url",
      bounds: { x: 12, y: 24, width: 420, height: 260 },
    });
    expect(visibilityWithoutFocus.at(-1)).toEqual({
      tabId: "tab-url",
      visible: true,
    });

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
      const visibleShows = visibilityWithoutFocus.filter(
        (request) => request.visible,
      );
      expect(visibleShows).toHaveLength(2);
    });
    const restoredBoundsIndex = lastCallIndex(
      calls,
      (call) => call.type === "setBounds" && call.request.tabId === "tab-url",
    );
    const restoredShowIndex = lastCallIndex(
      calls,
      (call) =>
        call.type === "setVisibleWithoutFocus" &&
        call.request.tabId === "tab-url" &&
        call.request.visible,
    );
    expect(hideIndex).toBeGreaterThan(showIndex);
    expect(restoredBoundsIndex).toBeGreaterThan(hideIndex);
    expect(restoredShowIndex).toBeGreaterThan(restoredBoundsIndex);
  });

  it("keeps an unfocused split view hidden on a legacy desktop focus bridge", async () => {
    const { api, attachments, visibility } = createRecordingBrowserApi();
    const { focus: _focus, onFocus: _onFocus, ...legacyApi } = api;
    installDesktopBrowser(legacyApi);

    render(
      <BrowserTabDeck
        browserTabs={[makeBrowserTab("tab-url", "https://example.com")]}
        activeBrowserTabId="tab-url"
        environmentId="env-1"
        canShowNativeBrowserView
        canHandleBrowserCommands={false}
        threadId="thread-1"
        onUpdate={() => {}}
      />,
    );

    await waitFor(() => expect(attachments).toHaveLength(1));
    expect(visibility.some((request) => request.visible)).toBe(false);
  });

  it("shows an unfocused split view without moving native focus", async () => {
    const { api, attachments, visibility, visibilityWithoutFocus } =
      createRecordingBrowserApi();
    installDesktopBrowser(api);

    render(
      <BrowserTabDeck
        browserTabs={[makeBrowserTab("tab-url", "https://example.com")]}
        activeBrowserTabId="tab-url"
        environmentId="env-1"
        canShowNativeBrowserView
        canHandleBrowserCommands={false}
        threadId="thread-1"
        onUpdate={() => {}}
      />,
    );

    await waitFor(() => expect(attachments).toHaveLength(1));
    await waitFor(() =>
      expect(visibilityWithoutFocus).toContainEqual({
        tabId: "tab-url",
        visible: true,
      }),
    );
    expect(visibility.some((request) => request.visible)).toBe(false);
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
    const { api, emitState, visibility, visibilityWithoutFocus } =
      createRecordingBrowserApi();
    installDesktopBrowser(api);

    renderBrowserDeck({
      canShowNativeBrowserView: true,
      url: "http://localhost:12843/",
    });

    await waitFor(() => {
      expect(visibilityWithoutFocus.some((request) => request.visible)).toBe(
        true,
      );
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
