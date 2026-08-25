import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExperimentalChangesViewTargetState } from "@get-bb/plugin-sdk";
import { useEnvironmentWorkStatus } from "../../../hooks/queries/environment-queries";
import type { GitDiffSelectionOption } from "../GitDiffToolbar";
import {
  ALL_GIT_DIFF_SELECTION,
  buildGitDiffSelectionOptions,
  buildGitDiffTarget,
  shouldResetSelectedGitDiffSelection,
  type GitDiffSelectionValue,
} from "./gitDiffPanelHelpers";

/**
 * The selection each environment's Changes tab last had. The tab unmounts
 * whenever another right-panel view is active, so the choice lives here
 * rather than in component state: leaving and coming back finds the same
 * commit selected, and a different environment starts from all changes.
 */
const selectionByEnvironment = new Map<string, GitDiffSelectionValue>();

function rememberedSelection(environmentId: string | undefined): GitDiffSelectionValue {
  return environmentId === undefined
    ? null
    : (selectionByEnvironment.get(environmentId) ?? null);
}

interface UseGitDiffPanelStateParams {
  environmentId?: string;
  isDiffPanelActive: boolean;
  requestedMergeBaseBranch?: string;
  experimental_target: ExperimentalChangesViewTargetState | null;
}

/**
 * Owns the diff tab's *target selection* — the requested merge-base branch and
 * the chosen selection (all changes / committed changes / uncommitted changes /
 * a specific commit) — and the derived {@link buildGitDiffTarget} that the TOC +
 * patch fetches key on. The diff body ({@link GitDiffTabContent}) and the
 * per-file cards do all diff fetching, parsing, virtualization, and collapse
 * state themselves; this hook holds none of that. It reacts to the pane's
 * target state, scopes commit targets, resets file targets to all changes, and
 * resets a stale selection when the workspace's commit list changes.
 */
export function useGitDiffPanelState({
  environmentId,
  isDiffPanelActive,
  requestedMergeBaseBranch,
  experimental_target,
}: UseGitDiffPanelStateParams) {
  const [selectedGitDiffSelection, setSelectedGitDiffSelectionState] =
    useState<GitDiffSelectionValue>(() => rememberedSelection(environmentId));
  const setSelectedGitDiffSelection = useCallback(
    (value: GitDiffSelectionValue) => {
      if (environmentId !== undefined) {
        selectionByEnvironment.set(environmentId, value);
      }
      setSelectedGitDiffSelectionState(value);
    },
    [environmentId],
  );

  const gitDiffTarget = useMemo(
    () =>
      buildGitDiffTarget(selectedGitDiffSelection, requestedMergeBaseBranch),
    [requestedMergeBaseBranch, selectedGitDiffSelection],
  );
  const { data: gitDiffWorkspaceStatus } = useEnvironmentWorkStatus(
    environmentId ?? "",
    requestedMergeBaseBranch,
    {
      enabled:
        Boolean(environmentId) &&
        Boolean(requestedMergeBaseBranch) &&
        isDiffPanelActive,
    },
  );
  const workspaceStatus =
    gitDiffWorkspaceStatus?.outcome === "available"
      ? gitDiffWorkspaceStatus.workspace
      : undefined;

  // --- Follow the environment: its own remembered selection, or all changes ---

  useEffect(() => {
    setSelectedGitDiffSelectionState(rememberedSelection(environmentId));
  }, [environmentId]);

  // --- Reset the diff to all-changes when an open-file intent arrives
  // (openDiffFile) so the opened file is in the slice. The scroll consumer
  // (DiffFilesPanel) clears the target once it scrolls the file into view.
  // Clearing the intent also lets re-opening the same path re-fire
  // this effect. ---

  useEffect(() => {
    if (experimental_target?.target.kind === "file") {
      setSelectedGitDiffSelection(null);
    }
  }, [
    experimental_target?.sequence,
    experimental_target?.target.kind,
    setSelectedGitDiffSelection,
  ]);

  // --- Apply the commit selection requested from the info tab (openCommitDiff) ---

  useEffect(() => {
    if (experimental_target?.target.kind === "commit") {
      setSelectedGitDiffSelection(experimental_target.target.sha);
      experimental_target.clear();
    }
  }, [experimental_target, setSelectedGitDiffSelection]);

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
    setSelectedGitDiffSelection,
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

  const onGitDiffSelectionChange = useCallback(
    (value: string) => {
      setSelectedGitDiffSelection(
        value === ALL_GIT_DIFF_SELECTION ? null : value,
      );
    },
    [setSelectedGitDiffSelection],
  );

  return {
    gitDiffTarget,
    gitDiffSelectOptions,
    gitDiffSelectValue,
    onGitDiffSelectionChange,
  };
}
