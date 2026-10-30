import type { ReactNode } from "react";
import { formatDiffStatsText } from "@bb/thread-view";
import { DiffStatsTally } from "./diff-stats-tally";

export interface WorkspaceChangedFileStatus {
  path: string;
  status: string;
  insertions: number | null;
  deletions: number | null;
}

export interface WorkspaceChangeStatsLike<
  File extends WorkspaceChangedFileStatus = WorkspaceChangedFileStatus,
> {
  insertions: number;
  deletions: number;
  lineStatsComplete: boolean;
  fileCount: number;
  files: File[];
}

export interface WorkspaceChangesStatus<
  File extends WorkspaceChangedFileStatus = WorkspaceChangedFileStatus,
  Commit = unknown,
> {
  workingTree: WorkspaceChangeStatsLike<File> & { state: string };
  mergeBase:
    | (WorkspaceChangeStatsLike<File> & {
        baseRef: string | null;
        commits: Commit[];
      })
    | null;
}

interface ChangeTally {
  filesCount: number;
  insertions: number;
  deletions: number;
  lineStatsComplete: boolean;
}

export function toChangeTally(stats: WorkspaceChangeStatsLike): ChangeTally {
  return {
    filesCount: stats.fileCount,
    insertions: stats.insertions,
    deletions: stats.deletions,
    lineStatsComplete: stats.lineStatsComplete,
  };
}

function formatWorkspaceChangedFilesLabel(changedFiles: number): string {
  return `${changedFiles} file${changedFiles === 1 ? "" : "s"}`;
}

export function formatOmittedChangedFilesLabel(
  stats: Pick<WorkspaceChangeStatsLike, "fileCount" | "files">,
): string | null {
  const omittedCount = stats.fileCount - stats.files.length;
  if (omittedCount <= 0) return null;
  return `${omittedCount.toLocaleString()} more ${omittedCount === 1 ? "file" : "files"} not shown`;
}

function formatChangeSummaryWithoutLineStats(
  tally: ChangeTally,
): string | null {
  if (
    tally.filesCount === 0 &&
    tally.insertions === 0 &&
    tally.deletions === 0
  ) {
    return "No changes";
  }
  if (
    !tally.lineStatsComplete ||
    (tally.insertions === 0 && tally.deletions === 0)
  ) {
    return formatWorkspaceChangedFilesLabel(tally.filesCount);
  }
  return null;
}

export function formatChangeSummary(tally: ChangeTally): string {
  return (
    formatChangeSummaryWithoutLineStats(tally) ??
    `${formatWorkspaceChangedFilesLabel(tally.filesCount)}, ${formatDiffStatsText(
      {
        added: tally.insertions,
        removed: tally.deletions,
      },
    )}`
  );
}

export function renderChangeSummary(tally: ChangeTally): ReactNode {
  return (
    formatChangeSummaryWithoutLineStats(tally) ?? (
      <>
        {formatWorkspaceChangedFilesLabel(tally.filesCount)},{" "}
        <DiffStatsTally
          insertions={tally.insertions}
          deletions={tally.deletions}
        />
      </>
    )
  );
}

type WorkspaceChangedFilesSectionKind =
  | "uncommitted"
  | "untracked"
  | "committed";

export const CHANGED_FILES_KIND_PREFIX: Record<
  WorkspaceChangedFilesSectionKind,
  string
> = {
  uncommitted: "Uncommitted",
  untracked: "Untracked",
  committed: "Committed",
};

export interface WorkspaceChangedFilesSection<
  File extends WorkspaceChangedFileStatus = WorkspaceChangedFileStatus,
> {
  kind: WorkspaceChangedFilesSectionKind;
  label: string;
  files: File[];
  mergeBaseRef: string | null;
  stats: WorkspaceChangeStatsLike<File>;
}

export interface WorkspaceChangedFileSelection<
  File extends WorkspaceChangedFileStatus = WorkspaceChangedFileStatus,
> {
  file: File;
  section: WorkspaceChangedFilesSection<File>;
}

export function selectWorkspaceChangedFilesSections<
  File extends WorkspaceChangedFileStatus,
>(
  workspaceStatus: WorkspaceChangesStatus<File> | undefined,
): WorkspaceChangedFilesSection<File>[] {
  if (!workspaceStatus) return [];
  const sections: WorkspaceChangedFilesSection<File>[] = [];
  const workingTree = workspaceStatus.workingTree;
  if (workingTree.fileCount > 0) {
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
  if (mergeBase && mergeBase.fileCount > 0) {
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

export function selectWorkspaceAheadCommits<Commit>(
  workspaceStatus: WorkspaceChangesStatus<WorkspaceChangedFileStatus, Commit> | undefined,
): Commit[] {
  const commits = workspaceStatus?.mergeBase?.commits;
  if (!commits || commits.length === 0) return [];
  return commits.slice().reverse();
}

export function selectWorkspaceChangedFilesSection<
  File extends WorkspaceChangedFileStatus,
>(
  workspaceStatus: WorkspaceChangesStatus<File> | undefined,
): WorkspaceChangedFilesSection<File> | null {
  return selectWorkspaceChangedFilesSections(workspaceStatus)[0] ?? null;
}

export function formatWorkspaceFileStatus(status: string): string {
  if (status === "??") {
    return "A?";
  }

  return status;
}
