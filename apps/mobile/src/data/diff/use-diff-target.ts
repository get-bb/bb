import type { Environment, WorkspaceDiffTarget } from "@bb/domain";
import { useCallback, useMemo, useState } from "react";
import {
  useEnvironmentWorkspace,
  type EnvironmentMergeBaseState,
} from "../environments";
import {
  ALL_DIFF_SELECTION,
  buildDiffSelectionOptions,
  buildDiffTarget,
  diffSelectionForTarget,
  shouldResetDiffSelection,
  UNCOMMITTED_DIFF_SELECTION,
  type DiffSelectionOption,
  type DiffSelectionValue,
} from "./diff-target";

export interface UseDiffTargetArgs {
  environment: Environment | undefined;
  /** Ready, git-backed environment: run the status query. */
  enabled: boolean;
}

export interface DiffTargetState {
  /** What the TOC + patch fetches key on. */
  target: WorkspaceDiffTarget;
  /** The picker value for `target` (for the check mark). */
  selection: string;
  options: readonly DiffSelectionOption[];
  setSelection: (value: string) => void;
  /** The merge base behind "all" / "committed" + the picker to change it. */
  mergeBase: EnvironmentMergeBaseState;
  /** The status query is still loading its first answer. */
  statusPending: boolean;
}

/**
 * The diff tab's target selection (port of the web `useGitDiffPanelState`):
 * the user's pick (all / committed / uncommitted / one commit) over the
 * effective merge base from `useEnvironmentWorkspace` (the same hook the
 * context banner uses, so a merge-base pick in either place moves both
 * through `PATCH /environments/:id`). A pick that stops matching the
 * workspace — its commit left the range, the tree became clean — falls back
 * to the default; so does an environment switch.
 */
export function useDiffTarget({
  environment,
  enabled,
}: UseDiffTargetArgs): DiffTargetState {
  const environmentId = environment?.id ?? null;
  const { workspaceStatus, statusPending, mergeBase } = useEnvironmentWorkspace(
    { environment, enabled },
  );
  const [picked, setPicked] = useState<{
    environmentId: string | null;
    value: DiffSelectionValue;
  }>({ environmentId, value: null });
  const pickedValue =
    picked.environmentId === environmentId ? picked.value : null;

  const commits = useMemo(
    () => workspaceStatus?.mergeBase?.commits ?? [],
    [workspaceStatus?.mergeBase?.commits],
  );
  const hasUncommittedChanges =
    (workspaceStatus?.workingTree.files.length ?? 0) > 0;
  const availability = useMemo(
    () => ({ hasUncommittedChanges }),
    [hasUncommittedChanges],
  );

  // A pick that stops matching the workspace is ignored (derived, not
  // reset in an effect): the default stands in until the user picks again.
  const selectionValue =
    workspaceStatus !== undefined &&
    shouldResetDiffSelection(pickedValue, commits, availability)
      ? null
      : pickedValue;

  const target = useMemo(
    () => buildDiffTarget(selectionValue, mergeBase.effectiveMergeBaseBranch),
    [mergeBase.effectiveMergeBaseBranch, selectionValue],
  );
  const mergeBaseBranch = mergeBase.effectiveMergeBaseBranch;
  const options = useMemo(
    () =>
      mergeBaseBranch
        ? buildDiffSelectionOptions(commits, availability)
        : // Without a merge base only the working tree can be diffed.
          [{ value: UNCOMMITTED_DIFF_SELECTION, label: "Uncommitted changes" }],
    [availability, commits, mergeBaseBranch],
  );
  const setSelection = useCallback(
    (value: string) =>
      setPicked({
        environmentId,
        value: value === ALL_DIFF_SELECTION ? null : value,
      }),
    [environmentId],
  );

  return {
    target,
    selection: diffSelectionForTarget(target),
    options,
    setSelection,
    mergeBase,
    statusPending,
  };
}
