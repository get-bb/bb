import {
  lazy,
  Suspense,
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
import { Button } from "@bb/shared-ui/button";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { SecondaryPanelLayout } from "@/components/secondary-panel/SecondaryPanelLayout";
import type { SecondaryPanelFileTab } from "@/components/secondary-panel/secondaryPanelFileTab";
import { useThreadFileTabs } from "@/components/secondary-panel/useThreadFileTabs";
import { terminalStatusLabel } from "@/components/thread/terminal/useThreadTerminalController";
import {
  useCloseFixedSecondaryPanel,
  useFixedPanelTabsState,
  useUpdateFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
import type { TerminalCreateTarget } from "@bb/server-contract";
import {
  createTerminalFixedPanelTab,
  type TerminalFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { getActiveTabIdAfterPrune } from "@/components/secondary-panel/secondaryPanelTabState";
import {
  useCloseTerminal,
  useCreateTerminal,
  useTerminals,
} from "@/hooks/queries/thread-terminal-queries";
import { useHosts } from "@/hooks/queries/host-queries";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  getDesktopBrowserApi,
  isDesktopBrowserAvailable,
} from "@/lib/bb-desktop";
import { getBrowserUrlHost } from "@/lib/browser-url";
import { isRoutePath } from "@/lib/route-paths";
import { usePluginSlots } from "@/lib/plugin-slots";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import {
  resolveTerminalHost,
  TerminalHostSelector,
} from "@/components/secondary-panel/TerminalHostSelector";
import { getPluginPagePanelStateId } from "./plugin-page-panel-state";

const TERMINAL_COLS = 100;
const TERMINAL_ROWS = 30;
const EMPTY_TERMINAL_HOSTS: readonly Host[] = [];
const RIGHT_PANEL_TOGGLE_CLASS = `${COARSE_POINTER_HEADER_ICON_BUTTON_CLASS} ${CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS}`;

const LazyBrowserTabDeck = lazy(() =>
  import("@/components/secondary-panel/BrowserTabDeck").then(
    ({ BrowserTabDeck }) => ({ default: BrowserTabDeck }),
  ),
);
const LazyNewTabPage = lazy(() =>
  import("@/components/secondary-panel/NewTabPage").then(({ NewTabPage }) => ({
    default: NewTabPage,
  })),
);
const LazyThreadSecondaryPanel = lazy(() =>
  import("@/components/secondary-panel/ThreadSecondaryPanel").then(
    ({ ThreadSecondaryPanel }) => ({ default: ThreadSecondaryPanel }),
  ),
);
const LazyThreadTerminalPanel = lazy(() =>
  import("@/components/thread/terminal/ThreadTerminalPanel").then(
    ({ ThreadTerminalPanel }) => ({ default: ThreadTerminalPanel }),
  ),
);
const compactDrawerOpenAtomFamily = atomFamily((_panelStateId: string) =>
  atom(false),
);

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

function terminalScope(target: TerminalCreateTarget | null) {
  if (target?.kind !== "host_path") return target;
  return {
    kind: "host_path" as const,
    hostId: target.hostId,
    ...(target.cwd === null ? {} : { cwd: target.cwd }),
  };
}

function isPluginPagePanelTab(tab: {
  kind: string;
  target?: TerminalCreateTarget;
}): boolean {
  return (
    tab.kind === "browser" ||
    tab.kind === "new-tab" ||
    (tab.kind === "terminal" && tab.target !== undefined)
  );
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
  const paneContext = useOptionalPaneContext();
  const isFocused = paneContext?.isFocused ?? true;
  const isHostedBySplitWorkspace = paneContext?.secondaryPanelHost != null;
  const panelStateId = getPluginPagePanelStateId({
    panelPath,
    paneId: paneId ?? paneContext?.paneId,
    pluginId,
  });
  const panelState = useFixedPanelTabsState(panelStateId, null);
  const updatePanelState = useUpdateFixedPanelTabsState(panelStateId, null);
  const closePersistedPanel = useCloseFixedSecondaryPanel(panelStateId, null);
  const [isCompactDrawerOpen, setCompactDrawerOpen] = useAtom(
    compactDrawerOpenAtomFamily(panelStateId),
  );
  const isCompactViewport = useIsCompactViewport();
  const isOpen = isCompactViewport
    ? isCompactDrawerOpen
    : panelState.secondary.isOpen;
  const activeTab =
    panelState.secondary.tabs.find(
      (tab) => tab.id === panelState.secondary.activeTabId,
    ) ?? null;
  const activeTerminalTab: TerminalFixedPanelTab | null =
    activeTab?.kind === "terminal" && activeTab.target !== undefined
      ? activeTab
      : null;
  const activeTerminalTarget = activeTerminalTab?.target ?? null;
  const activeTerminalQuery = useTerminals(
    terminalScope(activeTerminalTarget),
    {
      enabled: isOpen && activeTerminalTarget !== null,
    },
  );
  const terminalSessions = activeTerminalQuery.data?.sessions;
  const terminalsById = useMemo(
    () =>
      new Map((terminalSessions ?? []).map((session) => [session.id, session])),
    [terminalSessions],
  );
  const {
    activateTab,
    activeBrowserTab,
    browserTabs,
    closeTab,
    isNewTabActive,
    openTab,
    orderedSecondaryFileTabs,
    reorderFileTab,
    updateBrowserTab,
  } = useThreadFileTabs({
    panelStateId,
    syncThreadId: null,
    environmentId: null,
    storageFiles: undefined,
    terminalSessions: undefined,
  });
  const createTerminal = useCreateTerminal();
  const { mutateAsync: closeTerminal } = useCloseTerminal();
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

  // This branch previously persisted plugin-defined views in the shared tab
  // state. The new host accepts only native page tabs; remove stale local
  // entries without changing the state version used by Thread/New thread.
  useEffect(() => {
    updatePanelState((state) => {
      const tabs = state.secondary.tabs.filter(isPluginPagePanelTab);
      if (tabs.length === state.secondary.tabs.length) return state;
      const activeTabId = getActiveTabIdAfterPrune(
        tabs,
        state.secondary.activeTabId,
      );
      return {
        ...state,
        secondary: {
          ...state.secondary,
          tabs,
          activeTabId,
          isOpen: state.secondary.isOpen && activeTabId !== null,
        },
      };
    });
  }, [updatePanelState]);

  useEffect(() => {
    if (
      activeTerminalTab === null ||
      activeTerminalQuery.isLoading ||
      activeTerminalQuery.error !== null ||
      terminalSessions === undefined ||
      terminalsById.has(activeTerminalTab.terminalId)
    ) {
      return;
    }
    closeTab(activeTerminalTab.id);
  }, [
    activeTerminalQuery.error,
    activeTerminalQuery.isLoading,
    activeTerminalTab,
    closeTab,
    terminalSessions,
    terminalsById,
  ]);

  useEffect(() => {
    setCompactDrawerOpen(false);
  }, [setCompactDrawerOpen, subPath]);

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
  const hidePanel = useCallback(() => {
    if (isCompactViewport) {
      setCompactDrawerOpen(false);
      return;
    }
    closePersistedPanel();
  }, [closePersistedPanel, isCompactViewport, setCompactDrawerOpen]);
  const openNewTab = useCallback(() => {
    openTab({ kind: "new-tab" });
    revealPanel();
  }, [openTab, revealPanel]);
  const togglePanel = useCallback(() => {
    if (isOpen) {
      hidePanel();
      return;
    }
    if (activeTab === null) openTab({ kind: "new-tab" });
    revealPanel();
  }, [activeTab, hidePanel, isOpen, openTab, revealPanel]);

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

  const [togglePortalTarget, setTogglePortalTarget] =
    useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setTogglePortalTarget(findPluginRightPanelTogglePortal(panelStateId));
  }, [panel, panelStateId]);

  const openBrowser = useCallback(
    (url = "") => {
      if (!isDesktopBrowserAvailable()) return;
      openTab({ kind: "browser", url });
      revealPanel();
    },
    [openTab, revealPanel],
  );
  const browserTabIds = useMemo(
    () => new Set(browserTabs.map((tab) => tab.id)),
    [browserTabs],
  );
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi === null) return;
    if (browserApi.onScopedOpenTab) {
      return browserApi.onScopedOpenTab(({ tabId, url }) => {
        if (browserTabIds.has(tabId)) openBrowser(url);
      });
    }
    if (activeBrowserTab === null || !isFocused) return;
    return browserApi.onOpenTab(({ url }) => {
      if (!isRoutePath({ path: url })) openBrowser(url);
    });
  }, [activeBrowserTab, browserTabIds, isFocused, openBrowser]);

  const startTerminal = useCallback(
    (target: TerminalCreateTarget) => {
      if (createTerminal.isPending) return;
      void createTerminal
        .mutateAsync({
          cols: TERMINAL_COLS,
          rows: TERMINAL_ROWS,
          target,
        })
        .then((session) => {
          const tab = createTerminalFixedPanelTab({
            terminalId: session.id,
            target,
          });
          updatePanelState((state) => {
            const tabs = state.secondary.tabs.filter(
              (candidate) =>
                candidate.id !== state.secondary.activeTabId ||
                candidate.kind !== "new-tab",
            );
            return {
              ...state,
              secondary: {
                ...state.secondary,
                tabs: [...tabs, tab],
                activeTabId: tab.id,
                isOpen: isCompactViewport ? state.secondary.isOpen : true,
              },
            };
          });
          revealPanel();
        })
        .catch(() => undefined);
    },
    [createTerminal, isCompactViewport, revealPanel, updatePanelState],
  );
  const startSelectedTerminal = useCallback(() => {
    if (selectedTerminalHost?.status !== "connected") return;
    startTerminal({
      kind: "host_path",
      hostId: selectedTerminalHost.id,
      cwd: null,
    });
  }, [selectedTerminalHost, startTerminal]);

  useAppCommandHandler("terminal.open", () => {
    if (
      !isFocused ||
      panel === null ||
      createTerminal.isPending ||
      selectedTerminalHost?.status !== "connected"
    ) {
      return false;
    }
    startSelectedTerminal();
    return true;
  });

  const closeTerminalTab = useCallback(
    (tab: TerminalFixedPanelTab) => {
      void closeTerminal({ mode: "force", terminalId: tab.terminalId })
        .then(() => closeTab(tab.id))
        .catch(() => undefined);
    },
    [closeTab, closeTerminal],
  );

  const fileTabs = useMemo<SecondaryPanelFileTab[]>(
    () =>
      orderedSecondaryFileTabs.flatMap((tab) => {
        switch (tab.kind) {
          case "browser": {
            const label =
              tab.title ??
              (tab.url.length > 0 ? getBrowserUrlHost(tab.url) : "");
            return [
              {
                id: tab.id,
                filename: label || "Browser",
                isActive: tab.id === activeTab?.id,
                leadingVisual: <Icon name="Globe" className="size-3.5" />,
                statusLabel: null,
                onSelect: () => {
                  activateTab(tab.id);
                  revealPanel();
                },
                onClose: () => closeTab(tab.id),
              },
            ];
          }
          case "terminal": {
            if (tab.target === undefined) return [];
            const session = terminalsById.get(tab.terminalId);
            return [
              {
                id: tab.id,
                filename: session?.title ?? "Terminal",
                isActive: tab.id === activeTab?.id,
                leadingVisual: <Icon name="Terminal" className="size-3.5" />,
                statusLabel:
                  session === undefined || session.status === "running"
                    ? null
                    : terminalStatusLabel(session),
                onSelect: () => {
                  activateTab(tab.id);
                  revealPanel();
                },
                onClose: () => closeTerminalTab(tab),
              },
            ];
          }
          case "new-tab":
            return [
              {
                id: tab.id,
                filename: "New tab",
                isActive: tab.id === activeTab?.id,
                leadingVisual: <Icon name="NewTab" className="size-3.5" />,
                statusLabel: null,
                onSelect: () => {
                  activateTab(tab.id);
                  revealPanel();
                },
                onClose: () => closeTab(tab.id),
              },
            ];
          default:
            return [];
        }
      }),
    [
      activateTab,
      activeTab?.id,
      closeTab,
      closeTerminalTab,
      orderedSecondaryFileTabs,
      revealPanel,
      terminalsById,
    ],
  );

  const activeContent = useMemo(
    () =>
      activeTerminalTab ? (
        <Suspense fallback={null}>
          <LazyThreadTerminalPanel
            canCreateTerminal
            fixedPanelTarget={activeTerminalTarget ?? undefined}
            fixedTerminalId={activeTerminalTab.terminalId}
            isPanelOpen={isOpen}
            isPanelPersistedOpen={panelState.secondary.isOpen}
            panelStateId={panelStateId}
            syncThreadId={null}
            target={activeTerminalTarget!}
          />
        </Suspense>
      ) : isNewTabActive ? (
        <Suspense fallback={null}>
          <LazyNewTabPage
            autoFocus={false}
            projectId={undefined}
            environmentId={null}
            currentThreadId=""
            onAutoFocusHandled={() => undefined}
            onSelect={() => undefined}
            onOpenBrowser={
              isDesktopBrowserAvailable() ? () => openBrowser() : undefined
            }
            onStartTerminal={startSelectedTerminal}
            showFileSearch={false}
            startTerminalDisabled={
              createTerminal.isPending ||
              selectedTerminalHost?.status !== "connected"
            }
            startTerminalTrailing={
              <TerminalHostSelector
                disabled={createTerminal.isPending}
                hosts={terminalHosts}
                isLoading={hostsQuery.isLoading}
                onChange={setPreferredTerminalHostId}
                selectedHostId={selectedTerminalHost?.id ?? null}
              />
            }
          />
        </Suspense>
      ) : null,
    [
      activeTerminalTab,
      activeTerminalTarget,
      createTerminal.isPending,
      hostsQuery.isLoading,
      isNewTabActive,
      isOpen,
      openBrowser,
      panelState.secondary.isOpen,
      panelStateId,
      selectedTerminalHost,
      startSelectedTerminal,
      terminalHosts,
    ],
  );

  const renderPanel = useCallback(
    ({
      presentation,
      canShowNativeBrowserView,
      resizablePanelId,
    }: {
      presentation: "inline" | "drawer";
      canShowNativeBrowserView: boolean;
      isMainCollapsed: boolean;
      onToggleMainCollapse: () => void;
      resizablePanelId?: string;
    }) => {
      const deck =
        browserTabs.length === 0 ? null : (
          <Suspense fallback={null}>
            <LazyBrowserTabDeck
              browserTabs={browserTabs}
              activeBrowserTabId={activeBrowserTab?.id ?? null}
              environmentId={null}
              canShowNativeBrowserView={canShowNativeBrowserView}
              threadId={panelStateId}
              onUpdate={updateBrowserTab}
            />
          </Suspense>
        );
      return (
        <Suspense fallback={deck}>
          <LazyThreadSecondaryPanel
            activeTab={activeTab}
            canUseGitUi={false}
            metadataContent={null}
            fileTabs={fileTabs}
            fileTabContent={activeContent}
            fileTabContentFillsRegion={activeTerminalTab !== null}
            onFileTabReorder={reorderFileTab}
            browserDeck={deck}
            isBrowserTabActive={activeBrowserTab !== null}
            isOpen={isOpen}
            showConversationCollapseControl={false}
            showGitDiffTab={false}
            showInfoTab={false}
            showNewTabButton
            onPanelFocus={() => undefined}
            onPanelChange={() => undefined}
            onCollapse={hidePanel}
            onClose={hidePanel}
            onOpenNewTab={openNewTab}
            isConversationCollapsed={false}
            onToggleConversationCollapse={() => undefined}
            renderAsDrawer={presentation === "drawer"}
            resizablePanelId={resizablePanelId}
          />
        </Suspense>
      );
    },
    [
      activeBrowserTab,
      activeContent,
      activeTab,
      activeTerminalTab,
      browserTabs,
      fileTabs,
      hidePanel,
      isOpen,
      openNewTab,
      panelStateId,
      reorderFileTab,
      updateBrowserTab,
    ],
  );

  const toggleLabel = isOpen ? "Hide right panel" : "Show right panel";
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
        onClose={hidePanel}
        resetKey={panelStateId}
        contentKey={panelStateId}
        drawerLabel="Right panel"
        drawerFallback={null}
        mainPanelId={`plugin-panel-main-${pluginId}-${panelPath}`}
        main={children}
        composerHost={null}
        renderPanel={renderPanel}
      />
    </div>
  );

  return (
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
                  className={RIGHT_PANEL_TOGGLE_CLASS}
                  aria-label={toggleLabel}
                  aria-pressed={isOpen}
                  onClick={togglePanel}
                >
                  <Icon name="PanelRight" />
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
}
