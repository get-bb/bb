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
import { openInTarget as daemonOpenInTarget } from "@/lib/api-host-daemon";
import { useAsyncAtomValue } from "@/lib/use-async-atom-value";

const disabledLocalHostDaemonReachableAtom = atom(false);
const disabledHostDaemonPortAtom = atom<number | null>(null);
const disabledWorkspaceOpenTargetsAtom = atom<WorkspaceOpenTarget[]>([]);
const NO_WORKSPACE_OPEN_TARGETS: WorkspaceOpenTarget[] = [];

export interface UseWorkspaceOpenTargetsArgs {
  enabled: boolean;
}

export interface UseWorkspaceOpenTargetsResult {
  openWorkspace: ((request: OpenInTargetRequest) => Promise<void>) | null;
  workspaceOpenTargets: WorkspaceOpenTarget[];
}

export function useWorkspaceOpenTargets(
  args: UseWorkspaceOpenTargetsArgs,
): UseWorkspaceOpenTargetsResult {
  const localHostDaemonReachable = useAsyncAtomValue(
    args.enabled
      ? localHostDaemonReachableAtom
      : disabledLocalHostDaemonReachableAtom,
    false,
  );
  const daemonPort = useAsyncAtomValue(
    args.enabled ? hostDaemonPortAtom : disabledHostDaemonPortAtom,
    null,
  );
  const workspaceOpenTargets = useAsyncAtomValue(
    args.enabled
      ? localWorkspaceOpenTargetsAtom
      : disabledWorkspaceOpenTargetsAtom,
    NO_WORKSPACE_OPEN_TARGETS,
  );

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

  return {
    openWorkspace,
    workspaceOpenTargets,
  };
}
