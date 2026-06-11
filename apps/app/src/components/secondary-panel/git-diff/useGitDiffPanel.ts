import { useCallback, useEffect, useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useEnvironmentMergeBaseBranches } from "../../../hooks/queries/environment-queries";
import type { SecondaryFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import type { ThreadSecondaryPanel as ThreadSecondaryPanelTab } from "@/lib/thread-secondary-panel";
import {
  pendingGitDiffCommitShaAtom,
  pendingGitDiffScrollPathAtom,
  selectedMergeBaseBranchAtom,
} from "../threadSecondaryPanelAtoms";

type ThreadSecondaryPanelSetter = (
  panel: ThreadSecondaryPanelTab | null,
) => void;

interface UseGitDiffPanelParams {
  activeSecondaryTab: SecondaryFixedPanelTab | null;
  clearActiveFileTabs: () => void;
  defaultMergeBaseBranch?: string;
  environmentId?: string;
  mergeBaseBranchOptionsEnabled?: boolean;
  setThreadSecondaryPanel: ThreadSecondaryPanelSetter;
}

export function useGitDiffPanel({
  activeSecondaryTab,
  clearActiveFileTabs,
  defaultMergeBaseBranch,
  environmentId,
  mergeBaseBranchOptionsEnabled = false,
  setThreadSecondaryPanel,
}: UseGitDiffPanelParams) {
  const selectedMergeBaseBranch = useAtomValue(selectedMergeBaseBranchAtom);
  const setSelectedMergeBaseBranch = useSetAtom(selectedMergeBaseBranchAtom);
  const setPendingGitDiffScrollPath = useSetAtom(pendingGitDiffScrollPathAtom);
  const setPendingGitDiffCommitSha = useSetAtom(pendingGitDiffCommitShaAtom);
  const [mergeBaseBranchSearchQuery, setMergeBaseBranchSearchQuery] =
    useState("");
  const requestedMergeBaseBranch =
    selectedMergeBaseBranch ?? defaultMergeBaseBranch;

  const {
    data: mergeBaseBranches,
    isFetching: isLoadingMergeBaseBranchOptions,
  } = useEnvironmentMergeBaseBranches(environmentId ?? "", {
    // Branch options are only needed once the picker can open or the diff
    // panel is visible; initial thread load can use the persisted/default base.
    enabled:
      Boolean(environmentId) &&
      (mergeBaseBranchOptionsEnabled ||
        activeSecondaryTab?.kind === "git-diff"),
    query: mergeBaseBranchSearchQuery,
    selectedBranch: requestedMergeBaseBranch,
  });
  const selectedMergeBaseBranchRef = mergeBaseBranches?.selectedBranch;
  const mergeBaseBranchList = mergeBaseBranches?.branches;
  const mergeBaseRemoteBranchList = mergeBaseBranches?.remoteBranches;
  const mergeBaseBranchOptions = useMemo(() => {
    if (!mergeBaseBranchList) {
      return undefined;
    }

    return selectedMergeBaseBranchRef?.kind === "local" &&
      !mergeBaseBranchList.includes(selectedMergeBaseBranchRef.name)
      ? [selectedMergeBaseBranchRef.name, ...mergeBaseBranchList]
      : mergeBaseBranchList;
  }, [mergeBaseBranchList, selectedMergeBaseBranchRef]);
  const mergeBaseRemoteBranchOptions = useMemo(() => {
    if (!mergeBaseRemoteBranchList) {
      return undefined;
    }

    return selectedMergeBaseBranchRef?.kind === "remote" &&
      !mergeBaseRemoteBranchList.includes(selectedMergeBaseBranchRef.name)
      ? [selectedMergeBaseBranchRef.name, ...mergeBaseRemoteBranchList]
      : mergeBaseRemoteBranchList;
  }, [mergeBaseRemoteBranchList, selectedMergeBaseBranchRef]);
  const mergeBaseBranchOptionsTruncated = Boolean(
    mergeBaseBranches?.branchesTruncated ||
    mergeBaseBranches?.remoteBranchesTruncated,
  );

  useEffect(() => {
    setSelectedMergeBaseBranch(undefined);
    setMergeBaseBranchSearchQuery("");
  }, [environmentId, setSelectedMergeBaseBranch]);

  const openThreadSecondaryPanel = useCallback(
    (panel: ThreadSecondaryPanelTab) => {
      setThreadSecondaryPanel(panel);
    },
    [setThreadSecondaryPanel],
  );

  const openThreadDiffPanel = useCallback(() => {
    openThreadSecondaryPanel("git-diff");
  }, [openThreadSecondaryPanel]);

  const closeThreadSecondaryPanel = useCallback(() => {
    setThreadSecondaryPanel(null);
  }, [setThreadSecondaryPanel]);

  const openDiffFile = useCallback(
    (path: string) => {
      clearActiveFileTabs();
      setPendingGitDiffScrollPath(path);
      openThreadDiffPanel();
    },
    [clearActiveFileTabs, openThreadDiffPanel, setPendingGitDiffScrollPath],
  );

  const openCommitDiff = useCallback(
    (sha: string) => {
      clearActiveFileTabs();
      setPendingGitDiffCommitSha(sha);
      openThreadDiffPanel();
    },
    [clearActiveFileTabs, openThreadDiffPanel, setPendingGitDiffCommitSha],
  );

  return {
    closeThreadSecondaryPanel,
    defaultMergeBaseBranch,
    isLoadingMergeBaseBranchOptions,
    mergeBaseBranchOptions,
    mergeBaseBranchOptionsTruncated,
    mergeBaseRemoteBranchOptions,
    openCommitDiff,
    openDiffFile,
    openThreadDiffPanel,
    openThreadSecondaryPanel,
    selectedMergeBaseBranch,
    selectedMergeBaseBranchRef,
    setMergeBaseBranchSearchQuery,
    setSelectedMergeBaseBranch,
  };
}
