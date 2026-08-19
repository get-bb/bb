import { atom } from "jotai";
import { useMemo } from "react";
import type {
  OpenInTargetRequest,
  WorkspaceOpenTarget,
} from "@bb/host-daemon-contract";
import {
  hostDaemonPortAtom,
  localHostDaemonReachableAtom,
  localWorkspaceOpenTargetsAtom,
} from "@/lib/system-config-atoms";
import {
  fetchWorkspaceOpenTargets,
  openInTarget as daemonOpenInTarget,
} from "@/lib/api-host-daemon";
import { useAsyncAtomState } from "@/lib/use-async-atom-value";

const disabledLocalHostDaemonReachableAtom = atom(false);
const disabledHostDaemonPortAtom = atom<number | null>(null);
const disabledWorkspaceOpenTargetsAtom = atom<WorkspaceOpenTarget[]>([]);
const NO_WORKSPACE_OPEN_TARGETS: WorkspaceOpenTarget[] = [];

export interface UseWorkspaceOpenTargetsArgs {
  enabled: boolean;
}

export interface UseWorkspaceOpenTargetsResult {
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
  const workspaceOpenTargetsState = useAsyncAtomState(
    args.enabled
      ? localWorkspaceOpenTargetsAtom
      : disabledWorkspaceOpenTargetsAtom,
    NO_WORKSPACE_OPEN_TARGETS,
  );
  const localHostDaemonReachable = localHostDaemonReachableState.data;
  const daemonPort = daemonPortState.data;
  const workspaceOpenTargets = workspaceOpenTargetsState.data;
  const isLoading =
    args.enabled &&
    (localHostDaemonReachableState.isLoading ||
      daemonPortState.isLoading ||
      workspaceOpenTargetsState.isLoading);

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
    return (path: string) => fetchWorkspaceOpenTargets(port, { path });
  }, [args.enabled, localHostDaemonReachable, daemonPort]);

  return {
    fetchWorkspaceOpenTargetsForPath,
    isLoading,
    openWorkspace,
    workspaceOpenTargets,
  };
}
