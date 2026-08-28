import type { OpenSecondaryPanelTabRequest } from "@/components/secondary-panel/useThreadFileTabs";
import {
  buildProjectFileContentUrl,
  buildThreadHostFileContentUrl,
  buildThreadStorageContentUrl,
} from "./file-content-urls";

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

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = path.split(/[\\/]/u).at(-1) ?? "download";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  return true;
}
