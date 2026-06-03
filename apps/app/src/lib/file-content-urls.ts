import { apiClient, toRelativeUrl } from "./api-server";

function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function buildProjectAttachmentContentUrl(
  projectId: string,
  path: string,
): string {
  return toRelativeUrl(
    apiClient.projects[":id"].attachments.content.$url({
      param: { id: projectId },
      query: { path },
    }),
  );
}

export function buildThreadStorageContentUrl(
  threadId: string,
  path: string,
): string {
  return toRelativeUrl(
    apiClient.threads[":id"]["thread-storage"].content.$url({
      param: { id: threadId },
      query: { path },
    }),
  );
}

export function buildThreadStorageRawContentUrl(
  threadId: string,
  path: string,
): string {
  return `/api/v1/threads/${encodeURIComponent(threadId)}/thread-storage/files/${encodePathSegments(path)}`;
}

export function buildAppEntryUrl(
  applicationId: string,
  targetThreadId: string,
): string {
  return `/api/v1/apps/${encodeURIComponent(
    applicationId,
  )}/?targetThreadId=${encodeURIComponent(targetThreadId)}`;
}

export function buildAppAssetUrl(
  applicationId: string,
  path: string,
): string {
  return `/api/v1/apps/${encodeURIComponent(
    applicationId,
  )}/assets/${encodePathSegments(path)}`;
}

export function buildAppAssetBaseUrl(
  applicationId: string,
  entryPath: string,
): string {
  const lastSlash = entryPath.lastIndexOf("/");
  const basePath = lastSlash === -1 ? "" : entryPath.slice(0, lastSlash + 1);
  return buildAppAssetUrl(applicationId, basePath);
}

export function buildThreadHostFileContentUrl(
  threadId: string,
  path: string,
): string {
  return toRelativeUrl(
    apiClient.threads[":id"]["host-files"].content.$url({
      param: { id: threadId },
      query: { path },
    }),
  );
}

export function buildRawFilesystemHtmlContentUrl(
  threadId: string,
  path: string,
): string {
  return `/api/v1/threads/${encodeURIComponent(threadId)}/files/raw?path=${encodeURIComponent(path)}`;
}

export function buildThreadWorktreeRawContentUrl(
  threadId: string,
  path: string,
): string {
  return `/api/v1/threads/${encodeURIComponent(threadId)}/worktree/files/${encodePathSegments(path)}`;
}
