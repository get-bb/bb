import { AppPanelTabsPublisher } from "@/lib/app-panel-tabs";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { atom, useAtom } from "jotai";
import { atomFamily } from "jotai-family";
import type { Host } from "@bb/domain";
import { PluginTabScope, usePluginTabs } from "./PluginTabs";
import type { PluginNavTabSlot } from "@/lib/plugin-slots";
import {
  createPanelActionDestination,
  runPluginPanelAction,
} from "./PluginPanelActions";
import { Button } from "@bb/shared-ui/button";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { PluginItemIcon } from "@/components/plugin/PluginIcon";
import { RIGHT_PANEL_TOGGLE_ICON_NAME } from "@/components/secondary-panel/panelToggleControlState";
import { SecondaryPanelLayout } from "@/components/secondary-panel/SecondaryPanelLayout";
import { getPluginPageSecondaryPanelWidthPercentAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import {
  LazyBrowserTabDeck,
  LazyHostScopedFilePreviewTabContent,
  LazyNewTabPage,
  LazyThreadSecondaryPanel,
  preloadThreadSecondaryPanel,
  LazyThreadStorageFilePreviewTabContent,
  LazyAttachmentFilePreviewTabContent,
  LazyThreadTerminalPanel,
  LazyWorkspaceFilePreviewTabContent,
} from "@/components/secondary-panel/lazySecondaryPanelComponents";
import type {
  SecondaryPanelFixedTab,
  SecondaryPanelRenderableTab,
} from "@/components/secondary-panel/ThreadSecondaryPanel";
import { useThreadFileTabs } from "@/components/secondary-panel/useThreadFileTabs";
import {
  useCloseFixedSecondaryPanel,
  useReconciledFixedPanelTabsState,
  useUpdateFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
import {
  createPluginPageFixedPanelTab,
  type PluginPageFixedPanelTab,
  type SecondaryFileFixedPanelTab,
  type TerminalFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { createFileOpenerOriginalTab } from "./file-opener-tabs";
import { activateSecondaryPanelTabInState } from "@bb/client-core";
import {
  terminalQueryScopeForTarget,
  useTerminals,
} from "@/hooks/queries/thread-terminal-queries";
import { usePanelBrowser } from "@/components/secondary-panel/usePanelBrowser";
import { usePanelFiles } from "@/components/secondary-panel/usePanelFiles";
import { usePanelTerminals } from "@/components/secondary-panel/usePanelTerminals";
import { usePendingTerminalIds } from "@/components/thread/terminal/pending-terminals";
import { useHosts } from "@/hooks/queries/host-queries";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  isDesktopBrowserAvailable,
  MACOS_TITLE_BAR_TRAILING_TOGGLE_CLASS,
} from "@/lib/bb-desktop";
import { useIsSidebarFramed } from "@/components/ui/sidebar.js";
import { UrlOpenRoutingProvider } from "@/lib/url-open-routing";
import { usePluginSlots } from "@/lib/plugin-slots";
import { AppNavigationHostProvider } from "@/lib/app-navigation-host";
import {
  FixedTabTargetScope,
  getPluginFixedTabOwnerId,
  useAppPanelController,
  useSetFixedTabTarget,
  type AppFixedTabDestination,
} from "@/lib/app-fixed-tab-navigation";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import {
  resolveTerminalHost,
  TerminalHostSelector,
} from "@/components/secondary-panel/TerminalHostSelector";
import { getPluginPagePanelStateId } from "./plugin-page-panel-state";
import { PluginPanelTabContent } from "./PluginPanelActions";
import { PluginDetailRouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { PluginDetailTabContent } from "./plugin-detail-navigation";
import { usePanelTabPresenter } from "@/components/secondary-panel/usePanelTabPresenter";

const EMPTY_TERMINAL_HOSTS: readonly Host[] = [];
const RIGHT_PANEL_TOGGLE_CLASS = `${COARSE_POINTER_HEADER_ICON_BUTTON_CLASS} ${CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS}`;

const compactDrawerOpenAtomFamily = atomFamily((_panelStateId: string) =>
  atom(false),
);

function PluginFixedTabContent({
  fixedTabOwnerId,
  isOpen,
  panelId,
  panelStateId,
  pluginId,
  registration,
  subPath,
}: {
  fixedTabOwnerId: string;
  isOpen: boolean;
  panelId: string;
  panelStateId: string;
  pluginId: string;
  registration: Extract<PluginNavTabSlot, { availability: "fixed" }>;
  subPath: string;
}) {
  if (!isOpen) return null;
  const FixedTabComponent = registration.component;
  return (
    <PluginTabScope
      slot={registration}
      instanceId={`nav-panel/${pluginId}/${panelId}`}
    >
      <FixedTabTargetScope
        ownerId={fixedTabOwnerId}
        tabId={registration.id}
        targetKey={`${panelStateId}\0${registration.id}`}
      >
        <FixedTabComponent subPath={subPath} />
      </FixedTabTargetScope>
    </PluginTabScope>
  );
}

function findPluginRightPanelTogglePortal(
  panelStateId: string,
): HTMLElement | null {
  for (const candidate of document.querySelectorAll<HTMLElement>(
    "[data-plugin-right-panel-toggle-portal]",
  )) {
    if (
      candidate.getAttribute("data-plugin-right-panel-toggle-portal") ===
      panelStateId
    ) {
      return candidate;
    }
  }
  return null;
}

export function PluginPanelRightPanelHost({
  children,
  panelPath,
  pluginId,
  subPath,
  flushPageInsets = false,
  paneId,
}: {
  children: ReactNode;
  panelPath: string;
  pluginId: string;
  subPath: string;
  flushPageInsets?: boolean;
  paneId?: string;
}) {
  const { navPanels } = usePluginSlots();
  const panel =
    navPanels.find(
      (candidate) =>
        candidate.pluginId === pluginId && candidate.path === panelPath,
    ) ?? null;
  const registeredTabs = usePluginTabs(
    panel === null
      ? null
      : { kind: "nav-panel", panelId: panel.id, pluginId, subPath },
  );
  const pageTabs = useMemo(
    () =>
      registeredTabs.slots.filter(
        (tab): tab is PluginNavTabSlot => tab.context.kind === "nav-panel",
      ),
    [registeredTabs.slots],
  );
  const pageFixedTabs = useMemo(
    () =>
      pageTabs.filter(
        (tab): tab is Extract<PluginNavTabSlot, { availability: "fixed" }> =>
          tab.availability === "fixed",
      ),
    [pageTabs],
  );
  const pageActions = useMemo(
    () =>
      pageTabs.filter(
        (tab): tab is Extract<PluginNavTabSlot, { availability: "action" }> =>
          tab.availability === "action",
      ),
    [pageTabs],
  );
  const paneContext = useOptionalPaneContext();
  const isFocused = paneContext?.isFocused ?? true;
  const isHostedBySplitWorkspace = paneContext?.secondaryPanelHost != null;
  const resolvedPaneId = paneId ?? paneContext?.paneId;
  const panelHostId = resolvedPaneId ?? "standalone";
  const panelStateId = getPluginPagePanelStateId({
    panelPath,
    paneId: resolvedPaneId,
    pluginId,
  });
  const fixedViewTabs = useMemo<readonly PluginPageFixedPanelTab[]>(
    () =>
      pageFixedTabs.map((fixedTab) =>
        createPluginPageFixedPanelTab({
          fixedTabId: fixedTab.id,
          pageId: panel?.id ?? panelPath,
          pluginId,
        }),
      ),
    [pageFixedTabs, panel, panelPath, pluginId],
  );
  const panelState = useReconciledFixedPanelTabsState({
    fixedTabs: fixedViewTabs,
    isAuthoritative: registeredTabs.isReady,
    openFirstFixedTabWhenEmpty: true,
    panelStateId,
    syncThreadId: null,
  });
  const updatePanelState = useUpdateFixedPanelTabsState(panelStateId, null);
  const closePersistedPanel = useCloseFixedSecondaryPanel(panelStateId, null);
  const [isPanelFullPage, setIsPanelFullPage] = useState(false);
  const [isCompactDrawerOpen, setCompactDrawerOpen] = useAtom(
    compactDrawerOpenAtomFamily(panelStateId),
  );
  const closeCompactDrawer = useCallback(() => {
    setCompactDrawerOpen(false);
  }, [setCompactDrawerOpen]);
  const isCompactViewport = useIsCompactViewport();
  const isOpen = isCompactViewport
    ? isCompactDrawerOpen
    : panelState.secondary.isOpen;
  const activeTab =
    panelState.secondary.tabs.find(
      (tab) => tab.id === panelState.secondary.activeTabId,
    ) ?? null;
  const isPluginDetailActive = activeTab?.kind === "plugin-detail";
  const activeTerminalTab: TerminalFixedPanelTab | null =
    activeTab?.kind === "terminal" && activeTab.target !== undefined
      ? activeTab
      : null;
  const activeTerminalTarget = activeTerminalTab?.target ?? null;
  const activeTerminalQuery = useTerminals(
    activeTerminalTarget === null
      ? null
      : terminalQueryScopeForTarget(activeTerminalTarget),
    { enabled: isOpen },
  );
  const terminalSessions = activeTerminalQuery.data?.sessions;
  const terminalsById = useMemo(
    () =>
      new Map((terminalSessions ?? []).map((session) => [session.id, session])),
    [terminalSessions],
  );
  const pendingTerminalIds = usePendingTerminalIds();
  const {
    activateTab,
    activeBrowserTab,
    browserTabs,
    closeTab,
    openTab,
    openPluginDetail,
    openPluginPanel,
    orderedSecondaryFileTabs,
    reopenClosedTab,
    reorderTab,
    updateBrowserTab,
  } = useThreadFileTabs({
    panelStateId,
    syncThreadId: null,
    environmentId: null,
    fileOwnerThreadId: null,
    onCloseLastTab: closeCompactDrawer,
    preserveWorkspaceTabsAcrossContexts: true,
    storageFiles: undefined,
    terminalSessions: undefined,
  });
  const hostsQuery = useHosts();
  const primaryHostId = useSystemConfig().data?.primaryHostId ?? null;
  const [preferredTerminalHostId, setPreferredTerminalHostId] = useState<
    string | null
  >(null);
  const terminalHosts = hostsQuery.data ?? EMPTY_TERMINAL_HOSTS;
  const selectedTerminalHost = useMemo(
    () =>
      resolveTerminalHost({
        hosts: terminalHosts,
        preferredHostId: preferredTerminalHostId,
        primaryHostId,
      }),
    [preferredTerminalHostId, primaryHostId, terminalHosts],
  );

  useEffect(() => {
    if (
      activeTerminalTab === null ||
      activeTerminalQuery.isLoading ||
      activeTerminalQuery.error !== null ||
      terminalSessions === undefined ||
      terminalsById.has(activeTerminalTab.terminalId) ||
      pendingTerminalIds.starting.has(activeTerminalTab.terminalId)
    ) {
      return;
    }
    closeTab(activeTerminalTab.id);
  }, [
    activeTerminalQuery.error,
    activeTerminalQuery.isLoading,
    activeTerminalTab,
    closeTab,
    pendingTerminalIds,
    terminalSessions,
    terminalsById,
  ]);

  useEffect(() => {
    closeCompactDrawer();
  }, [closeCompactDrawer, subPath]);

  const revealPanel = useCallback(() => {
    if (isCompactViewport) {
      setCompactDrawerOpen(true);
      return;
    }
    updatePanelState((state) => ({
      ...state,
      secondary: { ...state.secondary, isOpen: true },
    }));
  }, [isCompactViewport, setCompactDrawerOpen, updatePanelState]);
  const openPluginDetailTab = useCallback(
    (detailKey: string) => {
      openPluginDetail({ detailKey, title: detailKey });
      revealPanel();
      return true;
    },
    [openPluginDetail, revealPanel],
  );
  const setFixedTabTarget = useSetFixedTabTarget();
  const fixedTabOwnerId = getPluginFixedTabOwnerId(
    pluginId,
    panel?.id ?? panelPath,
  );
  const fixedTabDestinations = useMemo<readonly AppFixedTabDestination[]>(
    () =>
      pageFixedTabs.flatMap((registration) => {
        const tab = fixedViewTabs.find(
          (candidate) => candidate.fixedTabId === registration.id,
        );
        if (tab === undefined) return [];
        return [
          {
            tab: {
              ownerId: fixedTabOwnerId,
              tabId: registration.id,
            },
            panelTabId: () => tab.id,
            open: (target) => {
              if (
                target !== undefined &&
                !setFixedTabTarget(
                  `${panelStateId}\0${registration.id}`,
                  registration.experimental_target,
                  target,
                )
              )
                return false;
              updatePanelState((state) =>
                activateSecondaryPanelTabInState(state, tab.id),
              );
              revealPanel();
              return true;
            },
          },
        ];
      }),
    [
      fixedViewTabs,
      fixedTabOwnerId,
      panelStateId,
      pageFixedTabs,
      revealPanel,
      setFixedTabTarget,
      updatePanelState,
    ],
  );
  const panelDestinations = useMemo(
    () => [
      ...fixedTabDestinations,
      ...pageActions.map((action) => ({
        ...createPanelActionDestination({
          action,
          openPluginPanel: (args) => {
            openPluginPanel(args);
            revealPanel();
          },
        }),
        tab: { ownerId: fixedTabOwnerId, tabId: action.id },
      })),
    ],
    [
      fixedTabDestinations,
      pageActions,
      openPluginPanel,
      revealPanel,
      fixedTabOwnerId,
    ],
  );
  const hidePanel = useCallback(() => {
    setIsPanelFullPage(false);
    if (isCompactViewport) {
      closeCompactDrawer();
      return;
    }
    closePersistedPanel();
  }, [closeCompactDrawer, closePersistedPanel, isCompactViewport]);
  const tabContext = useMemo(
    () => ({ kind: "nav-panel" as const, panelId: panel?.id ?? panelPath }),
    [panel?.id, panelPath],
  );
  const panelController = useAppPanelController({
    activeTabId: isOpen ? (activeTab?.id ?? null) : null,
    close: hidePanel,
    destinations: panelDestinations,
    isFocused: isFocused && panel !== null,
  });
  const pluginActions = useMemo(
    () =>
      pageActions.map((action) => ({
        id: `plugin-action:${action.pluginId}:${action.id}`,
        pluginId: action.pluginId,
        icon: action.icon,
        title: action.title,
        tooltip: action.tooltip,
        onSelect: () => {
          if (panel === null) return;
          runPluginPanelAction({
            action,
            context: {
              kind: "nav-panel",
              pluginId,
              panelId: panel.id,
              subPath,
            },
            panel: panelController,
          });
        },
      })),
    [pageActions, panel, pluginId, subPath, panelController],
  );
  const panelFiles = usePanelFiles({
    available: panel !== null,
    openTab,
    reveal: revealPanel,
    scope: null,
  });
  const openLiveFilePreview = panelFiles.openFilePreview;
  const acceptsSession = () => panel !== null;
  const terminals = usePanelTerminals({
    panelStateId,
    syncThreadId: null,
    createTarget:
      panel !== null && selectedTerminalHost?.status === "connected"
        ? { kind: "host_path", hostId: selectedTerminalHost.id, cwd: null }
        : null,
    isFocused,
    acceptsSession,
    tabsCarryTarget: true,
    reveal: revealPanel,
    onCloseLastTab: closeCompactDrawer,
  });
  const navigationCapabilities = useMemo(
    () => ({
      openFilePreview: openLiveFilePreview,
      panel: panelController,
      openTerminal: terminals.open,
    }),
    [panelController, openLiveFilePreview, terminals.open],
  );
  const openNewTab = useCallback(() => {
    openTab({ kind: "new-tab" });
    revealPanel();
  }, [openTab, revealPanel]);
  const togglePanel = useCallback(() => {
    if (isOpen) {
      panelController.close();
      return;
    }
    if (activeTab === null) openTab({ kind: "new-tab" });
    revealPanel();
  }, [activeTab, isOpen, openTab, panelController, revealPanel]);

  useAppCommandHandler("panel.toggle", () => {
    if (!isFocused || panel === null) return false;
    togglePanel();
    return true;
  });
  useAppCommandHandler("panel.newTab", () => {
    if (!isFocused || panel === null) return false;
    openNewTab();
    return true;
  });
  useAppCommandHandler("panel.reopenClosedTab", () => {
    if (!isFocused || panel === null || !reopenClosedTab()) return false;
    revealPanel();
    return true;
  });

  const isSidebarFramed = useIsSidebarFramed();
  const [togglePortalTarget, setTogglePortalTarget] =
    useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setTogglePortalTarget(findPluginRightPanelTogglePortal(panelStateId));
  }, [panel, panelStateId]);

  const panelBrowser = usePanelBrowser({
    available: isDesktopBrowserAvailable(),
    browserTabs,
    isFocused,
    openTab,
    reveal: revealPanel,
  });
  const openBrowser = panelBrowser.open;

  const fixedTabs = useMemo<readonly SecondaryPanelFixedTab[]>(
    () =>
      pageFixedTabs.flatMap((registration) => {
        const tab = fixedViewTabs.find(
          (candidate) => candidate.fixedTabId === registration.id,
        );
        if (tab === undefined) return [];
        return [
          {
            ariaLabel: registration.tooltip ?? registration.title,
            contentFillsRegion: registration.layout === "flush",
            label: registration.title,
            leadingVisual: (
              <PluginItemIcon
                pluginId={pluginId}
                icon={registration.icon}
                className="size-3.5"
              />
            ),
            onSelect: () => {
              panelController.openTab({
                tab: {
                  ownerId: fixedTabOwnerId,
                  tabId: registration.id,
                },
                availability: "fixed",
              });
            },
            renderContent: () =>
              panel === null ? null : (
                <PluginFixedTabContent
                  fixedTabOwnerId={fixedTabOwnerId}
                  isOpen={isOpen}
                  panelId={panel.id}
                  panelStateId={panelStateId}
                  pluginId={pluginId}
                  registration={registration}
                  subPath={subPath}
                />
              ),
            tab,
            title: registration.tooltip ?? registration.title,
          },
        ];
      }),
    [
      fixedViewTabs,
      pageFixedTabs,
      fixedTabOwnerId,
      isOpen,
      panelController,
      panel,
      panelStateId,
      pluginId,
      subPath,
    ],
  );

  const renderPanelTabContent = useCallback(
    function renderTabContent(tab: SecondaryFileFixedPanelTab): ReactNode {
      switch (tab.kind) {
        case "plugin-detail":
          return <PluginDetailTabContent detailKey={tab.detailKey} />;
        case "browser":
          return null;
        case "terminal":
          if (tab.target === undefined) return null;
          return (
            <LazyThreadTerminalPanel
              autoFocus={tab.terminalId === terminals.autoFocusTerminalId}
              isPanelOpen={isOpen}
              isPanelPersistedOpen={panelState.secondary.isOpen}
              onAutoFocusHandled={terminals.handleAutoFocusHandled}
              onCloseStart={() => terminals.close(tab.terminalId)}
              onRetryStart={() => terminals.retryStart(tab.terminalId)}
              target={tab.target}
              terminalId={tab.terminalId}
            />
          );
        case "new-tab":
          return (
            <LazyNewTabPage
              autoFocus={false}
              projectId={undefined}
              environmentId={null}
              currentThreadId=""
              onAutoFocusHandled={() => undefined}
              onSelect={() => undefined}
              onOpenBrowser={
                openBrowser === null
                  ? undefined
                  : () => {
                      activateTab(tab.id);
                      openBrowser?.();
                    }
              }
              onStartTerminal={() => {
                activateTab(tab.id);
                terminals.start();
              }}
              pluginActions={pluginActions}
              showFileSearch={false}
              startTerminalDisabled={!terminals.canStart}
              startTerminalTrailing={
                <TerminalHostSelector
                  hosts={terminalHosts}
                  isLoading={hostsQuery.isLoading}
                  onChange={setPreferredTerminalHostId}
                  selectedHostId={selectedTerminalHost?.id ?? null}
                />
              }
            />
          );
        case "workspace-file-preview":
          return tab.environmentId === null ? null : (
            <LazyWorkspaceFilePreviewTabContent
              activePath={tab.path}
              environmentId={tab.environmentId}
              isPanelOpen={isOpen}
              lineRange={tab.lineRange}
              source={tab.source}
            />
          );
        case "host-file-preview":
          return tab.hostId === null ? null : (
            <LazyHostScopedFilePreviewTabContent
              activePath={tab.path}
              hostId={tab.hostId}
              isPanelOpen={isOpen}
              lineRange={tab.lineRange}
            />
          );
        case "attachment-file-preview":
          return (
            <LazyAttachmentFilePreviewTabContent
              isPanelOpen={isOpen}
              name={tab.name}
              path={tab.path}
              projectId={tab.projectId}
            />
          );
        case "thread-storage-file-preview":
          return tab.threadId === null ? null : (
            <LazyThreadStorageFilePreviewTabContent
              activePath={tab.path}
              isPanelOpen={isOpen}
              lineRange={tab.lineRange}
              threadId={tab.threadId}
            />
          );
        case "plugin-panel": {
          const originalTab = createFileOpenerOriginalTab(tab);
          return (
            <PluginPanelTabContent
              tab={tab}
              context={{
                kind: "nav-panel",
                pluginId,
                panelId: panel?.id ?? panelPath,
                subPath,
              }}
              fileOpenerOriginal={
                originalTab === null ? undefined : renderTabContent(originalTab)
              }
            />
          );
        }
      }
    },
    [
      activateTab,
      pluginActions,
      panel,
      panelPath,
      pluginId,
      subPath,
      hostsQuery.isLoading,
      isOpen,
      openBrowser,
      panelState.secondary.isOpen,
      selectedTerminalHost,
      terminalHosts,
      terminals,
    ],
  );
  const presentPanelTab = usePanelTabPresenter({
    tabs: orderedSecondaryFileTabs,
    terminalsById,
    pluginActions: pageActions,
  });
  const panelTabs = useMemo<readonly SecondaryPanelRenderableTab[]>(
    () =>
      orderedSecondaryFileTabs.flatMap((tab): SecondaryPanelRenderableTab[] => {
        if (tab.kind === "terminal" && tab.target === undefined) return [];
        const presentation = presentPanelTab(tab);
        return [
          {
            ...presentation,
            contentFillsRegion:
              presentation.contentFillsRegion ||
              tab.kind === "terminal" ||
              tab.kind === "plugin-panel",
            tab,
            renderContent: () => renderPanelTabContent(tab),
            onSelect:
              tab.kind === "terminal"
                ? () => terminals.select(tab.terminalId, tab.target)
                : () => {
                    activateTab(tab.id);
                    revealPanel();
                  },
            onClose:
              tab.kind === "terminal"
                ? () => terminals.close(tab.terminalId)
                : () => closeTab(tab.id),
          },
        ];
      }),
    [
      activateTab,
      closeTab,
      orderedSecondaryFileTabs,
      presentPanelTab,
      renderPanelTabContent,
      revealPanel,
      terminals,
    ],
  );

  const renderPanel = useCallback(
    ({
      presentation,
      canShowNativeBrowserView,
      isMainCollapsed,
      onToggleMainCollapse,
      resizablePanelId,
    }: {
      presentation: "inline" | "drawer";
      canShowNativeBrowserView: boolean;
      isMainCollapsed: boolean;
      onToggleMainCollapse: () => void;
      resizablePanelId?: string;
    }) => {
      const renderDeck = (
        activeBrowserTabId: string | null,
        canHandleBrowserCommands: boolean,
        onNativeFocus?: () => void,
      ) =>
        browserTabs.length === 0 ? null : (
          <LazyBrowserTabDeck
            browserTabs={browserTabs}
            activeBrowserTabId={activeBrowserTabId}
            addressFocusRequest={panelBrowser.addressFocusRequest}
            onAddressFocusRequestConsumed={
              panelBrowser.handleAddressFocusRequestConsumed
            }
            environmentId={null}
            canShowNativeBrowserView={canShowNativeBrowserView}
            canHandleBrowserCommands={canHandleBrowserCommands}
            onNativeFocus={onNativeFocus}
            threadId={panelStateId}
            onUpdate={updateBrowserTab}
            onOpenInNewTab={panelBrowser.open}
          />
        );
      const drawerFallback = renderDeck(
        activeBrowserTab?.id ?? null,
        canShowNativeBrowserView,
      );
      return (
        <LazyThreadSecondaryPanel
          drawerFallback={drawerFallback}
          activeTab={activeTab}
          metadataContent={null}
          tabs={panelTabs}
          splitPanelStateId={panelStateId}
          onTabReorder={reorderTab}
          renderBrowserDeck={(activeBrowserTabId, pane) =>
            renderDeck(
              activeBrowserTabId,
              canShowNativeBrowserView && pane.isFocused,
              pane.onFocusPane,
            )
          }
          isOpen={isOpen}
          fixedTabs={fixedTabs}
          areFixedTabsReady={registeredTabs.isReady}
          showConversationCollapseControl={isPluginDetailActive}
          showNewTabButton={!isPluginDetailActive}
          onPanelFocus={() => undefined}
          onCollapse={panelController.close}
          onClose={panelController.close}
          onOpenNewTab={openNewTab}
          isConversationCollapsed={isMainCollapsed}
          onToggleConversationCollapse={onToggleMainCollapse}
          renderAsDrawer={presentation === "drawer"}
          resizablePanelId={resizablePanelId}
        />
      );
    },
    [
      activeBrowserTab,
      activeTab,
      isPluginDetailActive,
      panelBrowser.addressFocusRequest,
      browserTabs,
      fixedTabs,
      registeredTabs.isReady,
      panelBrowser.handleAddressFocusRequestConsumed,
      panelBrowser.open,
      panelController,
      isOpen,
      openNewTab,
      panelStateId,
      reorderTab,
      panelTabs,
      updateBrowserTab,
    ],
  );

  const toggleLabel = isOpen ? "Hide right panel" : "Show right panel";
  const toggleIconName = RIGHT_PANEL_TOGGLE_ICON_NAME;
  const page = (
    <div
      className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
        flushPageInsets
          ? "-m-4 h-[calc(100%+2rem)] md:-m-5 md:h-[calc(100%+2.5rem)]"
          : "h-full"
      }`}
    >
      <SecondaryPanelLayout
        open={isOpen}
        onToggle={togglePanel}
        onSwipeOpen={togglePanel}
        onClose={panelController.close}
        panelGroupKey={`plugin-panel-host:${panelHostId}`}
        resetKey={panelStateId}
        contentKey={panelStateId}
        drawerLabel="Right panel"
        drawerFallback={null}
        mainPanelId={`plugin-panel-main-${panelHostId}`}
        collapse={{
          active: isPanelFullPage,
          onToggle: () => setIsPanelFullPage((current) => !current),
        }}
        main={children}
        composerHost={null}
        renderPanel={renderPanel}
        widthPercentAtom={getPluginPageSecondaryPanelWidthPercentAtom({
          panelPath,
          pluginId,
        })}
      />
    </div>
  );

  const routedPage = (
    <>
      {panel !== null &&
      togglePortalTarget !== null &&
      !isOpen &&
      !isHostedBySplitWorkspace
        ? createPortal(
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    RIGHT_PANEL_TOGGLE_CLASS,
                    isSidebarFramed && MACOS_TITLE_BAR_TRAILING_TOGGLE_CLASS,
                  )}
                  aria-label={toggleLabel}
                  aria-pressed={isOpen}
                  onPointerEnter={preloadThreadSecondaryPanel}
                  onFocus={preloadThreadSecondaryPanel}
                  onPointerDown={preloadThreadSecondaryPanel}
                  onClick={togglePanel}
                >
                  <Icon name={toggleIconName} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{toggleLabel}</TooltipContent>
            </Tooltip>,
            togglePortalTarget,
          )
        : null}
      {page}
    </>
  );

  return (
    <UrlOpenRoutingProvider openInAppBrowser={openBrowser}>
      <AppNavigationHostProvider capabilities={navigationCapabilities}>
        <AppPanelTabsPublisher
          publish={panelController.publishTabs}
          activeTabId={activeTab?.id ?? null}
          actionContext={tabContext}
          fixedTabs={fixedTabs}
          isOpen={isOpen}
          tabs={panelTabs}
        />
        <PluginDetailRouteNavigationProvider
          onOpenPluginDetail={openPluginDetailTab}
        >
          {registeredTabs.observers}
          {routedPage}
        </PluginDetailRouteNavigationProvider>
      </AppNavigationHostProvider>
    </UrlOpenRoutingProvider>
  );
}
