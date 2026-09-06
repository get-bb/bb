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
  BbDesktopBrowserState,
} from "@bb/desktop-contract";
import type { PluginBrowserActionProps } from "@get-bb/plugin-sdk";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/bb-desktop-test-utils";
import { AppToaster } from "@/components/AppToaster";
import { appToast } from "@/components/ui/app-toast";
import { BrowserTabContent } from "./BrowserTabContent";
import { BrowserCookieImportWizard } from "./BrowserCookieImportWizard";
import { createBrowserViewVisibilityCoordinator } from "./browserViewVisibilityCoordinator";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { setBrowserCookieImportRecord } from "@/lib/browser-cookie-import-state";

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
  emitSnapshot: (snapshot: { dataUrl: string | null; tabId: string }) => void;
  emitNativeFocus: (tabId: string) => void;
  focus: ReturnType<typeof vi.fn>;
  goBack: ReturnType<typeof vi.fn>;
  trustLocalhostCertificate: Mock;
  stop: ReturnType<typeof vi.fn>;
  setBounds: Mock;
  setVisible: ReturnType<typeof vi.fn>;
}
interface BrowserCookieImportHarness {
  importCookiesFromBrowser: NonNullable<
    BbDesktopBrowserApi["experimental_importCookiesFromBrowser"]
  >;
  listCookieImportSources: NonNullable<
    BbDesktopBrowserApi["experimental_listCookieImportSources"]
  >;
}

function createBrowserChromeHarness(
  runPageScript?: BbDesktopBrowserApi["experimental_runBrowserPageScript"],
  cookieImportHarness?: BrowserCookieImportHarness,
  capturePage?: NonNullable<
    BbDesktopBrowserApi["experimental_captureBrowserPage"]
  >,
): BrowserChromeHarness {
  const stateListeners = new Set<(state: BbDesktopBrowserState) => void>();
  const focusListeners = new Set<(tabId: string) => void>();
  const snapshotListeners = new Set<
    (snapshot: { dataUrl: string | null; tabId: string }) => void
  >();
  const focus = vi.fn();
  const goBack = vi.fn();
  const stop = vi.fn();
  const setBounds = vi.fn();
  const setVisible = vi.fn();
  const trustLocalhostCertificate = vi.fn();
  const api: BbDesktopBrowserApi = {
    ...createNoopDesktopBrowserApi(),
    goBack,
    focus,
    stop,
    setBounds,
    setVisible,
    experimental_trustLocalhostCertificate: (request: {
      tabId: string;
      expectedNavigationEpoch: number;
    }) => {
      trustLocalhostCertificate(request);
      return Promise.resolve({
        navigationEpoch: request.expectedNavigationEpoch,
        trustedOrigin: "localhost",
      });
    },
    ...(runPageScript
      ? {
          experimental_browserControlVersion: 2 as const,
          experimental_runBrowserPageScript: runPageScript,
        }
      : {}),
    ...(cookieImportHarness
      ? {
          experimental_importCookies: vi
            .fn()
            .mockResolvedValue({ importedCookies: 0 }),
          experimental_importCookiesFromBrowser:
            cookieImportHarness.importCookiesFromBrowser,
          experimental_listCookieImportSources:
            cookieImportHarness.listCookieImportSources,
        }
      : {}),
    ...(capturePage
      ? {
          experimental_browserControlVersion: 2 as const,
          experimental_captureBrowserPage: capturePage,
          experimental_readBrowserCaptureChunk: (readRequest: {
            captureId: string;
            tabId: string;
            offset: number;
            length: number;
          }) =>
            Promise.resolve({
              captureId: readRequest.captureId,
              offset: 0,
              base64: "c2NyZWVuc2hvdC1ieXRlcw==",
              eof: true,
            }),
          experimental_releaseBrowserCapture: (releaseRequest: {
            captureId: string;
            tabId: string;
          }): Promise<void> => Promise.resolve(),
        }
      : {}),
    onState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    onFocus(listener) {
      focusListeners.add(listener);
      return () => focusListeners.delete(listener);
    },
    onSnapshot(listener) {
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    },
  };
  return {
    api,
    emitState(state) {
      for (const listener of stateListeners) listener(state);
    },
    emitSnapshot(snapshot) {
      for (const listener of snapshotListeners) listener(snapshot);
    },
    emitNativeFocus(tabId) {
      for (const listener of focusListeners) listener(tabId);
    },
    focus,
    goBack,
    stop,
    setBounds,
    setVisible,
    trustLocalhostCertificate,
  };
}

function registrationSet(
  browserActions: PluginRegistrationSet["browserActions"],
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    browserActions,
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
function renderBrowserChrome(
  harness: BrowserChromeHarness,
  initialUrl = "",
  options: {
    canHandleBrowserCommands?: boolean;
    canShowNativeBrowserView?: boolean;
    onNativeFocus?: () => void;
    threadId?: string;
    tabId?: string;
    environmentId?: string | null;
  } = {},
) {
  window.bbDesktop = createBbDesktopApi(desktopInfo, harness.api);
  return render(
    <TooltipProvider delayDuration={0}>
      <BrowserTabContent
        tabId={options.tabId ?? "browser:test"}
        initialUrl={initialUrl}
        addressFocusRequest={null}
        canHandleBrowserCommands={options.canHandleBrowserCommands}
        canShowNativeBrowserView={options.canShowNativeBrowserView ?? false}
        onNativeFocus={options.onNativeFocus}
        visibilityCoordinator={createBrowserViewVisibilityCoordinator(
          harness.api,
        )}
        environmentId={options.environmentId ?? null}
        threadId={options.threadId ?? "thread-1"}
        projectId="project-1"
        onUpdate={() => {}}
      />
      <button type="button">Outside browser</button>
    </TooltipProvider>,
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
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty("--ring");
    window.localStorage.clear();
    setBrowserCookieImportRecord(null);
    resetPluginSlotStoreForTest();
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
  it("forwards native viewport input while browser chrome remains in the renderer", async () => {
    const harness = createBrowserChromeHarness();
    const sendPointerInput = vi.fn().mockResolvedValue({
      dispatched: 1,
      navigationEpoch: 7,
    });
    harness.api.experimental_sendBrowserPointerInput = sendPointerInput;
    renderBrowserChrome(harness, "https://example.com/docs", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
    });
    act(() => harness.emitState(browserState({ navigationEpoch: 7 })));
    const viewport = document.querySelector<HTMLDivElement>(
      "[data-browser-viewport]",
    );
    if (viewport === null) {
      throw new Error("Expected browser viewport.");
    }
    Object.defineProperty(viewport, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(100, 80, 500, 350),
    });

    fireEvent.pointerDown(viewport, {
      button: 0,
      clientX: 140,
      clientY: 120,
      detail: 1,
      pointerType: "mouse",
    });
    fireEvent.wheel(viewport, {
      clientX: 140,
      clientY: 120,
      deltaX: 0,
      deltaY: 80,
    });

    await waitFor(() =>
      expect(sendPointerInput).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          expectedNavigationEpoch: 7,
          events: [
            {
              button: "left",
              clickCount: 1,
              type: "mouseDown",
              x: 40,
              y: 40,
            },
          ],
          tabId: "browser:test",
        }),
      ),
    );
    expect(sendPointerInput).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedNavigationEpoch: 7,
        events: [{ deltaX: 0, deltaY: 80, type: "mouseWheel", x: 40, y: 40 }],
        tabId: "browser:test",
      }),
    );
    expect(harness.focus).toHaveBeenCalledWith("browser:test");
  });

  it("restores the renderer while a resize snapshot replaces the native view", async () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
    });
    act(() => harness.emitState(browserState({ navigationEpoch: 7 })));

    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: true,
      }),
    );
    act(() =>
      harness.emitSnapshot({
        dataUrl: "data:image/jpeg;base64,resize",
        tabId: "browser:test",
      }),
    );
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: false,
      }),
    );
    act(() => harness.emitSnapshot({ dataUrl: null, tabId: "browser:test" }));
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: true,
      }),
    );
  });

  it("removes the native hit target before rendering recovery actions", async () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://localhost:8443/", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
    });
    harness.setBounds.mockClear();
    harness.setVisible.mockClear();

    act(() =>
      harness.emitState(
        browserState({
          errorText: "ERR_CERT_AUTHORITY_INVALID",
          navigationEpoch: 7,
          url: "https://localhost:8443/",
        }),
      ),
    );

    await waitFor(() =>
      expect(harness.setBounds).toHaveBeenLastCalledWith({
        bounds: { height: 0, width: 0, x: 0, y: 0 },
        tabId: "browser:test",
      }),
    );
  });
  it("trusts a loopback certificate only from the recovery action", async () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://localhost:8443/", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
    });

    act(() =>
      harness.emitState(
        browserState({
          errorText: "ERR_CERT_AUTHORITY_INVALID",
          navigationEpoch: 7,
          url: "https://localhost:8443/",
        }),
      ),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Trust and reload" }),
    );

    expect(
      document.querySelector("[data-browser-load-error]")?.className,
    ).toContain("z-10");
    expect(harness.trustLocalhostCertificate).toHaveBeenCalledWith({
      tabId: "browser:test",
      expectedNavigationEpoch: 7,
    });
  });
  it("hides the native view while another thread is active and restores it on return", async () => {
    const harness = createBrowserChromeHarness();
    const threadA = renderBrowserChrome(harness, "https://example.com/a", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      tabId: "browser:thread-a",
      threadId: "thread-a",
    });
    act(() =>
      harness.emitState(
        browserState({ tabId: "browser:thread-a", navigationEpoch: 7 }),
      ),
    );
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:thread-a",
        visible: true,
      }),
    );

    threadA.unmount();
    expect(harness.setVisible).toHaveBeenLastCalledWith({
      tabId: "browser:thread-a",
      visible: false,
    });

    const threadB = renderBrowserChrome(harness, "https://example.com/b", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      tabId: "browser:thread-b",
      threadId: "thread-b",
    });
    act(() =>
      harness.emitState(
        browserState({ tabId: "browser:thread-b", navigationEpoch: 7 }),
      ),
    );
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:thread-b",
        visible: true,
      }),
    );

    threadB.unmount();
    const restoredThreadA = renderBrowserChrome(
      harness,
      "https://example.com/a",
      {
        canHandleBrowserCommands: true,
        canShowNativeBrowserView: true,
        tabId: "browser:thread-a",
        threadId: "thread-a",
      },
    );
    act(() =>
      harness.emitState(
        browserState({ tabId: "browser:thread-a", navigationEpoch: 7 }),
      ),
    );
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:thread-a",
        visible: true,
      }),
    );
    restoredThreadA.unmount();
  });

  it("uses a page snapshot while a toast overlays the native browser", async () => {
    vi.stubGlobal(
      "Image",
      class {
        public src = "";
        async decode(): Promise<void> {}
      },
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:toast");
    const capturePage = vi.fn().mockResolvedValue({
      captureId: "cap-toast",
      format: "png",
      byteLength: 16,
      navigationEpoch: 7,
      pixelSize: { height: 600, width: 800 },
    });
    const harness = createBrowserChromeHarness(
      undefined,
      undefined,
      capturePage,
    );
    renderBrowserChrome(harness, "https://example.com/docs", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
    });
    render(<AppToaster position="bottom-right" />);
    act(() => harness.emitState(browserState({ navigationEpoch: 7 })));
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: true,
      }),
    );
    act(() => {
      appToast.success("Object copied", { duration: 50 });
    });

    expect(await screen.findByText("Object copied")).not.toBeNull();
    await waitFor(() => expect(capturePage).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        document
          .querySelector("[data-browser-toast-snapshot]")
          ?.getAttribute("src"),
      ).toBe("blob:toast"),
    );
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: false,
      }),
    );
    await waitFor(
      () =>
        expect(harness.setVisible).toHaveBeenLastCalledWith({
          tabId: "browser:test",
          visible: true,
        }),
      { timeout: 1_000 },
    );
    expect(document.querySelector("[data-browser-toast-snapshot]")).toBeNull();
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

  it("imports cookies from a detected desktop browser profile", async () => {
    const listCookieImportSources = vi.fn().mockResolvedValue({
      sources: [
        {
          family: "chrome" as const,
          label: "Google Chrome",
          profiles: [{ id: "Default", label: "Default" }],
        },
      ],
    });
    const importCookiesFromBrowser = vi
      .fn()
      .mockResolvedValue({ importedCookies: 2 });
    const harness = createBrowserChromeHarness(undefined, {
      importCookiesFromBrowser,
      listCookieImportSources,
    });
    renderBrowserChrome(harness, "https://example.com/docs", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
    });
    act(() => harness.emitState(browserState()));
    const importButton = await screen.findByRole("button", {
      name: "Import browser session",
    });
    expect(importButton.textContent).toContain("Import");
    fireEvent.click(importButton);
    await screen.findByRole("region", { name: "Import browser session" });
    expect(
      screen
        .getByRole("listitem", { name: "Choose source" })
        .getAttribute("aria-current"),
    ).toBe("step");
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: false,
      }),
    );
    const importFromChrome = await screen.findByRole("button", {
      name: /Google Chrome/,
    });
    expect(listCookieImportSources).toHaveBeenCalledWith({
      tabId: "browser:test",
    });

    fireEvent.click(importFromChrome);
    expect(
      screen
        .getByRole("listitem", { name: "Review import" })
        .getAttribute("aria-current"),
    ).toBe("step");
    await screen.findByText("Review this import");
    fireEvent.click(screen.getByRole("button", { name: "Import session" }));
    await waitFor(() =>
      expect(importCookiesFromBrowser).toHaveBeenCalledWith({
        family: "chrome",
        profileId: "Default",
        tabId: "browser:test",
      }),
    );
    await screen.findByText("Imported 2 cookies from Google Chrome");
    fireEvent.click(
      screen.getByRole("button", { name: "Close import wizard" }),
    );
    expect(
      screen.queryByRole("region", { name: "Import browser session" }),
    ).toBeNull();
    expect(
      screen.queryByText("Imported 2 cookies from Google Chrome"),
    ).toBeNull();
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: true,
      }),
    );
  });

  it("announces cookie import failures with the destructive status treatment", () => {
    render(
      <BrowserCookieImportWizard
        currentImport={null}
        isClearing={false}
        isImporting={false}
        isLoadingSources={false}
        message="Could not import browser session"
        messageTone="error"
        onClose={vi.fn()}
        onClear={vi.fn()}
        onImportFromBrowser={vi.fn()}
        onImportFromFile={vi.fn()}
        sources={[]}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Could not import browser session");
    expect(alert.className).toContain("text-destructive");
  });

  it("shows the current import and offers clear or overwrite actions", () => {
    const onClear = vi.fn();
    const onImportFromBrowser = vi.fn();
    render(
      <BrowserCookieImportWizard
        currentImport={{
          family: "chrome",
          importedCookies: 42,
          kind: "browser",
          profileId: "Default",
          profileLabel: "Person 1",
          sourceLabel: "Google Chrome",
        }}
        isClearing={false}
        isImporting={false}
        isLoadingSources={false}
        message={null}
        messageTone={null}
        onClear={onClear}
        onClose={vi.fn()}
        onImportFromBrowser={onImportFromBrowser}
        onImportFromFile={vi.fn()}
        sources={[]}
      />,
    );

    const currentImport = screen.getByRole("region", {
      name: "Currently imported session",
    });
    expect(currentImport.textContent).toContain("42 cookies");
    fireEvent.click(screen.getByRole("button", { name: "Clear import" }));
    expect(onClear).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Reimport" }));
    fireEvent.click(screen.getByRole("button", { name: "Reimport session" }));
    expect(onImportFromBrowser).toHaveBeenCalledWith("chrome", "Default");
  });

  it("restores native focus to the logical pane and reports page focus", async () => {
    const harness = createBrowserChromeHarness();
    const onNativeFocus = vi.fn();
    renderBrowserChrome(harness, "https://example.com/docs", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      onNativeFocus,
    });

    act(() => harness.emitState(browserState()));
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: true,
      }),
    );
    act(() => harness.emitNativeFocus("browser:other"));
    expect(onNativeFocus).not.toHaveBeenCalled();
    act(() => harness.emitNativeFocus("browser:test"));
    expect(onNativeFocus).toHaveBeenCalledTimes(1);
  });

  it("passes Browser actions passive tab identity only", () => {
    let slotProps: PluginBrowserActionProps | null = null;
    setPluginSlotRegistrations(
      "context",
      registrationSet([
        {
          id: "inspect",
          title: "Inspect page",
          component: (props) => {
            slotProps = props;
            return <button type="button">Inspect page</button>;
          },
        },
      ]),
    );
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");
    act(() => harness.emitState(browserState({ navigationEpoch: 2 })));

    expect(slotProps).toEqual({
      tabId: "browser:test",
      navigationEpoch: 2,
      threadId: "thread-1",
      projectId: "project-1",
      url: "https://example.com/docs",
    });
  });

  it("contains a crashing Browser action without losing native controls", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setPluginSlotRegistrations(
      "broken",
      registrationSet([
        {
          id: "broken",
          title: "Broken",
          component: () => {
            throw new Error("broken action");
          },
        },
      ]),
    );
    setPluginSlotRegistrations(
      "working",
      registrationSet([
        {
          id: "working",
          title: "Working",
          component: () => <button type="button" aria-label="Working action" />,
        },
      ]),
    );
    renderBrowserChrome(
      createBrowserChromeHarness(),
      "https://example.com/docs",
    );

    expect(screen.getByLabelText("Address and search bar")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Working action" }),
    ).not.toBeNull();
  });
});
