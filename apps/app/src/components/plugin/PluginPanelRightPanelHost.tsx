import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { atom, useAtom, useAtomValue, useStore } from "jotai";
import { atomFamily } from "jotai-family";
import type { Host, JsonValue } from "@bb/domain";
import { jsonValueSchema } from "@bb/domain";
import type { ExperimentalPluginFixedTabDeclaration } from "@get-bb/plugin-sdk";
import { Button } from "@bb/shared-ui/button";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { SecondaryPanelLayout } from "@/components/secondary-panel/SecondaryPanelLayout";
import {
  LazyBrowserTabDeck,
  LazyHostScopedFilePreviewTabContent,
  LazyNewTabPage,
  LazyThreadSecondaryPanel,
  LazyThreadStorageFilePreviewTabContent,
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
import type { TerminalCreateTarget } from "@bb/server-contract";
import {
  createPluginPageFixedPanelTab,
  createTerminalFixedPanelTab,
  type PluginPageFixedPanelTab,
  type SecondaryFileFixedPanelTab,
  type TerminalFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { createFileOpenerOriginalTab } from "./file-opener-tabs";
import { activateSecondaryPanelTabInState } from "@bb/client-core";
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
import { UrlOpenRoutingProvider } from "@/lib/url-open-routing";
import { usePluginSlots } from "@/lib/plugin-slots";
import {
  AppNavigationHostProvider,
  type AppFilePreviewIntent,
} from "@/lib/app-navigation-host";
import {
  AppFixedTabTargetProvider,
  getPluginFixedTabOwnerId,
  openAppFixedTabFromDestinations,
  type AppFixedTabDestination,
  type AppFixedTabTargetState,
} from "@/lib/app-fixed-tab-navigation";
import {
  normalizeExperimentalFileOpenOptions,
  toFilePreviewLineRange,
} from "@/lib/live-file-navigation";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import {
  resolveTerminalHost,
  TerminalHostSelector,
} from "@/components/secondary-panel/TerminalHostSelector";
import { getPluginPagePanelStateId } from "./plugin-page-panel-state";
import { PluginPanelTabContent } from "./PluginPanelActions";

const TERMINAL_COLS = 100;
const TERMINAL_ROWS = 30;
const EMPTY_TERMINAL_HOSTS: readonly Host[] = [];
const RIGHT_PANEL_TOGGLE_CLASS = `${COARSE_POINTER_HEADER_ICON_BUTTON_CLASS} ${CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS}`;

const compactDrawerOpenAtomFamily = atomFamily((_panelStateId: string) =>
  atom(false),
);
interface FixedTabSessionTarget {
  sequence: number;
  target: JsonValue;
}
const fixedTabTargetAtomFamily = atomFamily((_targetId: string) =>
  atom<FixedTabSessionTarget | null>(null),
);

function PluginFixedTabContent({
  fixedTabOwnerId,
  isOpen,
  panelGeneration,
  panelId,
  panelStateId,
  pluginId,
  registration,
  subPath,
}: {
  fixedTabOwnerId: string;
  isOpen: boolean;
  panelGeneration: number;
  panelId: string;
  panelStateId: string;
  pluginId: string;
  registration: ExperimentalPluginFixedTabDeclaration;
  subPath: string;
}) {
  const targetStore = useStore();
  const targetAtom = fixedTabTargetAtomFamily(
    `${panelStateId}\0${registration.id}`,
  );
  const targetSnapshot = useAtomValue(targetAtom);
  const targetState = useMemo<AppFixedTabTargetState | null>(() => {
    if (targetSnapshot === null) return null;
    const { sequence } = targetSnapshot;
    return {
      ...targetSnapshot,
      ownerId: fixedTabOwnerId,
      tabId: registration.id,
      clear: () => {
        targetStore.set(targetAtom, (current) =>
          current?.sequence === sequence ? null : current,
        );
      },
    };
  }, [
    fixedTabOwnerId,
    registration.id,
    targetAtom,
    targetSnapshot,
    targetStore,
  ]);
  if (!isOpen) return null;
  const FixedTabComponent = registration.component;
  return (
    <PluginSlotMount
      key={`${pluginId}/${panelId}/${registration.id}/${panelGeneration}`}
      pluginId={pluginId}
      slotKind="navPanelFixedTab"
      slotId={registration.id}
      instanceId={panelId}
    >
      <AppFixedTabTargetProvider state={targetState}>
        <FixedTabComponent subPath={subPath} />
      </AppFixedTabTargetProvider>
    </PluginSlotMount>
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

function terminalScope(target: TerminalCreateTarget | null) {
  if (target?.kind !== "host_path") return target;
  return {
    kind: "host_path" as const,
    hostId: target.hostId,
    ...(target.cwd === null ? {} : { cwd: target.cwd }),
  };
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
  const resolvedPaneId = paneId ?? paneContext?.paneId;
  const panelHostId = resolvedPaneId ?? "standalone";
  const panelStateId = getPluginPagePanelStateId({
    panelPath,
    paneId: resolvedPaneId,
    pluginId,
  });
  const fixedViewTabs = useMemo<readonly PluginPageFixedPanelTab[]>(
    () =>
      (panel?.experimental_fixedTabs ?? []).map((fixedTab) =>
        createPluginPageFixedPanelTab({
          fixedTabId: fixedTab.id,
          pageId: panel?.id ?? panelPath,
          pluginId,
        }),
      ),
    [panel, panelPath, pluginId],
  );
  const panelState = useReconciledFixedPanelTabsState({
    fixedTabs: fixedViewTabs,
    isAuthoritative: panel !== null,
    openFirstFixedTabWhenEmpty: true,
    panelStateId,
    syncThreadId: null,
  });
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
    openTab,
    orderedSecondaryFileTabs,
    reorderTab,
    updateBrowserTab,
  } = useThreadFileTabs({
    panelStateId,
    syncThreadId: null,
    environmentId: null,
    fileOwnerThreadId: null,
    preserveWorkspaceTabsAcrossContexts: true,
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
  const targetStore = useStore();
  const fixedTabOwnerId = getPluginFixedTabOwnerId(
    pluginId,
    panel?.id ?? panelPath,
  );
  const fixedTabDestinations = useMemo<readonly AppFixedTabDestination[]>(
    () =>
      (panel?.experimental_fixedTabs ?? []).flatMap((registration) => {
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
            open: (target) => {
              if (target !== undefined) {
                const result = jsonValueSchema.safeParse(target);
                if (
                  !result.success ||
                  registration.experimental_target === undefined
                ) {
                  return false;
                }
                try {
                  if (!registration.experimental_target.validate(result.data)) {
                    return false;
                  }
                } catch {
                  return false;
                }
                targetStore.set(
                  fixedTabTargetAtomFamily(
                    `${panelStateId}\0${registration.id}`,
                  ),
                  (current) => ({
                    sequence: (current?.sequence ?? 0) + 1,
                    target: result.data,
                  }),
                );
              }
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
      panel?.experimental_fixedTabs,
      revealPanel,
      targetStore,
      updatePanelState,
    ],
  );
  const openFixedTab = useCallback(
    (intent: Parameters<typeof openAppFixedTabFromDestinations>[1]) =>
      openAppFixedTabFromDestinations(fixedTabDestinations, intent),
    [fixedTabDestinations],
  );
  const openFilePreview = useCallback(
    (intent: AppFilePreviewIntent) => {
      const normalized = normalizeExperimentalFileOpenOptions(intent);
      if (normalized === null || panel === null) return false;
      const lineRange = toFilePreviewLineRange(normalized.location);
      const { target } = normalized;
      const tab =
        target.kind === "workspace"
          ? openTab(
              {
                kind: "workspace-file-preview",
                environmentId: target.environmentId,
                tab: {
                  lineRange,
                  path: target.path,
                  source: { kind: "working-tree" },
                  statusLabel: null,
                },
              },
              { viewer: intent.viewer },
            )
          : target.kind === "host"
            ? openTab(
                {
                  kind: "host-file-preview",
                  hostId: target.hostId,
                  tab: { lineRange, path: target.path },
                },
                { viewer: intent.viewer },
              )
            : openTab(
                {
                  kind: "thread-storage-file-preview",
                  threadId: target.threadId,
                  tab: { lineRange, path: target.path },
                },
                { viewer: intent.viewer },
              );
      if (tab === null) return false;
      revealPanel();
      return true;
    },
    [openTab, panel, revealPanel],
  );
  const navigationCapabilities = useMemo(
    () => ({ openFilePreview, openFixedTab }),
    [openFilePreview, openFixedTab],
  );
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
    (target: TerminalCreateTarget, replaceNewTabId?: string) => {
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
                candidate.id !==
                  (replaceNewTabId ?? state.secondary.activeTabId) ||
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
  const startSelectedTerminal = useCallback(
    (replaceNewTabId?: string) => {
      if (selectedTerminalHost?.status !== "connected") return;
      startTerminal(
        {
          kind: "host_path",
          hostId: selectedTerminalHost.id,
          cwd: null,
        },
        replaceNewTabId,
      );
    },
    [selectedTerminalHost, startTerminal],
  );

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

  const fixedTabs = useMemo<readonly SecondaryPanelFixedTab[]>(
    () =>
      (panel?.experimental_fixedTabs ?? []).flatMap((registration) => {
        const tab = fixedViewTabs.find(
          (candidate) => candidate.fixedTabId === registration.id,
        );
        if (tab === undefined) return [];
        return [
          {
            ariaLabel: registration.title,
            contentFillsRegion: registration.layout === "flush",
            label: registration.title,
            leadingVisual: (
              <PluginIcon
                pluginId={pluginId}
                icon={registration.icon}
                className="size-3.5"
              />
            ),
            onSelect: () => {
              openFixedTab({
                surface: { kind: "current" },
                tab: {
                  ownerId: fixedTabOwnerId,
                  tabId: registration.id,
                },
              });
            },
            renderContent: () =>
              panel === null ? null : (
                <PluginFixedTabContent
                  fixedTabOwnerId={fixedTabOwnerId}
                  isOpen={isOpen}
                  panelGeneration={panel.generation}
                  panelId={panel.id}
                  panelStateId={panelStateId}
                  pluginId={pluginId}
                  registration={registration}
                  subPath={subPath}
                />
              ),
            tab,
            title: registration.title,
          },
        ];
      }),
    [
      fixedViewTabs,
      fixedTabOwnerId,
      isOpen,
      openFixedTab,
      panel,
      panelStateId,
      pluginId,
      subPath,
    ],
  );

  const renderPanelTabContent = useCallback(
    function renderTabContent(tab: SecondaryFileFixedPanelTab): ReactNode {
      switch (tab.kind) {
        case "browser":
          return null;
        case "terminal":
          if (tab.target === undefined) return null;
          return (
            <LazyThreadTerminalPanel
              canCreateTerminal
              fixedPanelTarget={tab.target}
              fixedTerminalId={tab.terminalId}
              isPanelOpen={isOpen}
              isPanelPersistedOpen={panelState.secondary.isOpen}
              panelStateId={panelStateId}
              syncThreadId={null}
              target={tab.target}
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
                isDesktopBrowserAvailable()
                  ? () => {
                      activateTab(tab.id);
                      openBrowser();
                    }
                  : undefined
              }
              onStartTerminal={() => {
                activateTab(tab.id);
                startSelectedTerminal(tab.id);
              }}
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
          );
        case "workspace-file-preview":
          return tab.environmentId === null ? null : (
            <LazyWorkspaceFilePreviewTabContent
              activePath={tab.path}
              environmentId={tab.environmentId}
              isPanelOpen={isOpen}
              lineRange={tab.lineRange}
              source={tab.source}
              statusLabel={tab.statusLabel}
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
              context={{ kind: "new-thread", projectId: null }}
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
      createTerminal.isPending,
      hostsQuery.isLoading,
      isOpen,
      openBrowser,
      panelState.secondary.isOpen,
      panelStateId,
      selectedTerminalHost,
      startSelectedTerminal,
      terminalHosts,
    ],
  );
  const panelTabs = useMemo<readonly SecondaryPanelRenderableTab[]>(
    () =>
      orderedSecondaryFileTabs.flatMap((tab): SecondaryPanelRenderableTab[] => {
        const shared = {
          onSelect: () => {
            activateTab(tab.id);
            revealPanel();
          },
          renderContent: () => renderPanelTabContent(tab),
          tab,
        };
        switch (tab.kind) {
          case "browser": {
            const label =
              tab.title ??
              (tab.url.length > 0 ? getBrowserUrlHost(tab.url) : "");
            return [
              {
                ...shared,
                label: label || "Browser",
                leadingVisual: <Icon name="Globe" className="size-3.5" />,
                statusLabel: null,
                onClose: () => closeTab(tab.id),
              },
            ];
          }
          case "terminal": {
            if (tab.target === undefined) return [];
            const session = terminalsById.get(tab.terminalId);
            return [
              {
                ...shared,
                contentFillsRegion: true,
                label: session?.title ?? "Terminal",
                leadingVisual: <Icon name="Terminal" className="size-3.5" />,
                statusLabel:
                  session === undefined || session.status === "running"
                    ? null
                    : session.status,
                onClose: () => closeTerminalTab(tab),
              },
            ];
          }
          case "new-tab":
            return [
              {
                ...shared,
                label: "New tab",
                leadingVisual: <Icon name="NewTab" className="size-3.5" />,
                statusLabel: null,
                onClose: () => closeTab(tab.id),
              },
            ];
          case "workspace-file-preview":
          case "host-file-preview":
          case "thread-storage-file-preview":
            return [
              {
                ...shared,
                isPinned:
                  tab.kind === "thread-storage-file-preview" && tab.isPinned,
                label: tab.path.split(/[\\/]/u).at(-1) ?? tab.path,
                leadingVisual: <Icon name="File" className="size-3.5" />,
                statusLabel:
                  tab.kind === "workspace-file-preview"
                    ? tab.statusLabel
                    : null,
                onClose: () => closeTab(tab.id),
              },
            ];
          case "plugin-panel":
            return [
              {
                ...shared,
                // PluginPanelTabContent owns the complete body frame for every
                // plugin tab: padded actions provide their own padded scroll
                // container, while flush actions and file openers provide their
                // own full-bleed layout. Letting the file-preview shell frame a
                // padded action adds a second scroll container and an extra
                // bottom gutter.
                contentFillsRegion: true,
                label: tab.title,
                leadingVisual: (
                  <PluginIcon
                    pluginId={tab.pluginId}
                    icon={null}
                    className="size-3.5"
                  />
                ),
                statusLabel: null,
                onClose: () => closeTab(tab.id),
              },
            ];
        }
      }),
    [
      activateTab,
      closeTab,
      closeTerminalTab,
      orderedSecondaryFileTabs,
      renderPanelTabContent,
      revealPanel,
      terminalsById,
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
      const renderDeck = (
        activeBrowserTabId: string | null,
        canHandleBrowserCommands: boolean,
        onNativeFocus?: () => void,
      ) =>
        browserTabs.length === 0 ? null : (
          <LazyBrowserTabDeck
            browserTabs={browserTabs}
            activeBrowserTabId={activeBrowserTabId}
            environmentId={null}
            canShowNativeBrowserView={canShowNativeBrowserView}
            canHandleBrowserCommands={canHandleBrowserCommands}
            onNativeFocus={onNativeFocus}
            threadId={panelStateId}
            onUpdate={updateBrowserTab}
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
          canUseGitUi={false}
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
          showConversationCollapseControl={false}
          showNewTabButton
          onPanelFocus={() => undefined}
          onCollapse={hidePanel}
          onClose={hidePanel}
          onOpenNewTab={openNewTab}
          isConversationCollapsed={false}
          onToggleConversationCollapse={() => undefined}
          renderAsDrawer={presentation === "drawer"}
          resizablePanelId={resizablePanelId}
        />
      );
    },
    [
      activeBrowserTab,
      activeTab,
      browserTabs,
      fixedTabs,
      hidePanel,
      isOpen,
      openNewTab,
      panelTabs,
      panelStateId,
      reorderTab,
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
        panelGroupKey={`plugin-panel-host:${panelHostId}`}
        resetKey={panelStateId}
        contentKey={panelStateId}
        drawerLabel="Right panel"
        drawerFallback={null}
        mainPanelId={`plugin-panel-main-${panelHostId}`}
        main={children}
        composerHost={null}
        renderPanel={renderPanel}
      />
    </div>
  );

  return (
    <UrlOpenRoutingProvider
      openInAppBrowser={isDesktopBrowserAvailable() ? openBrowser : null}
    >
      <AppNavigationHostProvider capabilities={navigationCapabilities}>
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
      </AppNavigationHostProvider>
    </UrlOpenRoutingProvider>
  );
}
