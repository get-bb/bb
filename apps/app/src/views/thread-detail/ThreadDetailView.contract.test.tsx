// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Provider } from "jotai";
import { useLayoutEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalThreadHeaderRowProps } from "@get-bb/plugin-sdk";
import { pluginSdkAppImplementation } from "@/lib/plugin-sdk-app-impl";
import { getProjectComposeRoutePath } from "@/lib/route-paths";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import {
  makeEnvironment,
  makeThreadListEntry,
} from "@bb/test-helpers/domain-fixtures";
import { holdSidebarThreads } from "@/test/fixtures/related-threads";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { resetFixedPanelTabsStateForTest } from "@/lib/fixed-panel-tabs";
import {
  createPluginFixedPanelTab,
  createThreadInfoFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  getPluginSlotSnapshot,
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
import {
  getFocusedAppPanelController,
  resetFocusedAppNavigationSurfacesForTest,
  useAppNavigationHost,
} from "@/lib/app-navigation-host";
import {
  PluginActionContextProvider,
  useBindPluginActionContext,
} from "@/lib/plugin-action-context-provider";
import { buildFocusedSurfacePaletteActions } from "@/lib/command-palette/palette-plugin-actions";
import { markPluginFrontendsSettled } from "@/lib/plugin-frontend-boot-state";
import {
  CONTRACT_PLUGIN_ID,
  ContractActionTab,
  ContractPanelProbe,
  ContractStateProbe,
  ContractTargetedFixedTab,
  contractActionPanelTabId,
  contractTarget,
  describePanelControllerContract,
  readContractNavigate,
  readContractPanel,
  readContractTabs,
  snapshotFromState,
  type ContractStateSink,
  type PanelContractSurface,
} from "@/test/panel-controller-contract";
import { makeTerminalSession } from "@/test/fixtures/terminal-sessions";
import {
  ThreadActionCollectors,
  resetThreadActionRegistryForTest,
  useThreadHeaderActionEntries,
} from "@/lib/thread-actions/thread-action-registry";
import { DefaultPaneContextProvider } from "./PaneContext";
import { ThreadDetailView } from "./ThreadDetailView";

const appCommandHandlers = vi.hoisted(
  () => new Map<string, () => boolean | void>(),
);
const fixtures = vi.hoisted(() => ({
  environmentStatus: "ready" as import("@bb/domain").EnvironmentStatus,
  headerTargets: [] as import("@get-bb/plugin-sdk").PluginThreadActionTarget[],
  probe: {
    current: null,
  } as import("@/test/panel-controller-contract").ContractPanelRef,
  probeHost: "prompt" as
    | "prompt"
    | "headerRow"
    | "threadAction"
    | "messageAction"
    | "paletteCommand"
    | "newTabAction",
  sink: {
    current: null,
  } as import("@/test/panel-controller-contract").ContractStateSink,
  router: null as ReturnType<
    typeof import("react-router-dom").createMemoryRouter
  > | null,
  binder: null as {
    bind: import("@/lib/plugin-navigation-hooks").BindPluginActionContext;
    host: import("@/lib/app-navigation-host").ResolvedAppNavigationHostCapabilities;
  } | null,
}));

const THREAD = makeThreadResponse({
  id: "thr_contract",
  projectId: "proj_contract",
  environmentId: "env_contract",
});
const ENVIRONMENT = makeEnvironment({
  id: "env_contract",
  projectId: "proj_contract",
});

vi.mock("@/lib/bb-desktop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bb-desktop")>()),
  isDesktopBrowserAvailable: () => true,
}));
vi.mock("@/components/commands/AppCommandProvider", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/commands/AppCommandProvider")
  >()),
  useAppCommandHandler: (command: string, handler: () => boolean | void) => {
    appCommandHandlers.set(command, handler);
  },
  useAppCommandShortcut: () => null,
}));
vi.mock("@bb/shared-ui/hooks/use-compact-viewport", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@bb/shared-ui/hooks/use-compact-viewport")
  >()),
  useIsCompactViewport: () => false,
}));
vi.mock("./ThreadDetailSecondaryContent", async () => {
  const { ContractSecondaryPanel } =
    await import("@/test/panel-controller-contract");
  return {
    ThreadDetailSecondaryContent: ({
      header,
      main,
      secondaryPanel,
    }: {
      header: ReactNode;
      main: ReactNode;
      secondaryPanel: Parameters<typeof ContractSecondaryPanel>[0];
    }) => (
      <>
        {header}
        <div data-testid="thread-main">{main}</div>
        <ContractSecondaryPanel {...secondaryPanel} />
      </>
    ),
  };
});
vi.mock("./ThreadDetailHeader", async () => {
  const { useThreadHeaderActionEntries } =
    await import("@/lib/thread-actions/thread-action-registry");
  return {
    ThreadDetailHeader: ({ thread }: { thread: { id: string } }) => {
      useThreadHeaderActionEntries(thread);
      return <header data-testid="thread-header" />;
    },
  };
});
vi.mock("./ThreadDetailPromptArea", async () => {
  const { PluginContext } = await import("@/components/plugin/plugin-context");
  const { ContractPanelProbe } =
    await import("@/test/panel-controller-contract");
  const { ThreadTimelineRows } =
    await import("@/components/thread/timeline/ThreadTimelineRows");
  const { conversationRow } =
    await import("@/test/fixtures/thread-timeline-rows");
  return {
    ThreadDetailPromptArea: () =>
      fixtures.probeHost === "prompt" ? (
        <PluginContext.Provider value={CONTRACT_PLUGIN_ID}>
          <ContractPanelProbe probe={fixtures.probe} />
        </PluginContext.Provider>
      ) : fixtures.probeHost === "messageAction" ? (
        <ThreadTimelineRows
          threadId="thr_contract"
          timelineRows={[
            conversationRow({
              id: "probe_row",
              role: "assistant",
              text: "Probe answer.",
              threadId: "thr_contract",
            }),
          ]}
          threadRuntimeDisplayStatus="idle"
        />
      ) : null,
  };
});
vi.mock("./useThreadDetailThread", () => ({
  useThreadDetailThread: () => ({
    hasThreadDetailBootstrapSettled: true,
    threadDetailBootstrapQuery: { isFetching: false },
    threadQuery: {
      data: THREAD,
      isFetching: false,
      isLoadingError: false,
      error: null,
    },
    unreadDividerState: { ready: true, anchor: null },
  }),
}));
vi.mock("@/hooks/queries/environment-queries", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/hooks/queries/environment-queries")
  >()),
  useEnvironment: () => ({
    data: { ...ENVIRONMENT, status: fixtures.environmentStatus },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

async function mountThreadView(
  probeHost: typeof fixtures.probeHost,
): Promise<PanelContractSurface> {
  fixtures.probeHost = probeHost;
  const probe = fixtures.probe;
  probe.current = null;
  probe.navigate = undefined;
  const sink: ContractStateSink = { current: null };
  fixtures.sink = sink;
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <PluginActionContextProvider>
            <PluginActionContextBinderProbe />
            <ThreadActionCollectors
              coreRegistrations={[]}
              requestRename={() => undefined}
            />
            <DefaultPaneContextProvider
              paneId="main"
              onRequestClose={null}
              navigateInPane={() => {}}
            >
              <ContractStateProbe
                panelStateId={THREAD.id}
                syncThreadId={THREAD.id}
                sink={sink}
              />
              <ThreadDetailView
                surface="pane"
                projectId={THREAD.projectId}
                threadId={THREAD.id}
                timelineEnabled={false}
              />
            </DefaultPaneContextProvider>
          </PluginActionContextProvider>
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  fixtures.router = router;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  holdSidebarThreads(queryClient, [
    makeThreadListEntry({
      ...THREAD,
      environmentPath: ENVIRONMENT.path,
      environmentStatus: fixtures.environmentStatus,
      environmentHostLifecycle: ENVIRONMENT.hostLifecycle,
    }),
  ]);
  render(
    <QueryClientProvider client={queryClient}>
      <Provider>
        <RouterProvider router={router} />
      </Provider>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(snapshotFromState(sink).tabIds).toEqual(
      expect.arrayContaining([
        createThreadInfoFixedPanelTab().id,
        pluginFixedTabId("summary"),
      ]),
    ),
  );
  if (probeHost === "threadAction")
    await waitFor(() => expect(probe.current).not.toBeNull());
  if (probeHost === "messageAction") {
    fireEvent.click(
      await screen.findByRole("button", { name: "Probe message" }),
    );
    await waitFor(() => expect(probe.current).not.toBeNull());
  }
  if (probeHost === "paletteCommand") {
    await waitFor(() => expect(getFocusedAppPanelController()).not.toBeNull());
    const binder = fixtures.binder;
    if (binder === null) throw new Error("binder probe has not rendered");
    const [command] = buildFocusedSurfacePaletteActions({
      bind: binder.bind,
      host: binder.host,
      slots: getPluginSlotSnapshot().commandPaletteActions.flatMap((slot) =>
        slot.pluginId === CONTRACT_PLUGIN_ID && slot.target === "app"
          ? [slot]
          : [],
      ),
      threadId: THREAD.id,
      projectId: THREAD.projectId,
    });
    act(() => command?.run());
    expect(probe.current).not.toBeNull();
  }
  if (probeHost === "newTabAction") {
    act(() => {
      appCommandHandlers.get("file.quickOpen")?.();
    });
    await waitFor(() =>
      expect(
        document.getElementById("plugin-action:contract:launcher"),
      ).not.toBeNull(),
    );
    fireEvent.click(
      document.getElementById("plugin-action:contract:launcher")!,
    );
    await waitFor(() => expect(probe.current).not.toBeNull());
  }
  return {
    panel: () => readContractPanel(probe),
    navigation: {
      navigate: () => readContractNavigate(probe),
      open: {
        terminal: makeTerminalSession({
          id: "term_contract",
          threadId: THREAD.id,
          environmentId: ENVIRONMENT.id,
          hostId: ENVIRONMENT.hostId,
        }),
        file: {
          target: {
            kind: "thread-storage",
            threadId: THREAD.id,
            path: "a.md",
          },
          location: null,
        },
        url: "https://example.com/contract",
      },
    },
    snapshot: () => snapshotFromState(sink),
    tabs: () =>
      probeHost === "prompt" || probeHost === "headerRow"
        ? readContractTabs(probe)
        : readContractPanel(probe).getTabs(),
    renderedTabVisible: () =>
      screen.queryByTestId("contract-tab-visible")?.textContent ?? null,
    renderedTarget: () =>
      screen.queryByTestId("contract-target")?.textContent ?? null,
    command: (id) => appCommandHandlers.get(id)?.() !== false,
    action: { tab: actionTab, panelTabId: contractActionPanelTabId("chat") },
    fixed: {
      targeted: { tab: targetedTab, panelTabId: pluginFixedTabId("summary") },
      untargeted: {
        tab: untargetedTab,
        panelTabId: pluginFixedTabId("notes"),
      },
    },
    foreignTab: {
      id: "chat",
      context: { kind: "nav-panel", panelId: "board" },
      availability: "action",
    },
    toggleRestoresActiveTab: true,
  };
}

const FULL_SUPPORT = {
  fixedTabs: true,
  actionTabs: true,
  navigation: true,
} as const;

describePanelControllerContract("thread view", FULL_SUPPORT, () =>
  mountThreadView("prompt"),
);

describePanelControllerContract("thread header row", FULL_SUPPORT, () =>
  mountThreadView("headerRow"),
);

describePanelControllerContract("thread header action", FULL_SUPPORT, () =>
  mountThreadView("threadAction"),
);

describePanelControllerContract("thread message action", FULL_SUPPORT, () =>
  mountThreadView("messageAction"),
);

describePanelControllerContract(
  "command palette command on a thread",
  FULL_SUPPORT,
  () => mountThreadView("paletteCommand"),
);

describePanelControllerContract(
  "thread new-tab plugin action",
  FULL_SUPPORT,
  () => mountThreadView("newTabAction"),
);

function PluginActionContextBinderProbe() {
  const bind = useBindPluginActionContext();
  const host = useAppNavigationHost();
  useLayoutEffect(() => {
    fixtures.binder = { bind, host };
  });
  return null;
}

function HeaderRowProbe() {
  return fixtures.probeHost === "headerRow" ? (
    <ContractPanelProbe probe={fixtures.probe} />
  ) : fixtures.probeHost === "threadAction" ? (
    <ThreadActionProbe />
  ) : null;
}

function ThreadActionProbe() {
  useThreadHeaderActionEntries(THREAD);
  return null;
}

const targetedTab = {
  id: "summary",
  context: { kind: "thread" },
  availability: "fixed",
} as const;
const untargetedTab = { ...targetedTab, id: "notes" } as const;
const actionTab = {
  id: "chat",
  context: { kind: "thread" },
  availability: "action",
} as const;

function pluginFixedTabId(tabId: string) {
  return createPluginFixedPanelTab({ pluginId: CONTRACT_PLUGIN_ID, tabId }).id;
}

beforeEach(() => {
  markPluginFrontendsSettled();
  appCommandHandlers.clear();
  window.localStorage.clear();
  resetFixedPanelTabsStateForTest();
  resetPluginSlotStoreForTest();
  setPluginSlotRegistrations(
    CONTRACT_PLUGIN_ID,
    collectPluginAppRegistrations(
      definePluginApp((app) => {
        app.slots.experimental_tab({
          ...targetedTab,
          title: "Summary",
          icon: "Info",
          component: () => <ContractTargetedFixedTab tab={targetedTab} />,
          experimental_target: contractTarget,
        });
        app.slots.experimental_tab({
          ...untargetedTab,
          title: "Notes",
          icon: "Note",
          component: () => <div>Notes</div>,
        });
        app.slots.experimental_tab({
          ...actionTab,
          title: "Chat",
          icon: "Chat",
          component: ContractActionTab,
        });
        app.slots.experimental_threadHeaderRow({
          id: "probe",
          component: HeaderRowProbe,
        });
        app.slots.messageAction({
          id: "probe-message",
          title: "Probe message",
          icon: "Zap",
          run: ({ panel, navigate }) => {
            if (fixtures.probeHost === "messageAction") {
              fixtures.probe.current = panel;
              fixtures.probe.navigate = navigate;
            }
          },
        });
        app.commands.register({
          id: "probe-command",
          title: "Probe command",
          run: ({ panel, navigate }) => {
            if (fixtures.probeHost === "paletteCommand") {
              fixtures.probe.current = panel;
              fixtures.probe.navigate = navigate;
            }
          },
        });
        app.slots.experimental_tab({
          id: "launcher",
          context: { kind: "thread" },
          availability: "action",
          title: "Launcher",
          icon: "Zap",
          component: ContractActionTab,
          run: ({ panel, navigate }) => {
            if (fixtures.probeHost === "newTabAction") {
              fixtures.probe.current = panel;
              fixtures.probe.navigate = navigate;
            }
          },
        });
        app.slots.experimental_threadAction({
          id: "probe",
          title: "Probe",
          icon: "Info",
          group: "probe",
          placement: "header",
          item: ({ thread, navigate, panel }) => {
            fixtures.headerTargets.push(thread);
            if (fixtures.probeHost === "threadAction") {
              fixtures.probe.current = panel;
              fixtures.probe.tabs = undefined;
              fixtures.probe.navigate = navigate;
            }
            return null;
          },
        });
      }),
    ),
  );
});

afterEach(() => {
  fixtures.environmentStatus = "ready";
  fixtures.headerTargets.length = 0;
  cleanup();
  vi.restoreAllMocks();
  resetThreadActionRegistryForTest();
  resetPluginSlotStoreForTest();
  resetFocusedAppNavigationSurfacesForTest();
});

describe("thread action target on the thread page", () => {
  it("gives header actions the thread's environment while it provisions, as sidebar rows get it", async () => {
    fixtures.environmentStatus = "provisioning";
    await mountThreadView("prompt");
    await waitFor(() =>
      expect(fixtures.headerTargets.at(-1)?.environment).toEqual({
        id: ENVIRONMENT.id,
        path: ENVIRONMENT.path,
        status: "provisioning",
        hostLifecycle: ENVIRONMENT.hostLifecycle,
      }),
    );
  });
});

describe("experimental_threadHeaderRow", () => {
  const ROWS_PLUGIN_ID = "rows";
  function Labelled(label: string) {
    return function Row(props: ExperimentalThreadHeaderRowProps) {
      return (
        <div data-testid="header-row" data-props={JSON.stringify(props)}>
          {label}
        </div>
      );
    };
  }

  const {
    experimental_useAppPanel: useAppPanel,
    experimental_usePanelTabs: usePanelTabs,
    experimental_useSidebarThreads: useSidebarThreads,
    useBbNavigate,
    useSdk,
  } = pluginSdkAppImplementation;

  function HooksRow() {
    const panel = useAppPanel();
    const tabs = usePanelTabs();
    const sdk = useSdk();
    const sidebar = useSidebarThreads();
    const navigate = useBbNavigate();
    return (
      <div
        data-testid="header-row"
        data-tab-keys={tabs.tabs.map((tab) => tab.key).join(" ")}
        data-has-sdk={String(typeof sdk.threads.get === "function")}
        data-sidebar-status={sidebar.status}
      >
        <button
          type="button"
          onClick={() => {
            const summary = panel
              .getTabs()
              .tabs.find((tab) => tab.title === "Summary");
            if (summary) panel.selectTab(summary.key);
          }}
        >
          Show summary
        </button>
        <button type="button" onClick={() => navigate.toProject("proj_next")}>
          Go
        </button>
      </div>
    );
  }

  function Crashes(): never {
    throw new Error("row crashed");
  }

  function registerRows(setup: Parameters<typeof definePluginApp>[0]) {
    setPluginSlotRegistrations(
      ROWS_PLUGIN_ID,
      collectPluginAppRegistrations(definePluginApp(setup)),
    );
  }

  it("stacks rows by order between the thread header and the timeline", async () => {
    registerRows((app) => {
      app.slots.experimental_threadHeaderRow({
        id: "unordered",
        component: Labelled("Unordered"),
      });
      app.slots.experimental_threadHeaderRow({
        id: "second",
        order: 20,
        component: Labelled("Second"),
      });
      app.slots.experimental_threadHeaderRow({
        id: "empty",
        order: 0,
        component: () => null,
      });
      app.slots.experimental_threadHeaderRow({
        id: "first",
        order: 10,
        component: Labelled("First"),
      });
    });
    await mountThreadView("prompt");

    const rows = screen.getAllByTestId("header-row");
    expect(rows.map((row) => row.textContent)).toEqual([
      "First",
      "Second",
      "Unordered",
    ]);
    const header = screen.getByTestId("thread-header");
    const main = screen.getByTestId("thread-main");
    for (const row of rows) {
      expect(
        header.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        row.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(main.contains(row)).toBe(false);
    }
    expect(JSON.parse(rows[0]?.dataset.props ?? "null")).toEqual({
      threadId: THREAD.id,
      projectId: THREAD.projectId,
      environment: { id: "env_contract" },
    });
  });

  it("drops only a crashing row and keeps the thread view", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerRows((app) => {
      app.slots.experimental_threadHeaderRow({
        id: "broken",
        order: 0,
        component: Crashes,
      });
      app.slots.experimental_threadHeaderRow({
        id: "kept",
        component: Labelled("Kept"),
      });
    });
    await mountThreadView("prompt");

    expect(
      screen.getAllByTestId("header-row").map((row) => row.textContent),
    ).toEqual(["Kept"]);
    expect(screen.getByTestId("thread-header")).toBeTruthy();
    expect(screen.getByTestId("thread-main")).toBeTruthy();
    vi.mocked(console.error).mockRestore();
  });

  it("gives a row the thread's panel, navigation, sidebar threads and sdk", async () => {
    registerRows((app) => {
      app.slots.experimental_threadHeaderRow({
        id: "hooks",
        component: HooksRow,
      });
    });
    await mountThreadView("prompt");

    const row = screen.getByTestId("header-row");
    expect(row.dataset.hasSdk).toBe("true");
    expect(["loading", "ready", "error"]).toContain(row.dataset.sidebarStatus);
    expect(row.dataset.tabKeys?.split(" ")).toEqual(
      expect.arrayContaining([
        createThreadInfoFixedPanelTab().id,
        pluginFixedTabId("summary"),
      ]),
    );

    expect(snapshotFromState(fixtures.sink).activeTabId).not.toBe(
      pluginFixedTabId("summary"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show summary" }));
    await waitFor(() =>
      expect(snapshotFromState(fixtures.sink).activeTabId).toBe(
        pluginFixedTabId("summary"),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await waitFor(() =>
      expect(fixtures.router?.state.location.pathname).toBe(
        getProjectComposeRoutePath("proj_next"),
      ),
    );
  });
});
