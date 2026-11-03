import { useEffect, useRef } from "react";
import type { ExperimentalFileOpenOptions } from "@get-bb/plugin-sdk";
import { appToast } from "@/components/ui/app-toast";
import { useLiveFileOpenTargets } from "@/hooks/useLiveFileOpenTargets";
import { resolveLiveFilePath } from "@/hooks/useResolvedLiveFileTarget";
import { getExperimentalFileLocationStart } from "@/lib/live-file-navigation";

export function AppFileExternalNavigationDispatcher({
  intent,
  onSettled,
}: {
  intent: ExperimentalFileOpenOptions;
  onSettled: () => void;
}) {
  const didSettleRef = useRef(false);
  const {
    isLoading: areLocalTargetsLoading,
    openPathInPreferredFileTarget,
    root,
  } = useLiveFileOpenTargets(intent.target);

  useEffect(() => {
    if (
      didSettleRef.current ||
      root.status === "loading" ||
      areLocalTargetsLoading
    ) {
      return;
    }
    didSettleRef.current = true;
    onSettled();
    if (root.status === "unavailable") {
      appToast.error("Failed to open file externally", {
        description: "The file target is not available on its declared host.",
      });
      return;
    }
    const location = getExperimentalFileLocationStart(intent.location);
    void openPathInPreferredFileTarget({
      columnNumber: location.columnNumber,
      lineNumber: location.lineNumber,
      path: resolveLiveFilePath(root, intent.target.path),
    });
  }, [
    intent.location,
    intent.target.path,
    areLocalTargetsLoading,
    openPathInPreferredFileTarget,
    onSettled,
    root,
  ]);

  return null;
}
