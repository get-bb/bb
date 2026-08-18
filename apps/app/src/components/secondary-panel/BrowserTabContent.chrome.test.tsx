// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserState,
} from "@bb/desktop-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/bb-desktop-test-utils";
import { BrowserTabContent } from "./BrowserTabContent";

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

interface BrowserChromeHarness {
  api: BbDesktopBrowserApi;
  emitState: (state: BbDesktopBrowserState) => void;
  goBack: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function createBrowserChromeHarness(): BrowserChromeHarness {
  const stateListeners = new Set<(state: BbDesktopBrowserState) => void>();
  const goBack = vi.fn();
  const stop = vi.fn();
  const api: BbDesktopBrowserApi = {
    ...createNoopDesktopBrowserApi(),
    goBack,
    stop,
    onState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
  };
  return {
    api,
    emitState(state) {
      for (const listener of stateListeners) listener(state);
    },
    goBack,
    stop,
  };
}

function browserState(
  overrides: Partial<BbDesktopBrowserState> = {},
): BbDesktopBrowserState {
  return {
    tabId: "browser:test",
    url: "https://example.com/docs",
    title: "Example docs",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    errorText: null,
    ...overrides,
  };
}

function renderBrowserChrome(harness: BrowserChromeHarness, initialUrl = "") {
  window.bbDesktop = createBbDesktopApi(desktopInfo, harness.api);
  return render(
    <>
      <BrowserTabContent
        tabId="browser:test"
        initialUrl={initialUrl}
        addressFocusRequest={null}
        canShowNativeBrowserView={false}
        visibilityCoordinator={null}
        environmentId={null}
        threadId="thread-1"
        onUpdate={() => {}}
      />
      <button type="button">Outside browser</button>
    </>,
  );
}

function expectChromeVisible(): HTMLElement {
  const chrome = screen.getByTestId("browser-tab-nav-bar");
  expect(chrome.dataset.state).toBe("expanded");
  return chrome;
}

describe("BrowserTabContent persistent navigation", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
    delete window.bbDesktop;
  });

  it("keeps the top navigation visible through pointer and focus changes", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");
    const chrome = expectChromeVisible();

    fireEvent.pointerLeave(chrome);
    act(() => screen.getByRole("button", { name: "Outside browser" }).focus());
    expectChromeVisible();
    expect(screen.getByLabelText("Address and search bar")).not.toBeNull();
  });

  it("keeps navigation visible while loading and preserves the stop action", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");

    act(() => harness.emitState(browserState({ isLoading: true })));
    expectChromeVisible();

    const stopButton = screen.getByRole("button", { name: "Stop loading" });
    fireEvent.click(stopButton);
    expect(harness.stop).toHaveBeenCalledWith("browser:test");
  });

  it("preserves browser navigation actions", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");
    expectChromeVisible();

    act(() => harness.emitState(browserState({ canGoBack: true })));
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(harness.goBack).toHaveBeenCalledWith("browser:test");
  });
});
