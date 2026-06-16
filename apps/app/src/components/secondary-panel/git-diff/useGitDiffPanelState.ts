import { useCallback, useEffect, useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useEnvironmentWorkStatus } from "../../../hooks/queries/environment-queries";
import {
  pendingGitDiffCommitShaAtom,
  pendingGitDiffScrollPathAtom,
  selectedMergeBaseBranchAtom,
} from "../threadSecondaryPanelAtoms";
import { type GitDiffSelectionOption } from "../ThreadSecondaryPanel";
import {
  ALL_GIT_DIFF_SELECTION,
  buildGitDiffSelectionOptions,
  buildGitDiffTarget,
  shouldResetSelectedGitDiffSelection,
  type GitDiffSelectionValue,
} from "./gitDiffPanelHelpers";

interface UseGitDiffPanelStateParams {
  environmentId?: string;
  isDiffPanelActive: boolean;
  defaultMergeBaseBranch?: string;
}

/**
 * Owns the diff tab's *target selection* — the merge-base branch and the chosen
 * selection (all changes / committed changes / uncommitted changes / a specific
 * commit) — and the derived {@link buildGitDiffTarget} that the TOC + patch
 * fetches key on. The diff body ({@link GitDiffTabContent}) and the per-file
 * cards do all diff fetching, parsing, virtualization, and collapse state
 * themselves; this hook holds none of that. It reacts to the info-tab /
 * prompt-banner intents (`pendingGitDiffCommitSha` to scope to a commit,
 * `pendingGitDiffScrollPath` to reset the diff to all-changes so the opened file
 * is in the slice) and resets a stale selection when the workspace's commit list
 * changes.
 */
export function useGitDiffPanelState({
  environmentId,
  isDiffPanelActive,
  defaultMergeBaseBranch,
}: UseGitDiffPanelStateParams) {
  const selectedMergeBaseBranch = useAtomValue(selectedMergeBaseBranchAtom);
  const pendingGitDiffScrollPath = useAtomValue(pendingGitDiffScrollPathAtom);
  const setPendingGitDiffScrollPath = useSetAtom(pendingGitDiffScrollPathAtom);
  const pendingGitDiffCommitSha = useAtomValue(pendingGitDiffCommitShaAtom);
  const setPendingGitDiffCommitSha = useSetAtom(pendingGitDiffCommitShaAtom);
  const [selectedGitDiffSelection, setSelectedGitDiffSelection] =
    useState<GitDiffSelectionValue>(null);

  const effectiveMergeBaseBranch =
    selectedMergeBaseBranch ?? defaultMergeBaseBranch;
  const gitDiffTarget = useMemo(
    () =>
      buildGitDiffTarget(selectedGitDiffSelection, effectiveMergeBaseBranch),
    [effectiveMergeBaseBranch, selectedGitDiffSelection],
  );
  const { data: gitDiffWorkspaceStatus } = useEnvironmentWorkStatus(
    environmentId ?? "",
    effectiveMergeBaseBranch,
    {
      enabled:
        Boolean(environmentId) &&
        Boolean(effectiveMergeBaseBranch) &&
        isDiffPanelActive,
    },
  );
  const workspaceStatus =
    gitDiffWorkspaceStatus?.outcome === "available"
      ? gitDiffWorkspaceStatus.workspace
      : undefined;

  // --- Reset on environment change ---

  useEffect(() => {
    setSelectedGitDiffSelection(null);
  }, [environmentId]);

  useEffect(() => {
    setPendingGitDiffScrollPath(null);
  }, [environmentId, setPendingGitDiffScrollPath]);

  useEffect(() => {
    setPendingGitDiffCommitSha(null);
  }, [environmentId, setPendingGitDiffCommitSha]);

  // --- Reset the diff to all-changes when an open-file intent arrives
  // (openDiffFile) so the opened file is in the slice. The scroll consumer
  // (DiffFilesPanel) clears `pendingGitDiffScrollPath` once it scrolls the file
  // into view; that clear is also what lets re-opening the same path re-fire
  // this effect — jotai primitive atoms bail on Object.is, so a repeat write of
  // an uncleared path would be a no-op. ---

  useEffect(() => {
    if (pendingGitDiffScrollPath) {
      setSelectedGitDiffSelection(null);
    }
  }, [pendingGitDiffScrollPath]);

  // --- Apply the commit selection requested from the info tab (openCommitDiff) ---

  useEffect(() => {
    if (pendingGitDiffCommitSha) {
      setSelectedGitDiffSelection(pendingGitDiffCommitSha);
      setPendingGitDiffCommitSha(null);
    }
  }, [pendingGitDiffCommitSha, setPendingGitDiffCommitSha]);

  const hasUncommittedChanges =
    (workspaceStatus?.workingTree.files.length ?? 0) > 0;

  useEffect(() => {
    if (
      shouldResetSelectedGitDiffSelection(
        selectedGitDiffSelection,
        workspaceStatus?.mergeBase?.commits ?? [],
        { hasUncommittedChanges },
      )
    ) {
      setSelectedGitDiffSelection(null);
    }
  }, [
    hasUncommittedChanges,
    selectedGitDiffSelection,
    workspaceStatus?.mergeBase?.commits,
  ]);

  // --- Derived selection options ---

  const diffCommits = useMemo(
    () => workspaceStatus?.mergeBase?.commits ?? [],
    [workspaceStatus?.mergeBase?.commits],
  );
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
    gitDiffTarget,
    gitDiffSelectOptions,
    gitDiffSelectValue,
    onGitDiffSelectionChange,
  };
}
