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
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
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
import { z } from "zod";
import type { JsonValue, PluginFixedTabDeclaration } from "@get-bb/plugin-sdk";
import type { TerminalSession } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import * as appCommandProvider from "@/components/commands/AppCommandProvider";
import * as browserDesktop from "@/lib/bb-desktop";
import * as compactViewport from "@bb/shared-ui/hooks/use-compact-viewport";
import * as fileOpenerPreference from "@/lib/file-opener-preference";
import * as hostQueries from "@/hooks/queries/host-queries";
import * as pluginSlots from "@/lib/plugin-slots";
import * as systemQueries from "@/hooks/queries/system-queries";
import * as terminalQueries from "@/hooks/queries/thread-terminal-queries";
import * as lazySecondaryPanelComponents from "@/components/secondary-panel/lazySecondaryPanelComponents";
import * as secondaryPanelLayout from "@/components/secondary-panel/SecondaryPanelLayout";
import { useThreadTerminalController } from "@/components/thread/terminal/useThreadTerminalController";
import {
  getPluginFixedTabOwnerId,
  useAppFixedTabTarget,
} from "@/lib/app-fixed-tab-navigation";

type TestFixedTabRegistration = PluginFixedTabDeclaration;

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
const viewportState = vi.hoisted(() => ({ isCompactViewport: false }));
const createTerminal = vi.hoisted(() => vi.fn());
const threadTabsApi = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
}));
const terminalQueryState: { sessions: TerminalSession[] } = vi.hoisted(() => ({
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
  registrations:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ [] as TestFixedTabRegistration[],
  fileOpeners:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ [] as TestFileOpenerRegistration[],
  newThreadPanelActions:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ [] as TestNewThreadPanelActionRegistration[],
}));
const hostState = vi.hoisted(() => ({
  hosts: [
    { id: "host-1", name: "Studio", status: "connected" },
    { id: "host-2", name: "Laptop", status: "connected" },
  ],
  primaryHostId: "host-1",
}));
const secondaryPanelState = vi.hoisted(() => ({
  fixedTabs:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ [] as Array<{
      contentFillsRegion: boolean;
      hasRenderer: boolean;
      title: string;
    }>,
  splitPanelStateId:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ undefined as
      | string
      | undefined,
  tabKinds:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ [] as string[],
}));

const fixedTabTargetSchema = z.object({
  kind: z.literal("record"),
  recordId: z.string(),
});

vi.spyOn(sdk.threads.tabs, "get").mockImplementation(threadTabsApi.get);
vi.spyOn(sdk.threads.tabs, "update").mockImplementation(threadTabsApi.update);
vi.spyOn(compactViewport, "useIsCompactViewport").mockImplementation(
  () => viewportState.isCompactViewport,
);
vi.spyOn(appCommandProvider, "useAppCommandHandler").mockImplementation(
  () => undefined,
);
vi.spyOn(appCommandProvider, "useAppCommandShortcut").mockImplementation(
  () => null,
);
vi.spyOn(pluginSlots, "usePluginSlots").mockImplementation(() => ({
  ...pluginSlots.EMPTY_PLUGIN_SLOT_SNAPSHOT,
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
          fixedTabs: fixedTabState.registrations,
        },
      ]
    : [],
}));
vi.spyOn(
  fileOpenerPreference,
  "useFileOpenerPreferenceValue",
).mockImplementation(() => ({}));
vi.spyOn(browserDesktop, "getDesktopBrowserApi").mockImplementation(() => null);
vi.spyOn(browserDesktop, "isDesktopBrowserAvailable").mockImplementation(
  () => browserState.available,
);
vi.spyOn(terminalQueries, "useCreateTerminal").mockImplementation(() =>
  useMutation({ mutationFn: async (request) => createTerminal(request) }),
);
vi.spyOn(terminalQueries, "useCloseTerminal").mockImplementation(() =>
  useMutation({
    mutationFn: async () => terminalQueryState.sessions[0],
  }),
);
/* SAFETY: The test supplies only the query fields used by the host. */
vi.spyOn(terminalQueries, "useTerminals").mockImplementation(
  () =>
    ({
      data: terminalQueryState,
      error: null,
      isLoading: false,
    }) as ReturnType<typeof terminalQueries.useTerminals>,
);
/* SAFETY: The test supplies only the query fields used by the host. */
vi.spyOn(hostQueries, "useHosts").mockImplementation(
  () =>
    ({
      data: hostState.hosts,
      isLoading: false,
    }) as ReturnType<typeof hostQueries.useHosts>,
);
/* SAFETY: The test supplies only the query field used by the host. */
vi.spyOn(systemQueries, "useSystemConfig").mockImplementation(
  () =>
    ({
      data: { primaryHostId: hostState.primaryHostId },
    }) as ReturnType<typeof systemQueries.useSystemConfig>,
);
vi.spyOn(secondaryPanelLayout, "SecondaryPanelLayout").mockImplementation(
  ({ main, open, renderPanel }) => (
    <div data-testid="shared-secondary-panel-layout">
      {main}
      <div data-testid="shared-secondary-panel-region" hidden={!open}>
        {renderPanel({
          presentation: "inline",
          canShowNativeBrowserView: true,
          inlinePanelToggle: "button",
          isMainCollapsed: false,
          onToggleMainCollapse: () => undefined,
        })}
      </div>
    </div>
  ),
);

vi.spyOn(
  lazySecondaryPanelComponents,
  "LazyThreadSecondaryPanel",
).mockImplementation(
  ({
    activeTab,
    tabs,
    fixedTabs,
    onClose,
    onOpenNewTab,
    renderBrowserDeck,
    splitPanelStateId,
  }) => {
    const pane = { isFocused: true, onFocusPane: () => undefined };
    const activeFixedTab = fixedTabs.find(
      (tab) => tab.tab.id === activeTab?.id,
    );
    const activeRenderableTab = tabs.find(
      (tab) => tab.tab.id === activeTab?.id,
    );
    secondaryPanelState.fixedTabs = fixedTabs.map((tab) => ({
      contentFillsRegion: tab.contentFillsRegion === true,
      hasRenderer: tab.renderContent !== undefined,
      title: tab.title,
    }));
    secondaryPanelState.splitPanelStateId = splitPanelStateId;
    secondaryPanelState.tabKinds = tabs.map((tab) => tab.tab.kind);
    return (
      <aside
        data-testid="shared-thread-secondary-panel"
        data-file-tab-content-fills-region={
          activeRenderableTab?.contentFillsRegion === true ? "true" : "false"
        }
      >
        {tabs.map((tab) => (
          <div key={tab.tab.id}>
            <button type="button" onClick={tab.onSelect}>
              {tab.label}
            </button>
            <button
              type="button"
              aria-label={`Close ${tab.label}`}
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
        {activeFixedTab?.renderContent?.(pane)}
        {activeRenderableTab?.tab.kind === "browser"
          ? null
          : activeRenderableTab?.renderContent(pane)}
        {renderBrowserDeck?.(
          activeRenderableTab?.tab.kind === "browser"
            ? activeRenderableTab.tab.id
            : null,
          pane,
        )}
      </aside>
    );
  },
);

vi.spyOn(lazySecondaryPanelComponents, "LazyNewTabPage").mockImplementation(
  ({
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
);

vi.spyOn(lazySecondaryPanelComponents, "LazyBrowserTabDeck").mockImplementation(
  ({ activeBrowserTabId }) =>
    activeBrowserTabId === null ? (
      <></>
    ) : (
      <div data-testid="plugin-page-browser" />
    ),
);

vi.spyOn(
  lazySecondaryPanelComponents,
  "LazyThreadTerminalPanel",
).mockImplementation((props) => {
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
});

vi.spyOn(
  lazySecondaryPanelComponents,
  "LazyWorkspaceFilePreviewTabContent",
).mockImplementation(({ activePath, environmentId }) => (
  <div>
    workspace:{environmentId}:{activePath}
  </div>
));
vi.spyOn(
  lazySecondaryPanelComponents,
  "LazyHostScopedFilePreviewTabContent",
).mockImplementation(
  ({
    activePath,
    hostId,
    isPanelOpen,
  }: {
    activePath: string;
    hostId: string;
    isPanelOpen: boolean;
  }) => (
    <div
      data-testid="host-scoped-file-preview"
      data-panel-open={isPanelOpen ? "true" : "false"}
    >
      host:{hostId}:{activePath}
    </div>
  ),
);
vi.spyOn(
  lazySecondaryPanelComponents,
  "LazyThreadStorageFilePreviewTabContent",
).mockImplementation(
  ({ activePath, threadId }: { activePath: string; threadId: string }) => (
    <div>
      storage:{threadId}:{activePath}
    </div>
  ),
);

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
    viewportState.isCompactViewport = false;
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
    secondaryPanelState.fixedTabs = [];
    secondaryPanelState.splitPanelStateId = undefined;
    secondaryPanelState.tabKinds = [];
    localStorage.clear();
    resetFixedPanelTabsStateForTest();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the drawer glyph on the trigger for a compact viewport", async () => {
    viewportState.isCompactViewport = true;
    renderHost();

    const showButton = await screen.findByRole("button", {
      name: "Show right panel",
    });
    expect(showButton.querySelector('[data-icon="PanelBottom"]')).toBeTruthy();
  });

  it("shows the side-panel glyph on the trigger for a wide viewport", async () => {
    renderHost();

    const showButton = await screen.findByRole("button", {
      name: "Show right panel",
    });
    expect(showButton.querySelector('[data-icon="PanelRight"]')).toBeTruthy();
  });

  it("keeps one panel toggle and mounts the collapsed panel before opening", async () => {
    renderHost();

    expect(screen.getByTestId("shared-secondary-panel-layout")).toBeTruthy();
    const collapsedPanel = await screen.findByTestId(
      "shared-thread-secondary-panel",
    );
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

    expect(secondaryPanelState.splitPanelStateId).toBe(
      getPluginPagePanelStateId({
        panelPath: "board",
        pluginId: "demo",
      }),
    );
    expect(secondaryPanelState.fixedTabs).toEqual([
      {
        contentFillsRegion: false,
        hasRenderer: true,
        title: "Navigation",
      },
      { contentFillsRegion: true, hasRenderer: true, title: "Details" },
    ]);

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

  it("retains a validated fixed-tab target across panel and route remounts for the app session", async () => {
    function Details() {
      const targetState = useAppFixedTabTarget(
        getPluginFixedTabOwnerId("demo", "board"),
        "details",
      );
      return (
        <div data-testid="targeted-details-content">
          Details
          {targetState === null ? null : (
            <>
              <output>{JSON.stringify(targetState.target)}</output>
              <button type="button" onClick={targetState.clear}>
                Clear target
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
          validate: (value): value is JsonValue =>
            fixedTabTargetSchema.safeParse(value).success,
        },
      },
    ];
    browserState.available = true;

    const store = createStore();
    const initialRender = renderHost("board", "", store);
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

    fireEvent.click(screen.getByText("Add tab"));
    expect(await screen.findByTestId("plugin-page-new-tab")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open browser" }));
    expect(await screen.findByTestId("plugin-page-browser")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(
      await screen.findByText('{"kind":"record","recordId":"issue-42"}'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide right panel" }));
    expect(screen.queryByTestId("targeted-details-content")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show right panel" }));
    expect(
      await screen.findByText('{"kind":"record","recordId":"issue-42"}'),
    ).toBeTruthy();

    initialRender.unmount();
    const routeRemount = renderHost("board", "", store);
    expect(
      await screen.findByText('{"kind":"record","recordId":"issue-42"}'),
    ).toBeTruthy();

    routeRemount.unmount();
    renderHost();
    expect(await screen.findByTestId("navigation-content")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(await screen.findByTestId("targeted-details-content")).toBeTruthy();
    expect(screen.queryByText(/issue-42/)).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Open targeted fixed tab" }),
    );
    expect(
      await screen.findByText('{"kind":"record","recordId":"issue-42"}'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear target" }));
    expect(screen.queryByRole("button", { name: "Clear target" })).toBeNull();
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
    expect(
      screen.getByTestId("host-scoped-file-preview").dataset.panelOpen,
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Hide right panel" }));
    await waitFor(() => {
      expect(
        screen.getByTestId("host-scoped-file-preview").dataset.panelOpen,
      ).toBe("false");
    });

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

  it("lets a restored padded action own its single padded scroll frame", async () => {
    fixedTabState.newThreadPanelActions = [
      {
        id: "canvas",
        title: "Canvas",
        component: () => <div>Plugin canvas</div>,
        layout: "padded",
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
    expect(secondaryPanelState.tabKinds).toContain("browser");
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
    expect(secondaryPanelState.tabKinds).toContain("terminal");
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
