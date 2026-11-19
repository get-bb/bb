// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { defaultAppSettings } from "@bb/domain";
import { makeProjectWithThreadsResponse } from "@/test/fixtures/projects";
import { resetFixedPanelTabsStateForTest } from "@/lib/fixed-panel-tabs";
import {
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
} from "@/lib/app-navigation-host";
import { createPluginPanelController } from "@/lib/plugin-panel-controller";
import { DefaultPaneContextProvider } from "@/views/thread-detail/PaneContext";
import { ROOT_COMPOSE_FIXED_PANEL_STATE_ID } from "@/views/RootComposePanelTabContent";
import {
  CONTRACT_PLUGIN_ID,
  ContractActionTab,
  ContractStateProbe,
  contractActionPanelTabId,
  describePanelControllerContract,
  readContractNavigate,
  snapshotFromState,
  type ContractStateSink,
} from "@/test/panel-controller-contract";
import { makeTerminalSession } from "@/test/fixtures/terminal-sessions";
import { RootComposeView } from "./RootComposeView";

const probe = vi.hoisted(
  (): import("@/test/panel-controller-contract").ContractPanelRef => ({
    current: null,
  }),
);
const appCommandHandlers = vi.hoisted(
  () => new Map<string, () => boolean | void>(),
);

vi.mock("@/components/commands/AppCommandProvider", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/commands/AppCommandProvider")
  >()),
  useAppCommandHandler: (command: string, handler: () => boolean | void) => {
    appCommandHandlers.set(command, handler);
  },
  useAppCommandShortcut: () => null,
}));
vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => false,
}));
vi.mock("@/components/secondary-panel/SecondaryPanelLayout", () => ({
  SecondaryPanelLayout: ({ main }: { main: ReactNode }) => main,
}));
vi.mock("@/views/RootComposeSecondaryContent", async () => {
  const { ContractSecondaryPanel } =
    await import("@/test/panel-controller-contract");
  return {
    useRootComposePinnedPanelToggleBoxClassName: () => "",
    RootComposeSecondaryContent: ({
      children,
      secondaryPanel,
    }: {
      children: ReactNode;
      secondaryPanel: Parameters<typeof ContractSecondaryPanel>[0];
    }) => (
      <>
        {children}
        <ContractSecondaryPanel {...secondaryPanel} />
      </>
    ),
  };
});
vi.mock("@/components/promptbox/NewThreadPromptBox", async () => {
  const { PluginContext } = await import("@/components/plugin/plugin-context");
  const { ContractPanelProbe, CONTRACT_PLUGIN_ID } =
    await import("@/test/panel-controller-contract");
  return {
    NewThreadPromptBox: () => (
      <div data-testid="new-thread-prompt-box">
        <PluginContext.Provider value={CONTRACT_PLUGIN_ID}>
          <ContractPanelProbe probe={probe} />
        </PluginContext.Provider>
      </div>
    ),
  };
});
vi.mock("@/hooks/queries/thread-terminal-queries", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/hooks/queries/thread-terminal-queries")
  >()),
  useTerminals: () => ({ data: undefined }),
  useEnvironmentTerminals: () => ({ data: undefined }),
  useCloseTerminal: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/queries/environment-provider-queries", () => ({
  useSystemEnvironmentProviders: () => ({ providers: [] }),
}));
vi.mock("@/hooks/queries/machine-provider-queries", () => ({
  useSystemMachineProviders: () => ({ providers: [] }),
}));
vi.mock("@/hooks/queries/plugin-settings-queries", () => ({
  usePluginList: () => ({ data: { plugins: [] } }),
}));
vi.mock("@/lib/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sdk")>()),
  sdk: {
    system: {
      experimental_recordTelemetryEvent: vi.fn().mockResolvedValue(undefined),
    },
    terminals: { get: vi.fn() },
  },
}));
vi.mock("@/lib/bb-desktop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bb-desktop")>()),
  isDesktopBrowserAvailable: () => true,
}));
vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: {
      sections: [],
      projects: [],
      personalProject: makeProjectWithThreadsResponse({
        id: "personal",
        kind: "personal",
        name: "Personal",
        sources: [],
        threads: [],
      }),
    },
    isError: false,
    isLoading: false,
    isPending: false,
    isSuccess: true,
    isPlaceholderData: false,
  }),
}));
vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({ data: [] }),
  selectHosts: <T,>(hosts: T[] | undefined) => hosts ?? [],
  selectPrimaryHost: () => ({ id: "host_contract" }),
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemProviders: () => ({ data: undefined }),
  useProviderDirectory: () => ({ data: undefined }),
  useSystemProviderStates: () => ({ data: undefined, isPending: false }),
  useKnownProviderModelCatalogScope: () => undefined,
  useHostProviderCliStatus: () => ({ data: undefined }),
  useSystemConfig: () => ({
    data: {
      primaryHostId: "host_contract",
      generalSettings: defaultAppSettings,
    },
  }),
  useSystemExecutionOptions: () => ({
    data: undefined,
    isLoading: true,
    isError: false,
    isPlaceholderData: false,
  }),
}));
vi.mock("@/hooks/queries/thread-panel-queries", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/hooks/queries/thread-panel-queries")
  >()),
  useThreadStorageFiles: () => ({
    data: undefined,
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useThreadStorageFilePreview: () => ({
    data: undefined,
    error: null,
    isLoading: false,
  }),
}));
vi.mock("@/hooks/queries/project-queries", () => ({
  stripProjectThreads: (project: unknown) => project,
  useProjectPromptHistory: () => ({ data: [] }),
  useProjectSourceBranches: () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/project-default-execution-options-query", () => ({
  useProjectDefaultExecutionOptions: () => ({ data: undefined }),
}));
vi.mock("@/hooks/mutations/project-mutations", () => ({
  useUploadPromptAttachment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useQuickCreateProject", () => ({
  useQuickCreateProjectController: () => ({
    hostId: null,
    hostName: null,
    hosts: [],
    isAvailable: false,
    isCreating: false,
    openCreateDialog: vi.fn(),
    platform: null,
    projectPathDialog: { isOpen: false, onOpenChange: vi.fn(), target: null },
    submitProjectPath: vi.fn(),
  }),
}));
vi.mock("@/components/dialogs/ProjectMachineSetupDialog", () => ({
  ProjectMachineSetupDialog: () => null,
}));

const NO_TABS = { open: false, selectedKey: null, tabs: [] };
const CONTRACT_HOST_ID = "host_contract";

const actionTab = {
  id: "chat",
  context: { kind: "thread" },
  availability: "action",
} as const;

beforeEach(() => {
  appCommandHandlers.clear();
  window.localStorage.clear();
  resetFixedPanelTabsStateForTest();
  resetPluginSlotStoreForTest();
  setPluginSlotRegistrations(
    CONTRACT_PLUGIN_ID,
    collectPluginAppRegistrations(
      definePluginApp((app) => {
        app.slots.experimental_newThreadPanelAction({
          id: "chat",
          title: "Chat",
          component: ContractActionTab,
        });
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetFocusedAppNavigationSurfacesForTest();
});

describePanelControllerContract(
  "New thread screen",
  { fixedTabs: false, actionTabs: true, navigation: true },
  async () => {
    const sink: ContractStateSink = { current: null };
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <DefaultPaneContextProvider
              paneId="main"
              onRequestClose={null}
              navigateInPane={() => {}}
            >
              <ContractStateProbe
                panelStateId={ROOT_COMPOSE_FIXED_PANEL_STATE_ID}
                syncThreadId={null}
                sink={sink}
              />
              <RootComposeView />
            </DefaultPaneContextProvider>
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <Provider>
          <RouterProvider router={router} />
        </Provider>
      </QueryClientProvider>,
    );
    await screen.findByTestId("new-thread-prompt-box");
    await waitFor(() => expect(getFocusedAppPanelController()).not.toBeNull());
    const panel = createPluginPanelController(
      CONTRACT_PLUGIN_ID,
      getFocusedAppPanelController,
    );
    return {
      panel: () => panel,
      navigation: {
        navigate: () => readContractNavigate(probe),
        open: {
          terminal: makeTerminalSession({
            id: "term_contract",
            threadId: null,
            environmentId: null,
            hostId: CONTRACT_HOST_ID,
          }),
          file: {
            target: { kind: "host", hostId: CONTRACT_HOST_ID, path: "/a.md" },
            location: null,
          },
          url: "https://example.com/contract",
        },
      },
      snapshot: () => snapshotFromState(sink),
      tabs: () => getFocusedAppPanelController()?.getTabs() ?? NO_TABS,
      renderedTarget: () => null,
      renderedTabVisible: () => null,
      command: (id) => appCommandHandlers.get(id)?.() !== false,
      action: { tab: actionTab, panelTabId: contractActionPanelTabId("chat") },
      fixed: null,
      foreignTab: {
        id: "chat",
        context: { kind: "nav-panel", panelId: "board" },
        availability: "action",
      },
      toggleRestoresActiveTab: false,
    };
  },
);
