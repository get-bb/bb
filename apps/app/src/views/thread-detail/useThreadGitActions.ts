import {
  createElement,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { appToast } from "@/components/ui/app-toast";
import { AppToastCommitDescription } from "@/components/ui/app-toast-descriptions";
import type { Environment, Thread, WorkspaceStatus } from "@bb/domain";
import type {
  CommitActionResponse,
  SquashMergeActionResponse,
} from "@bb/server-contract";
import { useDialogState } from "@/hooks/useDialogState";
import type { ThreadGitActionDialogTarget } from "@/components/dialogs/ThreadGitActionDialog";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import type { RequestEnvironmentActionMutationLike } from "./threadDetailMutationTypes";

interface EnqueueGitActionParams {
  action: GitActionKind;
  run: QueuedGitActionRunner;
}

interface RunQueuedGitActionParams {
  toastId: string | number;
}

interface SquashMergeThreadParams {
  mergeBaseBranch: string;
}

interface RunSquashMergeThreadParams
  extends SquashMergeThreadParams, RunQueuedGitActionParams {}

type GitActionKind = "commit" | "squash_merge";
type QueuedGitActionRunner = (
  params: RunQueuedGitActionParams,
) => Promise<void>;

interface ShowGitActionErrorToastParams {
  action: GitActionKind;
  error: unknown;
  toastId: string | number;
}

interface ShowGitActionSuccessToastParams {
  response: GitActionSuccessResponse;
  toastId: string | number;
}

interface UseThreadGitActionsParams {
  environment?: Environment;
  requestEnvironmentAction: RequestEnvironmentActionMutationLike;
  thread?: Thread;
  workspaceStatus?: WorkspaceStatus;
}

export interface ThreadHeaderGitAction {
  label: string;
  target: ThreadGitActionDialogTarget;
}

type GitActionSuccessResponse =
  | CommitActionResponse
  | SquashMergeActionResponse;

function getGitActionSuccessTitle(action: GitActionKind): string {
  switch (action) {
    case "commit":
      return "Commit created";
    case "squash_merge":
      return "Squash merge completed";
  }
}

function getGitActionLoadingTitle(action: GitActionKind): string {
  switch (action) {
    case "commit":
      return "Creating commit";
    case "squash_merge":
      return "Squash merging";
  }
}

function getGitActionQueuedTitle(action: GitActionKind): string {
  switch (action) {
    case "commit":
      return "Commit queued";
    case "squash_merge":
      return "Squash merge queued";
  }
}

function getGitActionErrorTitle(action: GitActionKind): string {
  switch (action) {
    case "commit":
      return "Commit failed";
    case "squash_merge":
      return "Squash merge failed";
  }
}

function renderGitActionDescription(
  response: GitActionSuccessResponse,
): ReactNode {
  return createElement(AppToastCommitDescription, {
    commitSha: response.commitSha,
    commitSubject: response.commitSubject,
  });
}

function showGitActionSuccessToast({
  response,
  toastId,
}: ShowGitActionSuccessToastParams): void {
  appToast.success(getGitActionSuccessTitle(response.action), {
    id: toastId,
    description: renderGitActionDescription(response),
  });
}

function showGitActionErrorToast({
  action,
  error,
  toastId,
}: ShowGitActionErrorToastParams): void {
  const title = getGitActionErrorTitle(action);
  const message = getMutationErrorMessage({
    error,
    fallbackMessage: "Failed to start git action",
    lifecycleOperation: action,
  });
  const description = message === title ? undefined : message;

  appToast.error(title, {
    id: toastId,
    ...(description ? { description } : {}),
  });
}

export function useThreadGitActions({
  environment,
  requestEnvironmentAction,
  thread,
  workspaceStatus,
}: UseThreadGitActionsParams) {
  const threadGitActionDialog = useDialogState<ThreadGitActionDialogTarget>();
  const gitActionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const queuedGitActionCountRef = useRef(0);
  const workspaceWorkingTree = workspaceStatus?.workingTree;
  const workspaceMergeBase = workspaceStatus?.mergeBase;
  const isArchivedThread = thread?.archivedAt != null;
  const isDirectThreadEnvironment = environment?.managed === false;

  const threadHeaderGitActions = useMemo<ThreadHeaderGitAction[]>(() => {
    if (!thread || !workspaceStatus || isArchivedThread) {
      return [];
    }

    const actions: ThreadHeaderGitAction[] = [];

    const hasUncommitted = workspaceWorkingTree?.hasUncommittedChanges === true;
    const hasUnmerged =
      workspaceMergeBase?.hasCommittedUnmergedChanges === true;

    if (isDirectThreadEnvironment) {
      if (hasUncommitted) {
        actions.push({ target: { kind: "commit" }, label: "Commit" });
      }
      return actions;
    }

    if (environment?.managed) {
      if (hasUncommitted) {
        actions.push({ target: { kind: "commit" }, label: "Commit" });
      }
      if (hasUncommitted || hasUnmerged) {
        actions.push({
          target: {
            kind: hasUncommitted ? "commit_and_squash_merge" : "squash_merge",
          },
          label: "Squash merge",
        });
      }
    }

    return actions;
  }, [
    environment?.managed,
    isArchivedThread,
    isDirectThreadEnvironment,
    thread,
    workspaceMergeBase?.hasCommittedUnmergedChanges,
    workspaceStatus,
    workspaceWorkingTree?.hasUncommittedChanges,
  ]);

  const enqueueGitAction = useCallback(
    ({ action, run }: EnqueueGitActionParams): Promise<void> => {
      const isQueuedBehindGitAction = queuedGitActionCountRef.current > 0;
      queuedGitActionCountRef.current += 1;
      const toastId = appToast.loading(
        isQueuedBehindGitAction
          ? getGitActionQueuedTitle(action)
          : getGitActionLoadingTitle(action),
      );

      const runQueuedGitAction = async (): Promise<void> => {
        if (isQueuedBehindGitAction) {
          appToast.loading(getGitActionLoadingTitle(action), { id: toastId });
        }
        await run({ toastId });
      };

      const queuedAction = gitActionQueueRef.current.then(
        runQueuedGitAction,
        runQueuedGitAction,
      );
      gitActionQueueRef.current = queuedAction
        .catch(() => undefined)
        .finally(() => {
          queuedGitActionCountRef.current -= 1;
        });
      return queuedAction;
    },
    [],
  );

  const runCommitThread = useCallback(
    async ({ toastId }: RunQueuedGitActionParams) => {
      const attachedEnvironmentId = thread?.environmentId;
      if (!thread || !attachedEnvironmentId) {
        appToast.dismiss(toastId);
        return;
      }
      try {
        const response = await requestEnvironmentAction.mutateAsync({
          id: attachedEnvironmentId,
          action: "commit",
        });
        if (response.action !== "commit") {
          throw new Error("Expected commit action response.");
        }
        showGitActionSuccessToast({
          response,
          toastId,
        });
      } catch (nextError) {
        showGitActionErrorToast({
          action: "commit",
          error: nextError,
          toastId,
        });
      }
    },
    [requestEnvironmentAction, thread],
  );

  const handleCommitThread = useCallback(async () => {
    if (!thread?.environmentId) {
      return;
    }
    await enqueueGitAction({ action: "commit", run: runCommitThread });
  }, [enqueueGitAction, runCommitThread, thread?.environmentId]);

  const runSquashMergeThread = useCallback(
    async ({ mergeBaseBranch, toastId }: RunSquashMergeThreadParams) => {
      const attachedEnvironmentId = thread?.environmentId;
      if (!thread || !attachedEnvironmentId) {
        appToast.dismiss(toastId);
        return;
      }
      try {
        const response = await requestEnvironmentAction.mutateAsync({
          id: attachedEnvironmentId,
          action: "squash_merge",
          options: {
            mergeBaseBranch,
          },
        });
        if (response.action !== "squash_merge") {
          throw new Error("Expected squash merge action response.");
        }
        showGitActionSuccessToast({
          response,
          toastId,
        });
      } catch (nextError) {
        showGitActionErrorToast({
          action: "squash_merge",
          error: nextError,
          toastId,
        });
      }
    },
    [requestEnvironmentAction, thread],
  );

  const handleSquashMergeThread = useCallback(
    async ({ mergeBaseBranch }: SquashMergeThreadParams) => {
      if (!thread?.environmentId) {
        return;
      }
      await enqueueGitAction({
        action: "squash_merge",
        run: async ({ toastId }) =>
          runSquashMergeThread({ mergeBaseBranch, toastId }),
      });
    },
    [enqueueGitAction, runSquashMergeThread, thread?.environmentId],
  );

  return {
    handleCommitThread,
    handleSquashMergeThread,
    threadGitActionDialog,
    threadHeaderGitActions,
  };
}
