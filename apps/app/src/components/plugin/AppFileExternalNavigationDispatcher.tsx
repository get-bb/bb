import { useEffect, useRef } from "react";
import type { ExperimentalResolvedFileOpenOptions } from "@get-bb/plugin-sdk";
import { appToast } from "@/components/ui/app-toast";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import { useResolvedLiveFileTarget } from "@/hooks/useResolvedLiveFileTarget";
import {
  getExperimentalFileLocationStart,
  liveFileTargetFromIdentity,
} from "@/lib/live-file-navigation";

export function AppFileExternalNavigationDispatcher({
  intent,
  onSettled,
}: {
  intent: ExperimentalResolvedFileOpenOptions;
  onSettled: () => void;
}) {
  const didSettleRef = useRef(false);
  const resolvedTarget = useResolvedLiveFileTarget(
    liveFileTargetFromIdentity(intent.identity),
    {
      enabled: true,
    },
  );
  const { isLoading: areLocalTargetsLoading, openPathInPreferredFileTarget } =
    useLocalOpenTargets({
      enabled: resolvedTarget.status === "available",
      ...(resolvedTarget.status === "available"
        ? { openContext: resolvedTarget.openContext }
        : {}),
    });

  useEffect(() => {
    if (
      didSettleRef.current ||
      resolvedTarget.status === "loading" ||
      areLocalTargetsLoading
    ) {
      return;
    }
    didSettleRef.current = true;
    onSettled();
    if (resolvedTarget.status === "unavailable") {
      appToast.error("Failed to open file externally", {
        description: "The file target is not available on its declared host.",
      });
      return;
    }
    const location = getExperimentalFileLocationStart(intent.identity.location);
    void openPathInPreferredFileTarget({
      columnNumber: location.columnNumber,
      lineNumber: location.lineNumber,
      path: resolvedTarget.absolutePath,
    });
  }, [
    intent.identity.location,
    areLocalTargetsLoading,
    openPathInPreferredFileTarget,
    onSettled,
    resolvedTarget,
  ]);

  return null;
}
