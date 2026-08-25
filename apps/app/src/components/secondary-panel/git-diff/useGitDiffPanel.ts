import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ExperimentalChangesViewTarget,
  ExperimentalChangesViewTargetState,
} from "@get-bb/plugin-sdk";
import { useEnvironmentMergeBaseBranches } from "../../../hooks/queries/environment-queries";
import type { SecondaryFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import type { ThreadSecondaryPanel as ThreadSecondaryPanelTab } from "@/lib/thread-secondary-panel";

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
  threadId: string;
}

interface SelectedMergeBaseBranchState {
  branch?: string;
  environmentId?: string;
}

type PendingGitDiffIntent = {
  environmentId?: string;
  sequence: number;
  target: ExperimentalChangesViewTarget;
  threadId: string;
};

export function useGitDiffPanel({
  activeSecondaryTab,
  clearActiveFileTabs,
  defaultMergeBaseBranch,
  environmentId,
  mergeBaseBranchOptionsEnabled = false,
  setThreadSecondaryPanel,
  threadId,
}: UseGitDiffPanelParams) {
  const [selectedMergeBaseBranchState, setSelectedMergeBaseBranchState] =
    useState<SelectedMergeBaseBranchState>({ environmentId });
  const selectedMergeBaseBranch =
    selectedMergeBaseBranchState.environmentId === environmentId
      ? selectedMergeBaseBranchState.branch
      : undefined;
  const setSelectedMergeBaseBranch = useCallback(
    (branch: string | undefined) => {
      setSelectedMergeBaseBranchState({ branch, environmentId });
    },
    [environmentId],
  );
  const [pendingGitDiffIntent, setPendingGitDiffIntent] =
    useState<PendingGitDiffIntent | null>(null);
  const nextPendingGitDiffSequence = useRef(0);
  const currentPendingGitDiffIntent =
    pendingGitDiffIntent !== null &&
    pendingGitDiffIntent.environmentId === environmentId &&
    pendingGitDiffIntent.threadId === threadId
      ? pendingGitDiffIntent
      : null;
  const clearPendingGitDiffIntent = useCallback(() => {
    setPendingGitDiffIntent((current) =>
      current !== null &&
      current.environmentId === environmentId &&
      current.threadId === threadId
        ? null
        : current,
    );
  }, [environmentId, threadId]);
  const pendingGitDiffTarget =
    useMemo<ExperimentalChangesViewTargetState | null>(
      () =>
        currentPendingGitDiffIntent === null
          ? null
          : {
              sequence: currentPendingGitDiffIntent.sequence,
              target: currentPendingGitDiffIntent.target,
              clear: clearPendingGitDiffIntent,
            },
      [clearPendingGitDiffIntent, currentPendingGitDiffIntent],
    );
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
  useEffect(() => {
    setMergeBaseBranchSearchQuery("");
    setPendingGitDiffIntent(null);
  }, [environmentId, threadId]);

  const openThreadDiffPanel = useCallback(() => {
    setThreadSecondaryPanel("git-diff");
  }, [setThreadSecondaryPanel]);

  const closeThreadSecondaryPanel = useCallback(() => {
    setThreadSecondaryPanel(null);
  }, [setThreadSecondaryPanel]);

  const setPendingTarget = useCallback(
    (target: ExperimentalChangesViewTarget) => {
      nextPendingGitDiffSequence.current += 1;
      setPendingGitDiffIntent({
        environmentId,
        sequence: nextPendingGitDiffSequence.current,
        target,
        threadId,
      });
    },
    [environmentId, threadId],
  );

  const openDiffFile = useCallback(
    (path: string) => {
      clearActiveFileTabs();
      setPendingTarget({ kind: "file", path });
      openThreadDiffPanel();
    },
    [clearActiveFileTabs, openThreadDiffPanel, setPendingTarget],
  );

  const openCommitDiff = useCallback(
    (sha: string) => {
      clearActiveFileTabs();
      setPendingTarget({ kind: "commit", sha });
      openThreadDiffPanel();
    },
    [clearActiveFileTabs, openThreadDiffPanel, setPendingTarget],
  );

  return {
    closeThreadSecondaryPanel,
    isLoadingMergeBaseBranchOptions,
    mergeBaseBranchOptions,
    mergeBaseRemoteBranchOptions,
    openCommitDiff,
    openDiffFile,
    openThreadDiffPanel,
    pendingGitDiffTarget,
    requestedMergeBaseBranch,
    selectedMergeBaseBranch,
    selectedMergeBaseBranchRef,
    setMergeBaseBranchSearchQuery,
    setSelectedMergeBaseBranch,
  };
}
