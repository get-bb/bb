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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/bb-desktop-test-utils";
import {
  BROWSER_CHROME_IDLE_COLLAPSE_MS,
  BrowserTabContent,
} from "./BrowserTabContent";
import { requestBrowserChromeReveal } from "./browserChromeReveal";

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

function expectChromeState(expected: "collapsed" | "expanded"): HTMLElement {
  const chrome = screen.getByTestId("browser-tab-nav-bar");
  expect(chrome.dataset.state).toBe(expected);
  expect(chrome.getAttribute("aria-expanded")).toBe(
    expected === "expanded" ? "true" : "false",
  );
  return chrome;
}

function advanceIdleTimer(milliseconds: number): void {
  act(() => {
    vi.advanceTimersByTime(milliseconds);
  });
}

describe("BrowserTabContent auto-collapsing navigation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.localStorage.clear();
    delete window.bbDesktop;
  });

  it("collapses after the short idle delay without a duplicate URL footer", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");

    expectChromeState("expanded");
    advanceIdleTimer(BROWSER_CHROME_IDLE_COLLAPSE_MS - 1);
    expectChromeState("expanded");
    advanceIdleTimer(1);
    const collapsedChrome = expectChromeState("collapsed");
    expect(collapsedChrome.classList).toContain("h-1");
    expect(screen.queryByText("example.com")).toBeNull();
  });

  it("expands from the top strip on pointer entry and stays open while hovered", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness);
    const chrome = expectChromeState("expanded");

    advanceIdleTimer(BROWSER_CHROME_IDLE_COLLAPSE_MS);
    expectChromeState("collapsed");

    fireEvent.pointerEnter(chrome);
    expectChromeState("expanded");
    advanceIdleTimer(BROWSER_CHROME_IDLE_COLLAPSE_MS * 2);
    expectChromeState("expanded");

    fireEvent.pointerLeave(chrome);
    expectChromeState("expanded");
    advanceIdleTimer(BROWSER_CHROME_IDLE_COLLAPSE_MS - 1);
    expectChromeState("expanded");
    advanceIdleTimer(1);
    expectChromeState("collapsed");
  });

  it("does not flicker closed while keyboard focus moves among navigation controls", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness);
    const chrome = expectChromeState("expanded");

    advanceIdleTimer(BROWSER_CHROME_IDLE_COLLAPSE_MS - 1);
    expectChromeState("expanded");
    advanceIdleTimer(1);
    expectChromeState("collapsed");

    act(() => chrome.focus());
    expectChromeState("expanded");
    act(() => screen.getByRole("button", { name: "Reload" }).focus());
    act(() => screen.getByLabelText("Address and search bar").focus());
    advanceIdleTimer(BROWSER_CHROME_IDLE_COLLAPSE_MS * 2);
    expectChromeState("expanded");

    act(() => screen.getByRole("button", { name: "Outside browser" }).focus());
    advanceIdleTimer(BROWSER_CHROME_IDLE_COLLAPSE_MS);
    expectChromeState("collapsed");

    act(() => screen.getByLabelText("Address and search bar").focus());
    expectChromeState("expanded");
  });

  it("holds navigation open while loading and while the stop control is focused", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");

    advanceIdleTimer(BROWSER_CHROME_IDLE_COLLAPSE_MS);
    expectChromeState("collapsed");

    act(() => harness.emitState(browserState({ isLoading: true })));
    expectChromeState("expanded");
    advanceIdleTimer(BROWSER_CHROME_IDLE_COLLAPSE_MS * 2);
    expectChromeState("expanded");

    const stopButton = screen.getByRole("button", { name: "Stop loading" });
    act(() => stopButton.focus());
    fireEvent.click(stopButton);
    expect(harness.stop).toHaveBeenCalledWith("browser:test");

    act(() => harness.emitState(browserState({ isLoading: false })));
    advanceIdleTimer(BROWSER_CHROME_IDLE_COLLAPSE_MS * 2);
    expectChromeState("expanded");

    act(() => screen.getByRole("button", { name: "Outside browser" }).focus());
    advanceIdleTimer(BROWSER_CHROME_IDLE_COLLAPSE_MS);
    expectChromeState("collapsed");
  });

  it("resets the idle timer for active navigation and disables motion when requested", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");
    const chrome = expectChromeState("expanded");
    const controls = screen.getByTestId("browser-tab-nav-controls");

    expect(chrome.classList).toContain("motion-reduce:transition-none");
    expect(controls.classList).toContain("motion-reduce:transition-none");

    act(() => harness.emitState(browserState({ canGoBack: true })));
    fireEvent.pointerEnter(chrome);
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(harness.goBack).toHaveBeenCalledWith("browser:test");
    fireEvent.pointerLeave(chrome);

    advanceIdleTimer(BROWSER_CHROME_IDLE_COLLAPSE_MS);
    expectChromeState("collapsed");
  });

  it("reveals navigation when the active browser tab requests it", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");

    advanceIdleTimer(BROWSER_CHROME_IDLE_COLLAPSE_MS);
    expectChromeState("collapsed");

    act(() => requestBrowserChromeReveal("browser:test"));
    expectChromeState("expanded");
  });
});
