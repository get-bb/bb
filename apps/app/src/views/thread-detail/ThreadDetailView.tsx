import {
  getThreadFixedTabOwnerId,
  useAppPanelController,
  useSetFixedTabTarget,
} from "@/lib/app-fixed-tab-navigation";
import {
  createPanelActionDestination,
  PluginPanelTabContent,
  usePluginPanelActions,
} from "@/components/plugin/PluginPanelActions";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { GIT_DIFF_TAB_REFERENCE } from "@/lib/git-diff-tab";
import { useGitWorkspaceStatus } from "@/hooks/queries/git-plugin-queries";
import {
  useThreadFixedTabs,
  createThreadFixedTabDescriptor,
  getThreadFixedTabTargetKey,
  type ThreadFixedTabEntry,
} from "@/components/plugin/PluginThreadFixedTabs";
import { BrowserTabIcon } from "@/components/secondary-panel/BrowserTabIcon";
import { getPanelTabHistoryKey } from "@/components/secondary-panel/recentlyClosedPanelTabs";
import { queueSplitDownload } from "@/lib/split-prefetch";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  useSystemProviderInfo,
  useSystemConfig,
} from "@/hooks/queries/system-queries";
import { useImmediateRouteNavigate } from "@/components/ui/app-route-anchor";
import { useAtom } from "jotai";
import { useDesktopBrowserReveal } from "@/lib/use-desktop-browser-reveal";
import {
  type ThreadTimelineForkMessageHandler,
  type ThreadTimelineLinkHandler,
  type ThreadTimelineLocalFileLink,
  type ThreadTimelineLocalFileLinkHandler,
  type TimelineTitleActionResolver,
  useThreadTimelineController,
} from "@/components/thread/timeline";
import { ThreadProviderContext } from "@/components/thread/thread-provider-context";
import {
  type ThreadListEntry,
} from "@bb/domain";
import type { TerminalSession } from "@bb/server-contract";
import type { WorkspaceOpenTarget } from "@bb/host-daemon-contract";
import { appToast } from "@/components/ui/app-toast";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import {
  PluginDetailPanelContext,
  usePluginDetailPanelState,
} from "@/components/plugin/plugin-detail-navigation";
import { useForkThreadFromMessage } from "@/hooks/useForkThreadFromMessage";
import { useUpdateEnvironment } from "../../hooks/mutations/environment-mutations";
import { useUpdateThread } from "../../hooks/mutations/thread-state-mutations";
import { useEnvironment } from "../../hooks/queries/environment-queries";
import {
  useProjectThreadSubset,
  useThread,
  type ProjectThreadSubsetFilters,
} from "../../hooks/queries/thread-queries";
import { useThreadStorageLocation } from "../../hooks/queries/thread-panel-queries";
import { isTransientReadError } from "@/hooks/queries/query-helpers";
import { PageShell } from "@/components/ui/page-shell.js";
import { RouteLoadingSkeleton } from "@/components/ui/route-loading-skeleton";
import { ThreadTimelineLoadingSkeleton } from "@/components/thread/timeline/ThreadTimelineLoadingSkeleton";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import type {
  JsonValue,
  PluginThreadActionsInlineItem,
} from "@get-bb/plugin-sdk";
import { ThreadActionsMenu } from "@/components/thread/ThreadActionsMenu";
import { toThreadActionTarget } from "@/lib/thread-actions/thread-action-target";
import { Button } from "@bb/shared-ui/button";
import {
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import { PluginThreadHeaderActions } from "@/components/plugin/PluginThreadHeaderActions";
import { ThreadWorkspaceOpenButton } from "@/components/thread/ThreadWorkspaceOpenButton";
import {
  formatEnvironmentDisplay,
  type EnvironmentDisplayHostContext,
} from "@bb/core-ui";
import { assertNever } from "@bb/thread-view";
import { useCreateThreadInEnvironment } from "@/hooks/useCreateThreadInEnvironment";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useCanOpenFileExternally } from "@/hooks/useCanOpenFileExternally";
import type { LiveFileRoot } from "@/hooks/useResolvedLiveFileTarget";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import { selectHosts, useHosts } from "@/hooks/queries/host-queries";
import { useConnectionAwareQueryState } from "@/hooks/queries/connection-aware-query-state";
import { useThreadTerminals } from "@/hooks/queries/thread-terminal-queries";
import { usePanelBrowser } from "@/components/secondary-panel/usePanelBrowser";
import { usePanelFiles } from "@/components/secondary-panel/usePanelFiles";
import { usePanelTerminals } from "@/components/secondary-panel/usePanelTerminals";
import {
  findEnvironmentDisplayProvider,
  getEnvironmentSummaryChrome,
  isHostAmbiguous,
} from "@/lib/environment-workspace-display";
import { useSystemEnvironmentProviders } from "@/hooks/queries/environment-provider-queries";
import { useSystemMachineProviders } from "@/hooks/queries/machine-provider-queries";
import { formatWorkspaceCheckoutDisplay } from "@bb/shared-ui/lib/workspace-checkout-display";
import {
  getAbsoluteDirname,
  isAbsoluteFilePathWithinRoot,
  resolveAbsoluteFilePath,
} from "@bb/shared-ui/lib/absolute-file-path";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { hasThreadProvisioningFailure } from "@/lib/thread-provisioning-failure";
import {
  getProjectComposeRoutePath,
  type ThreadRoutePathArgs,
} from "@/lib/route-paths";
import { THREAD_INFO_FIXED_TAB_REFERENCE } from "@/components/secondary-panel/thread-info-fixed-tab-navigation";
import { ThreadDetailHeader } from "./ThreadDetailHeader";
import { ThreadScreen, useThreadComposerAddToChat } from "./ThreadScreen";
import { ThreadDetailSecondaryContent } from "./ThreadDetailSecondaryContent";
import {
  useThreadSecondaryPanelDrawerVisibility,
  useThreadSecondaryPanelVisibility,
  type ThreadSecondaryPanelFileOpenOptions,
} from "./useThreadSecondaryPanelVisibility";
import {
  shouldLoadThreadStorageFileList,
  useThreadStorageViewer,
} from "@/components/secondary-panel/useThreadStorageViewer";
import { getThreadConversationCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { BrowserTabLifecycleObserver } from "@/components/secondary-panel/BrowserTabLifecycleObserver";
import {
  LazyBrowserTabDeck,
  LazyHostFilePreviewTabContent,
  LazyNewTabPage,
  LazyThreadStorageFilePreviewTabContent,
  LazyAttachmentFilePreviewTabContent,
  LazyThreadTerminalPanel,
  LazyWorkspaceFilePreviewTabContent,
} from "@/components/secondary-panel/lazySecondaryPanelComponents";
import {
  SIDE_CHAT_PLUGIN_ID,
  SIDE_CHAT_PLUGIN_PANEL_ACTION_ID,
} from "@/lib/side-chat-plugin";
import { RightPanelFileTabIcon } from "@/components/secondary-panel/RightPanelFileTabIcon";
import { PluginItemIcon } from "@/components/plugin/PluginIcon";
import { createFileOpenerOriginalTab } from "@/components/plugin/file-opener-tabs";
import { ThreadTimelineNavigationProvider } from "@/components/thread/timeline/ThreadTimelineNavigationContext";
import {
  AttachmentOpenerContext,
  type OpenAttachmentRequest,
} from "@/components/secondary-panel/AttachmentOpenerContext";
import { SelectionAddToChatContext } from "@/components/thread/SelectionAddToChatContext";
import { usePluginSlots } from "@/lib/plugin-slots";
import { getFileExtension } from "@/lib/plugin-slot-resolvers";
import { Icon } from "@bb/shared-ui/icon";
import { getBbDesktopInfo, isDesktopBrowserAvailable } from "@/lib/bb-desktop";
import { UrlOpenRoutingProvider } from "@/lib/url-open-routing";
import {
  AppNavigationHostProvider,
  useAppNavigationHost,
} from "@/lib/app-navigation-host";
import { getFileBasename } from "@/lib/live-file-navigation";
import { getBrowserUrlHost } from "@/lib/browser-url";
import {
  useThreadStorageBrowser,
  type ThreadStoragePathSelectHandler,
} from "@/components/secondary-panel/useThreadStorageBrowser";
import {
  useThreadFileTabs,
  type FileSearchSelection,
} from "@/components/secondary-panel/useThreadFileTabs";
import {
  getEnvironmentFilePreviewSourceRef,
  getFilePreviewLineRangeStart,
  isSecondaryFileTab,
  isThreadForkable,
  type PromptMentionLinkResolver,
} from "@bb/client-core";
import { useThreadOpenFileSignal } from "@/components/secondary-panel/useThreadOpenFileSignal";
import type {
  SecondaryPanelFixedTab,
  SecondaryPanelRenderableTab,
} from "@/components/secondary-panel/ThreadSecondaryPanel";
import { useThreadDetailThread } from "./useThreadDetailThread";
import {
  buildTerminalSyncedSecondaryFileTabs,
  syncTerminalTabsInFixedPanelState,
} from "@/components/secondary-panel/terminalPanelTabs";
import { usePendingTerminalIds } from "@/components/thread/terminal/pending-terminals";
import {
  buildOpenFileExternallyHandler,
  resolveEnvironmentOpenContext,
  resolveThreadWorkspaceOpenPath,
} from "./threadWorkspaceOpenPath";
import {
  resolveThreadLocalFileLink,
  type ThreadLocalFileLinkResolution,
} from "@/lib/thread-local-file-links";
import {
  MarkdownLocalFileContextMenuContext,
  MarkdownLocalFileOpenTargetsContext,
  type MarkdownLinkRouting,
  type MarkdownLocalFileContextMenuItem,
  type MarkdownLocalFileLinkRouting,
} from "@/components/ui/markdown-link-routing";
import {
  useFixedPanelTabsStorageMaintenance,
  useReconciledFixedPanelTabsState,
  useTouchFixedPanelTabsState,
  useUpdateFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
import type { SecondaryFileFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { resolveGitDiffTabStatus } from "@/components/secondary-panel/gitDiffTabEligibility";
import { isRootThread } from "./threadParentSelectorOptions";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  getActiveFixedSecondaryTab,
  useSetThreadSecondaryPanelSelection,
  useToggleThreadSecondaryPanelSelection,
} from "./threadSecondaryPanelSelection";
import { useRouteState } from "@/hooks/useRouteState";
import { usePaneContext } from "./PaneContext";
import { PaneThreadActionCommandHandler } from "./PaneThreadActionCommandHandler";

const EMPTY_PARENT_THREADS: readonly ThreadListEntry[] = [];
const EMPTY_PROJECT_THREAD_SUBSET_FILTERS =
  {} satisfies ProjectThreadSubsetFilters;
const EMPTY_TERMINAL_SESSIONS: readonly TerminalSession[] = [];
const THREAD_HEADER_ACTIONS_GROUP = "0_header";
const THREAD_DETAIL_SCREEN_PRESENTATION = { kind: "page" } as const;

type OpenFilePreviewHandler = (relativePath: string) => void;

interface ThreadDetailViewPageProps {
  surface: "page";
}

interface ThreadDetailViewPaneProps extends ThreadRoutePathArgs {
  surface: "pane";
  timelineEnabled: boolean;
}

type ThreadDetailViewProps =
  | ThreadDetailViewPageProps
  | ThreadDetailViewPaneProps;

interface BuildMarkdownPreviewLinkRoutingArgs {
  baseDir: string | undefined;
  onOpenLink: ThreadTimelineLinkHandler;
  onOpenLocalFileLink: ThreadTimelineLocalFileLinkHandler;
  rootPath: string | null | undefined;
}

interface ResolveHostFilePreviewLinkRootPathArgs {
  baseDir: string | undefined;
  threadStorageRootPath: string | null;
  workspaceRootPath: string | null;
}

function buildMarkdownPreviewLinkRouting({
  baseDir,
  onOpenLink,
  onOpenLocalFileLink,
  rootPath,
}: BuildMarkdownPreviewLinkRoutingArgs): MarkdownLinkRouting {
  if (rootPath === null || rootPath === undefined) {
    return {
      onOpenLink,
    };
  }

  const localFileRouting: MarkdownLocalFileLinkRouting = {
    absoluteLinks: {
      kind: "contained",
      rootPath,
    },
    onOpenLink: onOpenLocalFileLink,
  };
  if (baseDir !== undefined) {
    localFileRouting.relativeLinks = {
      baseDir,
      rootPath,
    };
  }

  return {
    localFile: localFileRouting,
    onOpenLink,
  };
}

function buildOpenTargetMenuItemLabel(target: WorkspaceOpenTarget): string {
  return `Open in ${target.label}`;
}

function resolveHostFilePreviewLinkRootPath({
  baseDir,
  threadStorageRootPath,
  workspaceRootPath,
}: ResolveHostFilePreviewLinkRootPathArgs): string | null {
  if (baseDir === undefined) {
    return null;
  }

  if (
    workspaceRootPath !== null &&
    isAbsoluteFilePathWithinRoot({
      candidatePath: baseDir,
      rootPath: workspaceRootPath,
    })
  ) {
    return workspaceRootPath;
  }

  if (
    threadStorageRootPath !== null &&
    isAbsoluteFilePathWithinRoot({
      candidatePath: baseDir,
      rootPath: threadStorageRootPath,
    })
  ) {
    return threadStorageRootPath;
  }

  return null;
}

function ThreadDetailNotFound() {
  return (
    <PageShell contentClassName="min-h-full items-center justify-center">
      <p className="py-12 text-center text-sm text-destructive">Not found</p>
    </PageShell>
  );
}

function RoutedThreadDetailView() {
  const { projectId, threadId } = useRouteState();

  if (!projectId || !threadId) {
    return <ThreadDetailNotFound />;
  }

  return (
    <ThreadDetailViewInternal
      projectId={projectId}
      threadId={threadId}
      timelineEnabled
    />
  );
}

queueSplitDownload("queued-messages-list");

export function ThreadDetailView(props: ThreadDetailViewProps) {
  if (props.surface === "pane") {
    return <ThreadDetailViewInternal {...props} />;
  }
  return <RoutedThreadDetailView />;
}

function ThreadDetailViewInternal(
  props: ThreadRoutePathArgs & { timelineEnabled: boolean },
) {
  const { projectId, threadId, timelineEnabled } = props;
  const {
    isFocused,
    isMaximized: isPaneMaximized,
    navigateInPane,
    onRequestClose,
    isBoundedPane,
  } = usePaneContext();
  const navigate = useImmediateRouteNavigate();
  useFixedPanelTabsStorageMaintenance();
  const systemConfigQuery = useSystemConfig();
  const {
    hasThreadDetailBootstrapSettled,
    threadDetailBootstrapQuery,
    threadQuery: { data: thread, isFetching, isLoadingError, error },
    unreadDividerState,
  } = useThreadDetailThread(
    threadId,
    timelineEnabled,
    systemConfigQuery.data?.experiments.unreadDividerAtAnswer === true
      ? "turn-answer"
      : "first-unread-row",
  );
  const environmentQuery = useEnvironment(thread?.environmentId, {
    enabled: hasThreadDetailBootstrapSettled,
    staleTime: 5_000,
  });
  const environment = environmentQuery.data;
  const hostLifecycle =
    environment === undefined || environment.hostLifecycle === "active"
      ? null
      : environment.hostLifecycle;
  const executionUnavailable =
    hostLifecycle !== null || environment?.status === "destroyed";
  const gitDiffTabStatus = resolveGitDiffTabStatus({
    environmentId: thread?.environmentId ?? null,
    environmentIsGitRepo: environment?.isGitRepo,
    environmentLoadFailed: environmentQuery.isError,
    environmentOwnsPath: environment?.managed,
    hasResolvedThread: thread !== undefined,
    threadArchived: thread?.archivedAt != null || executionUnavailable,
  });
  const canUseGitUi = !executionUnavailable && gitDiffTabStatus === "eligible";
  const threadEnvironmentId =
    canUseGitUi && environment !== undefined && thread?.environmentId
      ? thread.environmentId
      : null;
  const threadTabEnvironmentId = thread?.environmentId ?? null;
  const threadTabEnvironment = useMemo(
    () =>
      threadTabEnvironmentId === null ? null : { id: threadTabEnvironmentId },
    [threadTabEnvironmentId],
  );
  const threadFixedTabs = useThreadFixedTabs({
    threadId: thread?.id ?? null,
    environmentId: threadTabEnvironmentId,
  });
  const threadFixedViewTabs = useMemo(
    () => threadFixedTabs.entries.map((entry) => entry.tab),
    [threadFixedTabs.entries],
  );
  const fixedPanelTabsState = useReconciledFixedPanelTabsState({
    fixedTabs: threadFixedViewTabs,
    isAuthoritative:
      threadFixedTabs.isReady &&
      (gitDiffTabStatus === "eligible" || gitDiffTabStatus === "ineligible"),
    panelStateId: threadId,
    syncThreadId: threadId,
  });
  const isPersistedSecondaryPanelOpen = fixedPanelTabsState.secondary.isOpen;
  const activeFixedSecondaryTab = getActiveFixedSecondaryTab({
    fixedPanelTabsState,
  });
  const activeFixedSecondaryTabId = activeFixedSecondaryTab?.id ?? null;
  const renderSecondaryPanelAsDrawer = useIsCompactViewport();
  const secondaryPanelDrawerVisibility =
    useThreadSecondaryPanelDrawerVisibility({
      isCompactViewport: renderSecondaryPanelAsDrawer,
      threadId,
    });
  const pluginDetails = usePluginDetailPanelState(
    threadId,
    isFocused,
    getPanelTabHistoryKey({
      environmentId: thread?.environmentId,
      fileOwnerThreadId: threadId ?? null,
      panelStateId: threadId ?? null,
    }),
  );
  const isWorkspacePanelOpen = renderSecondaryPanelAsDrawer
    ? secondaryPanelDrawerVisibility.isDrawerVisible
    : isPersistedSecondaryPanelOpen;
  const isSecondaryPanelOpen =
    isWorkspacePanelOpen || pluginDetails.activePluginId !== null;
  const touchFixedPanelTabsState = useTouchFixedPanelTabsState(
    threadId,
    threadId,
  );
  const updateFixedPanelTabsState = useUpdateFixedPanelTabsState(
    threadId,
    threadId,
  );
  const setThreadSecondaryPanel = useSetThreadSecondaryPanelSelection(
    threadId,
    threadId,
  );
  const closeThreadSecondaryPanel = useCallback(() => {
    setThreadSecondaryPanel(null);
  }, [setThreadSecondaryPanel]);
  const toggleDefaultPersistedSecondaryPanel =
    useToggleThreadSecondaryPanelSelection(threadId, threadId);
  const threadQueryState = useConnectionAwareQueryState({
    hasResolvedData: thread !== undefined,
    isFetching: threadDetailBootstrapQuery.isFetching || isFetching,
    isLoadingError,
    isRecoverableLoadingError: isTransientReadError(error),
  });
  const { data: parentThread } = useThread(thread?.parentThreadId ?? "");
  const [shouldAutoFocusNewTab, setShouldAutoFocusNewTab] = useState(false);
  const handleNewTabAutoFocusHandled = useCallback(
    () => setShouldAutoFocusNewTab(false),
    [],
  );
  const shouldLoadThreadStorageFiles = shouldLoadThreadStorageFileList({
    hasThread: thread !== undefined,
    isSecondaryPanelOpen,
    secondaryTabs: fixedPanelTabsState.secondary.tabs,
  });
  const { threadStorageFiles, threadStorageFilesError } =
    useThreadStorageViewer({
      fileListEnabled: shouldLoadThreadStorageFiles,
      threadId,
    });
  const threadStorageLocationQuery = useThreadStorageLocation(threadId, {
    enabled: Boolean(thread?.environmentId),
  });
  const threadStorageRootPath =
    threadStorageLocationQuery.data?.storageRootPath ?? null;
  const terminalsListQuery = useThreadTerminals(threadId, {
    enabled: isSecondaryPanelOpen,
  });
  const {
    activeBrowserTab,
    activeHostFileLineRange,
    activeHostFilePath,
    activeStorageFilePath,
    activeWorkspaceFilePath,
    browserTabs,
    clearActiveFileTabs,
    activateTab,
    closeTab,
    openTab,
    openPluginPanel,
    orderedSecondaryFileTabs,
    reopenClosedTab,
    reorderTab,
    selectFileSearchResult,
    updateBrowserTab,
  } = useThreadFileTabs({
    panelStateId: threadId,
    syncThreadId: threadId,
    environmentId: thread?.environmentId,
    onCloseLastTab: secondaryPanelDrawerVisibility.closeDrawer,
    storageFiles: threadStorageFiles,
    terminalSessions: terminalsListQuery.data?.sessions,
  });
  const panelBrowser = usePanelBrowser({
    available: isDesktopBrowserAvailable(),
    browserTabs,
    isFocused,
    openTab,
    reveal: secondaryPanelDrawerVisibility.openDrawer,
  });
  const openBrowser = panelBrowser.open;
  const openBrowserUrl = panelBrowser.openUrl;
  const {
    fileOpeners: pluginFileOpeners,
    threadPanelActions: registeredThreadActions,
  } = usePluginSlots();
  useThreadOpenFileSignal({
    threadId,
    environmentId: thread?.environmentId,
    openTab,
  });
  const browserDeckThreadId = thread?.id ?? null;
  const browserDeckEnvironmentId = thread?.environmentId ?? null;
  const renderBrowserDeck = useCallback(
    ({
      canHandleBrowserCommands,
      canShowNativeBrowserView,
      onNativeFocus,
      activeBrowserTabId = activeBrowserTab?.id ?? null,
    }: {
      canHandleBrowserCommands?: boolean;
      canShowNativeBrowserView: boolean;
      onNativeFocus?: () => void;
      activeBrowserTabId?: string | null;
    }) => {
      if (browserDeckThreadId === null) {
        return null;
      }
      return (
        <LazyBrowserTabDeck
          browserTabs={browserTabs}
          activeBrowserTabId={activeBrowserTabId}
          addressFocusRequest={panelBrowser.addressFocusRequest}
          onAddressFocusRequestConsumed={
            panelBrowser.handleAddressFocusRequestConsumed
          }
          environmentId={browserDeckEnvironmentId}
          canShowNativeBrowserView={canShowNativeBrowserView}
          canHandleBrowserCommands={canHandleBrowserCommands}
          onNativeFocus={onNativeFocus}
          threadId={browserDeckThreadId}
          onUpdate={updateBrowserTab}
          onOpenInNewTab={panelBrowser.open}
        />
      );
    },
    [
      activeBrowserTab?.id,
      panelBrowser.addressFocusRequest,
      browserTabs,
      browserDeckEnvironmentId,
      browserDeckThreadId,
      panelBrowser.handleAddressFocusRequestConsumed,
      panelBrowser.open,
      updateBrowserTab,
    ],
  );
  const panelFiles = usePanelFiles({
    available: true,
    openTab,
    reveal: secondaryPanelDrawerVisibility.openDrawer,
    scope: {
      threadId: thread?.id ?? null,
      environmentId: thread?.environmentId ?? null,
      hostId: environment?.hostId ?? null,
    },
  });
  const openLiveFilePreview = panelFiles.openFilePreview;
  const openNewTab = useCallback(() => {
    openTab({ kind: "new-tab" });
  }, [openTab]);
  const isThreadRoot = isRootThread(thread);
  const [
    parentThreadsRequestedForThreadId,
    setParentThreadsRequestedForThreadId,
  ] = useState<string | null>(null);
  const shouldLoadParentThreads =
    threadQueryState.status === "ready" &&
    isThreadRoot &&
    parentThreadsRequestedForThreadId === thread?.id;
  const parentThreadSubsetQuery = useProjectThreadSubset({
    enabled: shouldLoadParentThreads,
    filters: EMPTY_PROJECT_THREAD_SUBSET_FILTERS,
    projectId,
  });
  const parentThreads = useMemo(
    () =>
      shouldLoadParentThreads
        ? (parentThreadSubsetQuery.data ?? EMPTY_PARENT_THREADS)
        : EMPTY_PARENT_THREADS,
    [parentThreadSubsetQuery.data, shouldLoadParentThreads],
  );
  const handleParentSelectorOpenChange = useCallback(
    (open: boolean) => {
      if (open && thread?.id) {
        setParentThreadsRequestedForThreadId(thread.id);
      }
    },
    [thread?.id],
  );
  const handleRetryParentThreads = parentThreadSubsetQuery.retry;
  const timeline = useThreadTimelineController({
    threadId,
    enabled: timelineEnabled,
  });
  const updateEnvironment = useUpdateEnvironment();
  const updateThread = useUpdateThread({
    errorMessage: "Failed to assign parent thread.",
  });
  const loadedTerminalSessions = terminalsListQuery.data?.sessions;
  const terminalSessions = loadedTerminalSessions ?? EMPTY_TERMINAL_SESSIONS;
  const terminalsById = useMemo(
    () => new Map(terminalSessions.map((session) => [session.id, session])),
    [terminalSessions],
  );
  const pendingTerminalIds = usePendingTerminalIds();
  const syncedOrderedSecondaryFileTabs = useMemo(
    () =>
      loadedTerminalSessions === undefined
        ? orderedSecondaryFileTabs
        : buildTerminalSyncedSecondaryFileTabs({
            orderedTabs: orderedSecondaryFileTabs,
            pendingTerminalIds,
            terminalSessions: loadedTerminalSessions,
          }),
    [loadedTerminalSessions, orderedSecondaryFileTabs, pendingTerminalIds],
  );
  useEffect(() => {
    if (terminalsListQuery.data === undefined) {
      return;
    }
    updateFixedPanelTabsState((state) =>
      syncTerminalTabsInFixedPanelState({
        pendingTerminalIds,
        state,
        terminalSessions,
      }),
    );
  }, [
    pendingTerminalIds,
    terminalSessions,
    terminalsListQuery.data,
    updateFixedPanelTabsState,
  ]);
  const hostsQuery = useHosts({
    enabled:
      hasThreadDetailBootstrapSettled &&
      thread?.environmentId !== null &&
      thread?.environmentId !== undefined,
  });
  const connectedHostIds = useMemo(
    () =>
      new Set(
        (hostsQuery.data ?? [])
          .filter((host) => host.status === "connected")
          .map((host) => host.id),
      ),
    [hostsQuery.data],
  );
  const resolvedThreadEnvironmentHost = useMemo(() => {
    const hosts = hostsQuery.data ?? [];
    const environmentHostId = environment?.hostId;
    if (!environmentHostId) return null;
    return hosts.find((host) => host.id === environmentHostId) ?? null;
  }, [environment?.hostId, hostsQuery.data]);
  const hasMultipleMachines =
    selectHosts(hostsQuery.data, "persistent").length > 1;
  const threadEnvironmentHost = isHostAmbiguous(
    hasMultipleMachines,
    resolvedThreadEnvironmentHost?.type ?? null,
  )
    ? resolvedThreadEnvironmentHost
    : null;
  const forkThreadFromMessage = useForkThreadFromMessage({
    navigateInPane,
    sourceThread: thread ?? null,
  });
  const handleForkMessage = useCallback<ThreadTimelineForkMessageHandler>(
    (target) => {
      void forkThreadFromMessage(target);
    },
    [forkThreadFromMessage],
  );
  const threadProviderInfo = useSystemProviderInfo(
    thread?.environmentId
      ? {
          enabled: true,
          environmentId: thread.environmentId,
          providerId: thread.providerId,
        }
      : {
          enabled: thread !== undefined,
          providerId: thread?.providerId,
        },
  );
  const threadProviderPluginId = threadProviderInfo?.pluginId ?? null;
  const threadProviderContextValue = useMemo(
    () => ({
      providerId: thread?.providerId ?? null,
      pluginId: threadProviderPluginId,
    }),
    [thread?.providerId, threadProviderPluginId],
  );
  const isForkAvailable = isThreadForkable(
    thread ?? null,
    threadProviderInfo?.capabilities.supportsFork ?? false,
  );
  const handleSelectionAddToChat = useThreadComposerAddToChat({
    id: thread?.id ?? "",
    projectId: thread?.projectId ?? projectId,
  });
  const canCreateTerminal =
    !executionUnavailable &&
    thread?.environmentId !== null &&
    thread?.environmentId !== undefined &&
    environment?.status === "ready" &&
    connectedHostIds.has(environment.hostId);
  const createThreadInEnvironment = useCreateThreadInEnvironment({
    projectId,
    environmentId: thread?.environmentId ?? "",
    sectionId: thread?.sectionId ?? null,
    pinned: thread?.pinnedAt != null,
  });
  const { providers: registeredEnvironmentProviders } =
    useSystemEnvironmentProviders();
  const { providers: registeredMachineProviders } = useSystemMachineProviders();
  const {
    closePanel: closeWorkspacePanel,
    openCompactDrawer,
    openHostFile,
    openStorageFile,
    openWorkspaceFile,
    togglePanel: toggleWorkspacePanel,
  } = useThreadSecondaryPanelVisibility({
    closePersistedPanel: closeThreadSecondaryPanel,
    drawerVisibility: secondaryPanelDrawerVisibility,
    isPersistedOpen: isPersistedSecondaryPanelOpen,
    isCompactViewport: renderSecondaryPanelAsDrawer,
    openPersistedHostFile: panelFiles.openHostFile,
    openPersistedPanel: setThreadSecondaryPanel,
    openPersistedStorageFile: panelFiles.openStorageFile,
    openPersistedWorkspaceFile: panelFiles.openWorkspaceFile,
    togglePersistedPanel: toggleDefaultPersistedSecondaryPanel,
  });
  const dismissPluginDetails = pluginDetails.dismiss;
  const closeSecondaryPanel = useCallback(() => {
    dismissPluginDetails();
    closeWorkspacePanel();
  }, [dismissPluginDetails, closeWorkspacePanel]);
  const openRegisteredFixedTab = useCallback(
    (entry: ThreadFixedTabEntry) => {
      dismissPluginDetails();
      clearActiveFileTabs();
      updateFixedPanelTabsState((current) => ({
        ...current,
        secondary: {
          ...current.secondary,
          isOpen: true,
          activeTabId: entry.tab.id,
          tabs: current.secondary.tabs.some((tab) => tab.id === entry.tab.id)
            ? current.secondary.tabs
            : [...current.secondary.tabs, entry.tab],
        },
      }));
      openCompactDrawer();
    },
    [
      dismissPluginDetails,
      clearActiveFileTabs,
      updateFixedPanelTabsState,
      openCompactDrawer,
    ],
  );
  const setFixedTabTarget = useSetFixedTabTarget();
  const panelDestinations = useMemo(
    () => [
      ...threadFixedTabs.entries.map((entry) => ({
        tab: entry.reference,
        panelTabId: () => entry.tab.id,
        open(target: JsonValue | undefined) {
          if (
            target !== undefined &&
            (threadId === undefined ||
              !setFixedTabTarget(
                getThreadFixedTabTargetKey(threadId, entry.reference),
                entry.slot.experimental_target,
                target,
              ))
          )
            return false;
          openRegisteredFixedTab(entry);
          return true;
        },
      })),
      ...threadFixedTabs.actions.map((action) =>
        createPanelActionDestination({
          action,
          openPluginPanel: (args) => {
            dismissPluginDetails();
            openPluginPanel(args);
            openCompactDrawer();
          },
        }),
      ),
    ],
    [
      dismissPluginDetails,
      threadFixedTabs.actions,
      threadFixedTabs.entries,
      openCompactDrawer,
      openPluginPanel,
      openRegisteredFixedTab,
      setFixedTabTarget,
      threadId,
    ],
  );
  const panel = useAppPanelController({
    activeTabId: isSecondaryPanelOpen ? activeFixedSecondaryTabId : null,
    close: closeSecondaryPanel,
    destinations: panelDestinations,
    isFocused,
  });
  const toggleSecondaryPanel = useCallback(() => {
    if (isSecondaryPanelOpen) panel.close();
    else toggleWorkspacePanel();
  }, [isSecondaryPanelOpen, panel, toggleWorkspacePanel]);
  const pluginPanelActions = usePluginPanelActions({
    panel,
    threadId,
    environmentId: threadTabEnvironmentId,
    actions: threadFixedTabs.actions,
  });
  const openThreadInfo = useCallback(
    () =>
      panel.openTab({
        tab: THREAD_INFO_FIXED_TAB_REFERENCE,
        availability: "fixed",
      }),
    [panel],
  );
  const openSecondaryPanelDiffFile = useCallback(
    (path: string) =>
      panel.openTab({
        tab: GIT_DIFF_TAB_REFERENCE,
        availability: "fixed",
        target: { kind: "file", path },
      }),
    [panel],
  );

  const handleSelectFileSearchResult = useCallback(
    (selection: FileSearchSelection) => {
      selectFileSearchResult(selection);
      openCompactDrawer();
    },
    [openCompactDrawer, selectFileSearchResult],
  );
  const handleActivateFileTab = useCallback(
    (tabId: string) => {
      activateTab(tabId);
      openCompactDrawer();
    },
    [activateTab, openCompactDrawer],
  );
  useDesktopBrowserReveal({
    threadId,
    isFocused,
    browserTabs,
    activateTab: handleActivateFileTab,
  });
  const handleSelectStorageBrowserPath =
    useCallback<ThreadStoragePathSelectHandler>(
      (path) => {
        openStorageFile({
          lineRange: null,
          path,
        });
      },
      [openStorageFile],
    );
  const storageBrowserController = useThreadStorageBrowser({
    files: threadStorageFiles?.files,
    onSelectPath: handleSelectStorageBrowserPath,
    selectedPath: activeStorageFilePath,
    threadId,
  });
  const [storedConversationCollapsed, setStoredConversationCollapsed] = useAtom(
    getThreadConversationCollapsedAtom(threadId),
  );
  const isConversationCollapsed = storedConversationCollapsed;
  const toggleConversationCollapse = useCallback(() => {
    setStoredConversationCollapsed((collapsed) => !collapsed);
  }, [setStoredConversationCollapsed]);
  const secondaryPanelFixedTabs = useMemo<
    readonly SecondaryPanelFixedTab[]
  >(() => {
    if (thread === undefined) return [];
    const order = new Map(
      fixedPanelTabsState.secondary.tabs.map((tab, index) => [tab.id, index]),
    );
    return [...threadFixedTabs.entries]
      .sort(
        (left, right) =>
          (order.get(left.tab.id) ?? Infinity) -
          (order.get(right.tab.id) ?? Infinity),
      )
      .map((entry) =>
        createThreadFixedTabDescriptor(
          entry,
          thread.id,
          threadTabEnvironment,
          (reference) => {
            panel.openTab({ tab: reference, availability: "fixed" });
          },
        ),
      );
  }, [
    threadTabEnvironment,
    fixedPanelTabsState.secondary.tabs,
    threadFixedTabs.entries,
    panel,
    thread,
  ]);
  const openAttachment = useCallback(
    (attachment: OpenAttachmentRequest) => {
      openTab({ kind: "attachment-file-preview", ...attachment });
      openCompactDrawer();
    },
    [openCompactDrawer, openTab],
  );
  const resolveMentionLink = useCallback<PromptMentionLinkResolver>(
    (resource) => {
      if (resource.kind === "thread") {
        const targetProjectId = resource.projectId ?? projectId;
        if (!targetProjectId) return null;
        return () =>
          navigateInPane({
            projectId: targetProjectId,
            threadId: resource.threadId,
          });
      }
      if (resource.kind === "project") {
        return () => navigate(getProjectComposeRoutePath(resource.projectId));
      }
      if (resource.kind === "attachment") {
        const attachmentProjectId = projectId;
        if (!attachmentProjectId) return null;
        return () =>
          openAttachment({
            name: resource.label,
            path: resource.path,
            projectId: attachmentProjectId,
          });
      }
      if (resource.kind !== "path" || resource.entryKind !== "file") {
        return null;
      }
      if (resource.source === "thread-storage") {
        return () =>
          openStorageFile({
            lineRange: null,
            path: resource.path,
          });
      }
      if (!thread?.environmentId) return null;
      return () =>
        openWorkspaceFile({
          lineRange: null,
          path: resource.path,
          source: { kind: "working-tree" },
          statusLabel: null,
        });
    },
    [
      openAttachment,
      navigate,
      navigateInPane,
      openStorageFile,
      openWorkspaceFile,
      projectId,
      thread?.environmentId,
    ],
  );
  const handleOpenNewTab = useCallback(() => {
    openNewTab();
    openCompactDrawer();
    setShouldAutoFocusNewTab(true);
  }, [openCompactDrawer, openNewTab]);
  useAppCommandHandler("panel.newTab", () => {
    if (!isFocused) return false;
    handleOpenNewTab();
    return true;
  });
  useAppCommandHandler("panel.reopenClosedTab", () => {
    if (!isFocused || !reopenClosedTab(pluginDetails)) return false;
    openCompactDrawer();
    return true;
  });
  useAppCommandHandler("file.quickOpen", () => {
    if (!isFocused) return false;
    if (
      isSecondaryPanelOpen &&
      pluginDetails.activePluginId === null &&
      activeFixedSecondaryTab?.kind === "new-tab"
    ) {
      panel.close();
    } else {
      handleOpenNewTab();
    }
    return true;
  });
  useEffect(() => {
    if (!isFocused) {
      return;
    }
    const desktopInfo = getBbDesktopInfo();
    if (
      desktopInfo === null ||
      desktopInfo.onAppCommand !== undefined ||
      desktopInfo.onOpenNewTab === undefined
    ) {
      return;
    }
    return desktopInfo.onOpenNewTab(handleOpenNewTab);
  }, [handleOpenNewTab, isFocused]);
  const acceptsThreadTerminal = useCallback(
    (session: TerminalSession) => session.threadId === threadId,
    [threadId],
  );
  const terminals = usePanelTerminals({
    panelStateId: threadId,
    syncThreadId: threadId,
    createTarget:
      canCreateTerminal && threadId !== undefined
        ? { kind: "thread", threadId }
        : null,
    isFocused,
    acceptsSession: acceptsThreadTerminal,
    tabsCarryTarget: false,
    reveal: openCompactDrawer,
    onCloseLastTab: secondaryPanelDrawerVisibility.closeDrawer,
  });
  const appNavigationCapabilities = useMemo(
    () => ({
      openFilePreview: openLiveFilePreview,
      panel,
      openTerminal: terminals.open,
    }),
    [openLiveFilePreview, panel, terminals.open],
  );
  const handleCloseWindowRequest = useCallback(() => {
    if (pluginDetails.activePluginId !== null) {
      pluginDetails.close(pluginDetails.activePluginId);
      return true;
    }
    if (!isSecondaryPanelOpen) {
      return false;
    }
    if (
      activeFixedSecondaryTab !== null &&
      isSecondaryFileTab(activeFixedSecondaryTab)
    ) {
      if (activeFixedSecondaryTab.kind === "terminal") {
        terminals.close(activeFixedSecondaryTab.terminalId);
      } else {
        closeTab(activeFixedSecondaryTab.id);
      }
      return true;
    }
    return panel.close();
  }, [
    activeFixedSecondaryTab,
    panel,
    closeTab,
    isSecondaryPanelOpen,
    pluginDetails,
    terminals,
  ]);
  useAppCommandHandler("panel.toggle", () => {
    if (!isFocused) return false;
    toggleSecondaryPanel();
    return true;
  });
  useAppCommandHandler("panel.fullScreen.toggle", () => {
    if (
      !isFocused ||
      !isSecondaryPanelOpen ||
      renderSecondaryPanelAsDrawer ||
      isPaneMaximized
    ) {
      return false;
    }
    toggleConversationCollapse();
    return true;
  });
  useAppCommandHandler("panel.close", () => {
    if (!isFocused) return false;
    return handleCloseWindowRequest();
  });
  useEffect(() => {
    if (!isFocused) {
      return;
    }
    const desktopInfo = getBbDesktopInfo();
    if (
      desktopInfo === null ||
      desktopInfo.onCloseWindowRequest === undefined
    ) {
      return;
    }
    return desktopInfo.onCloseWindowRequest(handleCloseWindowRequest);
  }, [handleCloseWindowRequest, isFocused]);
  const workspaceStatus = useGitWorkspaceStatus(threadEnvironmentId).workspace;
  const { isLocalDaemonHost } = useHostDaemon();
  const threadEnvironmentIsLocal = environment
    ? isLocalDaemonHost(environment.hostId)
    : false;
  const removedEnvironmentHostName =
    environment !== undefined && environment.hostLifecycle !== "active"
      ? (threadDetailBootstrapQuery.data?.environmentHostName ?? null)
      : null;
  const environmentDisplayHostContext = useMemo<EnvironmentDisplayHostContext>(
    () => ({
      locality: threadEnvironmentIsLocal ? "local" : "remote",
      identity: threadEnvironmentHost
        ? {
            name: threadEnvironmentHost.name,
            connected: threadEnvironmentHost.status === "connected",
          }
        : removedEnvironmentHostName
          ? {
              name: removedEnvironmentHostName,
              connected: false,
            }
          : null,
    }),
    [
      removedEnvironmentHostName,
      threadEnvironmentIsLocal,
      threadEnvironmentHost,
    ],
  );
  const workspacePreviewRootPath = environment?.path ?? null;
  const threadOpenContext = executionUnavailable
    ? null
    : resolveEnvironmentOpenContext({
        environment,
        serverOrigin: window.location.origin,
        threadEnvironmentIsLocal,
      });
  const {
    canOpenPreferredDirectoryTarget,
    directoryOpenTargets,
    fileOpenTargets,
    openPathInDirectoryTarget,
    openPathInFileTarget,
    openPathInPreferredDirectoryTarget,
    preferredDirectoryTarget,
  } = useLocalOpenTargets({
    enabled: threadOpenContext !== null,
    ...(threadOpenContext ? { openContext: threadOpenContext } : {}),
  });
  const parentThreadId = thread?.parentThreadId;
  const parentThreadDisplayName =
    parentThread?.title && parentThread.title.trim().length > 0
      ? parentThread.title
      : parentThreadId;
  const handleAssignParent = useCallback(
    (nextParentThreadId: string | null) => {
      if (!thread || updateThread.isPending) {
        return;
      }

      updateThread.mutate({
        id: thread.id,
        parentThreadId: nextParentThreadId,
      });
    },
    [thread, updateThread],
  );
  const handleTimelineLocalFileLinkResolution = useCallback(
    (
      resolution: ThreadLocalFileLinkResolution,
      options?: ThreadSecondaryPanelFileOpenOptions,
    ) => {
      if (resolution.kind === "app-route") {
        return false;
      }
      if (resolution.kind === "error") {
        appToast.error("Failed to open file locally", {
          description: resolution.description,
        });
        return true;
      }

      if (resolution.kind === "open-in-target") {
        void openPathInFileTarget({
          lineNumber: getFilePreviewLineRangeStart({
            lineRange: resolution.request.lineRange,
          }),
          path: resolution.request.path,
          rememberTarget: false,
          targetId: resolution.request.targetId,
        });
        return true;
      }

      if (resolution.kind === "open-workspace-path") {
        openWorkspaceFile(
          {
            lineRange: resolution.request.lineRange,
            path: resolution.request.relativePath,
            source: { kind: "working-tree" },
            statusLabel: null,
          },
          options,
        );
        return true;
      }

      if (resolution.kind === "open-thread-storage-path") {
        openStorageFile(
          {
            lineRange: resolution.request.lineRange,
            path: resolution.request.relativePath,
          },
          options,
        );
        return true;
      }

      openHostFile(
        {
          lineRange: resolution.request.lineRange,
          path: resolution.request.path,
        },
        options,
      );
      return true;
    },
    [openHostFile, openPathInFileTarget, openStorageFile, openWorkspaceFile],
  );
  const handleOpenTimelineLocalFileLink = useCallback(
    (
      link: ThreadTimelineLocalFileLink,
      options?: ThreadSecondaryPanelFileOpenOptions,
    ) => {
      return handleTimelineLocalFileLinkResolution(
        resolveThreadLocalFileLink({
          fileOpenTargetIds: fileOpenTargets.map((target) => target.id),
          hostFileLinksAvailable:
            thread?.environmentId !== null &&
            thread?.environmentId !== undefined,
          link,
          threadStorageRootPath,
          workspaceRootPath: workspacePreviewRootPath,
        }),
        options,
      );
    },
    [
      fileOpenTargets,
      handleTimelineLocalFileLinkResolution,
      thread?.environmentId,
      threadStorageRootPath,
      workspacePreviewRootPath,
    ],
  );
  const handleOpenTimelineLink = useCallback<ThreadTimelineLinkHandler>(
    ({ href }) => openBrowserUrl(href),
    [openBrowserUrl],
  );
  const handleTimelineTitleAction = useCallback<TimelineTitleActionResolver>(
    (action) => {
      switch (action.kind) {
        case "open-file-diff":
          return () => {
            openSecondaryPanelDiffFile(action.path);
          };
        case "open-plugin-side-chat":
          return () => {
            panel.openTab({
              tab: {
                ownerId: getThreadFixedTabOwnerId(SIDE_CHAT_PLUGIN_ID),
                tabId: SIDE_CHAT_PLUGIN_PANEL_ACTION_ID,
              },
              availability: "action",
              params: { threadId: action.threadId, sourceThreadId: threadId },
            });
          };
        default:
          return assertNever(action);
      }
    },
    [openSecondaryPanelDiffFile, panel, threadId],
  );
  const metadataStorage = useMemo(
    () =>
      resolvedThreadEnvironmentHost?.status === "connected"
        ? {
            controller: storageBrowserController,
            filesError: threadStorageFilesError,
          }
        : undefined,
    [
      resolvedThreadEnvironmentHost?.status,
      storageBrowserController,
      threadStorageFilesError,
    ],
  );
  const workspaceFileEnvironmentId = thread?.environmentId ?? null;
  const environmentHostId = environment?.hostId ?? null;
  const workspaceFileRoot = useMemo<LiveFileRoot | null>(
    () =>
      workspaceFileEnvironmentId
        ? { kind: "workspace", environmentId: workspaceFileEnvironmentId }
        : null,
    [workspaceFileEnvironmentId],
  );
  const storageFileRoot = useMemo<LiveFileRoot>(
    () => ({ kind: "thread-storage", threadId }),
    [threadId],
  );
  const hostFileRoot = useMemo<LiveFileRoot | null>(
    () =>
      environmentHostId ? { kind: "host", hostId: environmentHostId } : null,
    [environmentHostId],
  );
  const canOpenWorkspaceFile = useCanOpenFileExternally(workspaceFileRoot);
  const canOpenStorageFile = useCanOpenFileExternally(storageFileRoot);
  const canOpenHostFile = useCanOpenFileExternally(hostFileRoot);
  const { openFileExternally } = useAppNavigationHost();
  const handleOpenFileInEditor = useMemo(
    () =>
      buildOpenFileExternallyHandler({
        root: workspaceFileRoot,
        canOpenFileExternally: canOpenWorkspaceFile,
        openFileExternally,
        lineNumber: null,
      }),
    [canOpenWorkspaceFile, openFileExternally, workspaceFileRoot],
  );
  const handleOpenStorageFileInEditor = useMemo(
    () =>
      buildOpenFileExternallyHandler({
        root: storageFileRoot,
        canOpenFileExternally: canOpenStorageFile,
        openFileExternally,
        lineNumber: null,
      }),
    [canOpenStorageFile, openFileExternally, storageFileRoot],
  );
  const hostFileLineNumber = getFilePreviewLineRangeStart({
    lineRange: activeHostFileLineRange,
  });
  const handleOpenHostFileInEditor = useMemo(
    () =>
      buildOpenFileExternallyHandler({
        root: hostFileRoot,
        canOpenFileExternally: canOpenHostFile,
        openFileExternally,
        lineNumber: hostFileLineNumber,
      }),
    [canOpenHostFile, hostFileLineNumber, hostFileRoot, openFileExternally],
  );
  const workspaceOpenPath = executionUnavailable
    ? null
    : resolveThreadWorkspaceOpenPath({
        canOpenWorkspace: canOpenPreferredDirectoryTarget,
        environment,
        hasWorkspaceOpenTargets: directoryOpenTargets.length > 0,
      });
  useAppCommandHandler("workspace.openPreferred", () => {
    if (!isFocused) return false;
    if (activeWorkspaceFilePath && handleOpenFileInEditor) {
      handleOpenFileInEditor(activeWorkspaceFilePath);
      return true;
    }
    if (activeHostFilePath && handleOpenHostFileInEditor) {
      handleOpenHostFileInEditor(activeHostFilePath);
      return true;
    }
    if (activeStorageFilePath && handleOpenStorageFileInEditor) {
      handleOpenStorageFileInEditor(activeStorageFilePath);
      return true;
    }
    if (workspaceOpenPath && preferredDirectoryTarget) {
      void openPathInPreferredDirectoryTarget({
        lineNumber: null,
        path: workspaceOpenPath,
      });
      return true;
    }
    return false;
  });
  const getLocalFileContextMenuItems = useCallback(
    (link: ThreadTimelineLocalFileLink) => {
      const extension = getFileExtension(link.path);
      const matching =
        extension === null
          ? []
          : pluginFileOpeners.filter((opener) =>
              opener.extensions.includes(extension),
            );
      const lineNumber = getFilePreviewLineRangeStart({
        lineRange: link.lineRange,
      });
      const openTargetItems = fileOpenTargets.map((target) => ({
        id: `open-target:${target.id}`,
        label: buildOpenTargetMenuItemLabel(target),
        onSelect: () => {
          void openPathInFileTarget({
            lineNumber,
            path: link.path,
            rememberTarget: false,
            targetId: target.id,
          });
        },
      }));
      const items: MarkdownLocalFileContextMenuItem[] = [];
      if (openTargetItems.length > 0) {
        items.push({
          id: "open-in",
          items: openTargetItems,
          label: "Open in",
          type: "submenu",
        });
      }
      if (matching.length > 0) {
        if (items.length > 0) {
          items.push({ id: "open-with-separator", type: "separator" });
        }
        items.push(
          {
            id: "builtin",
            label: "Open with built-in preview",
            onSelect: () => {
              handleOpenTimelineLocalFileLink(link, { viewer: "builtin" });
            },
          },
          ...matching.map((opener) => ({
            id: `${opener.pluginId}:${opener.id}`,
            label: `Open with ${opener.title}`,
            onSelect: () => {
              handleOpenTimelineLocalFileLink(link, {
                viewer: { pluginId: opener.pluginId, openerId: opener.id },
              });
            },
          })),
        );
      }
      if (items.length > 0) {
        items.push({ id: "copy-separator", type: "separator" });
      }
      items.push(
        {
          id: "copy-path",
          label: "Copy file path",
          onSelect: () => {
            void copyToClipboardWithToast(link.path, {
              successMessage: "File path copied",
              errorMessage: "Failed to copy file path",
            });
          },
        },
        {
          id: "copy-name",
          label: "Copy file name",
          onSelect: () => {
            void copyToClipboardWithToast(getFileBasename(link.path), {
              successMessage: "File name copied",
              errorMessage: "Failed to copy file name",
            });
          },
        },
      );
      return items;
    },
    [
      fileOpenTargets,
      handleOpenTimelineLocalFileLink,
      openPathInFileTarget,
      pluginFileOpeners,
    ],
  );
  const handleOpenFilePreview = useCallback<OpenFilePreviewHandler>(
    (relativePath) => {
      if (
        thread?.environmentId === null ||
        thread?.environmentId === undefined
      ) {
        return;
      }
      openLiveFilePreview({
        target: {
          kind: "workspace",
          environmentId: thread.environmentId,
          path: relativePath,
        },
        location: null,
      });
    },
    [openLiveFilePreview, thread?.environmentId],
  );

  if (threadQueryState.status === "loading") {
    return (
      <RouteLoadingSkeleton isBoundedPane={isBoundedPane}>
        <ThreadTimelineLoadingSkeleton />
      </RouteLoadingSkeleton>
    );
  }
  if (!thread || thread.projectId !== projectId) {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-destructive">
          {error ? "Failed to load thread." : "Not found"}
        </p>
      </PageShell>
    );
  }
  const canAssignToParent = isThreadRoot;
  const canTakeOverThread = Boolean(thread.parentThreadId);
  const environmentProvisioningFailure =
    thread.status === "error" && thread.environmentId === null
      ? hasThreadProvisioningFailure(timeline.timelineRows)
      : false;
  const threadEnvironmentProviderLookup = findEnvironmentDisplayProvider(
    registeredEnvironmentProviders,
    environment?.environmentProviderId ?? null,
  );
  const threadEnvironmentDisplay = environment
    ? formatEnvironmentDisplay({
        environment,
        host: environmentDisplayHostContext,
        providerLookup: threadEnvironmentProviderLookup,
      })
    : undefined;
  const composerEnvironmentChrome = threadEnvironmentDisplay
    ? getEnvironmentSummaryChrome({
        display: threadEnvironmentDisplay,
        providerLookup: threadEnvironmentProviderLookup,
        hasMultipleMachines,
        host: resolvedThreadEnvironmentHost,
        machineProviders: registeredMachineProviders,
      })
    : undefined;
  const isThreadOnReusableEnvironment =
    !executionUnavailable &&
    environment !== undefined &&
    environment.status === "ready" &&
    environment.path !== null;
  const onCreateNewThreadInEnvironment =
    isThreadOnReusableEnvironment && projectId && thread.environmentId !== null
      ? createThreadInEnvironment
      : undefined;
  const threadCheckoutDisplay = workspaceStatus
    ? formatWorkspaceCheckoutDisplay({ checkout: workspaceStatus.checkout })
    : undefined;
  const threadTitle = getThreadDisplayTitle(thread);
  const responsiveWorkspaceActions: PluginThreadActionsInlineItem[] =
    workspaceOpenPath && preferredDirectoryTarget
      ? [
          preferredDirectoryTarget,
          ...directoryOpenTargets.filter(
            (target) => target.id !== preferredDirectoryTarget.id,
          ),
        ].map((target) => ({
          key: `workspace/${target.id}`,
          group: THREAD_HEADER_ACTIONS_GROUP,
          action: {
            icon: "FolderOpen",
            label: `Open workspace in ${target.label}`,
            run: async () => {
              if (target.id === preferredDirectoryTarget.id) {
                await openPathInPreferredDirectoryTarget({
                  lineNumber: null,
                  path: workspaceOpenPath,
                });
                return;
              }
              await openPathInDirectoryTarget({
                lineNumber: null,
                path: workspaceOpenPath,
                rememberTarget: true,
                targetId: target.id,
              });
            },
          },
        }))
      : [];
  const showGitChanges =
    systemConfigQuery.data?.generalSettings.showGitChanges ?? false;
  const threadActionTarget = toThreadActionTarget(
    thread,
    isThreadOnReusableEnvironment && thread.environmentId !== null
      ? { id: thread.environmentId, path: environment.path }
      : null,
  );
  const workspaceOpenButton =
    workspaceOpenPath && preferredDirectoryTarget ? (
      <ThreadWorkspaceOpenButton
        preferredTarget={preferredDirectoryTarget}
        targets={directoryOpenTargets}
        onOpenPreferredTarget={async () => {
          await openPathInPreferredDirectoryTarget({
            lineNumber: null,
            path: workspaceOpenPath,
          });
        }}
        onOpenTarget={async (targetId) => {
          await openPathInDirectoryTarget({
            lineNumber: null,
            path: workspaceOpenPath,
            rememberTarget: true,
            targetId,
          });
        }}
      />
    ) : undefined;
  const timelineHeader = (
    <ThreadDetailHeader
      actionsMenu={({
        includeResponsiveActions,
        headerActions,
        requestRename,
        onCloseAutoFocus,
      }) => (
        <ThreadActionsMenu
          thread={threadActionTarget}
          trigger={(triggerProps) => (
            <Button
              {...triggerProps}
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                triggerProps.className,
                "rounded-md p-0",
                "data-[state=open]:bg-state-active data-[state=open]:text-foreground",
                HEADER_ICON_BUTTON_CLASS,
              )}
              aria-label="Thread actions"
              onClick={(event) => {
                triggerProps.onClick?.(event);
                event.stopPropagation();
              }}
            >
              <Icon
                name="MoreHorizontal"
                className={COARSE_POINTER_ICON_SIZE_CLASS}
              />
            </Button>
          )}
          inline={
            includeResponsiveActions
              ? [
                  ...responsiveWorkspaceActions,
                  ...headerActions.map(
                    ({ key, action }): PluginThreadActionsInlineItem => ({
                      key,
                      group: THREAD_HEADER_ACTIONS_GROUP,
                      action: { ...action, run: () => action.run() },
                    }),
                  ),
                ]
              : []
          }
          requestRename={requestRename}
          onCloseAutoFocus={onCloseAutoFocus}
        />
      )}
      isSecondaryPanelOpen={isSecondaryPanelOpen}
      onClosePane={onRequestClose ?? undefined}
      onToggleSecondaryPanel={toggleSecondaryPanel}
      pluginActions={
        <PluginThreadHeaderActions
          threadId={thread.id}
          projectId={thread.projectId}
        />
      }
      thread={threadActionTarget}
      threadTitle={threadTitle}
      workspaceOpenButton={workspaceOpenButton}
    />
  );
  const threadScreen = (
    <ThreadScreen
      composer={{
        environmentCheckout: threadCheckoutDisplay,
        environmentChrome: composerEnvironmentChrome,
        contextEnvironmentId: showGitChanges ? threadEnvironmentId : null,
        onCreateNewThreadInEnvironment,
        onOpenThreadInfo: openThreadInfo,
        permissionPolicy: "editable",
      }}
      environment={environment ?? null}
      presentation={THREAD_DETAIL_SCREEN_PRESENTATION}
      projectId={projectId}
      resolveMentionLink={resolveMentionLink}
      thread={thread}
      timeline={timeline}
      timelineHost={{
        environmentHostName: threadEnvironmentHost?.name ?? null,
        includePluginMessageActions: true,
        onForkMessage: isForkAvailable ? handleForkMessage : undefined,
        onOpenLink: handleOpenTimelineLink,
        onOpenLocalFileLink: handleOpenTimelineLocalFileLink,
        onTitleAction: handleTimelineTitleAction,
        unreadDividerAutoScroll: unreadDividerState.autoScroll,
        unreadDividerPlacement: unreadDividerState.placement,
      }}
      workspaceRootPath={environment?.path ?? undefined}
    />
  );
  const renderSecondaryTabContent = (
    tab: SecondaryFileFixedPanelTab,
  ): ReactNode => {
    switch (tab.kind) {
      case "browser":
        return null;
      case "terminal":
        return (
          <LazyThreadTerminalPanel
            autoFocus={
              tab.id === activeFixedSecondaryTabId &&
              tab.terminalId === terminals.autoFocusTerminalId
            }
            isPanelOpen={isSecondaryPanelOpen}
            isPanelPersistedOpen={isPersistedSecondaryPanelOpen}
            onAutoFocusHandled={terminals.handleAutoFocusHandled}
            onCloseStart={() => terminals.close(tab.terminalId)}
            onOpenLink={handleOpenTimelineLink}
            onRetryStart={() => terminals.retryStart(tab.terminalId)}
            onSelectionAddToChat={handleSelectionAddToChat}
            target={{ kind: "thread", threadId: thread.id }}
            terminalId={tab.terminalId}
          />
        );
      case "new-tab":
        return (
          <LazyNewTabPage
            autoFocus={
              tab.id === activeFixedSecondaryTabId && shouldAutoFocusNewTab
            }
            projectId={projectId ?? undefined}
            environmentId={thread.environmentId ?? null}
            currentThreadId={thread.id}
            onAutoFocusHandled={handleNewTabAutoFocusHandled}
            onSelect={handleSelectFileSearchResult}
            onOpenBrowser={() => {
              activateTab(tab.id);
              openBrowser?.();
            }}
            onStartTerminal={
              canCreateTerminal
                ? () => {
                    activateTab(tab.id);
                    terminals.start();
                  }
                : undefined
            }
            pluginActions={pluginPanelActions}
          />
        );
      case "workspace-file-preview": {
        const copyPath = resolveAbsoluteFilePath({
          path: tab.path,
          rootPath: workspacePreviewRootPath,
        });
        return (
          <LazyWorkspaceFilePreviewTabContent
            activePath={tab.path}
            copyPath={copyPath}
            environmentId={tab.environmentId}
            isPanelOpen={isSecondaryPanelOpen}
            lineRange={tab.lineRange}
            markdownLinkRouting={buildMarkdownPreviewLinkRouting({
              baseDir: copyPath
                ? getAbsoluteDirname({ path: copyPath })
                : undefined,
              onOpenLink: handleOpenTimelineLink,
              onOpenLocalFileLink: handleOpenTimelineLocalFileLink,
              rootPath: workspacePreviewRootPath,
            })}
            onOpenInEditor={handleOpenFileInEditor}
            onSelectionAddToChat={handleSelectionAddToChat}
            source={tab.source}
            threadId={thread.id}
          />
        );
      }
      case "host-file-preview": {
        const baseDir = getAbsoluteDirname({ path: tab.path });
        return (
          <LazyHostFilePreviewTabContent
            activePath={tab.path}
            copyPath={tab.path}
            environmentId={tab.environmentId}
            isPanelOpen={isSecondaryPanelOpen}
            lineRange={tab.lineRange}
            markdownLinkRouting={buildMarkdownPreviewLinkRouting({
              baseDir,
              onOpenLink: handleOpenTimelineLink,
              onOpenLocalFileLink: handleOpenTimelineLocalFileLink,
              rootPath: resolveHostFilePreviewLinkRootPath({
                baseDir,
                threadStorageRootPath,
                workspaceRootPath: workspacePreviewRootPath,
              }),
            })}
            onOpenInEditor={handleOpenHostFileInEditor}
            onSelectionAddToChat={handleSelectionAddToChat}
            threadId={thread.id}
          />
        );
      }
      case "attachment-file-preview":
        return (
          <LazyAttachmentFilePreviewTabContent
            isPanelOpen={isSecondaryPanelOpen}
            name={tab.name}
            onSelectionAddToChat={handleSelectionAddToChat}
            path={tab.path}
            projectId={tab.projectId}
          />
        );
      case "thread-storage-file-preview": {
        const copyPath = resolveAbsoluteFilePath({
          path: tab.path,
          rootPath: threadStorageRootPath,
        });
        return (
          <LazyThreadStorageFilePreviewTabContent
            activePath={tab.path}
            copyPath={copyPath}
            isPanelOpen={isSecondaryPanelOpen}
            lineRange={tab.lineRange}
            markdownLinkRouting={buildMarkdownPreviewLinkRouting({
              baseDir: copyPath
                ? getAbsoluteDirname({ path: copyPath })
                : undefined,
              onOpenLink: handleOpenTimelineLink,
              onOpenLocalFileLink: handleOpenTimelineLocalFileLink,
              rootPath: threadStorageRootPath,
            })}
            onOpenInEditor={handleOpenStorageFileInEditor}
            onSelectionAddToChat={handleSelectionAddToChat}
            threadId={thread.id}
          />
        );
      }
      case "plugin-panel": {
        const originalTab = createFileOpenerOriginalTab(tab);
        const fileOpenerOriginal =
          originalTab === null
            ? undefined
            : renderSecondaryTabContent(originalTab);
        return (
          <ThreadTimelineNavigationProvider
            environmentId={thread.environmentId}
            onOpenLink={handleOpenTimelineLink}
            onOpenLocalFileLink={handleOpenTimelineLocalFileLink}
            resolveMentionLink={resolveMentionLink}
            threadId={thread.id}
            workspaceRootPath={environment?.path ?? undefined}
          >
            <PluginPanelTabContent
              tab={tab}
              context={{
                kind: "thread",
                threadId: thread.id,
                environment: threadTabEnvironment,
              }}
              fileOpenerOriginal={fileOpenerOriginal}
            />
          </ThreadTimelineNavigationProvider>
        );
      }
    }
  };
  const filenameOfPanelTab = (path: string) => path.split("/").at(-1) ?? path;
  const panelTabs: readonly SecondaryPanelRenderableTab[] =
    syncedOrderedSecondaryFileTabs.map((tab): SecondaryPanelRenderableTab => {
      const pluginAction =
        tab.kind === "plugin-panel"
          ? registeredThreadActions.find(
              (action) =>
                action.pluginId === tab.pluginId && action.id === tab.actionId,
            )
          : undefined;
      const shared = {
        contentFillsRegion:
          tab.kind === "plugin-panel" &&
          (tab.fileOpenerOwner !== undefined ||
            pluginAction?.layout === "flush"),
        onClose: () => closeTab(tab.id),
        renderContent: () => renderSecondaryTabContent(tab),
        tab,
      };
      switch (tab.kind) {
        case "browser": {
          const browserLabel =
            tab.title ?? (tab.url.length > 0 ? getBrowserUrlHost(tab.url) : "");
          return {
            ...shared,
            label: browserLabel.length > 0 ? browserLabel : "Browser",
            leadingVisual: (
              <BrowserTabIcon
                tabId={tab.id}
                className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
              />
            ),
            statusLabel: null,
            onSelect: () => handleActivateFileTab(tab.id),
          };
        }
        case "terminal": {
          const session = terminalsById.get(tab.terminalId);
          return {
            ...shared,
            label: session?.title ?? "Terminal",
            leadingVisual: (
              <Icon
                name="Terminal"
                className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
                aria-hidden
              />
            ),
            statusLabel:
              session === undefined || session.status === "running"
                ? null
                : session.status,
            onSelect: () => terminals.select(tab.terminalId),
            onClose: () => terminals.close(tab.terminalId),
          };
        }
        case "workspace-file-preview":
          return {
            ...shared,
            label: filenameOfPanelTab(tab.path),
            leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
            statusLabel: getEnvironmentFilePreviewSourceRef(tab.source),
            onSelect: () => handleActivateFileTab(tab.id),
          };
        case "host-file-preview":
          return {
            ...shared,
            label: filenameOfPanelTab(tab.path),
            leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
            statusLabel: null,
            onSelect: () => handleActivateFileTab(tab.id),
          };
        case "thread-storage-file-preview":
          return {
            ...shared,
            label: filenameOfPanelTab(tab.path),
            isPinned: tab.isPinned,
            leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
            statusLabel: null,
            onSelect: () => handleActivateFileTab(tab.id),
          };
        case "attachment-file-preview":
          return {
            ...shared,
            label: tab.name,
            leadingVisual: <RightPanelFileTabIcon path={tab.name} />,
            statusLabel: null,
            onSelect: () => handleActivateFileTab(tab.id),
          };
        case "new-tab":
          return {
            ...shared,
            label: "New tab",
            leadingVisual: (
              <Icon
                name="NewTab"
                className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
                aria-hidden
              />
            ),
            statusLabel: null,
            onSelect: () => handleActivateFileTab(tab.id),
          };
        case "plugin-panel":
          return {
            ...shared,
            label: tab.title,
            leadingVisual: (
              <PluginItemIcon
                pluginId={tab.pluginId}
                icon={pluginAction?.icon ?? null}
                className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
              />
            ),
            statusLabel: null,
            onSelect: () => handleActivateFileTab(tab.id),
          };
      }
    });
  const threadDetailContent = (
    <MarkdownLocalFileContextMenuContext.Provider
      value={getLocalFileContextMenuItems}
    >
      <BrowserTabLifecycleObserver
        browserTabs={browserTabs}
        threadId={thread.id}
      />
      <UrlOpenRoutingProvider openInAppBrowser={openBrowser}>
        <AppNavigationHostProvider capabilities={appNavigationCapabilities}>
          {threadFixedTabs.observers}
          <ThreadDetailSecondaryContent
            header={timelineHeader}
            main={threadScreen}
            isMetadataLoading={
              !hasThreadDetailBootstrapSettled || environmentQuery.isLoading
            }
            isSecondaryPanelOpen={isSecondaryPanelOpen}
            isConversationCollapsed={isConversationCollapsed}
            isBoundedPane={isBoundedPane}
            onToggleSecondaryPanel={toggleSecondaryPanel}
            onToggleConversationCollapse={toggleConversationCollapse}
            renderHostedPanel={(panel) => (
              <MarkdownLocalFileContextMenuContext.Provider
                value={getLocalFileContextMenuItems}
              >
                <MarkdownLocalFileOpenTargetsContext.Provider
                  value={fileOpenTargets}
                >
                  <UrlOpenRoutingProvider openInAppBrowser={openBrowser}>
                    {panel}
                  </UrlOpenRoutingProvider>
                </MarkdownLocalFileOpenTargetsContext.Provider>
              </MarkdownLocalFileContextMenuContext.Provider>
            )}
            metadata={{
              thread,
              projectId,
              parentThreadProjectId: parentThread?.projectId ?? null,
              parentThreadDisplayName: parentThreadDisplayName ?? null,
              parentThreads,
              canAssignToParent,
              canTakeOverThread,
              isLoadingParentThreads: parentThreadSubsetQuery.isLoading,
              isParentThreadsError: parentThreadSubsetQuery.isError,
              environment: environment ?? null,
              environmentProvisioningFailure,
              environmentDisplayHost: environmentDisplayHostContext,
              threadEnvironmentId: threadTabEnvironmentId,
              updateThreadPending:
                updateThread.isPending || updateEnvironment.isPending,
              storage: metadataStorage,
              onAssignParent: handleAssignParent,
              onParentSelectorOpenChange: handleParentSelectorOpenChange,
              onRetryParentThreads: handleRetryParentThreads,
            }}
            secondaryPanel={{
              canNavigateTabs: isFocused,
              activeTab: activeFixedSecondaryTab,
              areFixedTabsReady: threadFixedTabs.isReady,
              environmentId: thread.environmentId ?? undefined,
              workspaceRootPath: environment?.path,
              tabs: panelTabs,
              fixedTabs: secondaryPanelFixedTabs,
              splitPanelStateId: thread.id,
              renderBrowserDeck,
              isOpen: isSecondaryPanelOpen,
              showFullScreenShortcut: true,
              onClose: panel.close,
              onCollapse: panel.close,
              onOpenFileInEditor: handleOpenFileInEditor,
              onTabReorder: reorderTab,
              onOpenNewTab: handleOpenNewTab,
              onOpenFilePreview: handleOpenFilePreview,
              onSelectionAddToChat: handleSelectionAddToChat,
              onPanelFocus: touchFixedPanelTabsState,
            }}
          />
        </AppNavigationHostProvider>
      </UrlOpenRoutingProvider>
    </MarkdownLocalFileContextMenuContext.Provider>
  );
  return (
    <>
      <PaneThreadActionCommandHandler thread={threadActionTarget} />
      <ThreadProviderContext.Provider value={threadProviderContextValue}>
        <PluginDetailPanelContext.Provider value={pluginDetails}>
          <MarkdownLocalFileOpenTargetsContext.Provider value={fileOpenTargets}>
            <AttachmentOpenerContext.Provider value={openAttachment}>
              <SelectionAddToChatContext.Provider
                value={handleSelectionAddToChat}
              >
                {threadDetailContent}
              </SelectionAddToChatContext.Provider>
            </AttachmentOpenerContext.Provider>
          </MarkdownLocalFileOpenTargetsContext.Provider>
        </PluginDetailPanelContext.Provider>
      </ThreadProviderContext.Provider>
    </>
  );
}
