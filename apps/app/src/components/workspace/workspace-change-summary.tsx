import type { ReactNode } from "react";
import type {
  WorkspaceChangeStats,
  WorkspaceCommitSummary,
  WorkspaceFileStatus,
  WorkspaceStatus,
} from "@bb/domain";
import { formatDiffStatsText } from "@bb/thread-view";
import { DiffStatsTally } from "@/components/ui/diff-stats-tally.js";

export interface ChangeTally {
  filesCount: number;
  insertions: number;
  deletions: number;
}

export function toChangeTally(stats: WorkspaceChangeStats): ChangeTally {
  return {
    filesCount: stats.files.length,
    insertions: stats.insertions,
    deletions: stats.deletions,
  };
}

export function formatWorkspaceChangedFilesLabel(changedFiles: number): string {
  return `${changedFiles} file${changedFiles === 1 ? "" : "s"}`;
}

export function formatChangeSummary(tally: ChangeTally): string {
  if (
    tally.filesCount === 0 &&
    tally.insertions === 0 &&
    tally.deletions === 0
  ) {
    return "No changes";
  }
  const filesLabel = formatWorkspaceChangedFilesLabel(tally.filesCount);
  if (tally.insertions === 0 && tally.deletions === 0) {
    return filesLabel;
  }
  const diffText = formatDiffStatsText({
    added: tally.insertions,
    removed: tally.deletions,
  });
  return `${filesLabel}, ${diffText}`;
}

export function renderChangeSummary(tally: ChangeTally): ReactNode {
  if (
    tally.filesCount === 0 &&
    tally.insertions === 0 &&
    tally.deletions === 0
  ) {
    return "No changes";
  }
  const filesLabel = formatWorkspaceChangedFilesLabel(tally.filesCount);
  if (tally.insertions === 0 && tally.deletions === 0) {
    return filesLabel;
  }
  return (
    <>
      {filesLabel},{" "}
      <DiffStatsTally
        insertions={tally.insertions}
        deletions={tally.deletions}
      />
    </>
  );
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

export interface WorkspaceChangedFileSelection {
  file: WorkspaceFileStatus;
  section: WorkspaceChangedFilesSection;
}

/**
 * Returns every changed-files group worth surfacing, in display order:
 * working-tree changes first (modified/staged or untracked), then
 * committed-unmerged commits if present. The two coexist only in the
 * `dirty_and_committed_unmerged` working-tree state; in every other state
 * the result has at most one entry.
 *
 * Each section carries its own stats so callers don't have to re-derive
 * which bucket the numbers came from. Untracked-only state surfaces the
 * working-tree stats synthesized by the workspace status command.
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

/**
 * Commits on the thread's branch that are ahead of the selected merge base,
 * newest first. Empty when there is no merge base (e.g. on the default branch)
 * or nothing is ahead. These are the same patch-unique commits the git diff
 * panel lets you inspect individually.
 */
export function selectWorkspaceAheadCommits(
  workspaceStatus: WorkspaceStatus | undefined,
): WorkspaceCommitSummary[] {
  const commits = workspaceStatus?.mergeBase?.commits;
  if (!commits || commits.length === 0) return [];
  return commits.slice().reverse();
}

/**
 * Single-bucket convenience for surfaces (context banner, follow-up prompt)
 * that only show one list. Returns the primary section per
 * `selectWorkspaceChangedFilesSections` ordering.
 */
export function selectWorkspaceChangedFilesSection(
  workspaceStatus: WorkspaceStatus | undefined,
): WorkspaceChangedFilesSection | null {
  return selectWorkspaceChangedFilesSections(workspaceStatus)[0] ?? null;
}

export function formatWorkspaceFileStatus(status: string): string {
  if (status === "??") {
    return "A?";
  }

  // Git porcelain status is open_external; preserve unknown values intentionally.
  return status;
}
