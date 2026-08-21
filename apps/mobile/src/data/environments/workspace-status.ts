import type {
  WorkspaceChangeStats,
  WorkspaceFileStatus,
  WorkspaceStatus,
} from "@bb/domain";
import type { EnvironmentStatusResponse } from "@bb/server-contract";
import { BbHttpError } from "@bb/sdk/browser";
import { formatDiffStatsText } from "@bb/thread-view";

/**
 * Pure workspace-status presentation (ports of
 * apps/app/src/components/workspace/workspace-change-summary.tsx and
 * workspace-status.tsx): the changed-files tally and summary line, the
 * section the banner shows (working tree first, then committed-unmerged),
 * and the one-line git status pill.
 */

/** The daemon's "could not resolve the workspace" failure, as the status route returns it. */
export type WorkspaceResolutionFailure = Extract<
  EnvironmentStatusResponse,
  { outcome: "unavailable" }
>["failure"];

export interface ChangeTally {
  filesCount: number;
  insertions: number;
  deletions: number;
  lineStatsComplete: boolean;
}

export function toChangeTally(stats: WorkspaceChangeStats): ChangeTally {
  return {
    filesCount: stats.files.length,
    insertions: stats.insertions,
    deletions: stats.deletions,
    lineStatsComplete: stats.lineStatsComplete,
  };
}

function formatWorkspaceChangedFilesLabel(changedFiles: number): string {
  return `${changedFiles} file${changedFiles === 1 ? "" : "s"}`;
}

/** "3 files, +12 -4" / "2 files" (incomplete line stats) / "No changes". */
export function formatChangeSummary(tally: ChangeTally): string {
  if (
    tally.filesCount === 0 &&
    tally.insertions === 0 &&
    tally.deletions === 0
  ) {
    return "No changes";
  }
  const filesLabel = formatWorkspaceChangedFilesLabel(tally.filesCount);
  if (
    !tally.lineStatsComplete ||
    (tally.insertions === 0 && tally.deletions === 0)
  ) {
    return filesLabel;
  }
  const diffText = formatDiffStatsText({
    added: tally.insertions,
    removed: tally.deletions,
  });
  return `${filesLabel}, ${diffText}`;
}

export type WorkspaceChangedFilesSectionKind =
  | "uncommitted"
  | "untracked"
  | "committed";

export interface WorkspaceChangedFilesSection {
  kind: WorkspaceChangedFilesSectionKind;
  label: string;
  files: WorkspaceFileStatus[];
  mergeBaseRef: string | null;
  /** Line-level stats for the files in this section. */
  stats: WorkspaceChangeStats;
}

const CHANGED_FILES_KIND_PREFIX: Record<
  WorkspaceChangedFilesSectionKind,
  string
> = {
  uncommitted: "Uncommitted",
  untracked: "Untracked",
  committed: "Committed",
};

/**
 * Every changed-files group worth surfacing, in display order: working-tree
 * changes first (modified/staged or untracked), then committed-unmerged
 * commits if present. The two coexist only in the
 * `dirty_and_committed_unmerged` working-tree state.
 */
export function selectWorkspaceChangedFilesSections(
  workspaceStatus: WorkspaceStatus | undefined,
): WorkspaceChangedFilesSection[] {
  if (!workspaceStatus) return [];
  const sections: WorkspaceChangedFilesSection[] = [];
  const workingTree = workspaceStatus.workingTree;
  if (workingTree.files.length > 0) {
    const isUntrackedOnly = workingTree.state === "untracked";
    sections.push({
      kind: isUntrackedOnly ? "untracked" : "uncommitted",
      label: isUntrackedOnly ? "Untracked" : "Uncommitted",
      files: workingTree.files,
      mergeBaseRef: null,
      stats: workingTree,
    });
  }
  const mergeBase = workspaceStatus.mergeBase;
  if (mergeBase && mergeBase.files.length > 0) {
    sections.push({
      kind: "committed",
      label: "Committed",
      files: mergeBase.files,
      mergeBaseRef: mergeBase.baseRef,
      stats: mergeBase,
    });
  }
  return sections;
}

/** The single bucket the context banner shows (primary section). */
export function selectWorkspaceChangedFilesSection(
  workspaceStatus: WorkspaceStatus | undefined,
): WorkspaceChangedFilesSection | null {
  return selectWorkspaceChangedFilesSections(workspaceStatus)[0] ?? null;
}

/** "Uncommitted · 3 files, +12 -4" — the banner's git row label. */
export function formatChangedFilesSectionLabel(
  section: WorkspaceChangedFilesSection,
): string {
  return `${CHANGED_FILES_KIND_PREFIX[section.kind]} · ${formatChangeSummary(
    toChangeTally(section.stats),
  )}`;
}

/** Git porcelain letter for a file row; untracked reads as added-unknown. */
export function formatWorkspaceFileStatus(status: string): string {
  return status === "??" ? "A?" : status;
}

// ---------------------------------------------------------------------------
// Git status pill

export type GitStatusLabel =
  | "Unknown"
  | "Up to date"
  | "Clean"
  | "Ahead"
  | "Behind"
  | "Diverged"
  | "Dirty"
  | "Untracked";

export interface GitStatusDisplay {
  label: GitStatusLabel;
  summary: string;
}

export interface GetGitStatusDisplayOptions {
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

function display(label: GitStatusLabel, summary: string): GitStatusDisplay {
  return { label, summary };
}

/**
 * The one-line git status (label + summary) for the header git sheet. The
 * summary carries only the merge-base comparison (ahead/behind) or a fallback
 * sentence; the changed-files aggregates are shown separately.
 */
export function getGitStatusDisplay(
  status: WorkspaceStatus | undefined,
  options?: GetGitStatusDisplayOptions,
): GitStatusDisplay {
  if (!status) {
    if (options?.workspaceUnavailable) {
      return options.workspaceUnavailable.code === "path_not_found"
        ? display("Unknown", "Workspace not found.")
        : display("Unknown", options.workspaceUnavailable.message);
    }
    const isPathNotFound =
      options?.error instanceof BbHttpError &&
      options.error.code === "path_not_found";
    if (options?.workspaceDeleted || isPathNotFound) {
      return display("Unknown", "Workspace not found.");
    }
    if (options?.error instanceof Error && options.error.message) {
      return display("Unknown", options.error.message);
    }
    return display("Unknown", "Workspace status unavailable.");
  }

  const resolvedMergeBaseBranch =
    options?.mergeBaseBranch ?? status.mergeBase?.mergeBaseBranch;
  const comparisonSummary = options?.showBranchComparison
    ? formatComparisonSummary(status, resolvedMergeBaseBranch)
    : null;
  const ahead = (status.mergeBase?.aheadCount ?? 0) > 0;
  const behind = (status.mergeBase?.behindCount ?? 0) > 0;

  switch (status.workingTree.state) {
    case "clean": {
      if (ahead && behind) {
        return display("Diverged", comparisonSummary ?? "Branch has diverged.");
      }
      if (ahead) {
        return display(
          "Ahead",
          comparisonSummary ?? "Local commits pending merge.",
        );
      }
      if (behind) {
        return display(
          "Behind",
          comparisonSummary ?? "Branch is behind its merge base.",
        );
      }
      return display(
        options?.showBranchComparison ? "Up to date" : "Clean",
        resolvedMergeBaseBranch
          ? `No local changes relative to ${resolvedMergeBaseBranch}.`
          : "No local changes.",
      );
    }
    case "untracked":
      return display("Untracked", comparisonSummary ?? "");
    case "dirty_uncommitted":
      return display("Dirty", comparisonSummary ?? "");
    case "committed_unmerged":
      if (ahead && behind) {
        return display("Diverged", comparisonSummary ?? "Branch has diverged.");
      }
      if (behind) {
        return display(
          "Behind",
          comparisonSummary ?? "Branch is behind its merge base.",
        );
      }
      return display(
        "Ahead",
        comparisonSummary ?? "Local commits pending merge.",
      );
    case "dirty_and_committed_unmerged":
      return display("Dirty", comparisonSummary ?? "");
  }
}

/** The workspace carried by a status response, or undefined when absent. */
export function getWorkspaceStatusFromResponse(
  response: EnvironmentStatusResponse | undefined,
): WorkspaceStatus | undefined {
  return response?.outcome === "available" ? response.workspace : undefined;
}

export function getWorkspaceUnavailableFailure(
  response: EnvironmentStatusResponse | undefined,
): WorkspaceResolutionFailure | undefined {
  return response?.outcome === "unavailable" ? response.failure : undefined;
}
