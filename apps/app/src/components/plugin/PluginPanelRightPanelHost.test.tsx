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
import { PluginPanelRightPanelHost } from "./PluginPanelRightPanelHost";
import { getPluginPagePanelStateId } from "./plugin-page-panel-state";

const browserState = vi.hoisted(() => ({ available: false }));
const createTerminal = vi.hoisted(() => vi.fn());

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
  }: {
    browserDeck: ReactNode;
    fileTabs: Array<{ id: string; filename: string; onSelect: () => void }>;
    fileTabContent: ReactNode;
    onClose: () => void;
    onOpenNewTab: () => void;
  }) => (
    <aside data-testid="shared-thread-secondary-panel">
      {fileTabs.map((tab) => (
        <button key={tab.id} type="button" onClick={tab.onSelect}>
          {tab.filename}
        </button>
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
  }: {
    onOpenBrowser?: () => void;
    onStartTerminal?: () => void;
  }) => (
    <div data-testid="plugin-page-new-tab">
      {onOpenBrowser ? (
        <button type="button" onClick={onOpenBrowser}>
          Open browser
        </button>
      ) : null}
      {onStartTerminal ? (
        <button type="button" onClick={onStartTerminal}>
          Start terminal
        </button>
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

vi.mock("./PluginPageTerminalTargetDialog", () => ({
  PluginPageTerminalTargetDialog: ({
    onSelect,
  }: {
    onSelect: (target: {
      kind: "host_path";
      hostId: string;
      cwd: null;
    }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onSelect({ kind: "host_path", hostId: "host-1", cwd: null })
      }
    >
      Use test machine
    </button>
  ),
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
    expect(
      screen.getByTestId("shared-secondary-panel-region").hasAttribute("hidden"),
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
      screen.getByTestId("shared-secondary-panel-region").hasAttribute("hidden"),
    ).toBe(false);
    expect(
      screen.queryByRole("button", { name: "Show right panel" }),
    ).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Hide right panel" }),
    ).toHaveLength(1);
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
  });

  it("asks for a terminal target instead of guessing one", async () => {
    renderHost();
    fireEvent.click(
      await screen.findByRole("button", { name: "Show right panel" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Start terminal" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Use test machine" }),
    );

    await waitFor(() =>
      expect(createTerminal).toHaveBeenCalledWith({
        cols: 100,
        rows: 30,
        target: { kind: "host_path", hostId: "host-1", cwd: null },
      }),
    );
    expect(await screen.findByTestId("plugin-page-terminal")).toBeTruthy();
  });
});
