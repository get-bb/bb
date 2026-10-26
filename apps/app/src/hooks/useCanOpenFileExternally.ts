import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import {
  getLiveFileOpenContext,
  useResolvedLiveFileRoot,
  type LiveFileRoot,
} from "@/hooks/useResolvedLiveFileTarget";

export function useCanOpenFileExternally(root: LiveFileRoot | null): boolean {
  const resolved = useResolvedLiveFileRoot(root);
  const { isLocalDaemonHost } = useHostDaemon();
  const { canOpenPreferredFileTarget } = useLocalOpenTargets({
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
  return resolved.status === "available" && canOpenPreferredFileTarget;
}
