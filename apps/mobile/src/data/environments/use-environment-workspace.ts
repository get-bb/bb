import {
  resolveEnvironmentMergeBaseBranch,
  type Environment,
  type WorkspaceStatus,
} from "@bb/domain";
import { useCallback, useState } from "react";
import { useUpdateEnvironment } from "./environment-mutations";
import { useEnvironmentStatus } from "./environment-queries";
import {
  resolveEffectiveMergeBaseBranch,
  resolveMergeBaseVisibility,
  resolvePersistedMergeBaseBranch,
} from "./merge-base";
import {
  getWorkspaceStatusFromResponse,
  getWorkspaceUnavailableFailure,
  type WorkspaceResolutionFailure,
} from "./workspace-status";

interface MergeBasePick {
  environmentId: string;
  branch: string;
  /** The server override at pick time; a different value means it moved. */
  persistedAtPick: string | null;
}

export interface EnvironmentMergeBaseState {
  /** The branch the status query compares against (selection wins). */
  effectiveMergeBaseBranch: string | undefined;
  /** Offer the merge-base picker. */
  showMergeBase: boolean;
  /** Enough data to describe an ahead/behind comparison. */
  showBranchComparison: boolean;
  /** Persisting a pick right now. */
  isUpdating: boolean;
  /** Pick a branch: optimistic locally, `PATCH /environments/:id` behind it. */
  setMergeBaseBranch: (branch: string) => void;
}

export interface UseEnvironmentWorkspaceArgs {
  environment: Environment | undefined;
  /** Git-backed, ready environment: run the status query. */
  enabled: boolean;
}

export interface EnvironmentWorkspaceState {
  workspaceStatus: WorkspaceStatus | undefined;
  workspaceUnavailable: WorkspaceResolutionFailure | undefined;
  /** First status read still in flight (the banner holds rendering). */
  statusPending: boolean;
  statusError: Error | null;
  mergeBase: EnvironmentMergeBaseState;
}

/**
 * Workspace status + merge base for one environment (the mobile counterpart
 * of the web `useEnvironmentWorkStatus` + `useEnvironmentMergeBase` pair).
 * The status request compares against the user's pick, else the
 * environment's configured / base / default branch — the daemon only
 * computes ahead/behind for an explicit branch. The pick is optimistic and
 * derived away (the server override wins again) as soon as the environment
 * record changes underneath it: the pick's own update landing, another
 * client picking, or a different environment.
 */
export function useEnvironmentWorkspace({
  environment,
  enabled,
}: UseEnvironmentWorkspaceArgs): EnvironmentWorkspaceState {
  const updateEnvironment = useUpdateEnvironment();
  const [pick, setPick] = useState<MergeBasePick | null>(null);
  const persisted = environment?.mergeBaseBranch ?? null;
  const selected =
    pick !== null &&
    environment !== undefined &&
    pick.environmentId === environment.id &&
    pick.persistedAtPick === persisted
      ? pick.branch
      : (persisted ?? undefined);
  const requestedMergeBaseBranch =
    selected ?? resolveEnvironmentMergeBaseBranch(environment);

  const statusQuery = useEnvironmentStatus(
    environment?.id ?? null,
    requestedMergeBaseBranch,
    { enabled },
  );
  const workspaceStatus = statusQuery.error
    ? undefined
    : getWorkspaceStatusFromResponse(statusQuery.data);
  const workspaceUnavailable = getWorkspaceUnavailableFailure(statusQuery.data);

  const effectiveMergeBaseBranch = resolveEffectiveMergeBaseBranch({
    environment,
    selectedMergeBaseBranch: selected,
    workspaceStatus,
  });
  const visibility = resolveMergeBaseVisibility({
    effectiveMergeBaseBranch,
    workspaceStatus,
  });

  const { mutate } = updateEnvironment;
  const setMergeBaseBranch = useCallback(
    (branch: string) => {
      if (!environment) return;
      const normalized = branch.trim();
      const nextPersisted = resolvePersistedMergeBaseBranch({
        branch: normalized,
        environment,
        workspaceStatus,
      });
      setPick(
        normalized.length > 0
          ? {
              environmentId: environment.id,
              branch: normalized,
              persistedAtPick: environment.mergeBaseBranch,
            }
          : null,
      );
      if (nextPersisted === environment.mergeBaseBranch) return;
      // The mutation's `meta.errorMessage` toasts the failure globally; the
      // hook only rolls the optimistic pick back.
      mutate(
        { id: environment.id, mergeBaseBranch: nextPersisted },
        { onError: () => setPick(null) },
      );
    },
    [environment, mutate, workspaceStatus],
  );

  return {
    workspaceStatus,
    workspaceUnavailable,
    statusPending: enabled && statusQuery.isPending,
    statusError: statusQuery.error,
    mergeBase: {
      effectiveMergeBaseBranch,
      showMergeBase: visibility.showMergeBase,
      showBranchComparison: visibility.showBranchComparison,
      isUpdating:
        updateEnvironment.isPending &&
        updateEnvironment.variables?.id === environment?.id,
      setMergeBaseBranch,
    },
  };
}
