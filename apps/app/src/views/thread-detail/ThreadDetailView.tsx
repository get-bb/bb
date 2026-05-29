import { useCallback, useEffect, useMemo, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import type {
  ThreadTimelineLocalFileLink,
  TimelineTitleActionResolver,
} from "@/components/thread/timeline";
import {
  resolveEnvironmentMergeBaseBranch,
  type ThreadListEntry,
  type ThreadWithRuntime,
} from "@bb/domain";
import { appToast } from "@/components/ui/app-toast";
import type { ThreadSecondaryPanel as ThreadSecondaryPanelTab } from "@/lib/thread-secondary-panel";
import {
  useThreadTerminalPanelState,
  useThreadTerminalPanelStorageMaintenance,
  useToggleThreadTerminalPanel,
  useUpdateThreadTerminalPanelState,
} from "@/lib/thread-terminal-panel";
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
  useProjectThreadSubset,
  useThread,
  useThreadApps,
  useThreadComposerBootstrap,
  useThreadDetailBootstrap,
  useThreadPendingInteractions,
  type ProjectThreadSubsetFilters,
} from "../../hooks/queries/thread-queries";
import { ThreadGitActionDialog } from "@/components/dialogs/ThreadGitActionDialog";
import { PageShell } from "@/components/ui/page-shell.js";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import { ThreadActionsMenu } from "@/components/thread/ThreadActionsMenu";
import { ThreadWorkspaceOpenButton } from "@/components/thread/ThreadWorkspaceOpenButton";
import { formatEnvironmentDisplay } from "@bb/core-ui";
import { assertNever } from "@bb/thread-view";
import { useCreateThreadInWorktree } from "@/hooks/useCreateThreadInWorktree";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import { useConnectionAwareQueryState } from "@/hooks/queries/connection-aware-query-state";
import { useEffectiveHost } from "@/hooks/queries/effective-hosts";
import { useThreadTerminals } from "@/hooks/queries/thread-terminal-queries";
import { getEnvironmentWorkspaceLabelIconName } from "@/lib/environment-workspace-display";
import { resolveAbsoluteFilePath } from "@/lib/absolute-file-path";
import { useStandardManagerTimelinePreference } from "@/lib/manager-timeline-view-preference";
import { getGitStatusDisplay } from "@/components/workspace/workspace-status";
import {
  selectWorkspaceChangedFilesSection,
  type WorkspaceChangedFileSelection,
} from "@/components/workspace/workspace-change-summary";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { getThreadRoutePath } from "@/lib/app-route-paths";
import { useGitDiffPanel } from "@/components/secondary-panel/git-diff/useGitDiffPanel";
import { useThreadDetailTurnSummaryRows } from "./turn-summary/useThreadDetailTurnSummaryRows";
import { ThreadDetailHeader } from "./ThreadDetailHeader";
import {
  ThreadDetailPromptArea,
  THREAD_DETAIL_COMPOSER_TEXTAREA_ID,
} from "./ThreadDetailPromptArea";
import {
  type ContextBannerMergeBaseConfig,
  isThreadDisplayStatusBannerActive,
  type ThreadPromptManagedBySection,
  type ThreadPromptManagerChildrenSection,
} from "@/components/promptbox/banner/ThreadPromptContextBanner";
import { ThreadDetailSecondaryContent } from "./ThreadDetailSecondaryContent";
import { useThreadSecondaryPanelVisibility } from "./useThreadSecondaryPanelVisibility";
import type { HostConnectionNotice } from "./ThreadTimelinePane";
import { useThreadStorageViewer } from "@/components/secondary-panel/useThreadStorageViewer";
import { threadConversationCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import {
  HostFilePreviewTabContent,
  ThreadStorageFilePreviewTabContent,
  WorkspaceFilePreviewTabContent,
} from "@/components/secondary-panel/ThreadSecondaryPanelTabContent";
import { AppTabContent } from "@/components/secondary-panel/AppTabContent";
import { NewTabPage } from "@/components/secondary-panel/NewTabPage";
import { ResolvedAppIcon } from "@/components/secondary-panel/AppIcon";
import { useManagerStorageBrowser } from "@/components/secondary-panel/useManagerStorageBrowser";
import {
  STATUS_APP_ID,
  useThreadFileTabs,
} from "@/components/secondary-panel/useThreadFileTabs";
import type { SecondaryPanelFileTab } from "@/components/secondary-panel/ThreadSecondaryPanel";
import { useEnvironmentMergeBase } from "@/components/secondary-panel/git-diff/useEnvironmentMergeBase";
import { useThreadGitActions } from "./useThreadGitActions";
import { useThreadReadTracking } from "./useThreadReadTracking";
import { useThreadUnreadDividerState } from "./useThreadUnreadDividerState";
import { useThreadTimelinePages } from "./useThreadTimelinePages";
import { terminalsEnabledAtom } from "@/lib/system-config-atoms";
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
import {
  useFixedPanelTabsSecondaryPanelUrlSync,
  useFixedPanelTabsState,
  useFixedPanelTabsStorageMaintenance,
  useTouchFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
import {
  buildManagerSelectorOptions,
  isUnassignedStandardThread,
} from "./threadManagerSelectorOptions";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { ThreadTerminalPanel } from "@/components/thread/terminal/ThreadTerminalPanel";
import {
  getActiveFixedSecondaryTab,
  getActiveThreadSecondaryPanel,
  getSelectedThreadSecondaryPanel,
  useSetThreadSecondaryPanelSelection,
  useToggleThreadSecondaryPanelSelection,
} from "./threadSecondaryPanelSelection";
import { useAppRoute } from "@/hooks/useAppRoute";

const EMPTY_MANAGER_THREADS: readonly ThreadListEntry[] = [];
const EMPTY_PROJECT_THREAD_SUBSET_FILTERS =
  {} satisfies ProjectThreadSubsetFilters;
const MANAGER_THREAD_SUBSET_FILTERS = {
  type: "manager",
} satisfies ProjectThreadSubsetFilters;

type MergeBasePickerOpenChangeHandler = NonNullable<
  ContextBannerMergeBaseConfig["onPickerOpenChange"]
>;
type SecondaryPanelChangeHandler = (panel: ThreadSecondaryPanelTab) => void;

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

export function ThreadDetailView() {
  const { projectId, threadId } = useAppRoute();
  useFixedPanelTabsStorageMaintenance(threadId);
  useThreadTerminalPanelStorageMaintenance(threadId);
  const fixedPanelTabsState = useFixedPanelTabsState(threadId);
  const terminalPanelState = useThreadTerminalPanelState(threadId);
  const activeFixedSecondaryTab = getActiveFixedSecondaryTab({
    fixedPanelTabsState,
  });
  const selectedSecondaryPanel = getSelectedThreadSecondaryPanel({
    activeFixedSecondaryTab,
  });
  const activeSecondaryPanel = getActiveThreadSecondaryPanel({
    fixedPanelTabsState,
    selectedSecondaryPanel,
  });
  const renderSecondaryPanelAsDrawer = useIsCompactViewport();
  const touchFixedPanelTabsState = useTouchFixedPanelTabsState(threadId);
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
  const toggleTerminalPanel = useToggleThreadTerminalPanel(threadId);
  const updateTerminalPanelState = useUpdateThreadTerminalPanelState(threadId);
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
      providerId: thread?.providerId ?? undefined,
    },
  );
  const hasThreadComposerBootstrapSettled =
    threadComposerBootstrapQuery.isSuccess ||
    threadComposerBootstrapQuery.isError;
  const composerSeededStaleTime = threadComposerBootstrapQuery.isSuccess
    ? 10_000
    : undefined;
  const { data: parentThread } = useThread(thread?.parentThreadId ?? "");
  const { data: pendingInteractions = [] } = useThreadPendingInteractions(
    thread?.id ?? "",
    {
      enabled: hasThreadComposerBootstrapSettled,
      refetchOnMount: threadComposerBootstrapQuery.isSuccess ? false : "always",
      staleTime: composerSeededStaleTime,
    },
  );
  const hasPendingInteraction =
    getLatestPendingInteraction(pendingInteractions) !== null;
  const isManagerThread = thread?.type === "manager";
  const canUseGitUi = thread?.type === "standard";
  const [
    storedUseStandardManagerTimeline,
    setStoredUseStandardManagerTimeline,
  ] = useStandardManagerTimelinePreference();
  const useStandardManagerTimeline =
    isManagerThread && storedUseStandardManagerTimeline;
  const managerTimelineView = useStandardManagerTimeline
    ? "standard"
    : undefined;
  const unreadDividerState = useThreadUnreadDividerState({
    routeThreadId: threadId,
    thread,
    useStandardManagerTimeline,
  });
  const [hasRequestedMergeBaseOptions, setHasRequestedMergeBaseOptions] =
    useState(false);
  const [newTabFocusRequest, setNewTabFocusRequest] = useState(0);
  const shouldLoadManagerStorageFiles = isManagerThread;
  const {
    isThreadStorageFilesLoading,
    refetchThreadStorageFiles,
    threadStorageFiles,
    threadStorageFilesError,
    threadStorageRootPath,
  } = useThreadStorageViewer({
    activePath: null,
    fileListEnabled: shouldLoadManagerStorageFiles,
    filePreviewEnabled: false,
    threadId,
    threadType: thread?.type,
  });
  const threadAppsQuery = useThreadApps(threadId ?? "", {
    enabled: Boolean(threadId) && thread !== undefined,
  });
  const {
    activateAppTab,
    activateNewTab,
    activateHostFileTab,
    activateStorageFileTab,
    activateWorkspaceFileTab,
    activeAppId,
    activeHostFileLineNumber,
    activeHostFilePath,
    activeStorageFilePath,
    activeWorkspaceFileLineNumber,
    activeWorkspaceFilePath,
    activeWorkspaceFileSource,
    activeWorkspaceFileStatusLabel,
    clearActiveFileTabs,
    closeAppTab,
    closeHostFileTab,
    closeNewTab,
    closeStorageFileTab,
    closeWorkspaceFileTab,
    isNewTabActive,
    openNewTab,
    openApp,
    openHostFile,
    openStorageFile,
    openWorkspaceFile,
    orderedSecondaryFileTabs,
    selectFileSearchResult,
  } = useThreadFileTabs({
    apps: threadAppsQuery.data,
    threadId,
    environmentId: thread?.environmentId,
    threadType: thread?.type,
    storageFiles: threadStorageFiles?.files,
  });
  const storageBrowserController = useManagerStorageBrowser({
    files: threadStorageFiles?.files,
    onSelectPath: openStorageFile,
    selectedPath: activeStorageFilePath,
  });
  const togglePersistedSecondaryPanel = useCallback(() => {
    if (fixedPanelTabsState.secondary.isOpen) {
      setThreadSecondaryPanel(null);
      return;
    }
    if (isManagerThread && activeFixedSecondaryTab === null) {
      openApp(STATUS_APP_ID);
      return;
    }
    toggleDefaultPersistedSecondaryPanel();
  }, [
    activeFixedSecondaryTab,
    fixedPanelTabsState.secondary.isOpen,
    isManagerThread,
    openApp,
    setThreadSecondaryPanel,
    toggleDefaultPersistedSecondaryPanel,
  ]);
  const handleUseStandardManagerTimelineChange = useCallback(
    (checked: boolean) => {
      if (!isManagerThread) {
        return;
      }

      setStoredUseStandardManagerTimeline(checked);
    },
    [isManagerThread, setStoredUseStandardManagerTimeline],
  );
  const isUnassignedStandard = isUnassignedStandardThread(thread);
  const shouldLoadManagerThreads =
    threadQueryState.status === "ready" && isUnassignedStandard;
  const shouldLoadActiveProjectThreads =
    shouldLoadManagerThreads || isManagerThread;
  const projectThreadSubsetFilters = useMemo<ProjectThreadSubsetFilters>(() => {
    if (shouldLoadManagerThreads) {
      return MANAGER_THREAD_SUBSET_FILTERS;
    }
    if (isManagerThread && thread?.id) {
      return { parentThreadId: thread.id };
    }
    return EMPTY_PROJECT_THREAD_SUBSET_FILTERS;
  }, [isManagerThread, shouldLoadManagerThreads, thread?.id]);
  const projectThreadSubsetQuery = useProjectThreadSubset({
    enabled: shouldLoadActiveProjectThreads,
    filters: projectThreadSubsetFilters,
    projectId,
  });
  const managerThreads = useMemo(
    () =>
      shouldLoadManagerThreads
        ? (projectThreadSubsetQuery.data ?? EMPTY_MANAGER_THREADS)
        : EMPTY_MANAGER_THREADS,
    [projectThreadSubsetQuery.data, shouldLoadManagerThreads],
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
    managerTimelineView,
    threadId: threadId ?? "",
  });
  const sendMessage = useSendThreadMessage();
  const requestEnvironmentAction = useRequestEnvironmentAction();
  const markThreadRead = useMarkThreadRead();
  const updateEnvironment = useUpdateEnvironment();
  const updateThread = useUpdateThread({
    errorMessage: "Failed to assign manager.",
    lifecycleOperation: "assign_manager",
  });
  const terminalsEnabled = useAtomValue(terminalsEnabledAtom);
  const terminalsListQuery = useThreadTerminals(threadId ?? "", {
    enabled: terminalsEnabled,
  });
  const activeTerminalCount = useMemo(
    () =>
      terminalsListQuery.data?.sessions.filter(
        (session) => session.status !== "exited",
      ).length ?? 0,
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
    openDiffFile: openPersistedDiffFile,
    openThreadDiffPanel: openPersistedDiffPanel,
    openThreadSecondaryPanel: openPersistedSecondaryPanel,
    selectedMergeBaseBranch,
    selectedMergeBaseBranchRef,
    setMergeBaseBranchSearchQuery,
    setSelectedMergeBaseBranch,
  } = useGitDiffPanel({
    activeSecondaryPanel,
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
    openDiffFile: openSecondaryPanelDiffFile,
    openDiffPanel: openSecondaryPanelDiffPanel,
    openPanel: openSecondaryPanel,
    togglePanel: toggleSecondaryPanel,
  } = useThreadSecondaryPanelVisibility({
    closePersistedPanel: closeThreadSecondaryPanel,
    isPersistedOpen: fixedPanelTabsState.secondary.isOpen,
    isCompactViewport: renderSecondaryPanelAsDrawer,
    openPersistedDiffFile,
    openPersistedDiffPanel,
    openPersistedPanel: openPersistedSecondaryPanel,
    threadId,
    togglePersistedPanel: togglePersistedSecondaryPanel,
  });
  const [storedConversationCollapsed, setStoredConversationCollapsed] = useAtom(
    threadConversationCollapsedAtom,
  );
  // The preference only applies while the panel is open on a wide viewport;
  // there is nothing to expand into otherwise.
  const canCollapseConversation =
    isSecondaryPanelOpen && !renderSecondaryPanelAsDrawer;
  const isConversationCollapsed =
    canCollapseConversation && storedConversationCollapsed;
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
  const handleOpenNewTab = useCallback(() => {
    openNewTab();
    setNewTabFocusRequest((current) => current + 1);
  }, [openNewTab]);
  const handleCreateAppPromptPrefill = useCallback(() => {
    closeNewTab();
    closeSecondaryPanel();
    focusThreadDetailComposer();
  }, [closeNewTab, closeSecondaryPanel]);
  const handleTerminalPanelResize = useCallback(
    (sizePercent: number) => {
      const panelHeightPercent = Math.round(sizePercent);
      updateTerminalPanelState((current) => {
        if (current.panelHeightPercent === panelHeightPercent) {
          return current;
        }
        return {
          ...current,
          panelHeightPercent,
        };
      });
    },
    [updateTerminalPanelState],
  );
  const handleChangedFileClick = useCallback(
    (selection: WorkspaceChangedFileSelection) => {
      const openTarget = resolveWorkspaceChangedFileOpenTarget(selection);
      if (openTarget.kind === "preview") {
        openWorkspaceFile({
          lineNumber: null,
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
  const threadAppsById = useMemo(() => {
    const entries = new Map(
      (threadAppsQuery.data ?? []).map((app) => [app.id, app]),
    );
    return entries;
  }, [threadAppsQuery.data]);
  const fileTabs = useMemo<SecondaryPanelFileTab[] | undefined>(() => {
    const filenameOf = (path: string) => path.split("/").at(-1) ?? path;
    const tabs = orderedSecondaryFileTabs.map((tab): SecondaryPanelFileTab => {
      switch (tab.kind) {
        case "app": {
          const app = threadAppsById.get(tab.appId);
          const appName = app?.name ?? tab.appId;
          return {
            id: tab.id,
            filename: appName,
            isActive: tab.appId === activeAppId,
            isPinned: tab.appId === STATUS_APP_ID,
            leadingVisual: app ? (
              <ResolvedAppIcon icon={app.icon} className="size-3.5" />
            ) : undefined,
            statusLabel: null,
            onSelect: () => activateAppTab(tab.appId),
            onClose: () => closeAppTab(tab.appId),
          };
        }
        case "workspace-file-preview":
          return {
            id: tab.id,
            filename: filenameOf(tab.path),
            isActive: tab.path === activeWorkspaceFilePath,
            statusLabel: tab.statusLabel,
            onSelect: () => activateWorkspaceFileTab(tab.path),
            onClose: () => closeWorkspaceFileTab(tab.path),
          };
        case "host-file-preview":
          return {
            id: tab.id,
            filename: filenameOf(tab.path),
            isActive: tab.path === activeHostFilePath,
            statusLabel: null,
            onSelect: () => activateHostFileTab(tab.path),
            onClose: () => closeHostFileTab(tab.path),
          };
        case "thread-storage-file-preview":
          return {
            id: tab.id,
            filename: filenameOf(tab.path),
            isActive: tab.path === activeStorageFilePath,
            isPinned: tab.isPinned,
            statusLabel: null,
            onSelect: () => activateStorageFileTab(tab.path),
            onClose: () => closeStorageFileTab(tab.path),
          };
        case "new-tab":
          return {
            id: tab.id,
            filename: "New tab",
            isActive: isNewTabActive,
            statusLabel: null,
            onSelect: activateNewTab,
            onClose: closeNewTab,
          };
      }
    });
    return tabs.length > 0 ? tabs : undefined;
  }, [
    activateAppTab,
    activateNewTab,
    activateHostFileTab,
    activateStorageFileTab,
    activateWorkspaceFileTab,
    activeAppId,
    activeHostFilePath,
    activeStorageFilePath,
    activeWorkspaceFilePath,
    closeAppTab,
    closeHostFileTab,
    closeNewTab,
    closeStorageFileTab,
    closeWorkspaceFileTab,
    isNewTabActive,
    orderedSecondaryFileTabs,
    threadAppsById,
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
  const workStatus = workStatusQuery.data;
  const workspaceStatusError = workStatusQuery.error;
  const workspaceStatus = workspaceStatusError
    ? undefined
    : (workStatus ?? undefined);
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
  const bootstrapResolvedMissingEnvironmentHost =
    threadDetailBootstrapQuery.isSuccess &&
    threadDetailBootstrapQuery.data.environment !== undefined &&
    threadDetailBootstrapQuery.data.environment !== null &&
    threadDetailBootstrapQuery.data.host === null;
  const { data: environmentHost } = useEffectiveHost(environment?.hostId, {
    enabled: !bootstrapResolvedMissingEnvironmentHost,
  });
  const managedBySection: ThreadPromptManagedBySection | null = useMemo(() => {
    if (!thread?.parentThreadId) return null;
    const href = getThreadRoutePath({
      projectId: thread.projectId,
      threadId: thread.parentThreadId,
    });
    if (parentThread === undefined) {
      // Parent record not yet loaded — show id-based fallback so the user
      // doesn't get a flicker of "no manager" before resolution.
      return {
        managerName: `Manager ${thread.parentThreadId.slice(0, 8)}`,
        href,
      };
    }
    // Plan ownership invariants: silently exclude dirty references rather
    // than rendering a stale or unreachable manager link.
    if (
      parentThread.type !== "manager" ||
      parentThread.archivedAt !== null ||
      parentThread.deletedAt !== null ||
      parentThread.projectId !== thread.projectId
    ) {
      return null;
    }
    return {
      managerName: getThreadDisplayTitle(parentThread),
      href,
    };
  }, [parentThread, thread?.parentThreadId, thread?.projectId]);
  const managerChildrenSection: ThreadPromptManagerChildrenSection | null =
    useMemo(() => {
      if (!isManagerThread) return null;
      const list = projectThreadSubsetQuery.data ?? [];
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
    }, [isManagerThread, projectThreadSubsetQuery.data]);
  const isThreadTimelinePending = timelineLoading && timelineRows.length === 0;
  const {
    erroredTurnSummaryIds,
    handleLoadTurnSummaryRows,
    loadingTurnSummaryIds,
    turnSummaryRowsById,
  } = useThreadDetailTurnSummaryRows({
    managerTimelineView,
    timelineRows,
    threadId,
  });
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
    mergeBaseBranchRef: selectedMergeBaseBranchRef,
    mergeBaseBranchOptions,
    mergeBaseRemoteBranchOptions,
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
  const managerSelectorOptions = useMemo(
    () =>
      buildManagerSelectorOptions({
        currentThreadId: thread?.id,
        isManagerThread,
        managerThreads,
        parentThreadDisplayName,
        parentThreadId,
      }),
    [
      isManagerThread,
      managerThreads,
      parentThreadDisplayName,
      parentThreadId,
      thread?.id,
    ],
  );
  const handleAssignManager = useCallback(
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
          lineNumber: resolution.request.lineNumber,
          path: resolution.request.relativePath,
          source: { kind: "working-tree" },
          statusLabel: null,
        });
        return true;
      }

      if (resolution.kind === "open-thread-storage-path") {
        openStorageFile(resolution.request.relativePath);
        return true;
      }

      openHostFile({
        lineNumber: resolution.request.lineNumber,
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
        !isManagerThread ||
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
      isManagerThread,
      localWorkspaceRootPath,
      refetchThreadStorageFiles,
      thread?.environmentId,
      threadStorageRootPath,
    ],
  );
  const handleTimelineTitleAction = useCallback<TimelineTitleActionResolver>(
    (action) => {
      switch (action.kind) {
        case "open-file-diff":
          // Manager threads can't render the diff panel (showGitDiffTab is
          // gated on canUseGitUi); leave the title content as plain text in
          // that case rather than producing a clickable affordance that would
          // route nowhere.
          if (isManagerThread) {
            return null;
          }
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
    [isManagerThread, openSecondaryPanelDiffFile],
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
  const turnSummaryRowsIdentity = `${thread.id}:${
    managerTimelineView ?? "default"
  }`;
  const hasAssignableManager = managerSelectorOptions.some(
    (option) => option.value !== "none",
  );
  const canAssignToManager = isUnassignedStandard && hasAssignableManager;
  const canTakeOverThread =
    thread.type === "standard" && Boolean(thread.parentThreadId);
  const threadEnvironmentDisplay = environment
    ? formatEnvironmentDisplay({
        environment,
        isLocalHost: threadEnvironmentIsLocal,
        hostName: environmentHost?.name,
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
  const canCreateTerminal =
    terminalsEnabled &&
    thread.environmentId !== null &&
    environment?.status === "ready";
  const threadGitStatusDisplay = getGitStatusDisplay(workspaceStatus, {
    mergeBaseBranch,
    showBranchComparison: showBranchComparisonUi,
    error: workspaceStatusError,
    workspaceDeleted: isWorkspaceDeleted,
  });
  const threadTitle = getThreadDisplayTitle(thread);
  const threadActionsMenu = (
    <ThreadActionsMenu
      thread={thread}
      triggerClassName={HEADER_ICON_BUTTON_CLASS}
      align="end"
      viewerToggleLabel={isManagerThread ? "Use standard timeline" : undefined}
      viewerToggleChecked={
        isManagerThread ? useStandardManagerTimeline : undefined
      }
      onViewerToggleCheckedChange={
        isManagerThread ? handleUseStandardManagerTimelineChange : undefined
      }
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
      canCollapseConversation={canCollapseConversation}
      isConversationCollapsed={isConversationCollapsed}
      isManagedThread={Boolean(parentThreadId)}
      isManagerThread={isManagerThread}
      isSecondaryPanelOpen={isSecondaryPanelOpen}
      activeTerminalCount={activeTerminalCount}
      isTerminalPanelOpen={terminalsEnabled && terminalPanelState.isOpen}
      isThreadGitActionPending={gitActions.isThreadGitActionPending}
      onOpenThreadGitAction={gitActions.threadGitActionDialog.onOpen}
      onToggleConversationCollapse={toggleConversationCollapse}
      onToggleSecondaryPanel={toggleSecondaryPanel}
      onToggleTerminalPanel={toggleTerminalPanel}
      showTerminalPanelToggle={terminalsEnabled}
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
      environmentHostConnected={
        environmentHost && !threadEnvironmentIsLocal
          ? environmentHost.status === "connected"
          : undefined
      }
      environmentIcon={threadEnvironmentIcon ?? undefined}
      environmentLabel={threadEnvironmentDisplay?.modeLabel}
      environmentHostLabel={
        threadEnvironmentDisplay?.location === "remote"
          ? (threadEnvironmentDisplay.hostLabel ?? undefined)
          : undefined
      }
      isEnvironmentActionPending={requestEnvironmentAction.isPending}
      onCreateNewThreadInWorktree={onCreateNewThreadInWorktree}
      composerQueriesEnabled={hasThreadComposerBootstrapSettled}
      composerQueriesRefetchOnMount={
        threadComposerBootstrapQuery.isSuccess ? false : "always"
      }
      composerQueriesStaleTime={composerSeededStaleTime}
      onChangedFileClick={handleChangedFileClick}
      openThreadDiffPanel={openSecondaryPanelDiffPanel}
      projectId={projectId}
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
      managedBySection={managedBySection}
      managerChildrenSection={managerChildrenSection}
      thread={thread}
    />
  );
  const metadataStorage =
    thread.type === "manager"
      ? {
          controller: storageBrowserController,
          filesError: threadStorageFilesError,
          isFilesLoading: isThreadStorageFilesLoading,
        }
      : undefined;
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
            lineNumber: activeHostFileLineNumber,
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
  const fileTabContent = isNewTabActive ? (
    <NewTabPage
      projectId={projectId ?? undefined}
      environmentId={thread.environmentId ?? null}
      currentThreadId={thread.id}
      currentThreadType={thread.type}
      focusRequest={newTabFocusRequest}
      onCreateAppPromptPrefill={handleCreateAppPromptPrefill}
      onSelect={selectFileSearchResult}
    />
  ) : activeAppId ? (
    <AppTabContent appId={activeAppId} threadId={thread.id} />
  ) : activeWorkspaceFilePath ? (
    <WorkspaceFilePreviewTabContent
      activePath={activeWorkspaceFilePath}
      copyPath={workspaceFileCopyPath}
      environmentId={thread.environmentId}
      lineNumber={activeWorkspaceFileLineNumber}
      onOpenInEditor={handleOpenFileInEditor}
      source={activeWorkspaceFileSource}
      statusLabel={activeWorkspaceFileStatusLabel}
      threadId={thread.id}
    />
  ) : activeHostFilePath ? (
    <HostFilePreviewTabContent
      activePath={activeHostFilePath}
      environmentId={thread.environmentId}
      lineNumber={activeHostFileLineNumber}
      onOpenInEditor={handleOpenHostFileInEditor}
      threadId={thread.id}
    />
  ) : activeStorageFilePath ? (
    <ThreadStorageFilePreviewTabContent
      activePath={activeStorageFilePath}
      copyPath={storageFileCopyPath}
      onOpenInEditor={handleOpenStorageFileInEditor}
      threadId={thread.id}
    />
  ) : undefined;

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
          managerThreads,
          canAssignToManager,
          canTakeOverThread,
          environmentHost: environmentHost ?? null,
          environmentIsLocal: threadEnvironmentIsLocal,
          environment: environment ?? null,
          workspaceStatus,
          workspaceStatusError: workspaceStatusError ?? null,
          selectedMergeBaseBranch,
          mergeBaseBranchRef: selectedMergeBaseBranchRef,
          mergeBaseBranchOptions,
          mergeBaseBranchOptionsTruncated,
          mergeBaseRemoteBranchOptions,
          isLoadingMergeBaseBranchOptions,
          updateThreadPending:
            updateThread.isPending || updateEnvironment.isPending,
          storage: metadataStorage,
          onAssignManager: handleAssignManager,
          onMergeBaseBranchChange: handleMergeBaseBranchChange,
          onMergeBasePickerOpenChange: handleMergeBasePickerOpenChange,
          onMergeBaseBranchSearchQueryChange: setMergeBaseBranchSearchQuery,
          onChangedFileClick: canUseGitUi ? handleChangedFileClick : undefined,
        }}
        secondaryPanel={{
          activePanel: selectedSecondaryPanel,
          canUseGitUi,
          defaultMergeBaseBranch: resolvedDefaultMergeBaseBranch,
          environmentId: thread.environmentId ?? undefined,
          workspaceRootPath: environment?.path,
          fileTabs,
          fileTabContent,
          isOpen: isSecondaryPanelOpen,
          onClose: closeSecondaryPanel,
          onCollapse: closeSecondaryPanel,
          onOpenFileInEditor: handleOpenFileInEditor,
          onOpenNewTab: handleOpenNewTab,
          onOpenFilePreview: (relativePath: string) => {
            openWorkspaceFile({
              lineNumber: null,
              path: relativePath,
              source: { kind: "working-tree" },
              statusLabel: null,
            });
          },
          onPanelFocus: handleSecondaryPanelFocus,
          onPanelChange: handleSecondaryPanelChange,
          showGitDiffTab: canUseGitUi,
        }}
        terminalPanel={
          terminalsEnabled ? (
            <ThreadTerminalPanel
              canCreateTerminal={canCreateTerminal}
              threadId={thread.id}
            />
          ) : undefined
        }
        terminalPanelHeightPercent={terminalPanelState.panelHeightPercent}
        terminalPanelOpen={terminalsEnabled && terminalPanelState.isOpen}
        onTerminalPanelResize={handleTerminalPanelResize}
        timeline={{
          activeThinking,
          hasOlderTimelineRows,
          hostConnectionNotice,
          isLoadingOlderTimelineRows,
          isThreadTimelinePending,
          timelineError: Boolean(timelineError),
          loadingTurnSummaryIds,
          erroredTurnSummaryIds,
          onLoadOlderRows: loadOlderTimelineRows,
          onLoadTurnSummaryRows: handleLoadTurnSummaryRows,
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
          turnSummaryRowsIdentity,
          turnSummaryRowsById,
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
          threadId={thread.id}
          threadType={thread.type}
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
