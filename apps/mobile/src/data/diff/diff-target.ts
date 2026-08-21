import type { WorkspaceCommitSummary, WorkspaceDiffTarget } from "@bb/domain";
import type { EnvironmentDiffArgs } from "@bb/sdk/browser";

/**
 * The diff tab's target selection (mirror of
 * apps/app/src/components/secondary-panel/git-diff/gitDiffPanelHelpers.ts):
 * the picker value, the `WorkspaceDiffTarget` the TOC / patch fetches key on,
 * the `GET /environments/:id/diff/files` query params, and the identity that
 * scopes per-file UI state. Pure, vitest-tested.
 */

export const ALL_DIFF_SELECTION = "all";
export const COMMITTED_DIFF_SELECTION = "branch_committed";
export const UNCOMMITTED_DIFF_SELECTION = "uncommitted";

/** `null` = the default ("all changes" against the merge base); otherwise a picker value. */
export type DiffSelectionValue = string | null;

export interface DiffSelectionAvailability {
  hasUncommittedChanges: boolean;
}

export interface DiffSelectionOption {
  value: string;
  label: string;
  /** Short sha shown in monospace before a commit's subject. */
  monoPrefix?: string;
}

/**
 * Resolve the diff target for a picker value. Without a merge-base branch
 * the merge-base targets cannot be built: "all" / "committed" fall back to
 * the working tree (the only target that is always meaningful), which the
 * web leaves undefined ("No diff to display").
 */
export function buildDiffTarget(
  selection: DiffSelectionValue,
  mergeBaseBranch: string | undefined,
): WorkspaceDiffTarget {
  if (selection === UNCOMMITTED_DIFF_SELECTION) {
    return { type: "uncommitted" };
  }
  if (selection === COMMITTED_DIFF_SELECTION) {
    return mergeBaseBranch
      ? { type: "branch_committed", mergeBaseBranch }
      : { type: "uncommitted" };
  }
  if (selection !== null && selection !== ALL_DIFF_SELECTION) {
    return { type: "commit", sha: selection };
  }
  return mergeBaseBranch
    ? { type: "all", mergeBaseBranch }
    : { type: "uncommitted" };
}

export function buildDiffSelectionOptions(
  commits: readonly WorkspaceCommitSummary[],
  availability: DiffSelectionAvailability,
): DiffSelectionOption[] {
  const all = { value: ALL_DIFF_SELECTION, label: "All changes" };
  const committed = {
    value: COMMITTED_DIFF_SELECTION,
    label: "Committed changes",
  };
  const uncommitted = {
    value: UNCOMMITTED_DIFF_SELECTION,
    label: "Uncommitted changes",
  };
  const hasMergeBaseContext =
    commits.length > 0 || availability.hasUncommittedChanges;
  if (!hasMergeBaseContext) {
    return [all];
  }
  return [
    all,
    ...(commits.length > 0 ? [committed] : []),
    ...(availability.hasUncommittedChanges ? [uncommitted] : []),
    ...commits.map((commit) => ({
      value: commit.sha,
      label: commit.subject,
      monoPrefix: commit.shortSha,
    })),
  ];
}

/**
 * A stored pick that no longer matches the workspace (its commit left the
 * merge-base range, the tree became clean, …) falls back to the default.
 */
export function shouldResetDiffSelection(
  selection: DiffSelectionValue,
  commits: readonly WorkspaceCommitSummary[],
  availability: DiffSelectionAvailability,
): boolean {
  if (selection === null || selection === ALL_DIFF_SELECTION) {
    return false;
  }
  if (selection === COMMITTED_DIFF_SELECTION) {
    return commits.length === 0;
  }
  if (selection === UNCOMMITTED_DIFF_SELECTION) {
    return !availability.hasUncommittedChanges;
  }
  return !commits.some((commit) => commit.sha === selection);
}

/** The per-target slice of the query key (branch name or sha). */
export function diffTargetKey(
  target: WorkspaceDiffTarget | null | undefined,
): string | null {
  switch (target?.type) {
    case "commit":
      return target.sha;
    case "branch_committed":
    case "all":
      return target.mergeBaseBranch;
    default:
      return null;
  }
}

/** The picker label for the active target. */
export function describeDiffTarget(target: WorkspaceDiffTarget): string {
  switch (target.type) {
    case "uncommitted":
      return "Uncommitted changes";
    case "branch_committed":
      return "Committed changes";
    case "all":
      return "All changes";
    case "commit":
      return target.sha.slice(0, 7);
  }
}

/** The picker value that produced `target` (for the check mark). */
export function diffSelectionForTarget(target: WorkspaceDiffTarget): string {
  switch (target.type) {
    case "uncommitted":
      return UNCOMMITTED_DIFF_SELECTION;
    case "branch_committed":
      return COMMITTED_DIFF_SELECTION;
    case "all":
      return ALL_DIFF_SELECTION;
    case "commit":
      return target.sha;
  }
}

/**
 * `GET /environments/:id/diff/files` query params for a target: the route's
 * discriminator is `target=<type>` with `mergeBaseBranch` / `sha` beside it
 * (not the nested `{type}` object the patch route takes in its body).
 */
export function buildEnvironmentDiffArgs(
  environmentId: string,
  target: WorkspaceDiffTarget,
): EnvironmentDiffArgs {
  switch (target.type) {
    case "uncommitted":
      return { environmentId, target: "uncommitted" };
    case "branch_committed":
      return {
        environmentId,
        target: "branch_committed",
        mergeBaseBranch: target.mergeBaseBranch,
      };
    case "all":
      return {
        environmentId,
        target: "all",
        mergeBaseBranch: target.mergeBaseBranch,
      };
    case "commit":
      return { environmentId, target: "commit", sha: target.sha };
  }
}

export interface DiffIdentityArgs {
  environmentId: string;
  target: WorkspaceDiffTarget;
  /** The resolved merge-base sha from the TOC response (null until loaded). */
  mergeBaseRef: string | null;
}

/**
 * Single string identity for the active (environment, target, resolved
 * merge base) diff slice. Per-file UI state (collapse) is keyed on it so a
 * target switch yields a fresh slice instead of leaking a previous diff's
 * choices onto an unrelated file at the same path.
 */
export function buildDiffIdentity({
  environmentId,
  target,
  mergeBaseRef,
}: DiffIdentityArgs): string {
  switch (target.type) {
    case "uncommitted":
      return `${environmentId}:uncommitted`;
    case "branch_committed":
    case "all":
      return [
        environmentId,
        target.type,
        target.mergeBaseBranch,
        mergeBaseRef ?? "pending",
      ].join(":");
    case "commit":
      return `${environmentId}:commit:${target.sha}`;
  }
}
