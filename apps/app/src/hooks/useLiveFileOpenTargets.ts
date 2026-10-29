import type { ExperimentalLiveFileTarget } from "@get-bb/plugin-sdk";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import { useResolvedLiveFileTarget } from "@/hooks/useResolvedLiveFileTarget";

export function useLiveFileOpenTargets(
  target: ExperimentalLiveFileTarget | null,
) {
  const resolved = useResolvedLiveFileTarget(target, {
    enabled: target !== null,
  });
  const localTargets = useLocalOpenTargets({
    enabled: resolved.status === "available",
    ...(resolved.status === "available"
      ? { openContext: resolved.openContext }
      : {}),
  });
  return {
    resolved,
    localTargets,
    canOpenExternally:
      resolved.status === "available" &&
      !localTargets.isLoading &&
      localTargets.canOpenPreferredFileTarget,
  };
}

export function useCanOpenFileExternally(
  target: ExperimentalLiveFileTarget | null,
): boolean {
  return useLiveFileOpenTargets(target).canOpenExternally;
}
