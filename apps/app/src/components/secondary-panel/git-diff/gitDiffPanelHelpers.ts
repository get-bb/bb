import type { WorkspaceCommitSummary } from "@bb/domain";
import {
  getGitDiffFileChangeKind,
  getGitDiffParseKey,
  splitGitDiffIntoPatchChunks,
  type ParsedGitDiffFileEntry,
} from "../../git-diff/git-diff-parsing";
import type { GitDiffSelectionOption } from "../ThreadSecondaryPanel";

export const GIT_DIFF_PARSE_BATCH_THRESHOLD = 24;
export const GIT_DIFF_AUTO_COLLAPSE_FILE_THRESHOLD = 10;
export const GIT_DIFF_PARSE_INITIAL_BATCH_SIZE = 6;
export const GIT_DIFF_PARSE_BATCH_SIZE = 18;
export const GIT_DIFF_PARSE_BATCH_DELAY_MS = 24;

export const ALL_GIT_DIFF_SELECTION = "all";
export const COMMITTED_GIT_DIFF_SELECTION = "branch_committed";
export const UNCOMMITTED_GIT_DIFF_SELECTION = "uncommitted";

export type GitDiffSelectionValue = string | null;

export interface GitDiffSelectionAvailability {
  hasUncommittedChanges: boolean;
}

export type GitDiffTarget =
  | { type: "commit"; sha: string }
  | { type: "uncommitted" }
  | { type: "branch_committed"; mergeBaseBranch: string }
  | { type: "all"; mergeBaseBranch: string }
  | undefined;

export interface GitDiffPreparationState {
  currentGitDiffKey: string;
  hasCurrentGitDiff: boolean;
  hasParsedGitDiffFiles: boolean;
  isAwaitingCurrentGitDiffParse: boolean;
  isPreparingGitDiff: boolean;
}

export type GitDiffParsePlan =
  | { kind: "reset"; gitDiffKey: string; patchChunks: [] }
  | { kind: "empty"; gitDiffKey: string; patchChunks: [] }
  | { kind: "immediate"; gitDiffKey: string; patchChunks: string[] }
  | { kind: "batched"; gitDiffKey: string; patchChunks: string[] };

export type GitDiffBulkCollapsePreference =
  | "default"
  | "collapsed-all"
  | "expanded-all";

interface GitDiffPreparationStateParams {
  currentGitDiff: string;
  isAwaitingPrerequisites: boolean;
  isGitDiffLoading: boolean;
  isParsingGitDiffFiles: boolean;
  lastParsedGitDiffKey: string;
  parsedGitDiffFileCount: number;
}

export interface ShouldCollapseGitDiffFileByDefaultParams {
  entry: ParsedGitDiffFileEntry;
  expectedFileCount: number;
}

export interface ReconcileGitDiffCollapsedFileKeysParams {
  bulkCollapsePreference: GitDiffBulkCollapsePreference;
  currentCollapsedFileKeys: ReadonlySet<string>;
  expectedFileCount: number;
  focusedFileKey: string | null;
  parsedGitDiffFileEntries: readonly ParsedGitDiffFileEntry[];
  previousFileKeys: ReadonlySet<string>;
}

export function buildGitDiffTarget(
  selectedGitDiffSelection: GitDiffSelectionValue,
  effectiveMergeBaseBranch: string | undefined,
): GitDiffTarget {
  if (selectedGitDiffSelection === UNCOMMITTED_GIT_DIFF_SELECTION) {
    return { type: "uncommitted" };
  }

  if (selectedGitDiffSelection === COMMITTED_GIT_DIFF_SELECTION) {
    return effectiveMergeBaseBranch
      ? {
          type: "branch_committed",
          mergeBaseBranch: effectiveMergeBaseBranch,
        }
      : undefined;
  }

  if (selectedGitDiffSelection) {
    return { type: "commit", sha: selectedGitDiffSelection };
  }

  if (effectiveMergeBaseBranch) {
    return {
      type: "all",
      mergeBaseBranch: effectiveMergeBaseBranch,
    };
  }

  return undefined;
}

export function buildGitDiffSelectionOptions(
  diffCommits: readonly WorkspaceCommitSummary[],
  options: GitDiffSelectionAvailability = {
    hasUncommittedChanges: false,
  },
): GitDiffSelectionOption[] {
  const allChangesOption = {
    value: ALL_GIT_DIFF_SELECTION,
    label: "All changes",
  };
  const committedOption = {
    value: COMMITTED_GIT_DIFF_SELECTION,
    label: "Committed changes",
  };
  const uncommittedOption = {
    value: UNCOMMITTED_GIT_DIFF_SELECTION,
    label: "Uncommitted changes",
  };
  const commitOptions = diffCommits.map((commit) => ({
    value: commit.sha,
    label: commit.subject,
    monoPrefix: commit.shortSha,
  }));

  const hasMergeBaseContext =
    diffCommits.length > 0 || options.hasUncommittedChanges;
  if (!hasMergeBaseContext) {
    return [allChangesOption];
  }

  return [
    allChangesOption,
    ...(diffCommits.length > 0 ? [committedOption] : []),
    ...(options.hasUncommittedChanges ? [uncommittedOption] : []),
    ...commitOptions,
  ];
}

export function shouldResetSelectedGitDiffSelection(
  selectedGitDiffSelection: GitDiffSelectionValue,
  diffCommits: readonly WorkspaceCommitSummary[],
  options: GitDiffSelectionAvailability = {
    hasUncommittedChanges: false,
  },
): boolean {
  if (!selectedGitDiffSelection) {
    return false;
  }
  if (selectedGitDiffSelection === COMMITTED_GIT_DIFF_SELECTION) {
    return diffCommits.length === 0;
  }
  if (selectedGitDiffSelection === UNCOMMITTED_GIT_DIFF_SELECTION) {
    return !options.hasUncommittedChanges;
  }
  return !diffCommits.some((commit) => commit.sha === selectedGitDiffSelection);
}

export function resolveGitDiffPreparationState(
  params: GitDiffPreparationStateParams,
): GitDiffPreparationState {
  const hasCurrentGitDiff = params.currentGitDiff.trim().length > 0;
  const currentGitDiffKey = getGitDiffParseKey(params.currentGitDiff);
  const hasParsedGitDiffFiles = params.parsedGitDiffFileCount > 0;
  const isAwaitingCurrentGitDiffParse =
    hasCurrentGitDiff && params.lastParsedGitDiffKey !== currentGitDiffKey;
  const isPreparingGitDiff =
    !hasParsedGitDiffFiles &&
    (params.isAwaitingPrerequisites ||
      params.isGitDiffLoading ||
      params.isParsingGitDiffFiles ||
      isAwaitingCurrentGitDiffParse);

  return {
    currentGitDiffKey,
    hasCurrentGitDiff,
    hasParsedGitDiffFiles,
    isAwaitingCurrentGitDiffParse,
    isPreparingGitDiff,
  };
}

export function shouldCollapseGitDiffFileByDefault({
  entry,
  expectedFileCount,
}: ShouldCollapseGitDiffFileByDefaultParams): boolean {
  if (expectedFileCount > GIT_DIFF_AUTO_COLLAPSE_FILE_THRESHOLD) {
    return true;
  }
  return getGitDiffFileChangeKind(entry.fileDiff) === "deleted";
}

export function reconcileGitDiffCollapsedFileKeys({
  bulkCollapsePreference,
  currentCollapsedFileKeys,
  expectedFileCount,
  focusedFileKey,
  parsedGitDiffFileEntries,
  previousFileKeys,
}: ReconcileGitDiffCollapsedFileKeysParams): Set<string> {
  if (bulkCollapsePreference === "expanded-all") {
    return new Set();
  }

  const nextCollapsedFileKeys = new Set<string>();
  for (const entry of parsedGitDiffFileEntries) {
    if (focusedFileKey !== null) {
      if (entry.key !== focusedFileKey) {
        nextCollapsedFileKeys.add(entry.key);
      }
      continue;
    }

    if (bulkCollapsePreference === "collapsed-all") {
      nextCollapsedFileKeys.add(entry.key);
      continue;
    }

    if (previousFileKeys.has(entry.key)) {
      if (currentCollapsedFileKeys.has(entry.key)) {
        nextCollapsedFileKeys.add(entry.key);
      }
      continue;
    }

    if (shouldCollapseGitDiffFileByDefault({ entry, expectedFileCount })) {
      nextCollapsedFileKeys.add(entry.key);
    }
  }

  return nextCollapsedFileKeys;
}

export function buildGitDiffParsePlan(args: {
  gitDiff: string;
  isDiffPanelActive: boolean;
}): GitDiffParsePlan {
  const gitDiffKey = getGitDiffParseKey(args.gitDiff);

  if (!args.isDiffPanelActive || args.gitDiff.trim().length === 0) {
    return {
      kind: "reset",
      gitDiffKey,
      patchChunks: [],
    };
  }

  const patchChunks = splitGitDiffIntoPatchChunks(args.gitDiff);
  if (patchChunks.length === 0) {
    return {
      kind: "empty",
      gitDiffKey,
      patchChunks: [],
    };
  }

  if (patchChunks.length <= GIT_DIFF_PARSE_BATCH_THRESHOLD) {
    return {
      kind: "immediate",
      gitDiffKey,
      patchChunks,
    };
  }

  return {
    kind: "batched",
    gitDiffKey,
    patchChunks,
  };
}
