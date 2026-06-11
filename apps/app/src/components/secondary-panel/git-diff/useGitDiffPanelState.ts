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
  buildGitDiffSelectionOptions,
  buildGitDiffTarget,
  shouldResetSelectedGitDiffCommit,
} from "./gitDiffPanelHelpers";

interface UseGitDiffPanelStateParams {
  environmentId?: string;
  isDiffPanelActive: boolean;
  defaultMergeBaseBranch?: string;
}

/**
 * Owns the diff tab's *target selection* — the merge-base branch, the chosen
 * commit (or "all changes" / "uncommitted"), and the derived
 * {@link buildGitDiffTarget} that the TOC + patch fetches key on. The diff body
 * ({@link GitDiffTabContent}) and the per-file cards do all diff fetching,
 * parsing, virtualization, and collapse state themselves; this hook holds none
 * of that. It reacts to the info-tab / prompt-banner intents
 * (`pendingGitDiffCommitSha` to scope to a commit, `pendingGitDiffScrollPath` to
 * reset the diff to all-changes so the opened file is in the slice) and resets a
 * stale commit selection when the workspace's commit list changes.
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
  const [selectedGitDiffCommitSha, setSelectedGitDiffCommitSha] = useState<
    string | null
  >(null);

  const effectiveMergeBaseBranch =
    selectedMergeBaseBranch ?? defaultMergeBaseBranch;
  const gitDiffTarget = useMemo(
    () =>
      buildGitDiffTarget(selectedGitDiffCommitSha, effectiveMergeBaseBranch),
    [effectiveMergeBaseBranch, selectedGitDiffCommitSha],
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
    setSelectedGitDiffCommitSha(null);
  }, [environmentId]);

  useEffect(() => {
    setPendingGitDiffScrollPath(null);
  }, [environmentId, setPendingGitDiffScrollPath]);

  useEffect(() => {
    setPendingGitDiffCommitSha(null);
  }, [environmentId, setPendingGitDiffCommitSha]);

  // --- Reset the diff to all-changes when an open-file intent arrives
  // (openDiffFile) so the opened file is in the slice. Clear the atom after
  // consuming it so re-opening the same path re-triggers the reset — jotai
  // primitive atoms bail on Object.is equality, so without this a repeat write
  // of the same path is a no-op and the effect would not re-fire. ---

  useEffect(() => {
    if (pendingGitDiffScrollPath) {
      setSelectedGitDiffCommitSha(null);
      setPendingGitDiffScrollPath(null);
    }
  }, [pendingGitDiffScrollPath, setPendingGitDiffScrollPath]);

  // --- Apply the commit selection requested from the info tab (openCommitDiff) ---

  useEffect(() => {
    if (pendingGitDiffCommitSha) {
      setSelectedGitDiffCommitSha(pendingGitDiffCommitSha);
      setPendingGitDiffCommitSha(null);
    }
  }, [pendingGitDiffCommitSha, setPendingGitDiffCommitSha]);

  const hasUncommittedChanges =
    (workspaceStatus?.workingTree.files.length ?? 0) > 0;

  useEffect(() => {
    if (
      shouldResetSelectedGitDiffCommit(
        selectedGitDiffCommitSha,
        workspaceStatus?.mergeBase?.commits ?? [],
        { hasUncommittedChanges },
      )
    ) {
      setSelectedGitDiffCommitSha(null);
    }
  }, [
    hasUncommittedChanges,
    selectedGitDiffCommitSha,
    workspaceStatus?.mergeBase?.commits,
  ]);

  // --- Derived selection options ---

  const diffCommits = useMemo(
    () => workspaceStatus?.mergeBase?.commits ?? [],
    [workspaceStatus?.mergeBase?.commits],
  );
  const gitDiffSelectValue = selectedGitDiffCommitSha ?? "all";
  const gitDiffSelectOptions: GitDiffSelectionOption[] = useMemo(
    () => buildGitDiffSelectionOptions(diffCommits, { hasUncommittedChanges }),
    [diffCommits, hasUncommittedChanges],
  );

  const onGitDiffSelectionChange = useCallback((value: string) => {
    setSelectedGitDiffCommitSha(value === "all" ? null : value);
  }, []);

  return {
    gitDiffTarget,
    gitDiffSelectOptions,
    gitDiffSelectValue,
    onGitDiffSelectionChange,
  };
}
