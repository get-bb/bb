import { useQuery, useQueryClient } from "@tanstack/react-query";
import { atom } from "jotai";
import { useMemo } from "react";
import type {
  OpenInTargetRequest,
  WorkspaceOpenTarget,
} from "@bb/host-daemon-contract";
import { localWorkspaceOpenTargetsQueryKey } from "@/hooks/queries/query-keys";
import { hostDerivedQueryPolicy } from "@/hooks/queries/query-policies";
import {
  hostDaemonPortAtom,
  localHostDaemonReachableAtom,
} from "@/lib/system-config-atoms";
import {
  fetchWorkspaceOpenTargets,
  openInTarget as daemonOpenInTarget,
} from "@/lib/api-host-daemon";
import { useAsyncAtomState } from "@/lib/use-async-atom-value";

const disabledLocalHostDaemonReachableAtom = atom(false);
const disabledHostDaemonPortAtom = atom<number | null>(null);
const NO_WORKSPACE_OPEN_TARGETS: WorkspaceOpenTarget[] = [];

interface UseWorkspaceOpenTargetsArgs {
  enabled: boolean;
}

interface UseWorkspaceOpenTargetsResult {
  fetchWorkspaceOpenTargetsForPath:
    | ((path: string) => Promise<WorkspaceOpenTarget[]>)
    | null;
  openWorkspace: ((request: OpenInTargetRequest) => Promise<void>) | null;
  isLoading: boolean;
  workspaceOpenTargets: WorkspaceOpenTarget[];
}

export function useWorkspaceOpenTargets(
  args: UseWorkspaceOpenTargetsArgs,
): UseWorkspaceOpenTargetsResult {
  const localHostDaemonReachableState = useAsyncAtomState(
    args.enabled
      ? localHostDaemonReachableAtom
      : disabledLocalHostDaemonReachableAtom,
    false,
  );
  const daemonPortState = useAsyncAtomState(
    args.enabled ? hostDaemonPortAtom : disabledHostDaemonPortAtom,
    null,
  );
  const localHostDaemonReachable = localHostDaemonReachableState.data;
  const daemonPort = daemonPortState.data;
  const queryClient = useQueryClient();
  const workspaceOpenTargetsQuery = useQuery({
    queryKey: localWorkspaceOpenTargetsQueryKey(daemonPort, null),
    queryFn: () =>
      daemonPort === null ? [] : fetchWorkspaceOpenTargets(daemonPort),
    enabled: args.enabled && !daemonPortState.isLoading,
    staleTime: Infinity,
    ...hostDerivedQueryPolicy(null),
  });
  const workspaceOpenTargets =
    workspaceOpenTargetsQuery.data ?? NO_WORKSPACE_OPEN_TARGETS;
  const isLoading =
    args.enabled &&
    (localHostDaemonReachableState.isLoading ||
      daemonPortState.isLoading ||
      workspaceOpenTargetsQuery.isPending);

  const openWorkspace = useMemo(() => {
    if (
      !args.enabled ||
      !localHostDaemonReachable ||
      !daemonPort ||
      workspaceOpenTargets.length === 0
    ) {
      return null;
    }
    const port = daemonPort;
    return (request: OpenInTargetRequest) => daemonOpenInTarget(port, request);
  }, [
    args.enabled,
    localHostDaemonReachable,
    daemonPort,
    workspaceOpenTargets.length,
  ]);

  const fetchWorkspaceOpenTargetsForPath = useMemo(() => {
    if (!args.enabled || !localHostDaemonReachable || !daemonPort) {
      return null;
    }
    const port = daemonPort;
    return (path: string) =>
      queryClient.fetchQuery({
        queryKey: localWorkspaceOpenTargetsQueryKey(port, path),
        queryFn: () => fetchWorkspaceOpenTargets(port, { path }),
        staleTime: 0,
        ...hostDerivedQueryPolicy(null),
      });
  }, [args.enabled, localHostDaemonReachable, daemonPort, queryClient]);

  return {
    fetchWorkspaceOpenTargetsForPath,
    isLoading,
    openWorkspace,
    workspaceOpenTargets,
  };
}
