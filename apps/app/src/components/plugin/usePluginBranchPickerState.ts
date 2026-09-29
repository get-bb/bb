import { useMemo } from "react";
import {
  useProjects,
  useProjectSourceBranches,
} from "@/hooks/queries/project-queries";
import type {
  BranchesState,
  CheckoutState,
  UseBranchesArgs,
  UseCheckoutStateArgs,
} from "@get-bb/plugin-sdk";

export function usePluginBranches({
  hostId,
  projectId,
  query = "",
}: UseBranchesArgs): BranchesState {
  const projects = useProjects({
    enabled: hostId === null && projectId !== null,
  });
  const sources = projects.data?.find(
    (project) => project.id === projectId,
  )?.sources;
  const source =
    sources?.find(
      (source) => source.type === "local_path" && source.isDefault,
    ) ?? sources?.find((source) => source.type === "local_path");
  const branchHostId = hostId ?? source?.hostId ?? null;
  const enabled = branchHostId !== null && projectId !== null;
  const branchesQuery = useProjectSourceBranches(projectId, branchHostId, {
    enabled,
    query,
    selectedBranch: "",
  });
  return useMemo(
    () => ({
      branches: enabled ? (branchesQuery.data?.branches ?? []) : [],
      remoteBranches: enabled ? (branchesQuery.data?.remoteBranches ?? []) : [],
      isLoading: enabled && branchesQuery.isFetching,
      refresh: branchesQuery.refreshFromRemote,
    }),
    [
      branchesQuery.data?.branches,
      branchesQuery.data?.remoteBranches,
      branchesQuery.isFetching,
      enabled,
      branchesQuery.refreshFromRemote,
    ],
  );
}

export function usePluginCheckoutState({
  hostId,
  projectId,
}: UseCheckoutStateArgs): CheckoutState {
  const enabled = hostId !== null && projectId !== null;
  const query = useProjectSourceBranches(projectId, hostId, {
    enabled,
    query: "",
    selectedBranch: "",
  });
  const checkout = query.data?.checkout;

  return useMemo(
    () => ({
      isGit:
        query.data === undefined
          ? null
          : query.data.checkout.kind !== "unknown",
      unborn: checkout?.kind === "unborn",
      detached: checkout?.kind === "detached",
      dirty: query.data?.hasUncommittedChanges ?? false,
      currentBranch: checkout?.kind === "branch" ? checkout.branchName : null,
      operation: query.data?.operation ?? { kind: "none" },
    }),
    [checkout, query.data],
  );
}
