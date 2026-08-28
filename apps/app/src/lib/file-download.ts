import type { OpenSecondaryPanelTabRequest } from "@/components/secondary-panel/useThreadFileTabs";
import {
  buildProjectFileContentUrl,
  buildThreadHostFileContentUrl,
  buildThreadStorageContentUrl,
} from "./file-content-urls";
import { appToast } from "@/components/ui/app-toast";

interface DownloadFileForOpenRequestArgs {
  projectHostId: string | null;
  projectId: string | null;
  request: OpenSecondaryPanelTabRequest;
  resolvedEnvironmentId: string | null | undefined;
  threadId: string | null | undefined;
}

export function getFileOpenRequestPath(
  request: OpenSecondaryPanelTabRequest,
): string | null {
  return request.kind === "workspace-file-preview" ||
    request.kind === "host-file-preview" ||
    request.kind === "thread-storage-file-preview"
    ? request.tab.path
    : null;
}

function buildFileDownloadUrl({
  projectHostId,
  projectId,
  request,
  resolvedEnvironmentId,
  threadId,
}: DownloadFileForOpenRequestArgs): string | null {
  if (request.kind === "workspace-file-preview") {
    if (
      projectId === null ||
      request.tab.source.kind !== "working-tree" ||
      request.tab.statusLabel === "deleted"
    ) {
      return null;
    }
    const environmentId =
      request.environmentId ?? resolvedEnvironmentId ?? null;
    if (environmentId === null && projectHostId === null) return null;
    return buildProjectFileContentUrl(
      projectId,
      request.tab.path,
      environmentId !== null
        ? { environmentId }
        : projectHostId === null
          ? {}
          : { hostId: projectHostId },
      "attachment",
    );
  }

  if (request.kind === "host-file-preview") {
    if (request.hostId !== undefined || !threadId) return null;
    return buildThreadHostFileContentUrl(
      threadId,
      request.tab.path,
      "attachment",
    );
  }

  if (request.kind === "thread-storage-file-preview") {
    const storageThreadId = request.threadId ?? threadId;
    return storageThreadId
      ? buildThreadStorageContentUrl(
          storageThreadId,
          request.tab.path,
          "attachment",
        )
      : null;
  }

  return null;
}

export function downloadFileForOpenRequest(
  args: DownloadFileForOpenRequestArgs,
): boolean {
  const url = buildFileDownloadUrl(args);
  const path = getFileOpenRequestPath(args.request);
  if (url === null || path === null) return false;

  const filename = path.split(/[\\/]/u).at(-1) ?? "download";
  void fetch(url)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    })
    .catch((error: unknown) => {
      appToast.error("Failed to download file", {
        description:
          error instanceof Error ? error.message : "Unknown download error",
      });
    });
  return true;
}
