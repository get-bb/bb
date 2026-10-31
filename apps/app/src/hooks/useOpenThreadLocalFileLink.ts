import { useCallback } from "react";
import type { Environment } from "@bb/domain";
import { getFilePreviewLineRangeStart } from "@bb/client-core";
import { appToast } from "@/components/ui/app-toast";
import type { ThreadTimelineLocalFileLink } from "@/components/thread/timeline";
import { useThreadStorageLocation } from "@/hooks/queries/thread-panel-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import type { AppFilePreviewIntent } from "@/lib/app-navigation-host";
import { resolveThreadLocalFileLink } from "@/lib/thread-local-file-links";
import { resolveEnvironmentOpenContext } from "@/views/thread-detail/threadWorkspaceOpenPath";
import type { ThreadSecondaryPanelFileOpenOptions } from "@/views/thread-detail/useThreadSecondaryPanelVisibility";

interface UseOpenThreadLocalFileLinkArgs {
  environment: Environment | null | undefined;
  openFilePreview: (intent: AppFilePreviewIntent) => boolean;
  threadId: string | undefined;
}

export function useOpenThreadLocalFileLink({
  environment,
  openFilePreview,
  threadId,
}: UseOpenThreadLocalFileLinkArgs) {
  const { isLocalDaemonHost } = useHostDaemon();
  const threadStorageRootPath =
    useThreadStorageLocation(threadId ?? "", {
      enabled: environment != null,
    }).data?.storageRootPath ?? null;
  const executionUnavailable =
    environment != null &&
    (environment.hostLifecycle !== "active" ||
      environment.status === "destroyed");
  const openContext = executionUnavailable
    ? null
    : resolveEnvironmentOpenContext({
        environment,
        serverOrigin: window.location.origin,
        threadEnvironmentIsLocal:
          environment != null && isLocalDaemonHost(environment.hostId),
      });
  const { fileOpenTargets, openPathInFileTarget } = useLocalOpenTargets({
    enabled: openContext !== null,
    ...(openContext ? { openContext } : {}),
  });

  return useCallback(
    (
      link: ThreadTimelineLocalFileLink,
      options?: ThreadSecondaryPanelFileOpenOptions,
    ) => {
      const resolution = resolveThreadLocalFileLink({
        fileOpenTargetIds: fileOpenTargets.map((target) => target.id),
        hostId: environment?.hostId ?? null,
        link,
        threadStorage:
          threadId === undefined || threadStorageRootPath === null
            ? null
            : { rootPath: threadStorageRootPath, threadId },
        workspace:
          environment == null || environment.path === null
            ? null
            : { environmentId: environment.id, rootPath: environment.path },
      });
      switch (resolution.kind) {
        case "app-route":
          return false;
        case "error":
          appToast.error("Failed to open file locally", {
            description: resolution.description,
          });
          return true;
        case "open-in-target":
          void openPathInFileTarget({
            lineNumber: getFilePreviewLineRangeStart({
              lineRange: resolution.lineRange,
            }),
            path: resolution.path,
            rememberTarget: false,
            targetId: resolution.targetId,
          });
          return true;
        case "preview":
          openFilePreview({ ...resolution.options, ...options });
          return true;
      }
    },
    [
      environment,
      fileOpenTargets,
      openFilePreview,
      openPathInFileTarget,
      threadId,
      threadStorageRootPath,
    ],
  );
}
