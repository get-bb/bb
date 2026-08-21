import type { Environment, Thread, WorkspaceStatus } from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import {
  environmentActionFailureDetailsSchema,
  type EnvironmentActionFailureDetails,
  type EnvironmentActionRequest,
  type EnvironmentActionResponse,
  type PullRequestMergeMethod,
} from "@bb/server-contract";
import { getMutationErrorMessage } from "@/lib/query/mutation-errors";

/**
 * Pure policy behind `POST /environments/:id/actions` on mobile (ports of
 * the web useThreadGitActions / ThreadDetailView PR handlers): which git
 * actions the header offers, the toast copy per action, and how a failure
 * (incl. the route's 409 "blocked" answers) is described.
 */

export type EnvironmentActionKind = EnvironmentActionRequest["action"];

export interface EnvironmentActionCopy {
  loading: string;
  success: string;
  error: string;
}

export const ENVIRONMENT_ACTION_COPY: Record<
  EnvironmentActionKind,
  EnvironmentActionCopy
> = {
  commit: {
    loading: "Creating commit",
    success: "Commit created",
    error: "Commit failed",
  },
  squash_merge: {
    loading: "Squash merging",
    success: "Squash merge completed",
    error: "Squash merge failed",
  },
  pull_request_ready: {
    loading: "Marking pull request ready",
    success: "Pull request marked ready",
    error: "Failed to update pull request",
  },
  pull_request_draft: {
    loading: "Converting pull request to draft",
    success: "Pull request converted to draft",
    error: "Failed to update pull request",
  },
  pull_request_merge: {
    loading: "Merging pull request",
    success: "Pull request merged",
    error: "Failed to merge pull request",
  },
};

export function getPullRequestMergeLoadingTitle(
  method: PullRequestMergeMethod,
): string {
  switch (method) {
    case "merge":
      return "Merging pull request";
    case "squash":
      return "Squash merging pull request";
    case "rebase":
      return "Rebasing and merging pull request";
  }
}

/** Success toast description: the server message, or the created commit. */
export function describeEnvironmentActionSuccess(
  response: EnvironmentActionResponse,
): string {
  switch (response.action) {
    case "commit":
    case "squash_merge":
      return `${response.commitSha.slice(0, 7)} ${response.commitSubject}`;
    case "pull_request_ready":
    case "pull_request_draft":
    case "pull_request_merge":
      return response.message;
  }
}

// ---------------------------------------------------------------------------
// Failures

export interface EnvironmentActionFailure {
  /**
   * `blocked`: the route refused cleanly (409 — nothing to commit, no PR,
   * merge conflict, git host CLI missing, …) and the message is the user
   * explanation. `error`: anything else (transport, 5xx, unexpected).
   */
  kind: "blocked" | "error";
  title: string;
  description: string;
  details: EnvironmentActionFailureDetails | undefined;
}

function toEnvironmentActionFailureDetails(
  error: unknown,
): EnvironmentActionFailureDetails | undefined {
  if (
    !(error instanceof BbHttpError) ||
    typeof error.body !== "object" ||
    error.body === null ||
    !("details" in error.body)
  ) {
    return undefined;
  }
  const result = environmentActionFailureDetailsSchema.safeParse(
    error.body.details,
  );
  return result.success ? result.data : undefined;
}

export function describeEnvironmentActionFailure({
  action,
  error,
}: {
  action: EnvironmentActionKind;
  error: unknown;
}): EnvironmentActionFailure {
  const details = toEnvironmentActionFailureDetails(error);
  const copy = ENVIRONMENT_ACTION_COPY[action];
  const description =
    details?.failure.message ??
    getMutationErrorMessage({
      error,
      fallbackMessage: "The action did not complete.",
    });
  const blocked = error instanceof BbHttpError && error.status === 409;
  return {
    kind: blocked ? "blocked" : "error",
    title: copy.error,
    description,
    details,
  };
}

// ---------------------------------------------------------------------------
// Header git actions

export type ThreadGitActionTarget =
  | { kind: "commit" }
  | { kind: "commit_and_squash_merge" }
  | { kind: "squash_merge" };

export interface ThreadHeaderGitAction {
  label: string;
  target: ThreadGitActionTarget;
}

/**
 * The git actions the thread header offers (web `threadHeaderGitActions`):
 * Commit when the working tree is dirty; Squash merge on a managed
 * environment that has anything to merge (uncommitted work is committed
 * first). Archived threads and unknown workspaces offer nothing.
 */
export function buildThreadHeaderGitActions({
  thread,
  environment,
  workspaceStatus,
}: {
  thread: Pick<Thread, "archivedAt"> | undefined;
  environment: Pick<Environment, "managed"> | undefined;
  workspaceStatus: WorkspaceStatus | undefined;
}): ThreadHeaderGitAction[] {
  if (!thread || !workspaceStatus || thread.archivedAt != null) {
    return [];
  }
  const hasUncommitted = workspaceStatus.workingTree.hasUncommittedChanges;
  const hasUnmerged =
    workspaceStatus.mergeBase?.hasCommittedUnmergedChanges === true;
  const actions: ThreadHeaderGitAction[] = [];
  if (environment?.managed === false) {
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
}

export interface ThreadGitActionSheetCopy {
  title: string;
  description: string;
  submitLabel: string;
  showMergeBase: boolean;
}

export function getThreadGitActionSheetCopy(
  target: ThreadGitActionTarget,
): ThreadGitActionSheetCopy {
  switch (target.kind) {
    case "commit":
      return {
        title: "Commit changes",
        description: "Create a commit from the current workspace changes.",
        submitLabel: "Commit changes",
        showMergeBase: false,
      };
    case "commit_and_squash_merge":
      return {
        title: "Commit and squash merge",
        description:
          "Commit the current changes, then squash merge this branch into the merge base.",
        submitLabel: "Commit and squash merge",
        showMergeBase: true,
      };
    case "squash_merge":
      return {
        title: "Squash merge",
        description: "Squash merge this branch into the merge base.",
        submitLabel: "Squash merge",
        showMergeBase: true,
      };
  }
}
