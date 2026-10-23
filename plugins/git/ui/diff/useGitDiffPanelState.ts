import { useCallback, useEffect, useMemo, useState } from "react";
import type { GitDiffSelectionOption } from "./GitDiffToolbar.js";
import {
  ALL_GIT_DIFF_SELECTION,
  buildGitDiffSelectionOptions,
  buildGitDiffTarget,
  shouldResetSelectedGitDiffSelection,
  type GitDiffSelectionValue,
} from "./gitDiffPanelHelpers.js";
import type { WorkspaceStatus } from "../../contract.js";

interface UseGitDiffPanelStateParams {
  environmentId: string | null;
  requestedMergeBaseBranch: string | undefined;
  workspaceStatus: WorkspaceStatus | undefined;
  pendingScrollPath: string | null;
  pendingCommitSha: string | null;
  pendingSequence: number | null;
  onClearPendingIntent: () => void;
}

export function useGitDiffPanelState({
  environmentId,
  requestedMergeBaseBranch,
  workspaceStatus,
  pendingScrollPath,
  pendingCommitSha,
  pendingSequence,
  onClearPendingIntent,
}: UseGitDiffPanelStateParams) {
  const [selectedGitDiffSelection, setSelectedGitDiffSelection] =
    useState<GitDiffSelectionValue>(null);
  const [gitDiffFileFilter, setGitDiffFileFilter] = useState<string | null>(
    null,
  );

  const gitDiffTarget = useMemo(
    () =>
      buildGitDiffTarget(selectedGitDiffSelection, requestedMergeBaseBranch),
    [requestedMergeBaseBranch, selectedGitDiffSelection],
  );

  useEffect(() => {
    setSelectedGitDiffSelection(null);
    setGitDiffFileFilter(null);
  }, [environmentId]);

  useEffect(() => {
    if (pendingScrollPath) {
      setSelectedGitDiffSelection(null);
      setGitDiffFileFilter(null);
    }
  }, [pendingScrollPath, pendingSequence]);

  useEffect(() => {
    if (pendingCommitSha) {
      setSelectedGitDiffSelection(pendingCommitSha);
      onClearPendingIntent();
    }
  }, [onClearPendingIntent, pendingCommitSha, pendingSequence]);

  const hasUncommittedChanges =
    (workspaceStatus?.workingTree.fileCount ?? 0) > 0;
  const statusCommits = workspaceStatus?.mergeBase?.commits;

  useEffect(() => {
    if (
      workspaceStatus !== undefined &&
      shouldResetSelectedGitDiffSelection(
        selectedGitDiffSelection,
        statusCommits ?? [],
        { hasUncommittedChanges },
      )
    ) {
      setSelectedGitDiffSelection(null);
    }
  }, [
    hasUncommittedChanges,
    selectedGitDiffSelection,
    statusCommits,
    workspaceStatus,
  ]);

  const diffCommits = useMemo(() => statusCommits ?? [], [statusCommits]);
  const gitDiffSelectValue = selectedGitDiffSelection ?? ALL_GIT_DIFF_SELECTION;
  const gitDiffSelectOptions: GitDiffSelectionOption[] = useMemo(
    () => buildGitDiffSelectionOptions(diffCommits, { hasUncommittedChanges }),
    [diffCommits, hasUncommittedChanges],
  );

  const onGitDiffSelectionChange = useCallback((value: string) => {
    setSelectedGitDiffSelection(
      value === ALL_GIT_DIFF_SELECTION ? null : value,
    );
  }, []);

  return {
    gitDiffFileFilter,
    gitDiffTarget,
    gitDiffSelectOptions,
    gitDiffSelectValue,
    onGitDiffSelectionChange,
    setGitDiffFileFilter,
  };
}
