import { useCallback } from "react";
import type { Environment } from "@bb/domain";
import { getFilePreviewLineRangeStart } from "@bb/client-core";
import { appToast } from "@/components/ui/app-toast";
import type { ThreadTimelineLocalFileLink } from "@/components/thread/timeline";
import { useThreadStorageLocation } from "@/hooks/queries/thread-panel-queries";
import { useLiveFileOpenTargets } from "@/hooks/useLiveFileOpenTargets";
import type { AppFilePreviewIntent } from "@/lib/app-navigation-host";
import { resolveThreadLocalFileLink } from "@/lib/thread-local-file-links";
import type { ThreadSecondaryPanelFileOpenOptions } from "@/views/thread-detail/useThreadSecondaryPanelVisibility";

type ResolveLocalFileLinkArgs = Parameters<
  typeof resolveThreadLocalFileLink
>[0];

interface UseLocalFileLinkOpenerArgs extends Pick<
  ResolveLocalFileLinkArgs,
  "hostId" | "threadStorage" | "workspace"
> {
  canOpenInEditor: boolean;
  openFilePreview: (intent: AppFilePreviewIntent) => boolean;
}

export function useLocalFileLinkOpener({
  canOpenInEditor,
  hostId,
  openFilePreview,
  threadStorage,
  workspace,
}: UseLocalFileLinkOpenerArgs) {
  const openTargets = useLiveFileOpenTargets(
    canOpenInEditor && hostId !== null ? { kind: "host", hostId } : null,
  );
  const { fileOpenTargets, openPathInFileTarget } = openTargets;
  const workspaceEnvironmentId = workspace?.environmentId ?? null;
  const workspaceRef = workspace?.experimental_ref;
  const workspaceRootPath = workspace?.rootPath ?? null;
  const storageThreadId = threadStorage?.threadId ?? null;
  const storageRootPath = threadStorage?.rootPath ?? null;
  const openLink = useCallback(
    (
      link: ThreadTimelineLocalFileLink,
      options?: ThreadSecondaryPanelFileOpenOptions,
    ) => {
      const resolution = resolveThreadLocalFileLink({
        fileOpenTargetIds: fileOpenTargets.map((target) => target.id),
        hostId,
        link,
        threadStorage:
          storageThreadId === null || storageRootPath === null
            ? null
            : { rootPath: storageRootPath, threadId: storageThreadId },
        workspace:
          workspaceEnvironmentId === null || workspaceRootPath === null
            ? null
            : {
                environmentId: workspaceEnvironmentId,
                rootPath: workspaceRootPath,
                ...(workspaceRef === undefined
                  ? {}
                  : { experimental_ref: workspaceRef }),
              },
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
      fileOpenTargets,
      hostId,
      openFilePreview,
      openPathInFileTarget,
      storageRootPath,
      storageThreadId,
      workspaceEnvironmentId,
      workspaceRef,
      workspaceRootPath,
    ],
  );
  return { openLink, openTargets };
}

export function useThreadFileLinkOpener({
  environment,
  openFilePreview,
  threadId,
}: {
  environment: Environment | null | undefined;
  openFilePreview: (intent: AppFilePreviewIntent) => boolean;
  threadId: string | undefined;
}) {
  const threadStorageRootPath =
    useThreadStorageLocation(threadId ?? "", {
      enabled: environment != null,
    }).data?.storageRootPath ?? null;
  const opener = useLocalFileLinkOpener({
    canOpenInEditor:
      environment != null &&
      environment.hostLifecycle === "active" &&
      environment.status !== "destroyed",
    hostId: environment?.hostId ?? null,
    openFilePreview,
    threadStorage:
      threadId === undefined || threadStorageRootPath === null
        ? null
        : { rootPath: threadStorageRootPath, threadId },
    workspace:
      environment == null || environment.path === null
        ? null
        : { environmentId: environment.id, rootPath: environment.path },
  });
  return { ...opener, threadStorageRootPath };
}
