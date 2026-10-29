import { useState } from "react";
import { Icon } from "./icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { experimental_PluginRpcCallError } from "@get-bb/plugin-sdk";

export interface GitStatusDisplayStatus {
  workingTree: {
    state:
      | "clean"
      | "untracked"
      | "dirty_uncommitted"
      | "committed_unmerged"
      | "dirty_and_committed_unmerged";
  };
  mergeBase: {
    mergeBaseBranch: string;
    aheadCount: number;
    behindCount: number;
    squashMergeCheckComplete: boolean;
  } | null;
}

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

const GIT_STATUS_REFUSAL_CODES: ReadonlySet<string> = new Set([
  "forbidden",
  "not_found",
  "conflict",
  "invalid",
]);

export function gitStatusErrorMessage(error: Error | null): string | null {
  if (error === null) return null;
  return error instanceof experimental_PluginRpcCallError &&
    GIT_STATUS_REFUSAL_CODES.has(error.code)
    ? error.message
    : "Workspace status unavailable.";
}

interface GetGitStatusDisplayOptions {
  errorMessage?: string | null;
  mergeBaseBranch?: string;
  showBranchComparison?: boolean;
  workspaceUnavailable?: { code: string; message: string };
  workspaceDeleted?: boolean;
}

function formatComparisonSummary(
  status: GitStatusDisplayStatus,
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
  status: GitStatusDisplayStatus,
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
  status: GitStatusDisplayStatus | undefined,
  options?: GetGitStatusDisplayOptions,
): ThreadGitStatusDisplay {
  if (!status) {
    if (options?.workspaceUnavailable) {
      if (options.workspaceUnavailable.code === "path_not_found") {
        return plainDisplay("Unknown", "Workspace not found.");
      }
      return plainDisplay("Unknown", options.workspaceUnavailable.message);
    }

    if (options?.workspaceDeleted) {
      return plainDisplay("Unknown", "Workspace not found.");
    }
    return plainDisplay(
      "Unknown",
      options?.errorMessage ?? "Workspace status unavailable.",
    );
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
  }
}

export function getGitStatusDisplay(
  status: GitStatusDisplayStatus | undefined,
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
