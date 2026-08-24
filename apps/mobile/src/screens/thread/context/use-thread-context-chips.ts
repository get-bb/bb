import type {
  Environment,
  WorkspaceFileStatus,
  WorkspaceStatus,
} from "@bb/domain";
import type {
  PullRequestMergeMethod,
  ThreadResponse,
} from "@bb/server-contract";
import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { Linking } from "react-native";
import {
  buildHandoffComposeParams,
  buildNewThreadInWorktreeComposeParams,
} from "@/data/compose";
import {
  getEnvironmentPullRequestFromResponse,
  getGitStatusDisplay,
  selectWorkspaceChangedFilesSection,
  useEnvironment,
  useEnvironmentAction,
  useEnvironmentPullRequest,
  useEnvironmentWorkspace,
  type GitStatusDisplay,
  type WorkspaceChangedFilesSection,
} from "@/data/environments";
import { SIDE_CHAT_PLUGIN_ID, useChildThreads } from "@/data/thread-detail";
import {
  getThreadDisplayTitle,
  useThread,
  useUnarchiveThread,
} from "@/data/threads";
import { toast, useSheet, type SheetController } from "@/ui";
import { newThreadHref, threadHref } from "../../shell/hrefs";
import {
  buildChildThreadsSection,
  buildParentThreadSection,
  resolveEnvironmentGoneStatus,
  resolveRelatedThreadId,
  resolveThreadContextLayout,
  type EnvironmentGoneStatus,
  type ThreadContextLayout,
} from "./context-model";
import type { MergeBasePickerSheetProps } from "./MergeBasePickerSheet";
import type { ThreadContextChipsProps } from "./ThreadContextChips";

interface UseThreadContextChipsArgs {
  threadId: string;
  /** The open thread; undefined while it loads. */
  thread: ThreadResponse | undefined;
  /**
   * Open the workspace panel's Diff tab, focused on a path when given (the
   * changed-files row and its file rows). Null when no panel hosts the
   * screen: the rows then only describe the change.
   */
  openDiff: ((path?: string) => void) | null;
}

interface ThreadContextChipsState {
  /** Props for the context chips in the prompt-chip row. */
  chips: ThreadContextChipsProps;
  /** Props for the `<MergeBasePickerSheet>` the changes chip / git sheet open. */
  mergeBasePicker: MergeBasePickerSheetProps;
  /** Workspace facts the header git sheet shares with the chips. */
  workspace: {
    environment: Environment | undefined;
    /** Ready, git-backed environment: the git / PR surfaces apply. */
    canUseGitUi: boolean;
    status: WorkspaceStatus | undefined;
    statusPending: boolean;
    gitStatus: GitStatusDisplay;
    changedFiles: WorkspaceChangedFilesSection | null;
    branchName: string | null;
    mergeBaseBranch: string | undefined;
    showMergeBase: boolean;
    environmentGoneStatus: EnvironmentGoneStatus | null;
  };
  /** "Handoff to new thread": compose seeded with a `@thread:` mention. */
  handoffToNewThread: () => void;
  /** "New thread in this worktree", or null when the thread has no reusable worktree. */
  newThreadInWorktree: (() => void) | null;
  /** The merge-base picker's sheet controller (shared with the git sheet). */
  mergeBaseSheet: SheetController;
}

function isProvisionedWorktree(environment: Environment | undefined): boolean {
  return (
    environment !== undefined &&
    environment.status === "ready" &&
    environment.path !== null &&
    (environment.isWorktree ||
      environment.workspaceProvisionType === "managed-worktree")
  );
}

/**
 * Data assembly for the thread context chips (the mobile counterpart of
 * the ThreadDetailView / ThreadDetailPromptArea banner wiring): environment
 * record, workspace status + merge base, pull request + actions, related
 * (parent / fork source) thread, active children, archive state, and the
 * "handoff" / "new thread in worktree" navigations.
 */
export function useThreadContextChips({
  threadId,
  thread,
  openDiff,
}: UseThreadContextChipsArgs): ThreadContextChipsState {
  const router = useRouter();
  const environmentId = thread?.environmentId ?? null;
  const environmentQuery = useEnvironment(environmentId);
  const environment = environmentQuery.data;
  const canUseGitUi =
    thread !== undefined &&
    environmentId !== null &&
    environment?.isGitRepo === true;

  const {
    workspaceStatus,
    workspaceUnavailable,
    statusPending,
    statusError,
    mergeBase,
  } = useEnvironmentWorkspace({ environment, enabled: canUseGitUi });
  const mergeBaseSheet = useSheet();

  const pullRequestQuery = useEnvironmentPullRequest(environmentId, {
    enabled: canUseGitUi,
  });
  const pullRequest = getEnvironmentPullRequestFromResponse(
    pullRequestQuery.data,
  );
  const environmentAction = useEnvironmentAction();
  const { run: runEnvironmentAction } = environmentAction;

  // Related thread (parent / fork source) and active children.
  const related = thread ? resolveRelatedThreadId(thread) : null;
  const relatedThreadQuery = useThread(related?.threadId ?? "", {
    enabled: related !== null,
  });
  const childThreadsQuery = useChildThreads(thread?.id, {
    enabled: thread !== undefined,
  });

  const unarchiveThread = useUnarchiveThread();
  const unarchivePending =
    unarchiveThread.isPending && unarchiveThread.variables?.id === threadId;

  const environmentGoneStatus = resolveEnvironmentGoneStatus(
    environment?.status,
  );
  const changedFiles = useMemo(
    () => selectWorkspaceChangedFilesSection(workspaceStatus),
    [workspaceStatus],
  );

  const layout = useMemo<ThreadContextLayout>(() => {
    if (!thread) return { kind: "hidden" };
    return resolveThreadContextLayout(
      {
        archived:
          thread.archivedAt !== null ? { archivedAt: thread.archivedAt } : null,
        environmentGone:
          environmentGoneStatus === null
            ? null
            : { status: environmentGoneStatus },
        parent: buildParentThreadSection({
          thread,
          relatedThread: relatedThreadQuery.data,
          sideChatPluginId: SIDE_CHAT_PLUGIN_ID,
        }),
        children: buildChildThreadsSection(childThreadsQuery.data),
        pullRequest: pullRequest === null ? null : { pullRequest },
        git: changedFiles === null ? null : { changedFiles },
      },
      { gitSectionPending: statusPending },
    );
  }, [
    changedFiles,
    childThreadsQuery.data,
    environmentGoneStatus,
    pullRequest,
    relatedThreadQuery.data,
    statusPending,
    thread,
  ]);

  const onOpenThread = useCallback(
    (id: string) => router.push(threadHref(id)),
    [router],
  );
  const onPressFile = useCallback(
    (file: WorkspaceFileStatus) => {
      if (openDiff) {
        openDiff(file.path);
        return;
      }
      toast.info("Open this thread in a workspace panel to see the diff", {
        description: file.path,
      });
    },
    [openDiff],
  );
  const onOpenDiff = useCallback(() => openDiff?.(), [openDiff]);
  const onOpenPullRequest = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {
      toast.error("Could not open the pull request");
    });
  }, []);

  const onMarkReady = useCallback(() => {
    if (environmentId === null) return;
    void runEnvironmentAction({
      id: environmentId,
      action: "pull_request_ready",
    });
  }, [environmentId, runEnvironmentAction]);
  const onMerge = useCallback(
    (method: PullRequestMergeMethod) => {
      if (environmentId === null) return;
      void runEnvironmentAction({
        id: environmentId,
        action: "pull_request_merge",
        options: { method },
      });
    },
    [environmentId, runEnvironmentAction],
  );
  const onConvertToDraft = useCallback(() => {
    if (environmentId === null) return;
    void runEnvironmentAction({
      id: environmentId,
      action: "pull_request_draft",
    });
  }, [environmentId, runEnvironmentAction]);

  const handoffToNewThread = useCallback(() => {
    if (!thread) return;
    router.navigate(
      newThreadHref(
        buildHandoffComposeParams({
          environmentId: thread.environmentId,
          projectId: thread.projectId,
          sourceThreadId: thread.id,
          sourceThreadTitle: getThreadDisplayTitle(thread),
        }),
      ),
    );
  }, [router, thread]);
  const canCreateInWorktree =
    thread !== undefined &&
    thread.environmentId !== null &&
    isProvisionedWorktree(environment);
  const newThreadInWorktree = useCallback(() => {
    if (!thread || thread.environmentId === null) return;
    router.navigate(
      newThreadHref(
        buildNewThreadInWorktreeComposeParams({
          projectId: thread.projectId,
          environmentId: thread.environmentId,
        }),
      ),
    );
  }, [router, thread]);

  const { setMergeBaseBranch } = mergeBase;
  const chips: ThreadContextChipsProps = {
    layout,
    onOpenThread,
    onPressFile,
    onOpenDiff: openDiff ? onOpenDiff : null,
    onOpenPullRequest,
    mergeBase:
      mergeBase.showMergeBase && mergeBase.effectiveMergeBaseBranch
        ? {
            branch: mergeBase.effectiveMergeBaseBranch,
            onPress: mergeBaseSheet.present,
          }
        : null,
    pullRequestActions: canUseGitUi
      ? {
          isPending: environmentAction.isPending,
          onMarkReady,
          onMerge,
          onConvertToDraft,
        }
      : null,
    unarchive:
      thread !== undefined && thread.archivedAt !== null
        ? {
            pending: unarchivePending,
            onPress: () => unarchiveThread.mutate({ id: threadId }),
          }
        : null,
  };

  const gitStatus = getGitStatusDisplay(workspaceStatus, {
    mergeBaseBranch: mergeBase.effectiveMergeBaseBranch,
    showBranchComparison: mergeBase.showBranchComparison,
    error: statusError ?? undefined,
    workspaceUnavailable,
    workspaceDeleted: environment?.status === "destroyed",
  });

  return {
    chips,
    mergeBasePicker: {
      controller: mergeBaseSheet,
      environmentId,
      mergeBaseBranch: mergeBase.effectiveMergeBaseBranch,
      onSelect: setMergeBaseBranch,
    },
    workspace: {
      environment,
      canUseGitUi,
      status: workspaceStatus,
      statusPending,
      gitStatus,
      changedFiles,
      branchName: workspaceStatus?.branch.currentBranch ?? null,
      mergeBaseBranch: mergeBase.effectiveMergeBaseBranch,
      showMergeBase: mergeBase.showMergeBase,
      environmentGoneStatus,
    },
    handoffToNewThread,
    newThreadInWorktree: canCreateInWorktree ? newThreadInWorktree : null,
    mergeBaseSheet,
  };
}
