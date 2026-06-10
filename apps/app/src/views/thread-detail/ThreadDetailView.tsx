import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import type {
  ThreadTimelineLinkHandler,
  ThreadTimelineLocalFileLink,
  ThreadTimelineLocalFileLinkHandler,
  TimelineTitleActionResolver,
} from "@/components/thread/timeline";
import {
  resolveEnvironmentMergeBaseBranch,
  type ThreadListEntry,
  type ThreadWithRuntime,
} from "@bb/domain";
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
  useEnvironmentWorkStatus,
} from "../../hooks/queries/environment-queries";
import {
  getLatestPendingInteraction,
  useApps,
  useProjectThreadSubset,
  useThread,
  useThreadComposerBootstrap,
  useThreadDetailBootstrap,
  useThreadPendingInteractions,
  useThreadSchedules,
  type ProjectThreadSubsetFilters,
} from "../../hooks/queries/thread-queries";
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
import { useExperiments } from "@/hooks/queries/system-queries";
import {
  useCloseThreadTerminal,
  useCreateThreadTerminal,
  useThreadTerminals,
} from "@/hooks/queries/thread-terminal-queries";
import { getEnvironmentWorkspaceLabelIconName } from "@/lib/environment-workspace-display";
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
import { getThreadRoutePath } from "@/lib/app-route-paths";
import { useGitDiffPanel } from "@/components/secondary-panel/git-diff/useGitDiffPanel";
import { ThreadDetailHeader } from "./ThreadDetailHeader";
import {
  ThreadDetailPromptArea,
  THREAD_DETAIL_COMPOSER_TEXTAREA_ID,
} from "./ThreadDetailPromptArea";
import {
  type ContextBannerMergeBaseConfig,
  isThreadDisplayStatusBannerActive,
  type ThreadPromptParentThreadSection,
  type ThreadPromptChildThreadsSection,
} from "@/components/promptbox/banner/ThreadPromptContextBanner";
import { selectThreadPromptWorkflowsSection } from "./threadPromptWorkflowsSection";
import { ThreadDetailSecondaryContent } from "./ThreadDetailSecondaryContent";
import { useThreadSecondaryPanelVisibility } from "./useThreadSecondaryPanelVisibility";
import type { HostConnectionNotice } from "./ThreadTimelinePane";
import { useThreadStorageViewer } from "@/components/secondary-panel/useThreadStorageViewer";
import {
  getThreadConversationCollapsedAtom,
  getThreadSecondaryPanelOpenAtom,
} from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import {
  HostFilePreviewTabContent,
  ThreadStorageFilePreviewTabContent,
  WorkspaceFilePreviewTabContent,
} from "@/components/secondary-panel/ThreadSecondaryPanelTabContent";
import { AppTabContent } from "@/components/secondary-panel/AppTabContent";
import { BrowserTabDeck } from "@/components/secondary-panel/BrowserTabDeck";
import { NewTabActionMenu } from "@/components/secondary-panel/NewTabFileSearch";
import { NewTabPage } from "@/components/secondary-panel/NewTabPage";
import { resolveRightPanelFileVisual } from "@/components/secondary-panel/rightPanelFileVisuals";
import { Icon } from "@/components/ui/icon.js";
import {
  getDesktopBrowserApi,
  isDesktopBrowserAvailable,
} from "@/lib/bb-desktop";
import {
  resolveChatLinkOpenTarget,
  useOpenLinksInAppBrowserPreference,
} from "@/lib/in-app-browser-link-preference";
import { getFilePreviewLineRangeStart } from "@/lib/file-preview";
import { getBrowserUrlHost } from "@/lib/browser-url";
import { ResolvedAppIcon } from "@/components/secondary-panel/AppIcon";
import {
  useThreadStorageBrowser,
  type ThreadStoragePathSelectHandler,
} from "@/components/secondary-panel/useThreadStorageBrowser";
import { useThreadFileTabs } from "@/components/secondary-panel/useThreadFileTabs";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import type {
  NewTabMenuRenderer,
  SecondaryPanelFileTab,
} from "@/components/secondary-panel/ThreadSecondaryPanel";
import { useEnvironmentMergeBase } from "@/components/secondary-panel/git-diff/useEnvironmentMergeBase";
import { useThreadGitActions } from "./useThreadGitActions";
import { useThreadReadTracking } from "./useThreadReadTracking";
import { useThreadUnreadDividerState } from "./useThreadUnreadDividerState";
import { useThreadTimelinePages } from "./useThreadTimelinePages";
import {
  buildOpenInEditorHandler,
  resolveWorkspaceChangedFileOpenTarget,
  resolveThreadLocalWorkspaceRootPath,
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
  useFixedPanelTabsSecondaryPanelUrlSync,
  useFixedPanelTabsState,
  useFixedPanelTabsStorageMaintenance,
  useRemoveFixedRightTerminalTab,
  useSetFixedRightTerminalActiveTerminal,
  useTouchFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
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
import { useAppRoute } from "@/hooks/useAppRoute";
import { resolveThreadComposerBootstrapReady } from "./threadDetailComposerBootstrapState";

const EMPTY_PARENT_THREADS: readonly ThreadListEntry[] = [];
const EMPTY_PROJECT_THREAD_SUBSET_FILTERS =
  {} satisfies ProjectThreadSubsetFilters;

type MergeBasePickerOpenChangeHandler = NonNullable<
  ContextBannerMergeBaseConfig["onPickerOpenChange"]
>;
type SecondaryPanelChangeHandler = (panel: ThreadSecondaryPanelTab) => void;

interface RightPanelFileTabIconProps {
  path: string;
}

function RightPanelFileTabIcon({ path }: RightPanelFileTabIconProps) {
  const visual = resolveRightPanelFileVisual({ path });
  return <Icon name={visual.iconName} className="size-3.5" aria-hidden />;
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

function focusThreadDetailComposer(): void {
  window.requestAnimationFrame(() => {
    const composer = document.getElementById(
      THREAD_DETAIL_COMPOSER_TEXTAREA_ID,
    );
    if (!(composer instanceof HTMLTextAreaElement)) {
      return;
    }

    composer.focus();
    const cursor = composer.value.length;
    composer.setSelectionRange(cursor, cursor);
  });
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

export function ThreadDetailView() {
  const { projectId, threadId } = useAppRoute();
  const navigate = useNavigate();
  useFixedPanelTabsStorageMaintenance(threadId);
  const fixedPanelTabsState = useFixedPanelTabsState(threadId);
  const isPersistedSecondaryPanelOpen = useAtomValue(
    getThreadSecondaryPanelOpenAtom(threadId),
  );
  const setPersistedSecondaryPanelOpen = useSetAtom(
    getThreadSecondaryPanelOpenAtom(threadId),
  );
  const activeFixedSecondaryTab = getActiveFixedSecondaryTab({
    fixedPanelTabsState,
  });
  const openFixedSecondaryTab = getOpenFixedSecondaryTab({
    activeFixedSecondaryTab,
    isSecondaryPanelOpen: isPersistedSecondaryPanelOpen,
  });
  const activeFixedSecondaryTabId = activeFixedSecondaryTab?.id ?? null;
  const renderSecondaryPanelAsDrawer = useIsCompactViewport();
  const touchFixedPanelTabsState = useTouchFixedPanelTabsState(threadId);
  const setActiveFixedTerminal =
    useSetFixedRightTerminalActiveTerminal(threadId);
  const removeFixedTerminalTab = useRemoveFixedRightTerminalTab(threadId);
  const setThreadSecondaryPanel = useSetThreadSecondaryPanelSelection(threadId);
  const toggleDefaultPersistedSecondaryPanel =
    useToggleThreadSecondaryPanelSelection(threadId);
  const setThreadSecondaryPanelFromUrl =
    useCallback<SecondaryPanelChangeHandler>(
      (panel) => {
        setThreadSecondaryPanel(panel);
      },
      [setThreadSecondaryPanel],
    );
  useFixedPanelTabsSecondaryPanelUrlSync(
    threadId,
    setThreadSecondaryPanelFromUrl,
  );
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
  const appsQuery = useApps({
    enabled: thread !== undefined,
  });
  const {
    activateAppTab,
    activateBrowserTab,
    activateNewTab,
    activateHostFileTab,
    activateStorageFileTab,
    activateWorkspaceFileTab,
    activeAppId,
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
    closeAppTab,
    closeBrowserTab,
    closeHostFileTab,
    closeNewTab,
    closeStorageFileTab,
    closeWorkspaceFileTab,
    isNewTabActive,
    openBrowserTab,
    openNewTab,
    openHostFile,
    openStorageFile,
    openWorkspaceFile,
    orderedSecondaryFileTabs,
    selectFileSearchResult,
    updateBrowserTab,
  } = useThreadFileTabs({
    apps: appsQuery.data,
    threadId,
    environmentId: thread?.environmentId,
    storageFiles: threadStorageFiles?.files,
  });
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
            getThreadRoutePath({
              projectId: targetProjectId,
              threadId: resource.threadId,
            }),
          );
      }
      if (resource.entryKind !== "file") return null;
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
      thread?.environmentId,
    ],
  );
  const [openLinksInAppBrowser] = useOpenLinksInAppBrowserPreference();
  // The in-app browser surface only exists on desktop; on web this stays false
  // and chat links keep their external-open behavior.
  const desktopBrowserAvailable = isDesktopBrowserAvailable();
  // Popups (`window.open`/`target=_blank`) from a browser view open as a new
  // in-panel browser tab; the native OS popup is denied in the main process.
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi === null) {
      return;
    }
    return browserApi.onOpenTab(({ url }) => {
      openBrowserTab(url);
    });
  }, [openBrowserTab]);
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
  const terminalsListQuery = useThreadTerminals(threadId ?? "");
  const createTerminal = useCreateThreadTerminal();
  const closeTerminal = useCloseThreadTerminal();
  const activeTerminalCount = useMemo(
    () =>
      terminalsListQuery.data?.sessions.filter(
        (session) => session.status !== "exited",
      ).length ?? 0,
    [terminalsListQuery.data],
  );
  const terminalsById = useMemo(
    () =>
      new Map(
        (terminalsListQuery.data?.sessions ?? []).map((session) => [
          session.id,
          session,
        ]),
      ),
    [terminalsListQuery.data],
  );
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
    mergeBaseBranchOptionsTruncated,
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
    setThreadSecondaryPanel,
  });
  const {
    closePanel: closeSecondaryPanel,
    isOpen: isSecondaryPanelOpen,
    openCommitDiff: openSecondaryPanelCommitDiff,
    openDiffFile: openSecondaryPanelDiffFile,
    openDiffPanel: openSecondaryPanelDiffPanel,
    openPanel: openSecondaryPanel,
    togglePanel: toggleSecondaryPanel,
  } = useThreadSecondaryPanelVisibility({
    closePersistedPanel: closeThreadSecondaryPanel,
    isPersistedOpen: isPersistedSecondaryPanelOpen,
    isCompactViewport: renderSecondaryPanelAsDrawer,
    openPersistedCommitDiff,
    openPersistedDiffFile,
    openPersistedDiffPanel,
    openPersistedPanel: openPersistedSecondaryPanel,
    threadId,
    togglePersistedPanel: toggleDefaultPersistedSecondaryPanel,
  });
  const [storedConversationCollapsed, setStoredConversationCollapsed] = useAtom(
    getThreadConversationCollapsedAtom(threadId),
  );
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
  const handleOpenFileSearch = useCallback(() => {
    openNewTab();
    setNewTabFocusRequest((current) => current + 1);
  }, [openNewTab]);
  const handleCreateAppPromptPrefill = useCallback(() => {
    closeNewTab();
    closeSecondaryPanel();
    focusThreadDetailComposer();
  }, [closeNewTab, closeSecondaryPanel]);
  const handleStartTerminal = useCallback(() => {
    if (!canCreateTerminal || createTerminal.isPending || !threadId) {
      return;
    }
    createTerminal.mutate(
      {
        threadId,
        cols: DEFAULT_TERMINAL_COLS,
        rows: DEFAULT_TERMINAL_ROWS,
      },
      {
        onSuccess: (session) => {
          setPersistedSecondaryPanelOpen(true);
          setActiveFixedTerminal(session.id);
        },
      },
    );
  }, [
    canCreateTerminal,
    createTerminal,
    setActiveFixedTerminal,
    setPersistedSecondaryPanelOpen,
    threadId,
  ]);
  const handleActivateTerminalTab = useCallback(
    (terminalId: string) => {
      setPersistedSecondaryPanelOpen(true);
      setActiveFixedTerminal(terminalId);
    },
    [setActiveFixedTerminal, setPersistedSecondaryPanelOpen],
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
  const renderNewTabMenu = useCallback<NewTabMenuRenderer>(
    ({ closeMenu }) => (
      <NewTabActionMenu
        projectId={projectId ?? undefined}
        currentThreadId={threadId ?? ""}
        onSelect={selectFileSearchResult}
        onOpenFileSearch={handleOpenFileSearch}
        onCreateAppPromptPrefill={handleCreateAppPromptPrefill}
        onOpenBrowser={() => openBrowserTab()}
        onStartTerminal={canCreateTerminal ? handleStartTerminal : undefined}
        onCloseMenu={closeMenu}
      />
    ),
    [
      canCreateTerminal,
      handleCreateAppPromptPrefill,
      handleOpenFileSearch,
      handleStartTerminal,
      openBrowserTab,
      projectId,
      selectFileSearchResult,
      threadId,
    ],
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
  const appsById = useMemo(() => {
    const entries = new Map(
      (appsQuery.data ?? []).map((app) => [app.applicationId, app]),
    );
    return entries;
  }, [appsQuery.data]);
  const fileTabs = useMemo<SecondaryPanelFileTab[] | undefined>(() => {
    const filenameOf = (path: string) => path.split("/").at(-1) ?? path;
    const tabs = orderedSecondaryFileTabs.map((tab): SecondaryPanelFileTab => {
      switch (tab.kind) {
        case "app": {
          const app = appsById.get(tab.applicationId);
          const appName = app?.name ?? tab.applicationId;
          return {
            id: tab.id,
            filename: appName,
            isActive: tab.id === activeFixedSecondaryTabId,
            leadingVisual: app ? (
              <ResolvedAppIcon icon={app.icon} className="size-3.5" />
            ) : (
              <Icon name="AppWindow" className="size-3.5" aria-hidden />
            ),
            statusLabel: null,
            onSelect: () => activateAppTab(tab.applicationId),
            onClose: () => closeAppTab(tab.applicationId),
          };
        }
        case "browser": {
          const browserLabel =
            tab.title ?? (tab.url.length > 0 ? getBrowserUrlHost(tab.url) : "");
          return {
            id: tab.id,
            filename: browserLabel.length > 0 ? browserLabel : "Browser",
            isActive: tab.id === activeFixedSecondaryTabId,
            leadingVisual: (
              <Icon name="Globe" className="size-3.5" aria-hidden />
            ),
            statusLabel: null,
            onSelect: () => activateBrowserTab(tab.id),
            onClose: () => closeBrowserTab(tab.id),
          };
        }
        case "terminal": {
          const session = terminalsById.get(tab.terminalId);
          return {
            id: tab.id,
            filename: session?.title ?? "Terminal",
            isActive: tab.id === activeFixedSecondaryTabId,
            leadingVisual: (
              <Icon name="Terminal" className="size-3.5" aria-hidden />
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
            onSelect: () => activateWorkspaceFileTab(tab.path),
            onClose: () => closeWorkspaceFileTab(tab.path),
          };
        case "host-file-preview":
          return {
            id: tab.id,
            filename: filenameOf(tab.path),
            isActive: tab.id === activeFixedSecondaryTabId,
            leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
            statusLabel: null,
            onSelect: () => activateHostFileTab(tab.path),
            onClose: () => closeHostFileTab(tab.path),
          };
        case "thread-storage-file-preview":
          return {
            id: tab.id,
            filename: filenameOf(tab.path),
            isActive: tab.id === activeFixedSecondaryTabId,
            isPinned: tab.isPinned,
            leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
            statusLabel: null,
            onSelect: () => activateStorageFileTab(tab.path),
            onClose: () => closeStorageFileTab(tab.path),
          };
        case "new-tab":
          return {
            id: tab.id,
            filename: "New tab",
            isActive: tab.id === activeFixedSecondaryTabId,
            leadingVisual: (
              <Icon name="NewTab" className="size-3.5" aria-hidden />
            ),
            statusLabel: null,
            onSelect: activateNewTab,
            onClose: closeNewTab,
          };
      }
    });
    return tabs.length > 0 ? tabs : undefined;
  }, [
    activateAppTab,
    activateBrowserTab,
    activateNewTab,
    activateHostFileTab,
    activateStorageFileTab,
    activateWorkspaceFileTab,
    activeFixedSecondaryTabId,
    closeAppTab,
    closeBrowserTab,
    closeHostFileTab,
    closeNewTab,
    closeStorageFileTab,
    closeWorkspaceFileTab,
    handleActivateTerminalTab,
    handleCloseTerminalTab,
    orderedSecondaryFileTabs,
    appsById,
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
      const href = getThreadRoutePath({
        projectId: thread.projectId,
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
    }, [parentThread, thread?.parentThreadId, thread?.projectId]);
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
          href: getThreadRoutePath({
            projectId: entry.projectId,
            threadId: entry.id,
          }),
        }));
      if (activeItems.length === 0) return null;
      return { items: activeItems };
    }, [childThreadSubsetQuery.data]);
  const workflowsExperimentEnabled = useExperiments().workflows;
  const workflowsSection = useMemo(
    () =>
      workflowsExperimentEnabled
        ? selectThreadPromptWorkflowsSection(timelineRows)
        : null,
    [timelineRows, workflowsExperimentEnabled],
  );
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
        workspaceRootPath: localWorkspaceRootPath,
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
            workspaceRootPath: localWorkspaceRootPath,
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
      localWorkspaceRootPath,
      refetchThreadStorageFiles,
      thread?.environmentId,
      threadStorageRootPath,
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
  const timelineHeader = (
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
      environmentBranchName={threadBranchName}
      environmentIcon={threadEnvironmentIcon ?? undefined}
      environmentLabel={threadEnvironmentDisplay?.modeLabel}
      environmentCompactLabel={threadEnvironmentDisplay?.compactModeLabel}
      isEnvironmentActionPending={requestEnvironmentAction.isPending}
      onCreateNewThreadInWorktree={onCreateNewThreadInWorktree}
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
              optionsTruncated: mergeBaseBranchOptionsTruncated,
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
      workflowsSection={workflowsSection}
      thread={thread}
    />
  );
  const metadataStorage = {
    controller: storageBrowserController,
    filesError: threadStorageFilesError,
    isFilesLoading: isThreadStorageFilesLoading,
  };
  const handleOpenFileInEditor = buildOpenInEditorHandler({
    rootPath: localWorkspaceRootPath,
    canOpenPreferredTarget: canOpenPreferredFileTarget,
    openInPreferredTarget: openPathInPreferredFileTarget,
  });
  const handleOpenStorageFileInEditor = buildOpenInEditorHandler({
    rootPath: threadEnvironmentIsLocal ? threadStorageRootPath : null,
    canOpenPreferredTarget: canOpenPreferredFileTarget,
    openInPreferredTarget: openPathInPreferredFileTarget,
  });
  const handleOpenHostFileInEditor =
    threadEnvironmentIsLocal && canOpenPreferredFileTarget
      ? (path: string) => {
          void openPathInPreferredFileTarget({
            lineNumber: getFilePreviewLineRangeStart({
              lineRange: activeHostFileLineRange,
            }),
            path,
          });
        }
      : undefined;
  const workspaceFileCopyPath = activeWorkspaceFilePath
    ? resolveAbsoluteFilePath({
        path: activeWorkspaceFilePath,
        rootPath: environment?.path,
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
    workspaceRootPath: localWorkspaceRootPath,
  });
  const workspaceMarkdownLinkRouting = buildMarkdownPreviewLinkRouting({
    baseDir: workspaceFileLinkBaseDir,
    onOpenLink: handleOpenTimelineLink,
    onOpenLocalFileLink: handleOpenTimelineLocalFileLink,
    rootPath: environment?.path,
  });
  const hostMarkdownLinkRouting = buildMarkdownPreviewLinkRouting({
    baseDir: hostFileLinkBaseDir,
    onOpenLink: handleOpenTimelineLink,
    onOpenLocalFileLink: handleOpenTimelineLocalFileLink,
    rootPath: hostFileLinkRootPath,
  });
  const storageMarkdownLinkRouting = buildMarkdownPreviewLinkRouting({
    baseDir: storageFileLinkBaseDir,
    onOpenLink: handleOpenTimelineLink,
    onOpenLocalFileLink: handleOpenTimelineLocalFileLink,
    rootPath: threadStorageRootPath,
  });
  const activeTerminalId =
    activeFixedSecondaryTab?.kind === "terminal"
      ? activeFixedSecondaryTab.terminalId
      : null;
  const fileTabContent = activeTerminalId ? (
    <ThreadTerminalPanel
      canCreateTerminal={canCreateTerminal}
      threadId={thread.id}
    />
  ) : isNewTabActive ? (
    <NewTabPage
      projectId={projectId ?? undefined}
      environmentId={thread.environmentId ?? null}
      currentThreadId={thread.id}
      focusRequest={newTabFocusRequest}
      onSelect={selectFileSearchResult}
    />
  ) : activeAppId ? (
    <AppTabContent applicationId={activeAppId} threadId={thread.id} />
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
        isConversationCollapsed={storedConversationCollapsed}
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
          selectedMergeBaseBranch,
          mergeBaseBranchRef: selectedMergeBaseBranchRef,
          mergeBaseBranchOptions,
          mergeBaseBranchOptionsTruncated,
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
          renderNewTabMenu,
          onOpenFilePreview: (relativePath: string) => {
            openWorkspaceFile({
              lineRange: null,
              path: relativePath,
              source: { kind: "working-tree" },
              statusLabel: null,
            });
          },
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
          mergeBaseBranchOptionsTruncated={mergeBaseBranchOptionsTruncated}
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
