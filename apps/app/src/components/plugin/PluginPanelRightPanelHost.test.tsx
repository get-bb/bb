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
import { resetFixedPanelTabsStateForTest } from "@/lib/fixed-panel-tabs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  createEmptyFixedPanelTabsState,
  createPluginPanelFixedPanelTab,
  createTerminalFixedPanelTab,
  getFixedPanelTabsStateStorageKey,
  serializeFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs-state";
import { PluginPanelRightPanelHost } from "./PluginPanelRightPanelHost";
import { getPluginPagePanelStateId } from "./plugin-page-panel-state";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import {
  getPluginFixedTabOwnerId,
  useAppFixedTabTarget,
} from "@/lib/app-fixed-tab-navigation";

interface TestFixedTabRegistration {
  panelId: string;
  id: string;
  title: string;
  icon: string;
  component: (props: { subPath: string }) => ReactNode;
  experimental_target?: {
    validate(value: import("@get-bb/plugin-sdk").JsonValue): boolean;
  };
  layout?: "padded" | "flush";
}

interface TestFileOpenerRegistration {
  id: string;
  title: string;
  extensions: string[];
  component: () => ReactNode;
  pluginId: string;
  generation: number;
}

interface TestNewThreadPanelActionRegistration {
  id: string;
  title: string;
  component: (props: {
    projectId: string | null;
    params: import("@get-bb/plugin-sdk").JsonValue | null;
  }) => ReactNode;
  layout?: "padded" | "flush";
  pluginId: string;
  generation: number;
}

const browserState = vi.hoisted(() => ({ available: false }));
const createTerminal = vi.hoisted(() => vi.fn());
const threadTabsApi = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
}));
const terminalQueryState = vi.hoisted(() => ({
  sessions: [
    {
      id: "terminal-1",
      threadId: "thread-restored-target",
      environmentId: "environment-1",
      hostId: "host-1",
      title: "Terminal 1",
      initialCwd: "/workspace",
      cols: 100,
      rows: 30,
      status: "running",
      exitCode: null,
      closeReason: null,
      createdAt: 1,
      updatedAt: 1,
      lastUserInputAt: null,
    },
    {
      id: "terminal-2",
      threadId: "thread-restored-target",
      environmentId: "environment-1",
      hostId: "host-1",
      title: "Terminal 2",
      initialCwd: "/workspace",
      cols: 100,
      rows: 30,
      status: "running",
      exitCode: null,
      closeReason: null,
      createdAt: 1,
      updatedAt: 1,
      lastUserInputAt: null,
    },
  ],
}));
const fixedTabState = vi.hoisted(() => ({
  panelRegistered: true,
  registrations: [] as TestFixedTabRegistration[],
  fileOpeners: [] as TestFileOpenerRegistration[],
  newThreadPanelActions: [] as TestNewThreadPanelActionRegistration[],
}));
const hostState = vi.hoisted(() => ({
  hosts: [
    { id: "host-1", name: "Studio", status: "connected" },
    { id: "host-2", name: "Laptop", status: "connected" },
  ],
  primaryHostId: "host-1",
}));

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: {
      ...actual.sdk,
      threads: {
        ...actual.sdk.threads,
        tabs: threadTabsApi,
      },
    },
  };
});

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => false,
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: () => undefined,
  useAppCommandShortcut: () => null,
}));

vi.mock("@/lib/plugin-slots", () => ({
  usePluginSlots: () => ({
    fileOpeners: fixedTabState.fileOpeners,
    newThreadPanelActions: fixedTabState.newThreadPanelActions,
    navPanels: fixedTabState.panelRegistered
      ? [
          {
            id: "board",
            pluginId: "demo",
            path: "board",
            title: "Board",
            icon: "Columns",
            component: () => null,
            generation: 1,
            experimental_fixedTabs: fixedTabState.registrations,
          },
        ]
      : [],
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
  useCreateEnvironmentTerminal: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useCreateThreadTerminal: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useCloseTerminal: () => ({
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    variables: undefined,
  }),
  useCloseEnvironmentTerminal: () => ({
    isPending: false,
    mutate: vi.fn(),
    variables: undefined,
  }),
  useCloseThreadTerminal: () => ({
    isPending: false,
    mutate: vi.fn(),
    variables: undefined,
  }),
  useRenameTerminal: () => ({ mutate: vi.fn() }),
  useRenameEnvironmentTerminal: () => ({ mutate: vi.fn() }),
  useRenameThreadTerminal: () => ({ mutate: vi.fn() }),
  useEnvironmentTerminals: () => ({
    data: terminalQueryState,
    error: null,
    isLoading: false,
  }),
  useThreadTerminals: () => ({
    data: terminalQueryState,
    error: null,
    isLoading: false,
  }),
  useTerminals: () => ({
    data: terminalQueryState,
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

// The lazy secondary panel's inline placeholder registers a real `Panel`
// while the chunk loads; the layout mock below has no PanelGroup to host it.
vi.mock("react-resizable-panels", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-resizable-panels")>()),
  Panel: ({ children }: { children?: ReactNode }) => (
    <div data-testid="panel-placeholder">{children}</div>
  ),
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
    fileTabContentFillsRegion,
    fixedTabs,
    fixedTabContent,
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
    fileTabContentFillsRegion?: boolean;
    fixedTabs: Array<{
      tab: { id: string };
      title: string;
      onSelect: () => void;
    }>;
    fixedTabContent: ReactNode;
    onClose: () => void;
    onOpenNewTab: () => void;
    topChromeSurface?: "panel" | "page";
  }) => (
    <aside
      data-testid="shared-thread-secondary-panel"
      data-file-tab-content-fills-region={
        fileTabContentFillsRegion === true ? "true" : "false"
      }
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
      {fixedTabs.map((tab) => (
        <button key={tab.tab.id} type="button" onClick={tab.onSelect}>
          {tab.title}
        </button>
      ))}
      <button type="button" onClick={onOpenNewTab}>
        Add tab
      </button>
      <button type="button" aria-label="Hide right panel" onClick={onClose} />
      {fileTabContent}
      {fixedTabContent}
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

vi.mock("@/components/thread/terminal/ThreadTerminalPanel", async () => {
  const { useThreadTerminalController } =
    await import("@/components/thread/terminal/useThreadTerminalController");
  return {
    ThreadTerminalPanel: (
      props: Parameters<typeof useThreadTerminalController>[0],
    ) => {
      const controller = useThreadTerminalController(props);
      return (
        <div data-testid="plugin-page-terminal">
          <button
            type="button"
            onClick={() => controller.handleSelectTerminal("terminal-2")}
          >
            Select sibling terminal
          </button>
        </div>
      );
    },
  };
});

vi.mock("@/components/secondary-panel/ThreadSecondaryPanelTabContent", () => ({
  WorkspaceFilePreviewTabContent: ({
    activePath,
    environmentId,
  }: {
    activePath: string;
    environmentId: string;
  }) => (
    <div>
      workspace:{environmentId}:{activePath}
    </div>
  ),
  HostScopedFilePreviewTabContent: ({
    activePath,
    hostId,
  }: {
    activePath: string;
    hostId: string;
  }) => (
    <div>
      host:{hostId}:{activePath}
    </div>
  ),
  ThreadStorageFilePreviewTabContent: ({
    activePath,
    threadId,
  }: {
    activePath: string;
    threadId: string;
  }) => (
    <div>
      storage:{threadId}:{activePath}
    </div>
  ),
}));

function FileIntentButtons() {
  const navigation = useAppNavigationHost();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          navigation.openFilePreview({
            target: {
              kind: "workspace",
              environmentId: "env-explicit",
              path: "src/example.ts",
            },
            location: { kind: "line", line: 7, column: null },
          })
        }
      >
        Open workspace file
      </button>
      <button
        type="button"
        onClick={() =>
          navigation.openFilePreview({
            target: {
              kind: "host",
              hostId: "host-explicit",
              path: "/tmp/example.log",
            },
            location: null,
          })
        }
      >
        Open host file
      </button>
      <button
        type="button"
        onClick={() =>
          navigation.openFilePreview({
            target: {
              kind: "thread-storage",
              threadId: "thr-explicit",
              path: "reports/result.md",
            },
            location: { kind: "range", startLine: 2, endLine: 4 },
          })
        }
      >
        Open storage file
      </button>
      <button
        type="button"
        onClick={() =>
          navigation.openFixedTab({
            surface: { kind: "current" },
            tab: {
              ownerId: getPluginFixedTabOwnerId("demo", "board"),
              tabId: "details",
            },
            target: { kind: "record", recordId: "issue-42" },
          })
        }
      >
        Open targeted fixed tab
      </button>
      <button
        type="button"
        onClick={() =>
          navigation.openFixedTab({
            surface: { kind: "current" },
            tab: {
              ownerId: getPluginFixedTabOwnerId("demo", "board"),
              tabId: "details",
            },
            target: { kind: "wrong" },
          })
        }
      >
        Open invalid fixed tab target
      </button>
    </>
  );
}

function renderHost(panelPath = "board", subPath = "", store = createStore()) {
  const panelStateId = getPluginPagePanelStateId({
    panelPath,
    pluginId: "demo",
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <TooltipProvider>
          <div data-plugin-right-panel-toggle-portal={panelStateId} />
          <PluginPanelRightPanelHost
            panelPath={panelPath}
            pluginId="demo"
            subPath={subPath}
          >
            <div>Plugin page</div>
            <FileIntentButtons />
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
    threadTabsApi.get.mockReset();
    threadTabsApi.get.mockResolvedValue({ revision: 4, tabs: [] });
    threadTabsApi.update.mockReset();
    threadTabsApi.update.mockResolvedValue({ revision: 5, tabs: [] });
    fixedTabState.panelRegistered = true;
    fixedTabState.registrations = [];
    fixedTabState.fileOpeners = [];
    fixedTabState.newThreadPanelActions = [];
    localStorage.clear();
    // Clearing storage is not enough on its own: the per-thread atoms cache
    // whatever storage held when they were first created.
    resetFixedPanelTabsStateForTest();
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
    await waitFor(() =>
      expect(
        screen
          .getByTestId("shared-secondary-panel-region")
          .hasAttribute("hidden"),
      ).toBe(true),
    );

    const showButton = await screen.findByRole("button", {
      name: "Show right panel",
    });
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

  it("uses the shared panel state and chrome for plugin fixed tabs", async () => {
    function Navigation({ subPath }: { subPath: string }) {
      return <div>Navigation for {subPath}</div>;
    }
    function Details({ subPath }: { subPath: string }) {
      return <div>Details for {subPath}</div>;
    }
    fixedTabState.registrations = [
      {
        panelId: "board",
        id: "navigation",
        title: "Navigation",
        icon: "PanelRight",
        component: Navigation,
      },
      {
        panelId: "board",
        id: "details",
        title: "Details",
        icon: "Info",
        component: Details,
        layout: "flush",
      },
    ];

    renderHost("board", "task/123");

    expect(
      screen
        .getByTestId("shared-secondary-panel-region")
        .hasAttribute("hidden"),
    ).toBe(false);
    expect(await screen.findByText("Navigation for task/123")).toBeTruthy();
    expect(screen.queryByText("Details for task/123")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hide right panel" }));
    expect(screen.queryByText("Navigation for task/123")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show right panel" }));
    expect(await screen.findByText("Navigation for task/123")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(await screen.findByText("Details for task/123")).toBeTruthy();
    expect(screen.queryByText("Navigation for task/123")).toBeNull();

    fireEvent.click(screen.getByText("Add tab"));
    expect(await screen.findByTestId("plugin-page-new-tab")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close New tab" }));
    expect(screen.getByText("Navigation for task/123")).toBeTruthy();
    expect(
      screen
        .getByTestId("shared-secondary-panel-region")
        .hasAttribute("hidden"),
    ).toBe(false);
  });

  it("validates and transiently delivers a plugin-owned fixed-tab target", async () => {
    function Details() {
      const delivery = useAppFixedTabTarget(
        getPluginFixedTabOwnerId("demo", "board"),
        "details",
      );
      return (
        <div data-testid="targeted-details-content">
          Details
          {delivery === null ? null : (
            <>
              <output>{JSON.stringify(delivery.target)}</output>
              <button type="button" onClick={delivery.consume}>
                Consume target
              </button>
            </>
          )}
        </div>
      );
    }
    fixedTabState.registrations = [
      {
        panelId: "board",
        id: "navigation",
        title: "Navigation",
        icon: "PanelRight",
        component: () => <div data-testid="navigation-content">Navigation</div>,
      },
      {
        panelId: "board",
        id: "details",
        title: "Details",
        icon: "Info",
        component: Details,
        experimental_target: {
          validate: (value) =>
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value) &&
            value.kind === "record" &&
            typeof value.recordId === "string",
        },
      },
    ];

    renderHost();
    expect(await screen.findByTestId("navigation-content")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Open invalid fixed tab target" }),
    );
    expect(screen.getByTestId("navigation-content")).toBeTruthy();
    expect(screen.queryByTestId("targeted-details-content")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Open targeted fixed tab" }),
    );
    expect(await screen.findByTestId("targeted-details-content")).toBeTruthy();
    expect(
      screen.getByText('{"kind":"record","recordId":"issue-42"}'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Consume target" }));
    expect(screen.queryByRole("button", { name: "Consume target" })).toBeNull();
    const persistedValues = Array.from(
      { length: localStorage.length },
      (_, index) => localStorage.getItem(localStorage.key(index) ?? "") ?? "",
    ).join("\n");
    expect(persistedValues).not.toContain("issue-42");
  });

  it("opens every explicit live-file identity through the shared panel host", async () => {
    renderHost();

    fireEvent.click(
      screen.getByRole("button", { name: "Open workspace file" }),
    );
    expect(
      await screen.findByText("workspace:env-explicit:src/example.ts"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open host file" }));
    expect(
      await screen.findByText("host:host-explicit:/tmp/example.log"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open storage file" }));
    expect(
      await screen.findByText("storage:thr-explicit:reports/result.md"),
    ).toBeTruthy();
  });

  it("gives plugin-page file openers the full content region", async () => {
    fixedTabState.fileOpeners = [
      {
        id: "editor",
        title: "Demo editor",
        extensions: ["ts"],
        component: () => <div>Plugin file editor</div>,
        pluginId: "demo",
        generation: 1,
      },
    ];
    renderHost();

    fireEvent.click(
      screen.getByRole("button", { name: "Open workspace file" }),
    );

    expect(await screen.findByText("Plugin file editor")).toBeTruthy();
    expect(
      screen.getByTestId("shared-thread-secondary-panel").dataset
        .fileTabContentFillsRegion,
    ).toBe("true");
  });

  it("gives restored flush action tabs the full content region", async () => {
    fixedTabState.newThreadPanelActions = [
      {
        id: "canvas",
        title: "Canvas",
        component: () => <div>Plugin canvas</div>,
        layout: "flush",
        pluginId: "demo",
        generation: 1,
      },
    ];
    const panelStateId = getPluginPagePanelStateId({
      panelPath: "board",
      pluginId: "demo",
    });
    const actionTab = createPluginPanelFixedPanelTab({
      actionId: "canvas",
      paramsJson: null,
      pluginId: "demo",
      title: "Canvas",
    });
    localStorage.setItem(
      getFixedPanelTabsStateStorageKey({ threadId: panelStateId }),
      serializeFixedPanelTabsState({
        state: createEmptyFixedPanelTabsState({
          lastUsedAt: Date.now(),
          secondary: {
            activeTabId: actionTab.id,
            isOpen: true,
            tabs: [actionTab],
          },
        }),
      }),
    );

    renderHost();

    expect(await screen.findByText("Plugin canvas")).toBeTruthy();
    expect(
      screen.getByTestId("shared-thread-secondary-panel").dataset
        .fileTabContentFillsRegion,
    ).toBe("true");
  });

  it("does not reopen fixed tabs after navigating away and back", async () => {
    fixedTabState.registrations = [
      {
        panelId: "board",
        id: "navigation",
        title: "Navigation",
        icon: "PanelRight",
        component: () => <div>Navigation</div>,
      },
    ];
    const store = createStore();
    const firstRender = renderHost("board", "", store);
    fireEvent.click(
      await screen.findByRole("button", { name: "Hide right panel" }),
    );
    await screen.findByRole("button", { name: "Show right panel" });
    const panelStateId = getPluginPagePanelStateId({
      panelPath: "board",
      pluginId: "demo",
    });
    await waitFor(() => {
      const storedValue = localStorage.getItem(
        getFixedPanelTabsStateStorageKey({ threadId: panelStateId }),
      );
      expect(storedValue).not.toBeNull();
      expect(JSON.parse(storedValue!)).toMatchObject({
        secondary: {
          isOpen: false,
          tabs: [{ kind: "plugin-page-fixed", fixedTabId: "navigation" }],
        },
      });
    });
    firstRender.unmount();

    renderHost("board", "", store);

    await waitFor(() =>
      expect(
        screen
          .getByTestId("shared-secondary-panel-region")
          .hasAttribute("hidden"),
      ).toBe(true),
    );
    expect(
      await screen.findByRole("button", { name: "Show right panel" }),
    ).toBeTruthy();
  });

  it("preserves a closed fixed tab while its plugin registration is loading", async () => {
    fixedTabState.registrations = [
      {
        panelId: "board",
        id: "navigation",
        title: "Navigation",
        icon: "PanelRight",
        component: () => <div>Navigation</div>,
      },
    ];
    const store = createStore();
    const initial = renderHost("board", "", store);
    fireEvent.click(
      await screen.findByRole("button", { name: "Hide right panel" }),
    );
    await screen.findByRole("button", { name: "Show right panel" });
    initial.unmount();

    fixedTabState.panelRegistered = false;
    const loading = renderHost("board", "", store);
    await waitFor(() =>
      expect(
        screen
          .getByTestId("shared-secondary-panel-region")
          .hasAttribute("hidden"),
      ).toBe(true),
    );
    loading.unmount();

    fixedTabState.panelRegistered = true;
    renderHost("board", "", store);

    await waitFor(() =>
      expect(
        screen
          .getByTestId("shared-secondary-panel-region")
          .hasAttribute("hidden"),
      ).toBe(true),
    );
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

  it("keeps a restored thread-targeted terminal out of thread tab sync", async () => {
    const panelStateId = getPluginPagePanelStateId({
      panelPath: "board",
      pluginId: "demo",
    });
    const restoredTarget = {
      kind: "thread" as const,
      threadId: "thread-restored-target",
    };
    const restoredTab = createTerminalFixedPanelTab({
      terminalId: "terminal-1",
      target: restoredTarget,
    });
    localStorage.setItem(
      getFixedPanelTabsStateStorageKey({ threadId: panelStateId }),
      serializeFixedPanelTabsState({
        state: createEmptyFixedPanelTabsState({
          lastUsedAt: Date.now(),
          secondary: {
            activeTabId: restoredTab.id,
            isOpen: true,
            tabs: [restoredTab],
          },
        }),
      }),
    );

    renderHost();
    expect(await screen.findByTestId("plugin-page-terminal")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Select sibling terminal" }),
    );

    const siblingTab = createTerminalFixedPanelTab({
      terminalId: "terminal-2",
      target: restoredTarget,
    });
    await waitFor(() => {
      const storedValue = localStorage.getItem(
        getFixedPanelTabsStateStorageKey({ threadId: panelStateId }),
      );
      if (storedValue === null) {
        throw new Error("Expected plugin panel state to remain persisted");
      }
      expect(JSON.parse(storedValue)).toMatchObject({
        secondary: { activeTabId: siblingTab.id },
      });
    });
    expect(threadTabsApi.get).not.toHaveBeenCalled();
    expect(threadTabsApi.update).not.toHaveBeenCalled();
  });
});
