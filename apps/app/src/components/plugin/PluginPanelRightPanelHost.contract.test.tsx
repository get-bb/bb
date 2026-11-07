// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { resetFixedPanelTabsStateForTest } from "@/lib/fixed-panel-tabs";
import { createPluginPageFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { markPluginFrontendsSettled } from "@/lib/plugin-frontend-boot-state";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
import { resetFocusedAppPanelControllersForTest } from "@/lib/app-fixed-tab-navigation";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import {
  CONTRACT_PLUGIN_ID,
  ContractActionTab,
  ContractPanelProbe,
  ContractStateProbe,
  ContractTargetedFixedTab,
  contractActionPanelTabId,
  contractTarget,
  describePanelControllerContract,
  readContractPanel,
  readContractTabs,
  snapshotFromState,
  type ContractPanelRef,
  type ContractStateSink,
} from "@/test/panel-controller-contract";
import { PluginContext } from "./plugin-context";
import { getPluginPagePanelStateId } from "./plugin-page-panel-state";
import { PluginPanelRightPanelHost } from "./PluginPanelRightPanelHost";

const appCommandHandlers = vi.hoisted(
  () => new Map<string, () => boolean | void>(),
);

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: (command: string, handler: () => boolean | void) => {
    appCommandHandlers.set(command, handler);
  },
  useAppCommandShortcut: () => null,
}));
vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => false,
}));
vi.mock("@/hooks/queries/plugin-settings-queries", () => ({
  usePluginList: () => ({ data: { plugins: [] } }),
}));
vi.mock("@/hooks/queries/plugin-catalog-queries", () => ({
  usePluginCatalogSearch: () => ({ data: { entries: [], collections: [] } }),
}));
vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: { primaryHostId: null } }),
}));
vi.mock("@/lib/bb-desktop", () => ({
  getDesktopBrowserApi: () => null,
  isDesktopBrowserAvailable: () => false,
}));
vi.mock("react-resizable-panels", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-resizable-panels")>()),
  Panel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/secondary-panel/SecondaryPanelLayout", () => ({
  SecondaryPanelLayout: ({
    main,
    renderPanel,
  }: {
    main: ReactNode;
    renderPanel: (options: {
      presentation: "inline";
      canShowNativeBrowserView: boolean;
      isMainCollapsed: boolean;
      onToggleMainCollapse: () => void;
    }) => ReactNode;
  }) => (
    <div>
      {main}
      {renderPanel({
        presentation: "inline",
        canShowNativeBrowserView: false,
        isMainCollapsed: false,
        onToggleMainCollapse: () => undefined,
      })}
    </div>
  ),
}));
vi.mock("@/components/secondary-panel/ThreadSecondaryPanel", async () => ({
  ThreadSecondaryPanel: (await import("@/test/panel-controller-contract"))
    .ContractSecondaryPanel,
}));

const PANEL_ID = "board";
const panelStateId = getPluginPagePanelStateId({
  panelPath: PANEL_ID,
  pluginId: CONTRACT_PLUGIN_ID,
});
const targetedTab = {
  id: "details",
  context: { kind: "nav-panel", panelId: PANEL_ID },
  availability: "fixed",
} as const;
const untargetedTab = { ...targetedTab, id: "navigation" } as const;
const actionTab = {
  id: "chat",
  context: { kind: "nav-panel", panelId: PANEL_ID },
  availability: "action",
} as const;

function pagePanelTabId(fixedTabId: string) {
  return createPluginPageFixedPanelTab({
    fixedTabId,
    pageId: PANEL_ID,
    pluginId: CONTRACT_PLUGIN_ID,
  }).id;
}

beforeEach(() => {
  markPluginFrontendsSettled();
  appCommandHandlers.clear();
  localStorage.clear();
  resetFixedPanelTabsStateForTest();
  setPluginSlotRegistrations(
    CONTRACT_PLUGIN_ID,
    collectPluginAppRegistrations(
      definePluginApp((app) => {
        app.slots.navPanel({
          id: PANEL_ID,
          title: "Board",
          icon: "Columns",
          path: PANEL_ID,
          component: () => null,
        });
        app.slots.experimental_tab({
          ...untargetedTab,
          title: "Navigation",
          icon: "PanelRight",
          component: () => <div>Navigation</div>,
        });
        app.slots.experimental_tab({
          ...targetedTab,
          title: "Details",
          icon: "Info",
          component: () => <ContractTargetedFixedTab tab={targetedTab} />,
          experimental_target: contractTarget,
        });
        app.slots.experimental_tab({
          ...actionTab,
          title: "Chat",
          icon: "Chat",
          component: ContractActionTab,
        });
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  removePluginSlotRegistrations(CONTRACT_PLUGIN_ID);
  resetFocusedAppPanelControllersForTest();
});

describePanelControllerContract(
  "plugin nav-panel page",
  { fixedTabs: true },
  async () => {
    const probe: ContractPanelRef = { current: null };
    const sink: ContractStateSink = { current: null };
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <JotaiProvider store={createStore()}>
          <TooltipProvider>
            <MemoryRouter
              initialEntries={[`/plugins/${CONTRACT_PLUGIN_ID}/board`]}
            >
              <RouteNavigationProvider>
                <ContractStateProbe
                  panelStateId={panelStateId}
                  syncThreadId={null}
                  sink={sink}
                />
                <PluginPanelRightPanelHost
                  panelPath={PANEL_ID}
                  pluginId={CONTRACT_PLUGIN_ID}
                  subPath=""
                >
                  <PluginContext.Provider value={CONTRACT_PLUGIN_ID}>
                    <ContractPanelProbe probe={probe} />
                  </PluginContext.Provider>
                </PluginPanelRightPanelHost>
              </RouteNavigationProvider>
            </MemoryRouter>
          </TooltipProvider>
        </JotaiProvider>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(snapshotFromState(sink).tabIds).toContain(
        pagePanelTabId("details"),
      ),
    );
    return {
      panel: () => readContractPanel(probe),
      snapshot: () => snapshotFromState(sink),
      tabs: () => readContractTabs(probe),
      renderedTabVisible: () =>
        screen.queryByTestId("contract-tab-visible")?.textContent ?? null,
      renderedTarget: () =>
        screen.queryByTestId("contract-target")?.textContent ?? null,
      command: (id) => appCommandHandlers.get(id)?.() !== false,
      action: { tab: actionTab, panelTabId: contractActionPanelTabId("chat") },
      fixed: {
        targeted: { tab: targetedTab, panelTabId: pagePanelTabId("details") },
        untargeted: {
          tab: untargetedTab,
          panelTabId: pagePanelTabId("navigation"),
        },
      },
      foreignTab: {
        id: "chat",
        context: { kind: "thread" },
        availability: "action",
      },
      toggleRestoresActiveTab: true,
    };
  },
);
