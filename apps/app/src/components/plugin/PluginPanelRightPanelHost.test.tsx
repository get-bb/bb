// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { getFixedPanelTabsStateStorageKey } from "@/lib/fixed-panel-tabs-state";
import { PluginPanelRightPanelHost } from "./PluginPanelRightPanelHost";
import { getPluginPagePanelStateId } from "./plugin-page-panel-state";

const browserState = vi.hoisted(() => ({ available: false }));
const createTerminal = vi.hoisted(() => vi.fn());
const hostState = vi.hoisted(() => ({
  hosts: [
    { id: "host-1", name: "Studio", status: "connected" },
    { id: "host-2", name: "Laptop", status: "connected" },
  ],
  primaryHostId: "host-1",
}));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => false,
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: () => undefined,
  useAppCommandShortcut: () => null,
}));

vi.mock("@/lib/plugin-slots", () => ({
  usePluginSlots: () => ({
    fileOpeners: [],
    navPanels: [
      {
        id: "board",
        pluginId: "demo",
        path: "board",
        title: "Board",
        icon: "Columns",
        component: () => null,
        generation: 1,
      },
    ],
  }),
}));

vi.mock("@/lib/file-opener-preference", () => ({
  useFileOpenerPreferenceValue: () => ({ kind: "automatic" }),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getDesktopBrowserApi: () => null,
  isDesktopBrowserAvailable: () => browserState.available,
}));

vi.mock("@/hooks/queries/thread-terminal-queries", () => ({
  useCreateTerminal: () => ({
    isPending: false,
    mutateAsync: createTerminal,
  }),
  useCloseTerminal: () => ({ mutateAsync: vi.fn() }),
  useTerminals: () => ({
    data: {
      sessions: [
        {
          id: "terminal-1",
          title: "Terminal",
          status: "running",
        },
      ],
    },
    error: null,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({ data: hostState.hosts, isLoading: false }),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: { primaryHostId: hostState.primaryHostId },
  }),
}));

vi.mock("@/components/secondary-panel/SecondaryPanelLayout", () => ({
  SecondaryPanelLayout: ({
    main,
    open,
    renderPanel,
  }: {
    main: ReactNode;
    open: boolean;
    renderPanel: (options: {
      presentation: "inline";
      canShowNativeBrowserView: boolean;
      isMainCollapsed: boolean;
      onToggleMainCollapse: () => void;
    }) => ReactNode;
  }) => (
    <div data-testid="shared-secondary-panel-layout">
      {main}
      <div data-testid="shared-secondary-panel-region" hidden={!open}>
        {renderPanel({
          presentation: "inline",
          canShowNativeBrowserView: true,
          isMainCollapsed: false,
          onToggleMainCollapse: () => undefined,
        })}
      </div>
    </div>
  ),
}));

vi.mock("@/components/secondary-panel/ThreadSecondaryPanel", () => ({
  ThreadSecondaryPanel: ({
    browserDeck,
    fileTabs,
    fileTabContent,
    onClose,
    onOpenNewTab,
    topChromeSurface,
  }: {
    browserDeck: ReactNode;
    fileTabs: Array<{
      id: string;
      filename: string;
      onClose: () => void;
      onSelect: () => void;
    }>;
    fileTabContent: ReactNode;
    onClose: () => void;
    onOpenNewTab: () => void;
    topChromeSurface?: "panel" | "page";
  }) => (
    <aside
      data-testid="shared-thread-secondary-panel"
      data-top-chrome-surface={topChromeSurface ?? "panel"}
    >
      {fileTabs.map((tab) => (
        <div key={tab.id}>
          <button type="button" onClick={tab.onSelect}>
            {tab.filename}
          </button>
          <button
            type="button"
            aria-label={`Close ${tab.filename}`}
            onClick={tab.onClose}
          />
        </div>
      ))}
      <button type="button" onClick={onOpenNewTab}>
        Add tab
      </button>
      <button type="button" aria-label="Hide right panel" onClick={onClose} />
      {fileTabContent}
      {browserDeck}
    </aside>
  ),
}));

vi.mock("@/components/secondary-panel/NewTabPage", () => ({
  NewTabPage: ({
    onOpenBrowser,
    onStartTerminal,
    startTerminalDisabled,
    startTerminalTrailing,
  }: {
    onOpenBrowser?: () => void;
    onStartTerminal?: () => void;
    startTerminalDisabled?: boolean;
    startTerminalTrailing?: ReactNode;
  }) => (
    <div data-testid="plugin-page-new-tab">
      {onOpenBrowser ? (
        <button type="button" onClick={onOpenBrowser}>
          Open browser
        </button>
      ) : null}
      {onStartTerminal ? (
        <>
          <button
            type="button"
            disabled={startTerminalDisabled}
            onClick={onStartTerminal}
          >
            Start terminal
          </button>
          {startTerminalTrailing}
        </>
      ) : null}
    </div>
  ),
}));

vi.mock("@/components/secondary-panel/BrowserTabDeck", () => ({
  BrowserTabDeck: () => <div data-testid="plugin-page-browser" />,
}));

vi.mock("@/components/thread/terminal/ThreadTerminalPanel", () => ({
  ThreadTerminalPanel: () => <div data-testid="plugin-page-terminal" />,
}));

function renderHost(panelPath = "board") {
  const panelStateId = getPluginPagePanelStateId({
    panelPath,
    pluginId: "demo",
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={createStore()}>
        <TooltipProvider>
          <div data-plugin-right-panel-toggle-portal={panelStateId} />
          <PluginPanelRightPanelHost
            panelPath={panelPath}
            pluginId="demo"
            subPath=""
          >
            <div>Plugin page</div>
          </PluginPanelRightPanelHost>
        </TooltipProvider>
      </JotaiProvider>
    </QueryClientProvider>,
  );
}

describe("PluginPanelRightPanelHost", () => {
  beforeEach(() => {
    browserState.available = false;
    createTerminal.mockReset();
    createTerminal.mockResolvedValue({ id: "terminal-1" });
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps one panel toggle and mounts the collapsed panel before opening", async () => {
    renderHost();

    expect(screen.getByTestId("shared-secondary-panel-layout")).toBeTruthy();
    const collapsedPanel = await screen.findByTestId(
      "shared-thread-secondary-panel",
    );
    expect(collapsedPanel.dataset.topChromeSurface).toBe("panel");
    expect(
      screen
        .getByTestId("shared-secondary-panel-region")
        .hasAttribute("hidden"),
    ).toBe(true);

    const showButton = await screen.findByRole("button", {
      name: "Show right panel",
    });
    expect(showButton.className).toContain("[&_svg]:size-[16px]");
    fireEvent.click(showButton);

    expect(screen.getByTestId("shared-thread-secondary-panel")).toBe(
      collapsedPanel,
    );
    expect(
      screen
        .getByTestId("shared-secondary-panel-region")
        .hasAttribute("hidden"),
    ).toBe(false);
    expect(
      screen.queryByRole("button", { name: "Show right panel" }),
    ).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Hide right panel" }),
    ).toHaveLength(1);
    expect(await screen.findByTestId("plugin-page-new-tab")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close New tab" }));
    expect(
      await screen.findByRole("button", { name: "Show right panel" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("plugin-page-new-tab")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show right panel" }));
    expect(await screen.findByTestId("plugin-page-new-tab")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide right panel" }));
    expect(
      await screen.findByRole("button", { name: "Show right panel" }),
    ).toBeTruthy();
  });

  it("opens Browser without a plugin allowlist", async () => {
    browserState.available = true;
    renderHost();
    fireEvent.click(
      await screen.findByRole("button", { name: "Show right panel" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Open browser" }),
    );

    expect(await screen.findByTestId("plugin-page-browser")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close Browser" }));
    expect(
      await screen.findByRole("button", { name: "Show right panel" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("plugin-page-new-tab")).toBeNull();
    expect(screen.queryByTestId("plugin-page-browser")).toBeNull();
  });

  it("closes an open panel when refresh leaves no persisted tabs", async () => {
    const firstRender = renderHost();
    fireEvent.click(
      await screen.findByRole("button", { name: "Show right panel" }),
    );
    expect(await screen.findByTestId("plugin-page-new-tab")).toBeTruthy();

    const panelStateId = getPluginPagePanelStateId({
      panelPath: "board",
      pluginId: "demo",
    });
    const storedValue = localStorage.getItem(
      getFixedPanelTabsStateStorageKey({ threadId: panelStateId }),
    );
    if (storedValue === null) {
      throw new Error("Expected open plugin panel state to be persisted");
    }
    expect(JSON.parse(storedValue)).toMatchObject({
      secondary: { activeTabId: null, isOpen: true, tabs: [] },
    });

    firstRender.unmount();
    renderHost();

    expect(
      screen
        .getByTestId("shared-secondary-panel-region")
        .hasAttribute("hidden"),
    ).toBe(true);
    expect(screen.queryByTestId("plugin-page-new-tab")).toBeNull();
    expect(
      await screen.findByRole("button", { name: "Show right panel" }),
    ).toBeTruthy();
  });

  it("starts a terminal on the machine selected in the New tab row", async () => {
    renderHost();
    fireEvent.click(
      await screen.findByRole("button", { name: "Show right panel" }),
    );
    fireEvent.pointerDown(
      await screen.findByRole("button", { name: "Machine" }),
      { button: 0 },
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Laptop/u }));
    fireEvent.click(screen.getByRole("button", { name: "Start terminal" }));

    await waitFor(() =>
      expect(createTerminal).toHaveBeenCalledWith({
        cols: 100,
        rows: 30,
        target: { kind: "host_path", hostId: "host-2", cwd: null },
      }),
    );
    expect(await screen.findByTestId("plugin-page-terminal")).toBeTruthy();
  });
});
