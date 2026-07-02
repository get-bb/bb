import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
  isRunningThreadRuntimeDisplayStatus,
  type ThreadTimelineForkMessageHandler,
  type ThreadTimelineSideChatMessageHandler,
  type ThreadTimelineSendToMainMessageHandler,
  type ThreadTimelineLinkHandler,
  type ThreadTimelineLocalFileLink,
  type ThreadTimelineLocalFileLinkHandler,
  type TimelineTitleActionResolver,
  useThreadTimelineController,
} from "@/components/thread/timeline";
import {
  isActiveTerminalSessionStatus,
  resolveEnvironmentMergeBaseBranch,
  type ThreadListEntry,
  type ThreadWithRuntime,
} from "@bb/domain";
import type {
  PullRequestMergeMethod,
  TerminalSession,
} from "@bb/server-contract";
import { appToast } from "@/components/ui/app-toast";
import type { ThreadSecondaryPanel as ThreadSecondaryPanelTab } from "@/lib/thread-secondary-panel";
import { useForkThreadFromMessage } from "@/hooks/useForkThreadFromMessage";
import { isThreadForkable } from "@/lib/fork-thread-request";
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
  type ProjectThreadSubsetFilters,
} from "../../hooks/queries/thread-queries";
import { isTransientReadError } from "@/hooks/queries/query-helpers";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
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
import { useHosts } from "@/hooks/queries/host-queries";
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
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { createLocalStorageEnumStorage } from "@/lib/browser-storage";
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
import { SideChatTabDeck } from "@/components/secondary-panel/SideChatTabDeck";
import { NewTabPage } from "@/components/secondary-panel/NewTabPage";
import { resolveRightPanelFileVisual } from "@/components/secondary-panel/rightPanelFileVisuals";
import { COARSE_POINTER_COMPACT_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { Icon } from "@/components/ui/icon.js";
import {
  getBbDesktopInfo,
  getDesktopBrowserApi,
  isDesktopBrowserAvailable,
  MACOS_APP_REGION_NO_DRAG_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
} from "@/lib/bb-desktop";
import {
  openUrlByPreference,
  useOpenLinksInAppBrowserPreference,
} from "@/lib/in-app-browser-link-preference";
import {
  openUrlInExternalBrowser,
  UrlOpenRoutingProvider,
} from "@/lib/url-open-routing";
import { getFilePreviewLineRangeStart } from "@/lib/file-preview";
import { getBrowserUrlHost } from "@/lib/browser-url";
import {
  useThreadStorageBrowser,
  type ThreadStoragePathSelectHandler,
} from "@/components/secondary-panel/useThreadStorageBrowser";
import {
  useThreadFileTabs,
  type FileSearchSelection,
} from "@/components/secondary-panel/useThreadFileTabs";
import { useThreadOpenFileSignal } from "@/components/secondary-panel/useThreadOpenFileSignal";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import type { SecondaryPanelFileTab } from "@/components/secondary-panel/ThreadSecondaryPanel";
import { useEnvironmentMergeBase } from "@/components/secondary-panel/git-diff/useEnvironmentMergeBase";
import { useThreadGitActions } from "./useThreadGitActions";
import { useThreadReadTracking } from "@/hooks/useThreadReadTracking";
import { useThreadUnreadDividerState } from "./useThreadUnreadDividerState";
import {
  buildTerminalSyncedSecondaryFileTabs,
  findActiveTerminalIdInSecondaryFileTabs,
  getRetainedTerminalTabId,
  syncTerminalTabsInFixedPanelState,
} from "@/components/secondary-panel/terminalPanelTabs";
import {
  buildOpenInEditorHandler,
  resolveEnvironmentOpenContext,
  resolveWorkspaceChangedFileOpenTarget,
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
import { isThreadNewTabKeyboardShortcut } from "./threadDetailNewTabShortcut";

const EMPTY_PARENT_THREADS: readonly ThreadListEntry[] = [];
const EMPTY_PROJECT_THREAD_SUBSET_FILTERS =
  {} satisfies ProjectThreadSubsetFilters;
const PARENT_THREAD_SELECTOR_FILTERS = {
  excludeSideChats: true,
} satisfies ProjectThreadSubsetFilters;
const EMPTY_TERMINAL_SESSIONS: readonly TerminalSession[] = [];
const DEFAULT_PULL_REQUEST_MERGE_METHOD: PullRequestMergeMethod = "merge";
const PULL_REQUEST_MERGE_METHOD_STORAGE_KEY =
  "bb.pullRequest.mergeMethod";

function isPullRequestMergeMethod(
  value: string,
): value is PullRequestMergeMethod {
  return value === "merge" || value === "squash" || value === "rebase";
}

const pullRequestMergeMethodAtom = atomWithStorage<PullRequestMergeMethod>(
  PULL_REQUEST_MERGE_METHOD_STORAGE_KEY,
  DEFAULT_PULL_REQUEST_MERGE_METHOD,
  createLocalStorageEnumStorage<PullRequestMergeMethod>(
    isPullRequestMergeMethod,
  ),
  { getOnInit: true },
);

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

function getPullRequestMergeLoadingTitle(
  method: PullRequestMergeMethod,
): string {
  switch (method) {
    case "merge":
      return "Merging pull request";
    case "squash":
      return "Squash merging pull request";
    case "rebase":
      return "Rebase merging pull request";
  }
}

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
        onClick={onNewQuickThread}
      >
        <Icon name="EditFile" />
      </button>
      <button
        type="button"
        className={buttonClassName}
        aria-label="Open in main app"
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
  const retainedTerminalId = getRetainedTerminalTabId({
    activeTab: activeFixedSecondaryTab,
    isPanelOpen: isPersistedSecondaryPanelOpenForSurface,
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
    isRecoverableLoadingError: isTransientReadError(error),
  });
  const threadOriginKind = thread?.originKind ?? thread?.childOrigin ?? null;
  const threadSourceThreadId =
    thread?.sourceThreadId ??
    (thread && threadOriginKind ? thread.parentThreadId : null);
  const { data: parentThread } = useThread(thread?.parentThreadId ?? "");
  const { data: sourceThread } = useThread(threadSourceThreadId ?? "");
  const pendingInteractionsQuery = useThreadPendingInteractions(
    thread?.id ?? "",
    {
      enabled: threadQueryState.status === "ready" && Boolean(thread?.id),
    },
  );
  const pendingInteractions = pendingInteractionsQuery.data ?? [];
  const pendingInteractionsInitialLoading =
    pendingInteractionsQuery.data === undefined &&
    (pendingInteractionsQuery.isLoading || pendingInteractionsQuery.isFetching);
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
    activeSideChatTabId,
    activateSideChatTab,
    browserTabs,
    clearActiveFileTabs,
    activateTab,
    closeTab,
    closeSideChatTab,
    isNewTabActive,
    openTab,
    openSideChat,
    openExistingSideChatTab,
    orderedSecondaryFileTabs,
    reorderFileTab,
    selectFileSearchResult,
    setSideChatThreadId,
    sideChatTabs,
    updateBrowserTab,
  } = useThreadFileTabs({
    threadId,
    environmentId: thread?.environmentId,
    retainedTerminalId,
    storageFiles: threadStorageFiles?.files,
    terminalSessions: terminalsListQuery.data?.sessions,
  });
  useThreadOpenFileSignal({
    threadId,
    environmentId: thread?.environmentId,
    openTab,
  });
  const browserDeckThreadId = thread?.id ?? null;
  const browserDeckEnvironmentId = thread?.environmentId ?? null;
  // Browser tabs are not rendered through the single `fileTabContent` slot:
  // each one keeps a live native view that must persist across tab switches, so
  // the deck stays mounted independently of which tab is active.
  const renderBrowserDeck = useCallback(
    ({
      canShowNativeBrowserView,
    }: {
      canShowNativeBrowserView: boolean;
    }) => {
      if (browserDeckThreadId === null) {
        return null;
      }
      return (
        <BrowserTabDeck
          browserTabs={browserTabs}
          activeBrowserTabId={activeBrowserTab?.id ?? null}
          environmentId={browserDeckEnvironmentId}
          canShowNativeBrowserView={canShowNativeBrowserView}
          threadId={browserDeckThreadId}
          onUpdate={updateBrowserTab}
        />
      );
    },
    [
      activeBrowserTab?.id,
      browserTabs,
      browserDeckEnvironmentId,
      browserDeckThreadId,
      updateBrowserTab,
    ],
  );
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
  // and handled web links keep their external-open behavior.
  const desktopBrowserAvailable = isDesktopBrowserAvailable();
  const canOpenUrlsInAppBrowser =
    props.surface === "page" && desktopBrowserAvailable;
  const browserTabIds = useMemo(
    () => new Set(browserTabs.map((tab) => tab.id)),
    [browserTabs],
  );
  const isThreadRoot = isRootThread(thread);
  const shouldLoadParentThreads =
    threadQueryState.status === "ready" && isThreadRoot;
  const parentThreadSubsetQuery = useProjectThreadSubset({
    enabled: shouldLoadParentThreads,
    filters: PARENT_THREAD_SELECTOR_FILTERS,
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
    activePromptMode,
    activeThinking,
    activeWorkflow,
    activeBackgroundCommands,
    contextWindowUsage,
    goal,
    hasOlderTimelineRows,
    isLoadingOlderTimelineRows,
    loadOlderTimelineRows,
    pendingTodos,
    timelineError,
    timelineLoading,
    timelineRows,
  } = useThreadTimelineController({
    threadId: threadId ?? "",
  });
  const sendMessage = useSendThreadMessage();
  const requestEnvironmentAction = useRequestEnvironmentAction();
  const [pullRequestMergeMethod, setPullRequestMergeMethod] = useAtom(
    pullRequestMergeMethodAtom,
  );
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
    () => new Map(terminalSessions.map((session) => [session.id, session])),
    [terminalSessions],
  );
  const syncedOrderedSecondaryFileTabs = useMemo(
    () =>
      buildTerminalSyncedSecondaryFileTabs({
        orderedTabs: orderedSecondaryFileTabs,
        retainedTerminalId,
        terminalSessions,
      }),
    [orderedSecondaryFileTabs, retainedTerminalId, terminalSessions],
  );
  useEffect(() => {
    if (terminalsListQuery.data === undefined) {
      return;
    }
    updateFixedPanelTabsState((state) =>
      syncTerminalTabsInFixedPanelState({
        retainedTerminalId,
        state,
        terminalSessions,
      }),
    );
  }, [
    retainedTerminalId,
    terminalSessions,
    terminalsListQuery.data,
    updateFixedPanelTabsState,
  ]);
  const hostConnectionNotice = useMemo(
    () => (thread ? buildHostConnectionNotice(thread) : null),
    [thread],
  );
  const environmentQuery = useEnvironment(thread?.environmentId, {
    enabled: hasThreadDetailBootstrapSettled,
    staleTime: 5_000,
  });
  const environment = environmentQuery.data;
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
  const forkThreadFromMessage = useForkThreadFromMessage({
    sourceThread: thread ?? null,
  });
  const handleForkMessage =
    useCallback<ThreadTimelineForkMessageHandler>((target) => {
      void forkThreadFromMessage(target);
    }, [forkThreadFromMessage]);
  const isForkAvailable = isThreadForkable(thread ?? null);
  const canUseSideChatPanel = props.surface !== "popout";
  const canStartSideChat =
    canUseSideChatPanel && (thread?.canSpawnChild ?? false);
  const handleSideChatMessage =
    useCallback<ThreadTimelineSideChatMessageHandler>(
      (target) => {
        if (!canStartSideChat || !threadId) return;
        openSideChat({
          sourceThreadId: threadId,
          sourceMessageText: target.messageText,
          sourceSeqEnd: target.sourceSeqEnd,
        });
      },
      [canStartSideChat, openSideChat, threadId],
    );
  // A side chat started from the new-tab page has no anchor message, so it forks
  // from the thread's tip (empty source text ⇒ no "replying to" reference).
  const handleStartSideChat = useCallback(() => {
    if (!canStartSideChat || !threadId) return;
    openSideChat({
      replaceNewTab: true,
      sourceThreadId: threadId,
      sourceMessageText: "",
    });
  }, [canStartSideChat, openSideChat, threadId]);
  // Same scope (`projectId` + `thread.id`) the composer's `ThreadDetailPromptArea`
  // uses, so the timeline "Add to chat" action and the composer share one
  // localStorage-backed draft — the quoted text is appended to the draft as a
  // `> ` blockquote block and renders inline in the composer immediately, with
  // no duplicated draft state.
  const selectionPromptDraft = usePromptDraftStorage({
    kind: "thread",
    projectId: thread?.projectId ?? projectId ?? "",
    threadId: thread?.id ?? "",
  });
  const addQuoteToComposer = selectionPromptDraft.addQuote;
  // Bumped each time a quote is appended so the composer (a sibling component
  // sharing the localStorage draft) can focus its caret at the end, ready for
  // the reply under the quote.
  const [composerFocusRequestNonce, setComposerFocusRequestNonce] = useState(0);
  const handleSelectionAddToChat = useCallback(
    (text: string) => {
      addQuoteToComposer(text);
      setComposerFocusRequestNonce((nonce) => nonce + 1);
    },
    [addQuoteToComposer],
  );
  // "Reply in side chat" anchors the side chat on the user's SELECTION (passed
  // as the side-chat source text), so the reply's visible anchor and the
  // context handed to the agent are exactly the highlighted text — unlike the
  // per-message Reply button, which anchors on the whole message.
  const handleSelectionReplyInSideChat = useCallback(
    (target: { messageText: string; sourceSeqEnd?: number }) => {
      handleSideChatMessage(target);
    },
    [handleSideChatMessage],
  );
  const sendSideChatMessageToMain =
    useCallback<ThreadTimelineSendToMainMessageHandler>(
      (target) => {
        if (
          thread?.id === undefined ||
          threadOriginKind !== "side-chat" ||
          threadSourceThreadId === null ||
          sendMessage.isPending
        ) {
          return;
        }

        sendMessage.mutate({
          id: threadSourceThreadId,
          input: [{ type: "text", text: target.messageText, mentions: [] }],
          mode: "auto",
          senderThreadId: thread.id,
        });
      },
      [
        sendMessage,
        thread?.id,
        threadOriginKind,
        threadSourceThreadId,
      ],
    );
  const handleSendToMainMessage =
    threadOriginKind === "side-chat" && threadSourceThreadId !== null
      ? sendSideChatMessageToMain
      : undefined;
  const canUseGitUi = environment?.isGitRepo === true;
  const canCreateTerminal =
    thread?.environmentId !== null &&
    thread?.environmentId !== undefined &&
    environment?.status === "ready" &&
    connectedHostIds.has(environment.hostId);
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
    openCompactDrawer,
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
  const openBrowserTabAndReveal = useCallback(
    (url?: string) => {
      openBrowserTab(url);
      openCompactDrawer();
    },
    [openBrowserTab, openCompactDrawer],
  );
  const handleOpenUrlByPreference = useCallback(
    (url: string) =>
      openUrlByPreference({
        desktopBrowserAvailable: canOpenUrlsInAppBrowser,
        openExternalBrowser: openUrlInExternalBrowser,
        openInAppBrowser: openBrowserTabAndReveal,
        openLinksInAppBrowser,
        url,
      }),
    [canOpenUrlsInAppBrowser, openBrowserTabAndReveal, openLinksInAppBrowser],
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
          handleOpenUrlByPreference(url);
        }
      });
    }
    return browserApi.onOpenTab(({ url }) => {
      if (isRoutePath({ path: url })) {
        return;
      }
      handleOpenUrlByPreference(url);
    });
  }, [browserTabIds, handleOpenUrlByPreference]);
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
    openCompactDrawer();
    setNewTabFocusRequest((current) => current + 1);
  }, [openCompactDrawer, openNewTab]);
  useEffect(() => {
    if (props.surface !== "page") {
      return;
    }
    const desktopInfo = getBbDesktopInfo();
    if (desktopInfo === null || desktopInfo.onOpenNewTab === undefined) {
      return;
    }
    return desktopInfo.onOpenNewTab(handleOpenNewTab);
  }, [handleOpenNewTab, props.surface]);
  useEffect(() => {
    if (props.surface !== "page" || getBbDesktopInfo() === null) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isThreadNewTabKeyboardShortcut(event)) {
        return;
      }
      event.preventDefault();
      handleOpenNewTab();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleOpenNewTab, props.surface]);
  const handleOpenBrowser = useCallback(() => {
    openBrowserTabAndReveal();
  }, [openBrowserTabAndReveal]);
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
        openCompactDrawer();
      })
      .catch(() => undefined);
  }, [
    canCreateTerminal,
    closeTab,
    createTerminal,
    openCompactDrawer,
    setActiveFixedTerminal,
    threadId,
  ]);
  const handleActivateTerminalTab = useCallback(
    (terminalId: string) => {
      setActiveFixedTerminal(terminalId);
      openCompactDrawer();
    },
    [openCompactDrawer, setActiveFixedTerminal],
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
              onSelect: () => handleActivateFileTab(tab.id),
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
              onSelect: () => handleActivateFileTab(tab.id),
              onClose: () => closeTab(tab.id),
            };
          case "host-file-preview":
            return {
              id: tab.id,
              filename: filenameOf(tab.path),
              isActive: tab.id === activeFixedSecondaryTabId,
              leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
              statusLabel: null,
              onSelect: () => handleActivateFileTab(tab.id),
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
              onSelect: () => handleActivateFileTab(tab.id),
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
              onSelect: () => handleActivateFileTab(tab.id),
              onClose: () => closeTab(tab.id),
            };
          case "side-chat":
            return {
              id: tab.id,
              filename: tab.title,
              isActive: tab.id === activeSideChatTabId,
              leadingVisual: (
                <Icon name="SideChat" className="size-3.5" aria-hidden />
              ),
              statusLabel: null,
              onSelect: () => activateSideChatTab(tab.id),
              onClose: () => closeSideChatTab(tab.id),
            };
        }
      },
    );
    return tabs.length > 0 ? tabs : undefined;
  }, [
    activateSideChatTab,
    activeFixedSecondaryTabId,
    activeSideChatTabId,
    closeTab,
    closeSideChatTab,
    handleActivateFileTab,
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
  const handlePullRequestReady = useCallback(async () => {
    const environmentId = thread?.environmentId;
    if (!environmentId) {
      return;
    }
    const toastId = appToast.loading("Marking pull request ready");
    try {
      const response = await requestEnvironmentAction.mutateAsync({
        id: environmentId,
        action: "pull_request_ready",
      });
      if (response.action !== "pull_request_ready") {
        throw new Error("Expected pull request ready action response.");
      }
      appToast.success(response.message, { id: toastId });
    } catch (error) {
      appToast.error("Failed to update pull request", {
        id: toastId,
        description: getMutationErrorMessage({
          error,
          fallbackMessage: "Pull request was not updated",
        }),
      });
    }
  }, [requestEnvironmentAction, thread?.environmentId]);
  const handlePullRequestDraft = useCallback(async () => {
    const environmentId = thread?.environmentId;
    if (!environmentId) {
      return;
    }
    const toastId = appToast.loading("Converting pull request to draft");
    try {
      const response = await requestEnvironmentAction.mutateAsync({
        id: environmentId,
        action: "pull_request_draft",
      });
      if (response.action !== "pull_request_draft") {
        throw new Error("Expected pull request draft action response.");
      }
      appToast.success(response.message, { id: toastId });
    } catch (error) {
      appToast.error("Failed to update pull request", {
        id: toastId,
        description: getMutationErrorMessage({
          error,
          fallbackMessage: "Pull request was not updated",
        }),
      });
    }
  }, [requestEnvironmentAction, thread?.environmentId]);
  const handlePullRequestMerge = useCallback(
    async (method: PullRequestMergeMethod) => {
      const environmentId = thread?.environmentId;
      if (!environmentId) {
        return;
      }
      setPullRequestMergeMethod(method);
      const toastId = appToast.loading(
        getPullRequestMergeLoadingTitle(method),
      );
      try {
        const response = await requestEnvironmentAction.mutateAsync({
          id: environmentId,
          action: "pull_request_merge",
          options: { method },
        });
        if (response.action !== "pull_request_merge") {
          throw new Error("Expected pull request merge action response.");
        }
        appToast.success(response.message, { id: toastId });
      } catch (error) {
        appToast.error("Failed to merge pull request", {
          id: toastId,
          description: getMutationErrorMessage({
            error,
            fallbackMessage: "Pull request was not merged",
          }),
        });
      }
    },
    [requestEnvironmentAction, setPullRequestMergeMethod, thread?.environmentId],
  );
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
  const workspacePreviewRootPath = resolveThreadWorkspacePreviewRootPath({
    environment,
  });
  const threadOpenContext = resolveEnvironmentOpenContext({
    environment,
    serverOrigin: window.location.origin,
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
    enabled: threadOpenContext !== null,
    ...(threadOpenContext ? { openContext: threadOpenContext } : {}),
  });
  const parentThreadSection: ThreadPromptParentThreadSection | null =
    useMemo(() => {
      const relatedThreadId =
        threadOriginKind !== null
          ? threadSourceThreadId
          : thread?.parentThreadId;
      if (!thread || !relatedThreadId) return null;
      const href = getSurfaceAwareThreadRoutePath({
        projectId: thread.projectId,
        surface: props.surface,
        threadId: relatedThreadId,
      });
      const relationship =
        threadOriginKind === "fork"
          ? "fork"
          : threadOriginKind === "side-chat"
            ? "side-chat"
            : "parent";
      const relatedThread =
        relationship === "parent" ? parentThread : sourceThread;
      if (relatedThread === undefined) {
        // Related record not yet loaded — show id-based fallback so the user
        // doesn't get a flicker of "no related thread" before resolution.
        return {
          parentThreadTitle: relatedThreadId.slice(0, 8),
          href,
          relationship,
        };
      }
      // Plan ownership invariants: silently exclude dirty references rather
      // than rendering a stale or unreachable related-thread link.
      if (
        relatedThread.archivedAt !== null ||
        relatedThread.deletedAt !== null ||
        relatedThread.projectId !== thread.projectId
      ) {
        return null;
      }
      return {
        parentThreadTitle: getThreadDisplayTitle(relatedThread),
        href,
        relationship,
      };
    }, [
      parentThread,
      props.surface,
      sourceThread,
      thread,
      threadOriginKind,
      threadSourceThreadId,
    ]);
  const childThreadsSection: ThreadPromptChildThreadsSection | null =
    useMemo(() => {
      const list = childThreadSubsetQuery.data ?? [];
      const activeItems = list
        .filter(
          (entry) =>
            // Forks / side chats are user-driven branches opened directly, not
            // delegated work the parent is waiting on — keep them out of the
            // active-child banner count and drawer.
            entry.childOrigin === null &&
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
    ({ href }) => handleOpenUrlByPreference(href),
    [handleOpenUrlByPreference],
  );
  const handleTimelineTitleAction = useCallback<TimelineTitleActionResolver>(
    (action) => {
      switch (action.kind) {
        case "open-file-diff":
          return () => {
            openSecondaryPanelDiffFile(action.path);
          };
        case "open-side-chat":
          return () => {
            openExistingSideChatTab(action.threadId);
          };
        default:
          // Surfaces a compile-time error if a future TimelineTitleAction
          // variant is added without app-side handling, instead of silently
          // returning undefined and leaving a kind unrouted.
          return assertNever(action);
      }
    },
    [openSecondaryPanelDiffFile, openExistingSideChatTab],
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
        rootPath: workspacePreviewRootPath,
        canOpenPreferredTarget: canOpenPreferredFileTarget,
        openInPreferredTarget: openPathInPreferredFileTarget,
      }),
    [
      canOpenPreferredFileTarget,
      openPathInPreferredFileTarget,
      workspacePreviewRootPath,
    ],
  );
  const handleOpenStorageFileInEditor = useMemo(
    () =>
      buildOpenInEditorHandler({
        rootPath: threadStorageRootPath,
        canOpenPreferredTarget: canOpenPreferredFileTarget,
        openInPreferredTarget: openPathInPreferredFileTarget,
      }),
    [
      canOpenPreferredFileTarget,
      openPathInPreferredFileTarget,
      threadStorageRootPath,
    ],
  );
  const handleOpenHostFileInEditor = useMemo<
    OpenInEditorHandler | undefined
  >(() => {
    if (!canOpenPreferredFileTarget) {
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
  const isThreadOnProvisionedWorktreeEnvironment =
    environment !== undefined &&
    environment.status === "ready" &&
    environment.path !== null &&
    (environment.isWorktree ||
      environment.workspaceProvisionType === "managed-worktree");
  const onCreateNewThreadInWorktree =
    isThreadOnProvisionedWorktreeEnvironment &&
    projectId &&
    thread.environmentId !== null
      ? createThreadInWorktree
      : undefined;
  const promptBannerMergeBaseBranch = effectiveMergeBaseBranch;
  const threadBranchName = workspaceBranch?.currentBranch ?? undefined;
  const threadCheckoutDisplay = workspaceStatus
    ? formatWorkspaceCheckoutDisplay({ checkout: workspaceStatus.checkout })
    : undefined;
  const isWorkspaceDeleted = environment?.status === "destroyed";
  // Decision B*: a thread whose environment is gone (being torn down or already
  // destroyed) is read-only — un-archive never resurrects it, so the composer is
  // replaced with the "environment is gone" banner instead of allowing a send.
  const threadEnvironmentGoneStatus =
    environment?.status === "destroying" || environment?.status === "destroyed"
      ? environment.status
      : null;
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
        childPillLabel={
          threadOriginKind === "side-chat"
            ? "side chat"
            : parentThreadId
              ? "child"
              : null
        }
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
      environmentCompactLabel={threadEnvironmentDisplay?.compactModeLabel}
      environmentIcon={threadEnvironmentIcon ?? undefined}
      environmentLabel={threadEnvironmentDisplay?.modeLabel}
      environmentGoneStatus={threadEnvironmentGoneStatus}
      isEnvironmentActionPending={requestEnvironmentAction.isPending}
      onCreateNewThreadInWorktree={onCreateNewThreadInWorktree}
      onEscapeEmptyPrompt={
        props.surface === "popout" ? props.onPopoutHide : undefined
      }
      onPullRequestMerge={handlePullRequestMerge}
      onPullRequestDraft={handlePullRequestDraft}
      onPullRequestReady={handlePullRequestReady}
      pullRequestMergeMethod={pullRequestMergeMethod}
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
      composerFocusRequestNonce={composerFocusRequestNonce}
      sendMessage={sendMessage}
      pendingInteractions={pendingInteractions}
      pendingInteractionsInitialLoading={pendingInteractionsInitialLoading}
      pendingTodos={pendingTodos}
      activePromptMode={activePromptMode}
      goal={goal}
      activeWorkflow={activeWorkflow}
      activeBackgroundCommands={activeBackgroundCommands}
      parentThreadSection={parentThreadSection}
      childThreadsSection={childThreadsSection}
      pullRequest={pullRequest}
      thread={thread}
    />
  );
  const activeTerminalId = findActiveTerminalIdInSecondaryFileTabs({
    activeTabId: activeFixedSecondaryTabId,
    tabs: syncedOrderedSecondaryFileTabs,
  });
  const fileTabContent = activeTerminalId ? (
    <ThreadTerminalPanel
      canCreateTerminal={canCreateTerminal}
      onOpenLink={handleOpenTimelineLink}
      onSelectionAddToChat={handleSelectionAddToChat}
      target={{ kind: "thread", threadId: thread.id }}
    />
  ) : isNewTabActive ? (
    <NewTabPage
      projectId={projectId ?? undefined}
      environmentId={thread.environmentId ?? null}
      currentThreadId={thread.id}
      focusRequest={newTabFocusRequest}
      onSelect={handleSelectFileSearchResult}
      onStartSideChat={canStartSideChat ? handleStartSideChat : undefined}
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
      onSelectionAddToChat={handleSelectionAddToChat}
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
      onSelectionAddToChat={handleSelectionAddToChat}
      threadId={thread.id}
    />
  ) : activeStorageFilePath ? (
    <ThreadStorageFilePreviewTabContent
      activePath={activeStorageFilePath}
      copyPath={storageFileCopyPath}
      lineRange={activeStorageFileLineRange}
      markdownLinkRouting={storageMarkdownLinkRouting}
      onOpenInEditor={handleOpenStorageFileInEditor}
      onSelectionAddToChat={handleSelectionAddToChat}
      threadId={thread.id}
    />
  ) : undefined;
  const isBrowserTabActive = activeBrowserTab !== null;
  // Side-chat tabs, like browser tabs, keep a live conversation surface mounted
  // across tab switches so streaming + composer state survive deactivation; the
  // deck self-collapses when no side-chat tab is active, and suppresses the
  // normal file-content slot when one is.
  const isSideChatTabActive = activeSideChatTabId !== null;
  const sideChatDeck = (
    <SideChatTabDeck
      sideChatTabs={sideChatTabs}
      activeSideChatTabId={activeSideChatTabId}
      sourceThread={thread}
      sourceEnvironment={environment ?? null}
      sourceTimelineRows={timelineRows}
      resolveMentionLink={resolveMentionLink}
      onSetThreadId={setSideChatThreadId}
    />
  );

  return (
    <UrlOpenRoutingProvider
      openInAppBrowser={
        canOpenUrlsInAppBrowser ? openBrowserTabAndReveal : null
      }
    >
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
          renderBrowserDeck,
          isBrowserTabActive,
          sideChatDeck,
          isSideChatTabActive,
          isOpen: isSecondaryPanelOpen,
          onClose: closeSecondaryPanel,
          onCollapse: closeSecondaryPanel,
          onOpenFileInEditor: handleOpenFileInEditor,
          onFileTabReorder: reorderFileTab,
          onOpenNewTab: handleOpenNewTab,
          onOpenFilePreview: handleOpenFilePreview,
          onSelectionAddToChat: handleSelectionAddToChat,
          onPanelFocus: handleSecondaryPanelFocus,
          onPanelChange: handleSecondaryPanelChange,
          showGitDiffTab: canUseGitUi,
        }}
        timeline={{
          activeThinking,
          canSpawnChild: thread.canSpawnChild,
          threadChildOrigin: threadOriginKind,
          hasOlderTimelineRows,
          hostConnectionNotice,
          isLoadingOlderTimelineRows,
          isThreadTimelinePending,
          timelineError: Boolean(timelineError),
          onForkMessage: isForkAvailable ? handleForkMessage : undefined,
          onSideChatMessage: canStartSideChat
            ? handleSideChatMessage
            : undefined,
          onSendToMainMessage: handleSendToMainMessage,
          onSelectionAddToChat: handleSelectionAddToChat,
          onSelectionReplyInSideChat: canStartSideChat
            ? handleSelectionReplyInSideChat
            : undefined,
          onLoadOlderRows: loadOlderTimelineRows,
          onOpenLink: handleOpenTimelineLink,
          onOpenLocalFileLink: handleOpenTimelineLocalFileLink,
          onTitleAction: handleTimelineTitleAction,
          projectId,
          resolveMentionLink,
          showOngoingIndicator:
            thread.status !== "stopping" &&
            // A pending interaction (question or approval) already renders its
            // own inline shimmer row, so the bottom indicator would just
            // duplicate it.
            !hasPendingInteraction &&
            isRunningThreadRuntimeDisplayStatus(thread.runtime.displayStatus) &&
            !isThreadTimelinePending,
          ongoingIndicatorLabel:
            thread.runtime.displayStatus === "host-reconnecting"
              ? "Waiting for reconnection"
              : undefined,
          timelineRows,
          isStopping: thread.status === "stopping",
          stoppingAnchorAt: thread.updatedAt,
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
    </UrlOpenRoutingProvider>
  );
}
