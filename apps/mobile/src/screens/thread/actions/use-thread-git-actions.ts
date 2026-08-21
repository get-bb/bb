import type { Environment, Thread, WorkspaceStatus } from "@bb/domain";
import { useCallback, useMemo } from "react";
import {
  buildThreadHeaderGitActions,
  useEnvironmentAction,
  type ThreadGitActionTarget,
  type ThreadHeaderGitAction,
} from "@/data/environments";

interface UseThreadGitActionsArgs {
  thread: Pick<Thread, "archivedAt" | "environmentId"> | undefined;
  environment: Environment | undefined;
  workspaceStatus: WorkspaceStatus | undefined;
  /** The merge base a squash merge targets (from `useEnvironmentMergeBase`). */
  mergeBaseBranch: string | undefined;
}

interface ThreadGitActionsState {
  /** What the header offers right now (empty hides the git button). */
  actions: readonly ThreadHeaderGitAction[];
  /** Label of the primary (first) action for the header button. */
  primaryLabel: string | null;
  pending: boolean;
  run: (target: ThreadGitActionTarget) => void;
}

/**
 * The header git actions (web `useThreadGitActions`): derives the offered
 * actions from the workspace status and runs them through
 * `useEnvironmentAction` (which owns the loading / success / blocked toasts).
 * A squash merge commits first server-side, so both merge targets map to the
 * one `squash_merge` request.
 */
export function useThreadGitActions({
  thread,
  environment,
  workspaceStatus,
  mergeBaseBranch,
}: UseThreadGitActionsArgs): ThreadGitActionsState {
  const environmentAction = useEnvironmentAction();
  const actions = useMemo(
    () => buildThreadHeaderGitActions({ thread, environment, workspaceStatus }),
    [environment, thread, workspaceStatus],
  );
  const environmentId = thread?.environmentId ?? null;
  const { run: runAction } = environmentAction;
  const run = useCallback(
    (target: ThreadGitActionTarget) => {
      if (environmentId === null) return;
      if (target.kind === "commit") {
        void runAction({ id: environmentId, action: "commit" });
        return;
      }
      if (!mergeBaseBranch) return;
      void runAction({
        id: environmentId,
        action: "squash_merge",
        options: { mergeBaseBranch },
      });
    },
    [environmentId, mergeBaseBranch, runAction],
  );
  return {
    actions,
    primaryLabel: actions[0]?.label ?? null,
    pending: environmentAction.isPending,
    run,
  };
}
