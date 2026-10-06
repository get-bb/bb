import type { WorkspaceCommitSummary, WorkspaceDiffTarget } from "@bb/domain";
import type { DiffFileEntry } from "@bb/server-contract";
import picomatch from "picomatch/posix";
import type { GitDiffSelectionOption } from "../GitDiffToolbar";

interface GitDiffIdentityParams {
  environmentId?: string;
  mergeBaseRef: string | null;
  target: WorkspaceDiffTarget | undefined;
}

export function buildGitDiffIdentity({
  environmentId,
  mergeBaseRef,
  target,
}: GitDiffIdentityParams): string {
  const environmentKey = environmentId ?? "none";
  if (!target) return `${environmentKey}:none`;

  switch (target.type) {
    case "uncommitted":
      return `${environmentKey}:uncommitted`;
    case "branch_committed":
      return [
        environmentKey,
        "branch_committed",
        target.mergeBaseBranch,
        mergeBaseRef ?? "pending",
      ].join(":");
    case "all":
      return [
        environmentKey,
        "all",
        target.mergeBaseBranch,
        mergeBaseRef ?? "pending",
      ].join(":");
    case "commit":
      return `${environmentKey}:commit:${target.sha}`;
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

export const GIT_DIFF_AUTO_COLLAPSE_FILE_THRESHOLD = 10;

export const ALL_GIT_DIFF_SELECTION = "all";
export const COMMITTED_GIT_DIFF_SELECTION = "branch_committed";
export const UNCOMMITTED_GIT_DIFF_SELECTION = "uncommitted";

export type GitDiffSelectionValue = string | null;

interface GitDiffSelectionAvailability {
  hasUncommittedChanges: boolean;
}

export function buildGitDiffTarget(
  selectedGitDiffSelection: GitDiffSelectionValue,
  effectiveMergeBaseBranch: string | undefined,
): WorkspaceDiffTarget | undefined {
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

type DiffFilePathMatcher = (path: string) => boolean;

interface DiffFilePatternMatchers {
  exact: DiffFilePathMatcher;
  partial: DiffFilePathMatcher;
}

function compileGlob(patterns: string | string[], basename: boolean) {
  return picomatch(patterns, { basename, dot: true, nocase: true });
}

function compileDiffFilePattern(pattern: string): DiffFilePatternMatchers {
  if (!picomatch.scan(pattern).isGlob) {
    const needle = pattern.toLowerCase();
    const matcher = (path: string) => path.toLowerCase().includes(needle);
    return { exact: matcher, partial: matcher };
  }
  const hasSlash = pattern.includes("/");
  return {
    exact: compileGlob(pattern, !hasSlash),
    partial: hasSlash
      ? compileGlob([`${pattern}*`, `${pattern}*/**`], false)
      : compileGlob(`${pattern}*`, true),
  };
}

export function filterDiffFilesByPath<
  T extends Pick<DiffFileEntry, "path" | "previousPath">,
>(files: readonly T[], query: string): readonly T[] {
  const patterns = query
    .split(",")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== "" && pattern !== "!");
  if (patterns.length === 0) {
    return files;
  }
  const fileMatches = (file: T, isMatch: DiffFilePathMatcher) =>
    [file.path, file.previousPath].some(
      (path) => path !== null && isMatch(path),
    );
  const included = patterns
    .filter((pattern) => !pattern.startsWith("!"))
    .map((pattern) => {
      const { exact, partial } = compileDiffFilePattern(pattern);
      return files.some((file) => fileMatches(file, exact)) ? exact : partial;
    });
  const candidates =
    included.length === 0
      ? files
      : files.filter((file) =>
          included.some((isMatch) => fileMatches(file, isMatch)),
        );
  const excluded = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => compileDiffFilePattern(pattern.slice(1)).exact)
    .filter(
      (isMatch) => !candidates.every((file) => fileMatches(file, isMatch)),
    );
  if (excluded.length === 0) {
    return candidates;
  }
  return candidates.filter(
    (file) => !excluded.some((isMatch) => fileMatches(file, isMatch)),
  );
}
