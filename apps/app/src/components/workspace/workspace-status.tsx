import { useState } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { assertNever } from "@bb/core-ui";
import { BbHttpError } from "@bb/sdk/browser";
import { describeLifecycleError } from "@/lib/lifecycle-errors";
import type { WorkspaceStatus } from "bb-plugin-bb--git/contract";
import type { WorkspaceResolutionFailure } from "@bb/host-daemon-contract/workspace";

export const INCOMPLETE_SQUASH_MERGE_MESSAGE =
  "Squash-merge check incomplete; counts may include already-merged commits.";

export interface ThreadGitStatusDisplay {
  label:
    | "Unknown"
    | "Up to date"
    | "Clean"
    | "Ahead"
    | "Behind"
    | "Diverged"
    | "Dirty"
    | "Untracked";
  summary: string;
  warning?: string;
}

interface GetGitStatusDisplayOptions {
  error?: unknown;
  mergeBaseBranch?: string;
  showBranchComparison?: boolean;
  workspaceUnavailable?: WorkspaceResolutionFailure;
  workspaceDeleted?: boolean;
}

function formatComparisonSummary(
  status: WorkspaceStatus,
  mergeBaseBranch?: string,
): string | null {
  const aheadCount = status.mergeBase?.aheadCount ?? 0;
  const behindCount = status.mergeBase?.behindCount ?? 0;
  if (aheadCount === 0 && behindCount === 0) {
    return null;
  }

  if (aheadCount > 0 && behindCount > 0) {
    return mergeBaseBranch
      ? `${aheadCount} ahead, ${behindCount} behind relative to ${mergeBaseBranch}`
      : `${aheadCount} ahead, ${behindCount} behind`;
  }

  if (aheadCount > 0) {
    return mergeBaseBranch
      ? `${aheadCount} ahead of ${mergeBaseBranch}`
      : `${aheadCount} ahead`;
  }

  return mergeBaseBranch
    ? `${behindCount} behind ${mergeBaseBranch}`
    : `${behindCount} behind`;
}

function plainDisplay(
  label: ThreadGitStatusDisplay["label"],
  summary: string,
): ThreadGitStatusDisplay {
  return { label, summary };
}

function divergenceDisplay(
  status: WorkspaceStatus,
  comparisonSummary: string | null,
): ThreadGitStatusDisplay | null {
  const aheadCount = status.mergeBase?.aheadCount ?? 0;
  const behindCount = status.mergeBase?.behindCount ?? 0;
  if (aheadCount > 0 && behindCount > 0) {
    return plainDisplay(
      "Diverged",
      comparisonSummary ?? "Branch has diverged.",
    );
  }
  if (behindCount > 0) {
    return plainDisplay(
      "Behind",
      comparisonSummary ?? "Branch is behind its merge base.",
    );
  }
  return null;
}

function getGitStatusDisplayWithoutWarning(
  status: WorkspaceStatus | undefined,
  options?: GetGitStatusDisplayOptions,
): ThreadGitStatusDisplay {
  if (!status) {
    const lifecycleErrorDescription =
      options?.error === undefined
        ? null
        : describeLifecycleError({
            error: options.error,
            operation: "load_git_status",
          });
    if (lifecycleErrorDescription) {
      return plainDisplay("Unknown", lifecycleErrorDescription.body);
    }

    if (options?.workspaceUnavailable) {
      if (options.workspaceUnavailable.code === "path_not_found") {
        return plainDisplay("Unknown", "Workspace not found.");
      }
      return plainDisplay("Unknown", options.workspaceUnavailable.message);
    }

    const isPathNotFound =
      options?.error instanceof BbHttpError &&
      options.error.code === "path_not_found";
    if (options?.workspaceDeleted || isPathNotFound) {
      return plainDisplay("Unknown", "Workspace not found.");
    }
    return plainDisplay("Unknown", "Workspace status unavailable.");
  }

  const resolvedMergeBaseBranch =
    options?.mergeBaseBranch ?? status.mergeBase?.mergeBaseBranch;
  const comparisonSummary = options?.showBranchComparison
    ? formatComparisonSummary(status, resolvedMergeBaseBranch)
    : null;

  switch (status.workingTree.state) {
    case "clean":
      return (
        divergenceDisplay(status, comparisonSummary) ??
        ((status.mergeBase?.aheadCount ?? 0) > 0
          ? plainDisplay(
              "Ahead",
              comparisonSummary ?? "Local commits pending merge.",
            )
          : plainDisplay(
              options?.showBranchComparison ? "Up to date" : "Clean",
              resolvedMergeBaseBranch
                ? `No local changes relative to ${resolvedMergeBaseBranch}.`
                : "No local changes.",
            ))
      );
    case "untracked":
      return plainDisplay("Untracked", comparisonSummary ?? "");
    case "dirty_uncommitted":
    case "dirty_and_committed_unmerged":
      return plainDisplay("Dirty", comparisonSummary ?? "");
    case "committed_unmerged":
      return (
        divergenceDisplay(status, comparisonSummary) ??
        plainDisplay(
          "Ahead",
          comparisonSummary ?? "Local commits pending merge.",
        )
      );
    default:
      return assertNever(status.workingTree.state);
  }
}

export function getGitStatusDisplay(
  status: WorkspaceStatus | undefined,
  options?: GetGitStatusDisplayOptions,
): ThreadGitStatusDisplay {
  const display = getGitStatusDisplayWithoutWarning(status, options);
  return status?.mergeBase?.squashMergeCheckComplete === false
    ? { ...display, warning: INCOMPLETE_SQUASH_MERGE_MESSAGE }
    : display;
}

export function SquashMergeInfo() {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={INCOMPLETE_SQUASH_MERGE_MESSAGE}
          onPointerDown={(event) => {
            event.preventDefault();
            setOpen((value) => !value);
          }}
          onClick={(event) => {
            event.preventDefault();
            if (event.detail === 0) setOpen((value) => !value);
          }}
          className="inline-flex shrink-0 items-center text-muted-foreground"
        >
          <Icon name="Info" className="size-3" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>{INCOMPLETE_SQUASH_MERGE_MESSAGE}</TooltipContent>
    </Tooltip>
  );
}
