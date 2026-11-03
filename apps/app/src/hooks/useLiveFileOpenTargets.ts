import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import {
  getLiveFileOpenContext,
  useResolvedLiveFileRoot,
  type LiveFileRoot,
} from "@/hooks/useResolvedLiveFileTarget";

export function useLiveFileOpenTargets(root: LiveFileRoot | null) {
  const resolved = useResolvedLiveFileRoot(root);
  const { isLocalDaemonHost } = useHostDaemon();
  const localTargets = useLocalOpenTargets({
    enabled: resolved.status === "available",
    ...(resolved.status === "available"
      ? {
          openContext: getLiveFileOpenContext({
            hostId: resolved.hostId,
            isLocalDaemonHost,
            serverOrigin: window.location.origin,
          }),
        }
      : {}),
  });
  return {
    ...localTargets,
    root: resolved,
    canOpenExternally:
      resolved.status === "available" &&
      localTargets.canOpenPreferredFileTarget,
  };
}
