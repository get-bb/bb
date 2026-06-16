import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import type {
  ThreadTimelineLinkHandler,
  ThreadTimelineLocalFileLink,
  ThreadTimelineLocalFileLinkHandler,
  TimelineTitleActionResolver,
} from "@/components/thread/timeline";
import {
  isActiveTerminalSessionStatus,
  resolveEnvironmentMergeBaseBranch,
  type ThreadListEntry,
  type ThreadWithRuntime,
} from "@bb/domain";
import type { TerminalSession } from "@bb/server-contract";
import { appToast } from "@/components/ui/app-toast";
import type { ThreadSecondaryPanel as ThreadSecondaryPanelTab } from "@/lib/thread-secondary-panel";
import { useRequestEnvironmentAction } from "../../hooks/mutations/environment-mutations";
import {
  useMarkThreadRead,
  useUpdateThread,
} from "../../hooks/mutations/thread-state-mutations";
import { useSendThreadMessage } from "../../hooks/mutations/thread-runtime-mutations";
import { useUpdateEnvironment } from "../../hooks/mutations/environment-mutations";
import {
  useEnvironment,
  useEnvironmentPullRequest,
  useEnvironmentWorkStatus,
} from "../../hooks/queries/environment-queries";
import {
  getLatestPendingInteraction,
  useProjectThreadSubset,
  useThread,
  useThreadDetailBootstrap,
  useThreadPendingInteractions,
  useThreadSchedules,
  type ProjectThreadSubsetFilters,
} from "../../hooks/queries/thread-queries";
import { useThreadComposerBootstrap } from "../../hooks/queries/thread-composer-bootstrap-query";
import { ThreadGitActionDialog } from "@/components/dialogs/ThreadGitActionDialog";
import { PageShell } from "@/components/ui/page-shell.js";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import { ThreadActionsMenu } from "@/components/thread/ThreadActionsMenu";
import { ThreadWorkspaceOpenButton } from "@/components/thread/ThreadWorkspaceOpenButton";
import {
  formatEnvironmentDisplay,
  type EnvironmentDisplayHostContext,
} from "@bb/core-ui";
import { assertNever } from "@bb/thread-view";
import { useCreateThreadInWorktree } from "@/hooks/useCreateThreadInWorktree";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import { useConnectionAwareQueryState } from "@/hooks/queries/connection-aware-query-state";
import {
  useCloseThreadTerminal,
  useCreateThreadTerminal,
  useThreadTerminals,
} from "@/hooks/queries/thread-terminal-queries";
import { getEnvironmentWorkspaceLabelIconName } from "@/lib/environment-workspace-display";
import { formatWorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";
import {
  getAbsoluteDirname,
  isAbsoluteFilePathWithinRoot,
  resolveAbsoluteFilePath,
} from "@/lib/absolute-file-path";
import { getGitStatusDisplay } from "@/components/workspace/workspace-status";
import {
  selectWorkspaceChangedFilesSection,
  type WorkspaceChangedFileSelection,
} from "@/components/workspace/workspace-change-summary";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import {
  getSurfaceAwareThreadRoutePath,
  isRoutePath,
  type ThreadRoutePathArgs,
} from "@/lib/route-paths";
import { useGitDiffPanel } from "@/components/secondary-panel/git-diff/useGitDiffPanel";
import { ThreadDetailHeader } from "./ThreadDetailHeader";
import { ThreadDetailPromptArea } from "./ThreadDetailPromptArea";
import {
  type ContextBannerMergeBaseConfig,
  isThreadDisplayStatusBannerActive,
  type ThreadPromptParentThreadSection,
  type ThreadPromptChildThreadsSection,
} from "@/components/promptbox/banner/ThreadPromptContextBanner";
import { ThreadDetailSecondaryContent } from "./ThreadDetailSecondaryContent";
import {
  useThreadSecondaryPanelVisibility,
  type ThreadSecondaryPanelHostFileOpenHandler,
  type ThreadSecondaryPanelStorageFileOpenHandler,
  type ThreadSecondaryPanelWorkspaceFileOpenHandler,
} from "./useThreadSecondaryPanelVisibility";
import type { HostConnectionNotice } from "./ThreadTimelinePane";
import { useThreadStorageViewer } from "@/components/secondary-panel/useThreadStorageViewer";
import { getThreadConversationCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import {
  HostFilePreviewTabContent,
  ThreadStorageFilePreviewTabContent,
  WorkspaceFilePreviewTabContent,
} from "@/components/secondary-panel/ThreadSecondaryPanelTabContent";
import { BrowserTabDeck } from "@/components/secondary-panel/BrowserTabDeck";
import { NewTabPage } from "@/components/secondary-panel/NewTabPage";
import { resolveRightPanelFileVisual } from "@/components/secondary-panel/rightPanelFileVisuals";
import { COARSE_POINTER_COMPACT_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { Icon } from "@/components/ui/icon.js";
import {
  getDesktopBrowserApi,
  isDesktopBrowserAvailable,
  MACOS_APP_REGION_NO_DRAG_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
} from "@/lib/bb-desktop";
import {
  resolveChatLinkOpenTarget,
  useOpenLinksInAppBrowserPreference,
} from "@/lib/in-app-browser-link-preference";
import { getFilePreviewLineRangeStart } from "@/lib/file-preview";
import { getBrowserUrlHost } from "@/lib/browser-url";
import {
  useThreadStorageBrowser,
  type ThreadStoragePathSelectHandler,
} from "@/components/secondary-panel/useThreadStorageBrowser";
import { useThreadFileTabs } from "@/components/secondary-panel/useThreadFileTabs";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import type { SecondaryPanelFileTab } from "@/components/secondary-panel/ThreadSecondaryPanel";
import { useEnvironmentMergeBase } from "@/components/secondary-panel/git-diff/useEnvironmentMergeBase";
import { useThreadGitActions } from "./useThreadGitActions";
import { useThreadReadTracking } from "./useThreadReadTracking";
import { useThreadUnreadDividerState } from "./useThreadUnreadDividerState";
import { useThreadTimelinePages } from "./useThreadTimelinePages";
import {
  buildTerminalSyncedSecondaryFileTabs,
  findActiveTerminalIdInSecondaryFileTabs,
  syncTerminalTabsInFixedPanelState,
} from "./threadTerminalTabs";
import {
  buildOpenInEditorHandler,
  resolveWorkspaceChangedFileOpenTarget,
  resolveThreadLocalWorkspaceRootPath,
  resolveThreadWorkspacePreviewRootPath,
  resolveThreadWorkspaceOpenPath,
} from "./threadWorkspaceOpenPath";
import {
  resolveThreadLocalFileLink,
  type ThreadLocalFileLinkResolution,
} from "@/lib/thread-local-file-links";
import type {
  MarkdownLinkRouting,
  MarkdownLocalFileLinkRouting,
} from "@/components/ui/markdown-link-routing";
import {
  useFixedPanelTabsState,
  useFixedPanelTabsStorageMaintenance,
  useRemoveFixedRightTerminalTab,
  useSetFixedRightTerminalActiveTerminal,
  useTouchFixedPanelTabsState,
  useUpdateFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
import { createNewTabFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import {
  buildParentSelectorOptions,
  isRootThread,
} from "./threadParentSelectorOptions";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { ThreadTerminalPanel } from "@/components/thread/terminal/ThreadTerminalPanel";
import {
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  terminalStatusLabel,
} from "@/components/thread/terminal/useThreadTerminalController";
import {
  getActiveFixedSecondaryTab,
  getOpenFixedSecondaryTab,
  useSetThreadSecondaryPanelSelection,
  useToggleThreadSecondaryPanelSelection,
} from "./threadSecondaryPanelSelection";
import { useRouteState } from "@/hooks/useRouteState";
import { resolveThreadComposerBootstrapReady } from "./threadDetailComposerBootstrapState";

const EMPTY_PARENT_THREADS: readonly ThreadListEntry[] = [];
const EMPTY_PROJECT_THREAD_SUBSET_FILTERS =
  {} satisfies ProjectThreadSubsetFilters;
const EMPTY_TERMINAL_SESSIONS: readonly TerminalSession[] = [];

type MergeBasePickerOpenChangeHandler = NonNullable<
  ContextBannerMergeBaseConfig["onPickerOpenChange"]
>;
type SecondaryPanelChangeHandler = (panel: ThreadSecondaryPanelTab) => void;
type NullableSecondaryPanelChangeHandler = (
  panel: ThreadSecondaryPanelTab | null,
) => void;
type OpenInEditorHandler = NonNullable<
  ReturnType<typeof buildOpenInEditorHandler>
>;
type OpenFilePreviewHandler = (relativePath: string) => void;

interface RightPanelFileTabIconProps {
  path: string;
}

interface ThreadDetailViewPageProps {
  surface: "page";
}

interface ThreadDetailViewPopoutProps {
  onPopoutHide: () => void;
  onPopoutNewQuickThread: () => void;
  onPopoutOpenInMain: (thread: ThreadRoutePathArgs) => void;
  surface: "popout";
}

type ThreadDetailViewProps =
  | ThreadDetailViewPageProps
  | ThreadDetailViewPopoutProps;

interface PopoutThreadHeaderProps {
  onHide: () => void;
  onNewQuickThread: () => void;
  onOpenInMain: () => void;
  threadTitle: string;
}

function RightPanelFileTabIcon({ path }: RightPanelFileTabIconProps) {
  const visual = resolveRightPanelFileVisual({ path });
  return (
    <Icon
      name={visual.iconName}
      className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
      aria-hidden
    />
  );
}

function PopoutThreadHeader({
  onHide,
  onNewQuickThread,
  onOpenInMain,
  threadTitle,
}: PopoutThreadHeaderProps) {
  const buttonClassName = [
    "inline-flex items-center justify-center text-muted-foreground",
    "transition-colors hover:bg-state-hover hover:text-foreground",
    HEADER_ICON_BUTTON_CLASS,
    MACOS_APP_REGION_NO_DRAG_CLASS,
  ].join(" ");

  return (
    <div
      className={[
        MACOS_WINDOW_DRAG_CLASS,
        "flex h-10 shrink-0 items-center gap-1",
        "border-b border-border-seam-vertical px-2",
      ].join(" ")}
    >
      <button
        type="button"
        className={buttonClassName}
        aria-label="Hide popout"
        title="Hide popout"
        onClick={onHide}
      >
        <Icon name="X" />
      </button>
      <p className="min-w-0 flex-1 truncate px-1 text-sm font-semibold">
        {threadTitle}
      </p>
      <button
        type="button"
        className={buttonClassName}
        aria-label="New quick thread"
        title="New quick thread"
        onClick={onNewQuickThread}
      >
        <Icon name="EditFile" />
      </button>
      <button
        type="button"
        className={buttonClassName}
        aria-label="Open in main app"
        title="Open in main app"
        onClick={onOpenInMain}
      >
        <Icon name="ExternalLink" />
      </button>
    </div>
  );
}

interface BuildMarkdownPreviewLinkRoutingArgs {
  baseDir: string | undefined;
  onOpenLink: ThreadTimelineLinkHandler;
  onOpenLocalFileLink: ThreadTimelineLocalFileLinkHandler;
  rootPath: string | null | undefined;
}

export interface ResolveHostFilePreviewLinkRootPathArgs {
  baseDir: string | undefined;
  threadStorageRootPath: string | null;
  workspaceRootPath: string | null;
}

function buildHostConnectionNotice(
  thread: ThreadWithRuntime,
): HostConnectionNotice | null {
  const displayStatus = thread.runtime.displayStatus;
  if (
    displayStatus !== "host-reconnecting" &&
    displayStatus !== "waiting-for-host"
  ) {
    return null;
  }

  return {
    label:
      displayStatus === "host-reconnecting"
        ? "Host disconnected. Waiting for reconnection..."
        : "Host disconnected",
    tone: displayStatus === "host-reconnecting" ? "pending" : "error",
  };
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

export function resolveHostFilePreviewLinkRootPath({
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

export function ThreadDetailView(props: ThreadDetailViewProps) {
  const { projectId, threadId } = useRouteState();
  const navigate = useNavigate();
  useFixedPanelTabsStorageMaintenance(threadId);
  const fixedPanelTabsState = useFixedPanelTabsState(threadId);
  const isPersistedSecondaryPanelOpen = fixedPanelTabsState.secondary.isOpen;
  const isPersistedSecondaryPanelOpenForSurface =
    props.surface === "popout" ? false : isPersistedSecondaryPanelOpen;
  const activeFixedSecondaryTab = getActiveFixedSecondaryTab({
    fixedPanelTabsState,
  });
  const openFixedSecondaryTab = getOpenFixedSecondaryTab({
    activeFixedSecondaryTab,
    isSecondaryPanelOpen: isPersistedSecondaryPanelOpenForSurface,
  });
  const activeFixedSecondaryTabId = activeFixedSecondaryTab?.id ?? null;
  const renderSecondaryPanelAsDrawer = useIsCompactViewport();
  const touchFixedPanelTabsState = useTouchFixedPanelTabsState(threadId);
  const setActiveFixedTerminal =
    useSetFixedRightTerminalActiveTerminal(threadId);
  const removeFixedTerminalTab = useRemoveFixedRightTerminalTab(threadId);
  const updateFixedPanelTabsState = useUpdateFixedPanelTabsState(threadId);
  const setThreadSecondaryPanel = useSetThreadSecondaryPanelSelection(threadId);
  const setThreadSecondaryPanelForSurface =
    useCallback<NullableSecondaryPanelChangeHandler>(
      (panel) => {
        if (props.surface === "popout") {
          return;
        }
        setThreadSecondaryPanel(panel);
      },
      [props.surface, setThreadSecondaryPanel],
    );
  const toggleDefaultPersistedSecondaryPanel =
    useToggleThreadSecondaryPanelSelection(threadId);
  const threadDetailBootstrapQuery = useThreadDetailBootstrap(threadId ?? "");
  const hasThreadDetailBootstrapSettled =
    threadDetailBootstrapQuery.isSuccess || threadDetailBootstrapQuery.isError;
  const {
    data: thread,
    isFetching,
    isLoadingError,
    error,
  } = useThread(threadId ?? "", {
    enabled: hasThreadDetailBootstrapSettled,
    refetchOnMount: threadDetailBootstrapQuery.isSuccess ? true : "always",
  });
  // Treat placeholder data (a full thread row primed from the sidebar list
  // cache) as resolved so switching to an uncached thread renders the shell
  // immediately instead of flashing a full-page "Loading..." while the
  // bootstrap request is in flight. The timeline pane shows its own loading
  // state as content streams in.
  const threadQueryState = useConnectionAwareQueryState({
    hasResolvedData: thread !== undefined,
    isFetching: threadDetailBootstrapQuery.isFetching || isFetching,
    isLoadingError,
  });
  const threadComposerBootstrapQuery = useThreadComposerBootstrap(
    thread?.id ?? "",
    {
      enabled: threadQueryState.status === "ready" && Boolean(thread?.id),
      environmentId: thread?.environmentId ?? undefined,
      providerId: thread?.providerId,
    },
  );
  const hasThreadComposerBootstrapData =
    threadComposerBootstrapQuery.data !== undefined;
  const hasThreadComposerBootstrapReady = resolveThreadComposerBootstrapReady({
    hasData: hasThreadComposerBootstrapData,
    isError: threadComposerBootstrapQuery.isError,
    isFetching: threadComposerBootstrapQuery.isFetching,
    isSuccess: threadComposerBootstrapQuery.isSuccess,
  });
  const composerQueryThreadId = hasThreadComposerBootstrapReady
    ? (thread?.id ?? "")
    : "";
  const composerHydratedDataStaleTime = hasThreadComposerBootstrapData
    ? 10_000
    : undefined;
  const { data: parentThread } = useThread(thread?.parentThreadId ?? "");
  const { data: pendingInteractions = [] } = useThreadPendingInteractions(
    composerQueryThreadId,
    {
      enabled: hasThreadComposerBootstrapReady,
      staleTime: composerHydratedDataStaleTime,
    },
  );
  const { data: threadSchedules = [] } = useThreadSchedules(thread?.id ?? "", {
    enabled: threadQueryState.status === "ready" && Boolean(thread?.id),
  });
  const hasPendingInteraction =
    getLatestPendingInteraction(pendingInteractions) !== null;
  const unreadDividerState = useThreadUnreadDividerState({
    routeThreadId: threadId,
    thread,
  });
  const [hasRequestedMergeBaseOptions, setHasRequestedMergeBaseOptions] =
    useState(false);
  const [newTabFocusRequest, setNewTabFocusRequest] = useState(0);
  const shouldLoadThreadStorageFiles = thread !== undefined;
  const {
    isThreadStorageFilesLoading,
    refetchThreadStorageFiles,
    threadStorageFiles,
    threadStorageFilesError,
    threadStorageRootPath,
  } = useThreadStorageViewer({
    activePath: null,
    fileListEnabled: shouldLoadThreadStorageFiles,
    filePreviewEnabled: false,
    threadId,
  });
  const terminalsListQuery = useThreadTerminals(threadId ?? "");
  const {
    activeBrowserTab,
    activeHostFileLineRange,
    activeHostFilePath,
    activeStorageFileLineRange,
    activeStorageFilePath,
    activeWorkspaceFileLineRange,
    activeWorkspaceFilePath,
    activeWorkspaceFileSource,
    activeWorkspaceFileStatusLabel,
    browserTabs,
    clearActiveFileTabs,
    activateTab,
    closeTab,
    isNewTabActive,
    openTab,
    orderedSecondaryFileTabs,
    reorderFileTab,
    selectFileSearchResult,
    updateBrowserTab,
  } = useThreadFileTabs({
    threadId,
    environmentId: thread?.environmentId,
    storageFiles: threadStorageFiles?.files,
    terminalSessions: terminalsListQuery.data?.sessions,
  });
  const openPersistedWorkspaceFile =
    useCallback<ThreadSecondaryPanelWorkspaceFileOpenHandler>(
      (file) => openTab({ kind: "workspace-file-preview", tab: file }),
      [openTab],
    );
  const openPersistedStorageFile =
    useCallback<ThreadSecondaryPanelStorageFileOpenHandler>(
      (file) => openTab({ kind: "thread-storage-file-preview", tab: file }),
      [openTab],
    );
  const openPersistedHostFile =
    useCallback<ThreadSecondaryPanelHostFileOpenHandler>(
      (file) => openTab({ kind: "host-file-preview", tab: file }),
      [openTab],
    );
  const openBrowserTab = useCallback(
    (url?: string) => {
      openTab({ kind: "browser", url: url ?? "" });
    },
    [openTab],
  );
  const openNewTab = useCallback(() => {
    openTab({ kind: "new-tab" });
  }, [openTab]);
  const [openLinksInAppBrowser] = useOpenLinksInAppBrowserPreference();
  // The in-app browser surface only exists on desktop; on web this stays false
  // and chat links keep their external-open behavior.
  const desktopBrowserAvailable = isDesktopBrowserAvailable();
  const browserTabIds = useMemo(
    () => new Set(browserTabs.map((tab) => tab.id)),
    [browserTabs],
  );
  // Popups (`window.open`/`target=_blank`) from a browser view open as a new
  // in-panel browser tab; the native OS popup is denied in the main process.
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi === null) {
      return;
    }
    if (browserApi.onScopedOpenTab) {
      return browserApi.onScopedOpenTab(({ tabId, url }) => {
        if (browserTabIds.has(tabId)) {
          openBrowserTab(url);
        }
      });
    }
    return browserApi.onOpenTab(({ url }) => {
      if (isRoutePath({ path: url })) {
        return;
      }
      openBrowserTab(url);
    });
  }, [browserTabIds, openBrowserTab]);
  const isThreadRoot = isRootThread(thread);
  const shouldLoadParentThreads =
    threadQueryState.status === "ready" && isThreadRoot;
  const parentThreadSubsetQuery = useProjectThreadSubset({
    enabled: shouldLoadParentThreads,
    filters: EMPTY_PROJECT_THREAD_SUBSET_FILTERS,
    projectId,
  });
  const childThreadSubsetFilters = useMemo<ProjectThreadSubsetFilters>(() => {
    if (!thread?.id) {
      return EMPTY_PROJECT_THREAD_SUBSET_FILTERS;
    }
    return { parentThreadId: thread.id };
  }, [thread?.id]);
  const childThreadSubsetQuery = useProjectThreadSubset({
    enabled: threadQueryState.status === "ready" && Boolean(thread?.id),
    filters: childThreadSubsetFilters,
    projectId,
  });
  const parentThreads = useMemo(
    () =>
      shouldLoadParentThreads
        ? (parentThreadSubsetQuery.data ?? EMPTY_PARENT_THREADS)
        : EMPTY_PARENT_THREADS,
    [parentThreadSubsetQuery.data, shouldLoadParentThreads],
  );
  const {
    activeThinking,
    contextWindowUsage,
    hasOlderTimelineRows,
    isLoadingOlderTimelineRows,
    loadOlderTimelineRows,
    pendingTodos,
    timelineError,
    timelineLoading,
    timelineRows,
  } = useThreadTimelinePages({
    threadId: threadId ?? "",
  });
  const sendMessage = useSendThreadMessage();
  const requestEnvironmentAction = useRequestEnvironmentAction();
  const markThreadRead = useMarkThreadRead();
  const updateEnvironment = useUpdateEnvironment();
  const updateThread = useUpdateThread({
    errorMessage: "Failed to assign parent thread.",
  });
  const createTerminal = useCreateThreadTerminal();
  const closeTerminal = useCloseThreadTerminal();
  const terminalSessions =
    terminalsListQuery.data?.sessions ?? EMPTY_TERMINAL_SESSIONS;
  const activeTerminalCount = useMemo(
    () =>
      terminalSessions.filter((session) =>
        isActiveTerminalSessionStatus(session.status),
      ).length,
    [terminalSessions],
  );
  const terminalsById = useMemo(
    () =>
      new Map(
        terminalSessions.map((session) => [session.id, session]),
      ),
    [terminalSessions],
  );
  const syncedOrderedSecondaryFileTabs = useMemo(
    () =>
      buildTerminalSyncedSecondaryFileTabs({
        orderedTabs: orderedSecondaryFileTabs,
        terminalSessions,
      }),
    [orderedSecondaryFileTabs, terminalSessions],
  );
  useEffect(() => {
    if (terminalsListQuery.data === undefined) {
      return;
    }
    updateFixedPanelTabsState((state) =>
      syncTerminalTabsInFixedPanelState({
        state,
        terminalSessions,
      }),
    );
  }, [terminalSessions, terminalsListQuery.data, updateFixedPanelTabsState]);
  const hostConnectionNotice = useMemo(
    () => (thread ? buildHostConnectionNotice(thread) : null),
    [thread],
  );
  const environmentQuery = useEnvironment(thread?.environmentId, {
    enabled: hasThreadDetailBootstrapSettled,
    staleTime: 5_000,
  });
  const environment = environmentQuery.data;
  const canUseGitUi = environment?.isGitRepo === true;
  const canCreateTerminal =
    thread?.environmentId !== null &&
    thread?.environmentId !== undefined &&
    environment?.status === "ready";
  const createThreadInWorktree = useCreateThreadInWorktree({
    projectId: projectId ?? "",
    environmentId: thread?.environmentId ?? "",
  });
  const environmentMergeBaseBranch =
    resolveEnvironmentMergeBaseBranch(environment);
  const {
    closeThreadSecondaryPanel,
    defaultMergeBaseBranch: resolvedDefaultMergeBaseBranch,
    isLoadingMergeBaseBranchOptions,
    mergeBaseBranchOptions,
    mergeBaseRemoteBranchOptions,
    openCommitDiff: openPersistedCommitDiff,
    openDiffFile: openPersistedDiffFile,
    openThreadDiffPanel: openPersistedDiffPanel,
    openThreadSecondaryPanel: openPersistedSecondaryPanel,
    selectedMergeBaseBranch,
    selectedMergeBaseBranchRef,
    setMergeBaseBranchSearchQuery,
    setSelectedMergeBaseBranch,
  } = useGitDiffPanel({
    activeSecondaryTab: openFixedSecondaryTab,
    clearActiveFileTabs,
    defaultMergeBaseBranch: environmentMergeBaseBranch,
    environmentId: canUseGitUi
      ? (thread?.environmentId ?? undefined)
      : undefined,
    mergeBaseBranchOptionsEnabled: hasRequestedMergeBaseOptions,
    setThreadSecondaryPanel: setThreadSecondaryPanelForSurface,
  });
  const {
    closePanel: closeSecondaryPanel,
    isOpen: isSecondaryPanelOpen,
    openCommitDiff: openSecondaryPanelCommitDiff,
    openDiffFile: openSecondaryPanelDiffFile,
    openDiffPanel: openSecondaryPanelDiffPanel,
    openHostFile,
    openPanel: openSecondaryPanel,
    openStorageFile,
    openWorkspaceFile,
    togglePanel: toggleSecondaryPanel,
  } = useThreadSecondaryPanelVisibility({
    closePersistedPanel: closeThreadSecondaryPanel,
    isPersistedOpen: isPersistedSecondaryPanelOpenForSurface,
    isCompactViewport: renderSecondaryPanelAsDrawer,
    openPersistedCommitDiff,
    openPersistedDiffFile,
    openPersistedDiffPanel,
    openPersistedHostFile,
    openPersistedPanel: openPersistedSecondaryPanel,
    openPersistedStorageFile,
    openPersistedWorkspaceFile,
    surface: props.surface,
    threadId,
    togglePersistedPanel: toggleDefaultPersistedSecondaryPanel,
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
  });
  const [storedConversationCollapsed, setStoredConversationCollapsed] = useAtom(
    getThreadConversationCollapsedAtom(threadId),
  );
  const isConversationCollapsed =
    props.surface === "popout" ? false : storedConversationCollapsed;
  // The collapse preference only applies while the panel is open on a wide
  // viewport; ThreadDetailSecondaryContent gates it (there is nothing to expand
  // into otherwise) and surfaces the toggle on the seam arrow.
  const toggleConversationCollapse = useCallback(() => {
    setStoredConversationCollapsed((collapsed) => !collapsed);
  }, [setStoredConversationCollapsed]);
  useEffect(() => {
    setHasRequestedMergeBaseOptions(false);
  }, [thread?.environmentId]);
  const handleMergeBasePickerOpenChange =
    useCallback<MergeBasePickerOpenChangeHandler>((open) => {
      if (open) {
        setHasRequestedMergeBaseOptions(true);
      }
    }, []);
  const handleSecondaryPanelChange = useCallback<SecondaryPanelChangeHandler>(
    (panel) => {
      clearActiveFileTabs();
      openSecondaryPanel(panel);
    },
    [clearActiveFileTabs, openSecondaryPanel],
  );
  const handleSecondaryPanelFocus = useCallback(() => {
    touchFixedPanelTabsState();
  }, [touchFixedPanelTabsState]);
  // Click handler for inserted mention pills in the follow-up composer: threads
  // navigate, files open an in-app preview (workspace files need an
  // environment; thread-storage files need thread storage). Returning null
  // leaves the pill non-interactive.
  const resolveMentionLink = useCallback<PromptMentionLinkResolver>(
    (resource) => {
      if (resource.kind === "thread") {
        const targetProjectId = resource.projectId ?? projectId;
        if (!targetProjectId) return null;
        return () =>
          navigate(
            getSurfaceAwareThreadRoutePath({
              projectId: targetProjectId,
              surface: props.surface,
              threadId: resource.threadId,
            }),
          );
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
      navigate,
      openStorageFile,
      openWorkspaceFile,
      projectId,
      props.surface,
      thread?.environmentId,
    ],
  );
  const handleOpenNewTab = useCallback(() => {
    openNewTab();
    setNewTabFocusRequest((current) => current + 1);
  }, [openNewTab]);
  const handleOpenBrowser = useCallback(() => {
    openBrowserTab();
  }, [openBrowserTab]);
  const handleStartTerminal = useCallback(() => {
    if (!canCreateTerminal || createTerminal.isPending || !threadId) {
      return;
    }
    const newTab = createNewTabFixedPanelTab();
    void createTerminal
      .mutateAsync({
        threadId,
        cols: DEFAULT_TERMINAL_COLS,
        rows: DEFAULT_TERMINAL_ROWS,
      })
      .then((session) => {
        closeTab(newTab.id);
        setActiveFixedTerminal(session.id);
      })
      .catch(() => undefined);
  }, [
    canCreateTerminal,
    closeTab,
    createTerminal,
    setActiveFixedTerminal,
    threadId,
  ]);
  const handleActivateTerminalTab = useCallback(
    (terminalId: string) => {
      setActiveFixedTerminal(terminalId);
    },
    [setActiveFixedTerminal],
  );
  const handleCloseTerminalTab = useCallback(
    (terminalId: string) => {
      if (!threadId) {
        removeFixedTerminalTab(terminalId);
        return;
      }
      closeTerminal.mutate(
        { mode: "force", threadId, terminalId },
        {
          onSuccess: () => {
            removeFixedTerminalTab(terminalId);
          },
        },
      );
    },
    [closeTerminal, removeFixedTerminalTab, threadId],
  );
  const handleChangedFileClick = useCallback(
    (selection: WorkspaceChangedFileSelection) => {
      const openTarget = resolveWorkspaceChangedFileOpenTarget(selection);
      if (openTarget.kind === "preview") {
        openWorkspaceFile({
          lineRange: null,
          path: selection.file.path,
          source: openTarget.source,
          statusLabel: openTarget.statusLabel,
        });
        return;
      }
      openSecondaryPanelDiffFile(selection.file.path);
    },
    [openSecondaryPanelDiffFile, openWorkspaceFile],
  );
  const handleCommitClick = useCallback(
    (sha: string) => {
      openSecondaryPanelCommitDiff(sha);
    },
    [openSecondaryPanelCommitDiff],
  );
  const fileTabs = useMemo<SecondaryPanelFileTab[] | undefined>(() => {
    const filenameOf = (path: string) => path.split("/").at(-1) ?? path;
    const tabs = syncedOrderedSecondaryFileTabs.map(
      (tab): SecondaryPanelFileTab => {
        switch (tab.kind) {
          case "browser": {
            const browserLabel =
              tab.title ??
              (tab.url.length > 0 ? getBrowserUrlHost(tab.url) : "");
            return {
              id: tab.id,
              filename: browserLabel.length > 0 ? browserLabel : "Browser",
              isActive: tab.id === activeFixedSecondaryTabId,
              leadingVisual: (
                <Icon
                  name="Globe"
                  className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
                  aria-hidden
                />
              ),
              statusLabel: null,
              onSelect: () => activateTab(tab.id),
              onClose: () => closeTab(tab.id),
            };
          }
          case "terminal": {
            const session = terminalsById.get(tab.terminalId);
            return {
              id: tab.id,
              filename: session?.title ?? "Terminal",
              isActive: tab.id === activeFixedSecondaryTabId,
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
                  : terminalStatusLabel(session),
              onSelect: () => handleActivateTerminalTab(tab.terminalId),
              onClose: () => handleCloseTerminalTab(tab.terminalId),
            };
          }
          case "workspace-file-preview":
            return {
              id: tab.id,
              filename: filenameOf(tab.path),
              isActive: tab.id === activeFixedSecondaryTabId,
              leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
              statusLabel: tab.statusLabel,
              onSelect: () => activateTab(tab.id),
              onClose: () => closeTab(tab.id),
            };
          case "host-file-preview":
            return {
              id: tab.id,
              filename: filenameOf(tab.path),
              isActive: tab.id === activeFixedSecondaryTabId,
              leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
              statusLabel: null,
              onSelect: () => activateTab(tab.id),
              onClose: () => closeTab(tab.id),
            };
          case "thread-storage-file-preview":
            return {
              id: tab.id,
              filename: filenameOf(tab.path),
              isActive: tab.id === activeFixedSecondaryTabId,
              isPinned: tab.isPinned,
              leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
              statusLabel: null,
              onSelect: () => activateTab(tab.id),
              onClose: () => closeTab(tab.id),
            };
          case "new-tab":
            return {
              id: tab.id,
              filename: "New tab",
              isActive: tab.id === activeFixedSecondaryTabId,
              leadingVisual: (
                <Icon
                  name="NewTab"
                  className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
                  aria-hidden
                />
              ),
              statusLabel: null,
              onSelect: () => activateTab(tab.id),
              onClose: () => closeTab(tab.id),
            };
        }
      },
    );
    return tabs.length > 0 ? tabs : undefined;
  }, [
    activateTab,
    activeFixedSecondaryTabId,
    closeTab,
    handleActivateTerminalTab,
    handleCloseTerminalTab,
    syncedOrderedSecondaryFileTabs,
    terminalsById,
  ]);
  const requestedMergeBaseBranch =
    selectedMergeBaseBranch ?? environmentMergeBaseBranch;
  const workStatusQuery = useEnvironmentWorkStatus(
    thread?.environmentId,
    requestedMergeBaseBranch,
    {
      enabled: canUseGitUi && environment !== undefined,
    },
  );
  const workspaceStatusError = workStatusQuery.error;
  const workStatusResponse = workspaceStatusError
    ? undefined
    : workStatusQuery.data;
  const workspaceStatus =
    workStatusResponse?.outcome === "available"
      ? workStatusResponse.workspace
      : undefined;
  const workspaceUnavailable =
    workStatusResponse?.outcome === "unavailable"
      ? workStatusResponse.failure
      : undefined;
  const pullRequestQuery = useEnvironmentPullRequest(thread?.environmentId, {
    enabled: canUseGitUi && environment !== undefined,
  });
  const pullRequest = pullRequestQuery.data?.pullRequest ?? null;
  const workspaceBranch = workspaceStatus?.branch;
  const workspaceChangedFilesSection = useMemo(
    () => selectWorkspaceChangedFilesSection(workspaceStatus),
    [workspaceStatus],
  );
  const workingTreeChangedFilesSection = useMemo(() => {
    if (
      workspaceChangedFilesSection === null ||
      workspaceChangedFilesSection.kind === "committed"
    ) {
      return null;
    }
    return workspaceChangedFilesSection;
  }, [workspaceChangedFilesSection]);
  const { isLocalDaemonHost } = useHostDaemon();
  const threadEnvironmentIsLocal = environment
    ? isLocalDaemonHost(environment.hostId)
    : false;
  const environmentDisplayHostContext = useMemo<EnvironmentDisplayHostContext>(
    () => ({
      locality: threadEnvironmentIsLocal ? "local" : "remote",
    }),
    [threadEnvironmentIsLocal],
  );
  const localWorkspaceRootPath = resolveThreadLocalWorkspaceRootPath({
    environment,
    threadEnvironmentIsLocal,
  });
  const workspacePreviewRootPath = resolveThreadWorkspacePreviewRootPath({
    environment,
  });
  const {
    canOpenPreferredDirectoryTarget,
    canOpenPreferredFileTarget,
    directoryOpenTargets,
    openPathInDirectoryTarget,
    openPathInPreferredDirectoryTarget,
    openPathInPreferredFileTarget,
    preferredDirectoryTarget,
  } = useLocalOpenTargets({
    enabled: threadEnvironmentIsLocal,
  });
  const parentThreadSection: ThreadPromptParentThreadSection | null =
    useMemo(() => {
      if (!thread?.parentThreadId) return null;
      const href = getSurfaceAwareThreadRoutePath({
        projectId: thread.projectId,
        surface: props.surface,
        threadId: thread.parentThreadId,
      });
      if (parentThread === undefined) {
        // Parent record not yet loaded — show id-based fallback so the user
        // doesn't get a flicker of "no parent" before resolution.
        return {
          parentThreadTitle: `Parent ${thread.parentThreadId.slice(0, 8)}`,
          href,
        };
      }
      // Plan ownership invariants: silently exclude dirty references rather
      // than rendering a stale or unreachable parent link.
      if (
        parentThread.archivedAt !== null ||
        parentThread.deletedAt !== null ||
        parentThread.projectId !== thread.projectId
      ) {
        return null;
      }
      return {
        parentThreadTitle: getThreadDisplayTitle(parentThread),
        href,
      };
    }, [
      parentThread,
      props.surface,
      thread?.parentThreadId,
      thread?.projectId,
    ]);
  const childThreadsSection: ThreadPromptChildThreadsSection | null =
    useMemo(() => {
      const list = childThreadSubsetQuery.data ?? [];
      const activeItems = list
        .filter((entry) =>
          isThreadDisplayStatusBannerActive(entry.runtime.displayStatus),
        )
        .map((entry) => ({
          id: entry.id,
          title: getThreadDisplayTitle(entry),
          href: getSurfaceAwareThreadRoutePath({
            projectId: entry.projectId,
            surface: props.surface,
            threadId: entry.id,
          }),
        }));
      if (activeItems.length === 0) return null;
      return { items: activeItems };
    }, [childThreadSubsetQuery.data, props.surface]);
  const isThreadTimelinePending = timelineLoading && timelineRows.length === 0;
  useThreadReadTracking({
    markThreadRead,
    thread,
  });
  const {
    effectiveMergeBaseBranch,
    handleMergeBaseBranchChange,
    showBranchComparisonUi,
    showMergeBase,
    mergeBaseBranch,
  } = useEnvironmentMergeBase({
    environment,
    selectedMergeBaseBranch,
    setSelectedMergeBaseBranch,
    thread,
    updateEnvironment,
    workspaceStatus,
  });
  const gitActions = useThreadGitActions({
    environment,
    requestEnvironmentAction,
    sendMessage,
    thread,
    workspaceStatus,
  });
  useEffect(() => {
    if (gitActions.threadGitActionDialog.target !== null) {
      setHasRequestedMergeBaseOptions(true);
    }
  }, [gitActions.threadGitActionDialog.target]);
  const parentThreadId = thread?.parentThreadId;
  const parentThreadDisplayName =
    parentThread?.title && parentThread.title.trim().length > 0
      ? parentThread.title
      : parentThreadId;
  const parentSelectorOptions = useMemo(
    () =>
      buildParentSelectorOptions({
        currentThreadId: thread?.id,
        parentThreads,
        parentThreadDisplayName,
        parentThreadId,
      }),
    [parentThreads, parentThreadDisplayName, parentThreadId, thread?.id],
  );
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
    (resolution: ThreadLocalFileLinkResolution) => {
      if (resolution.kind === "app-route") {
        return false;
      }
      if (resolution.kind === "error") {
        appToast.error("Failed to open file locally", {
          description: resolution.description,
        });
        return true;
      }

      if (resolution.kind === "open-workspace-path") {
        openWorkspaceFile({
          lineRange: resolution.request.lineRange,
          path: resolution.request.relativePath,
          source: { kind: "working-tree" },
          statusLabel: null,
        });
        return true;
      }

      if (resolution.kind === "open-thread-storage-path") {
        openStorageFile({
          lineRange: resolution.request.lineRange,
          path: resolution.request.relativePath,
        });
        return true;
      }

      openHostFile({
        lineRange: resolution.request.lineRange,
        path: resolution.request.path,
      });
      return true;
    },
    [openHostFile, openStorageFile, openWorkspaceFile],
  );
  const handleOpenTimelineLocalFileLink = useCallback(
    (link: ThreadTimelineLocalFileLink) => {
      const resolution = resolveThreadLocalFileLink({
        hostFileLinksAvailable:
          thread?.environmentId !== null && thread?.environmentId !== undefined,
        link,
        threadStorageRootPath,
        workspaceRootPath: workspacePreviewRootPath,
      });

      if (
        resolution.kind !== "open-host-path" ||
        threadStorageRootPath !== null
      ) {
        return handleTimelineLocalFileLinkResolution(resolution);
      }

      void refetchThreadStorageFiles()
        .then((result) => {
          const resolvedThreadStorageRootPath =
            result.data?.storageRootPath ?? null;
          if (resolvedThreadStorageRootPath === null) {
            appToast.error("Failed to open file locally", {
              description: "Thread storage path is not available yet.",
            });
            return;
          }

          const resolvedResolution = resolveThreadLocalFileLink({
            hostFileLinksAvailable: true,
            link,
            threadStorageRootPath: resolvedThreadStorageRootPath,
            workspaceRootPath: workspacePreviewRootPath,
          });
          handleTimelineLocalFileLinkResolution(resolvedResolution);
        })
        .catch((error: Error) => {
          appToast.error("Failed to open file locally", {
            description: error.message,
          });
        });

      return true;
    },
    [
      handleTimelineLocalFileLinkResolution,
      refetchThreadStorageFiles,
      thread?.environmentId,
      threadStorageRootPath,
      workspacePreviewRootPath,
    ],
  );
  const handleOpenTimelineLink = useCallback<ThreadTimelineLinkHandler>(
    ({ href }) => {
      if (
        resolveChatLinkOpenTarget({
          desktopBrowserAvailable,
          openInAppBrowser: openLinksInAppBrowser,
          url: href,
        }) !== "in-app-browser"
      ) {
        return false;
      }
      openBrowserTab(href);
      return true;
    },
    [desktopBrowserAvailable, openBrowserTab, openLinksInAppBrowser],
  );
  const handleTimelineTitleAction = useCallback<TimelineTitleActionResolver>(
    (action) => {
      switch (action.kind) {
        case "open-file-diff":
          return () => {
            openSecondaryPanelDiffFile(action.path);
          };
        default:
          // Surfaces a compile-time error if a future TimelineTitleAction
          // variant is added without app-side handling, instead of silently
          // returning undefined and leaving a kind unrouted.
          return assertNever(action.kind);
      }
    },
    [openSecondaryPanelDiffFile],
  );
  const metadataStorage = useMemo(
    () => ({
      controller: storageBrowserController,
      filesError: threadStorageFilesError,
      isFilesLoading: isThreadStorageFilesLoading,
    }),
    [
      isThreadStorageFilesLoading,
      storageBrowserController,
      threadStorageFilesError,
    ],
  );
  const handleOpenFileInEditor = useMemo(
    () =>
      buildOpenInEditorHandler({
        rootPath: localWorkspaceRootPath,
        canOpenPreferredTarget: canOpenPreferredFileTarget,
        openInPreferredTarget: openPathInPreferredFileTarget,
      }),
    [
      canOpenPreferredFileTarget,
      localWorkspaceRootPath,
      openPathInPreferredFileTarget,
    ],
  );
  const handleOpenStorageFileInEditor = useMemo(
    () =>
      buildOpenInEditorHandler({
        rootPath: threadEnvironmentIsLocal ? threadStorageRootPath : null,
        canOpenPreferredTarget: canOpenPreferredFileTarget,
        openInPreferredTarget: openPathInPreferredFileTarget,
      }),
    [
      canOpenPreferredFileTarget,
      openPathInPreferredFileTarget,
      threadEnvironmentIsLocal,
      threadStorageRootPath,
    ],
  );
  const handleOpenHostFileInEditor = useMemo<
    OpenInEditorHandler | undefined
  >(() => {
    if (!threadEnvironmentIsLocal || !canOpenPreferredFileTarget) {
      return undefined;
    }
    return (path) => {
      void openPathInPreferredFileTarget({
        lineNumber: getFilePreviewLineRangeStart({
          lineRange: activeHostFileLineRange,
        }),
        path,
      });
    };
  }, [
    activeHostFileLineRange,
    canOpenPreferredFileTarget,
    openPathInPreferredFileTarget,
    threadEnvironmentIsLocal,
  ]);
  const workspaceFileCopyPath = activeWorkspaceFilePath
    ? resolveAbsoluteFilePath({
        path: activeWorkspaceFilePath,
        rootPath: workspacePreviewRootPath,
      })
    : null;
  const storageFileCopyPath = activeStorageFilePath
    ? resolveAbsoluteFilePath({
        path: activeStorageFilePath,
        rootPath: threadStorageRootPath,
      })
    : null;
  // Relative links inside a previewed markdown file resolve against the file's
  // own directory, mirroring how the file's links would resolve on disk.
  const workspaceFileLinkBaseDir = workspaceFileCopyPath
    ? getAbsoluteDirname({ path: workspaceFileCopyPath })
    : undefined;
  const storageFileLinkBaseDir = storageFileCopyPath
    ? getAbsoluteDirname({ path: storageFileCopyPath })
    : undefined;
  const hostFileLinkBaseDir = activeHostFilePath
    ? getAbsoluteDirname({ path: activeHostFilePath })
    : undefined;
  const hostFileLinkRootPath = resolveHostFilePreviewLinkRootPath({
    baseDir: hostFileLinkBaseDir,
    threadStorageRootPath,
    workspaceRootPath: workspacePreviewRootPath,
  });
  const workspaceMarkdownLinkRouting = useMemo(
    () =>
      buildMarkdownPreviewLinkRouting({
        baseDir: workspaceFileLinkBaseDir,
        onOpenLink: handleOpenTimelineLink,
        onOpenLocalFileLink: handleOpenTimelineLocalFileLink,
        rootPath: workspacePreviewRootPath,
      }),
    [
      handleOpenTimelineLink,
      handleOpenTimelineLocalFileLink,
      workspaceFileLinkBaseDir,
      workspacePreviewRootPath,
    ],
  );
  const hostMarkdownLinkRouting = useMemo(
    () =>
      buildMarkdownPreviewLinkRouting({
        baseDir: hostFileLinkBaseDir,
        onOpenLink: handleOpenTimelineLink,
        onOpenLocalFileLink: handleOpenTimelineLocalFileLink,
        rootPath: hostFileLinkRootPath,
      }),
    [
      handleOpenTimelineLink,
      handleOpenTimelineLocalFileLink,
      hostFileLinkBaseDir,
      hostFileLinkRootPath,
    ],
  );
  const storageMarkdownLinkRouting = useMemo(
    () =>
      buildMarkdownPreviewLinkRouting({
        baseDir: storageFileLinkBaseDir,
        onOpenLink: handleOpenTimelineLink,
        onOpenLocalFileLink: handleOpenTimelineLocalFileLink,
        rootPath: threadStorageRootPath,
      }),
    [
      handleOpenTimelineLink,
      handleOpenTimelineLocalFileLink,
      storageFileLinkBaseDir,
      threadStorageRootPath,
    ],
  );
  const handleOpenFilePreview = useCallback<OpenFilePreviewHandler>(
    (relativePath) => {
      openWorkspaceFile({
        lineRange: null,
        path: relativePath,
        source: { kind: "working-tree" },
        statusLabel: null,
      });
    },
    [openWorkspaceFile],
  );

  if (!projectId || !threadId) {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-destructive">Not found</p>
      </PageShell>
    );
  }
  if (threadQueryState.status === "loading") {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-muted-foreground">
          Loading...
        </p>
      </PageShell>
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
  const hasAssignableParent = parentSelectorOptions.some(
    (option) => option.value !== "none",
  );
  const canAssignToParent = isThreadRoot && hasAssignableParent;
  const canTakeOverThread = Boolean(thread.parentThreadId);
  const threadEnvironmentDisplay = environment
    ? formatEnvironmentDisplay({
        environment,
        host: environmentDisplayHostContext,
      })
    : undefined;
  const threadEnvironmentIcon = threadEnvironmentDisplay
    ? getEnvironmentWorkspaceLabelIconName(
        threadEnvironmentDisplay.workspaceDisplayKind,
      )
    : null;
  const isThreadOnWorktreeEnvironment =
    environment !== undefined &&
    (environment.isWorktree ||
      environment.workspaceProvisionType === "managed-worktree");
  const onCreateNewThreadInWorktree =
    isThreadOnWorktreeEnvironment && projectId && thread.environmentId !== null
      ? createThreadInWorktree
      : undefined;
  const promptBannerMergeBaseBranch = effectiveMergeBaseBranch;
  const threadBranchName = workspaceBranch?.currentBranch ?? undefined;
  const threadCheckoutDisplay = workspaceStatus
    ? formatWorkspaceCheckoutDisplay({ checkout: workspaceStatus.checkout })
    : undefined;
  const isWorkspaceDeleted = environment?.status === "destroyed";
  const threadGitStatusDisplay = getGitStatusDisplay(workspaceStatus, {
    mergeBaseBranch,
    showBranchComparison: showBranchComparisonUi,
    error: workspaceStatusError,
    workspaceUnavailable,
    workspaceDeleted: isWorkspaceDeleted,
  });
  const threadTitle = getThreadDisplayTitle(thread);
  const threadActionsMenu = (
    <ThreadActionsMenu
      thread={thread}
      triggerClassName={HEADER_ICON_BUTTON_CLASS}
      align="end"
    />
  );
  const workspaceOpenPath = resolveThreadWorkspaceOpenPath({
    canOpenWorkspace: canOpenPreferredDirectoryTarget,
    environment,
    hasWorkspaceOpenTargets: directoryOpenTargets.length > 0,
    threadEnvironmentIsLocal,
  });
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
  const timelineHeader =
    props.surface === "popout" ? (
      <PopoutThreadHeader
        threadTitle={threadTitle}
        onHide={props.onPopoutHide}
        onNewQuickThread={props.onPopoutNewQuickThread}
        onOpenInMain={() => {
          props.onPopoutOpenInMain({
            projectId,
            threadId: thread.id,
          });
        }}
      />
    ) : (
      <ThreadDetailHeader
        actionsMenu={threadActionsMenu}
        isChildThread={Boolean(parentThreadId)}
        isSecondaryPanelOpen={isSecondaryPanelOpen}
        activeTerminalCount={activeTerminalCount}
        onOpenThreadGitAction={gitActions.threadGitActionDialog.onOpen}
        onToggleSecondaryPanel={toggleSecondaryPanel}
        threadHeaderGitActions={gitActions.threadHeaderGitActions}
        threadTitle={threadTitle}
        workspaceOpenButton={workspaceOpenButton}
      />
    );
  const composerFooter = (
    <ThreadDetailPromptArea
      canUseGitUi={canUseGitUi}
      contextWindowUsage={contextWindowUsage}
      environmentCheckout={threadCheckoutDisplay}
      environmentIcon={threadEnvironmentIcon ?? undefined}
      environmentLabel={threadEnvironmentDisplay?.modeLabel}
      environmentCompactLabel={threadEnvironmentDisplay?.compactModeLabel}
      isEnvironmentActionPending={requestEnvironmentAction.isPending}
      onCreateNewThreadInWorktree={onCreateNewThreadInWorktree}
      onEscapeEmptyPrompt={
        props.surface === "popout" ? props.onPopoutHide : undefined
      }
      composerQueriesEnabled={hasThreadComposerBootstrapReady}
      composerQueriesStaleTime={composerHydratedDataStaleTime}
      onChangedFileClick={handleChangedFileClick}
      openThreadDiffPanel={openSecondaryPanelDiffPanel}
      projectId={projectId}
      resolveMentionLink={resolveMentionLink}
      workspaceChangedFilesSection={
        canUseGitUi ? workspaceChangedFilesSection : null
      }
      workspaceStatusPending={
        canUseGitUi && (environmentQuery.isLoading || workStatusQuery.isLoading)
      }
      contextBannerMergeBase={
        canUseGitUi && showMergeBase && promptBannerMergeBaseBranch
          ? {
              branch: promptBannerMergeBaseBranch,
              branchRef: selectedMergeBaseBranchRef,
              options: mergeBaseBranchOptions,
              remoteOptions: mergeBaseRemoteBranchOptions,
              optionsLoading: isLoadingMergeBaseBranchOptions,
              onChange: handleMergeBaseBranchChange,
              onPickerOpenChange: handleMergeBasePickerOpenChange,
              onSearchQueryChange: setMergeBaseBranchSearchQuery,
            }
          : null
      }
      sendMessage={sendMessage}
      pendingInteractions={pendingInteractions}
      pendingTodos={pendingTodos}
      parentThreadSection={parentThreadSection}
      childThreadsSection={childThreadsSection}
      thread={thread}
    />
  );
  const activeTerminalId =
    findActiveTerminalIdInSecondaryFileTabs({
      activeTabId: activeFixedSecondaryTabId,
      tabs: syncedOrderedSecondaryFileTabs,
    });
  const fileTabContent = activeTerminalId ? (
    <ThreadTerminalPanel
      canCreateTerminal={canCreateTerminal}
      onOpenLink={handleOpenTimelineLink}
      threadId={thread.id}
    />
  ) : isNewTabActive ? (
    <NewTabPage
      projectId={projectId ?? undefined}
      environmentId={thread.environmentId ?? null}
      currentThreadId={thread.id}
      focusRequest={newTabFocusRequest}
      onSelect={selectFileSearchResult}
      onOpenBrowser={handleOpenBrowser}
      onStartTerminal={canCreateTerminal ? handleStartTerminal : undefined}
    />
  ) : activeWorkspaceFilePath ? (
    <WorkspaceFilePreviewTabContent
      activePath={activeWorkspaceFilePath}
      copyPath={workspaceFileCopyPath}
      environmentId={thread.environmentId}
      lineRange={activeWorkspaceFileLineRange}
      markdownLinkRouting={workspaceMarkdownLinkRouting}
      onOpenInEditor={handleOpenFileInEditor}
      source={activeWorkspaceFileSource}
      statusLabel={activeWorkspaceFileStatusLabel}
      threadId={thread.id}
    />
  ) : activeHostFilePath ? (
    <HostFilePreviewTabContent
      activePath={activeHostFilePath}
      copyPath={activeHostFilePath}
      environmentId={thread.environmentId}
      lineRange={activeHostFileLineRange}
      markdownLinkRouting={hostMarkdownLinkRouting}
      onOpenInEditor={handleOpenHostFileInEditor}
      threadId={thread.id}
    />
  ) : activeStorageFilePath ? (
    <ThreadStorageFilePreviewTabContent
      activePath={activeStorageFilePath}
      copyPath={storageFileCopyPath}
      lineRange={activeStorageFileLineRange}
      markdownLinkRouting={storageMarkdownLinkRouting}
      onOpenInEditor={handleOpenStorageFileInEditor}
      threadId={thread.id}
    />
  ) : undefined;
  // Browser tabs are not rendered through the single `fileTabContent` slot:
  // each one keeps a live native view that must persist across tab switches, so
  // the deck stays mounted independently of which tab is active.
  const isBrowserTabActive = activeBrowserTab !== null;
  const browserDeck = (
    <BrowserTabDeck
      browserTabs={browserTabs}
      activeBrowserTabId={activeBrowserTab?.id ?? null}
      environmentId={thread.environmentId}
      isPanelOpen={isSecondaryPanelOpen}
      threadId={thread.id}
      onUpdate={updateBrowserTab}
    />
  );

  return (
    <>
      <ThreadDetailSecondaryContent
        footer={composerFooter}
        header={timelineHeader}
        isMetadataLoading={environmentQuery.isLoading}
        isSecondaryPanelOpen={isSecondaryPanelOpen}
        isConversationCollapsed={isConversationCollapsed}
        surface={props.surface}
        onToggleConversationCollapse={toggleConversationCollapse}
        metadata={{
          thread,
          projectId,
          parentThreadDisplayName: parentThreadDisplayName ?? null,
          parentThreads,
          canAssignToParent,
          canTakeOverThread,
          environment: environment ?? null,
          environmentDisplayHost: environmentDisplayHostContext,
          workspaceStatus,
          workspaceStatusError: workspaceStatusError ?? null,
          workspaceUnavailable,
          pullRequest,
          selectedMergeBaseBranch,
          mergeBaseBranchRef: selectedMergeBaseBranchRef,
          mergeBaseBranchOptions,
          mergeBaseRemoteBranchOptions,
          isLoadingMergeBaseBranchOptions,
          threadSchedules,
          updateThreadPending:
            updateThread.isPending || updateEnvironment.isPending,
          storage: metadataStorage,
          onAssignParent: handleAssignParent,
          onMergeBaseBranchChange: handleMergeBaseBranchChange,
          onMergeBasePickerOpenChange: handleMergeBasePickerOpenChange,
          onMergeBaseBranchSearchQueryChange: setMergeBaseBranchSearchQuery,
          onChangedFileClick: canUseGitUi ? handleChangedFileClick : undefined,
          onCommitClick: canUseGitUi ? handleCommitClick : undefined,
        }}
        secondaryPanel={{
          activeTab: activeFixedSecondaryTab,
          canUseGitUi,
          defaultMergeBaseBranch: resolvedDefaultMergeBaseBranch,
          environmentId: thread.environmentId ?? undefined,
          workspaceRootPath: environment?.path,
          fileTabs,
          fileTabContent,
          browserDeck,
          isBrowserTabActive,
          isOpen: isSecondaryPanelOpen,
          onClose: closeSecondaryPanel,
          onCollapse: closeSecondaryPanel,
          onOpenFileInEditor: handleOpenFileInEditor,
          onFileTabReorder: reorderFileTab,
          onOpenNewTab: handleOpenNewTab,
          onOpenFilePreview: handleOpenFilePreview,
          onPanelFocus: handleSecondaryPanelFocus,
          onPanelChange: handleSecondaryPanelChange,
          showGitDiffTab: canUseGitUi,
        }}
        timeline={{
          activeThinking,
          hasOlderTimelineRows,
          hostConnectionNotice,
          isLoadingOlderTimelineRows,
          isThreadTimelinePending,
          timelineError: Boolean(timelineError),
          onLoadOlderRows: loadOlderTimelineRows,
          onOpenLink: handleOpenTimelineLink,
          onOpenLocalFileLink: handleOpenTimelineLocalFileLink,
          onTitleAction: handleTimelineTitleAction,
          projectId,
          resolveMentionLink,
          showOngoingIndicator:
            thread.stopRequestedAt === null &&
            // A pending interaction (question or approval) already renders its
            // own inline shimmer row, so the bottom indicator would just
            // duplicate it.
            !hasPendingInteraction &&
            (thread.runtime.displayStatus === "active" ||
              thread.runtime.displayStatus === "host-reconnecting") &&
            !isThreadTimelinePending,
          ongoingIndicatorLabel:
            thread.runtime.displayStatus === "host-reconnecting"
              ? "Waiting for reconnection"
              : undefined,
          timelineRows,
          stopRequestedAt: thread.stopRequestedAt,
          threadId: thread.id,
          threadRuntimeDisplayStatus: thread.runtime.displayStatus,
          unreadDividerAutoScroll: unreadDividerState.autoScroll,
          unreadDividerPlacement: unreadDividerState.placement,
          workspaceRootPath: environment?.path ?? undefined,
        }}
      />
      {canUseGitUi ? (
        <ThreadGitActionDialog
          target={gitActions.threadGitActionDialog.target}
          branchName={threadBranchName}
          gitStatusDisplay={threadGitStatusDisplay}
          changedFilesSection={workingTreeChangedFilesSection}
          showMergeBaseDetails={showBranchComparisonUi}
          mergeBaseBranch={effectiveMergeBaseBranch}
          mergeBaseBranchOptions={mergeBaseBranchOptions}
          mergeBaseBranchRef={selectedMergeBaseBranchRef}
          mergeBaseRemoteBranchOptions={mergeBaseRemoteBranchOptions}
          mergeBaseBranchOptionsLoading={isLoadingMergeBaseBranchOptions}
          onMergeBaseBranchSearchQueryChange={setMergeBaseBranchSearchQuery}
          onMergeBaseBranchChange={
            showBranchComparisonUi ? handleMergeBaseBranchChange : undefined
          }
          onOpenChange={(open) => {
            if (!open) {
              gitActions.threadGitActionDialog.onClose();
            }
          }}
          onCommit={gitActions.handleCommitThread}
          onSquashMerge={gitActions.handleSquashMergeThread}
        />
      ) : null}
    </>
  );
}
