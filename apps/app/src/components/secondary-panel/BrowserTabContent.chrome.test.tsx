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
  BbDesktopBrowserFindResult,
  BbDesktopBrowserState,
} from "@bb/desktop-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/bb-desktop-test-utils";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { BrowserTabContent } from "./BrowserTabContent";

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      keybindings: [
        {
          command: "browser.find",
          desktopOnly: true,
          shortcut: {
            key: "f",
            mod: true,
            meta: false,
            control: false,
            alt: false,
            shift: false,
          },
          when: {
            all: ["mainSurface", "browserFocus"],
            none: ["modalOpen"],
          },
        },
      ],
    },
  }),
}));

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
  emitFindResult: (result: BbDesktopBrowserFindResult) => void;
  emitState: (state: BbDesktopBrowserState) => void;
  find: ReturnType<typeof vi.fn>;
  goBack: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  stopFind: ReturnType<typeof vi.fn>;
}

function createBrowserChromeHarness(): BrowserChromeHarness {
  const stateListeners = new Set<(state: BbDesktopBrowserState) => void>();
  const findResultListeners = new Set<
    (result: BbDesktopBrowserFindResult) => void
  >();
  const find = vi.fn();
  const goBack = vi.fn();
  const stop = vi.fn();
  const stopFind = vi.fn();
  const api: BbDesktopBrowserApi = {
    ...createNoopDesktopBrowserApi(),
    find,
    goBack,
    stop,
    stopFind,
    onFindResult(listener) {
      findResultListeners.add(listener);
      return () => findResultListeners.delete(listener);
    },
    onState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
  };
  return {
    api,
    emitFindResult(result) {
      for (const listener of findResultListeners) listener(result);
    },
    emitState(state) {
      for (const listener of stateListeners) listener(state);
    },
    find,
    goBack,
    stop,
    stopFind,
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
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  return render(
    <AppCommandProvider>
      <BrowserTabContent
        tabId="browser:test"
        initialUrl={initialUrl}
        addressFocusRequest={null}
        canShowNativeBrowserView={true}
        visibilityCoordinator={null}
        environmentId={null}
        threadId="thread-1"
        onUpdate={() => {}}
      />
      <button type="button">Outside browser</button>
    </AppCommandProvider>,
  );
}

function expectChromeVisible(): HTMLElement {
  const chrome = screen.getByTestId("browser-tab-nav-bar");
  expect(chrome.dataset.state).toBe("expanded");
  expect(chrome.classList).toContain("h-11");
  expect(screen.getByTestId("browser-tab-nav-controls").classList).toContain(
    "opacity-100",
  );
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

  it("opens Find with Command+F and drives native page search", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");

    fireEvent.keyDown(screen.getByTestId("browser-tab-nav-bar"), {
      code: "KeyF",
      key: "f",
      metaKey: true,
    });
    const input = screen.getByRole("textbox", { name: "Find in page" });
    for (const text of ["d", "do", "docs"]) {
      fireEvent.change(input, { target: { value: text } });
      expect(harness.find).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        text,
        forward: true,
      });
    }

    act(() =>
      harness.emitFindResult({
        tabId: "browser:test",
        activeMatchOrdinal: 2,
        matches: 5,
      }),
    );
    expect(screen.getByRole("status").textContent).toBe("2 of 5");

    act(() =>
      harness.emitFindResult({
        tabId: "browser:other",
        activeMatchOrdinal: 1,
        matches: 99,
      }),
    );
    expect(screen.getByRole("status").textContent).toBe("2 of 5");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(harness.find).toHaveBeenLastCalledWith(
      expect.objectContaining({ forward: true }),
    );
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(harness.find).toHaveBeenLastCalledWith(
      expect.objectContaining({ forward: false }),
    );

    fireEvent.keyDown(input, { key: "Escape" });
    expect(harness.stopFind).toHaveBeenLastCalledWith({
      tabId: "browser:test",
      focusPage: true,
    });
    expect(screen.queryByTestId("browser-find-bar")).toBeNull();
  });
});
