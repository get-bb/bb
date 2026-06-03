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

export interface AppEntryUrlArgs {
  applicationId: string;
  /**
   * Thread the app should target for its `message` capability. `null` for the
   * standalone surface, where the app renders thread-independently and has no
   * thread to post into.
   */
  targetThreadId: string | null;
  /**
   * Cache-busting token (typically the app detail's `dataUpdatedAt`) so the
   * iframe reloads when the underlying app changes. Omitted when no reload
   * tracking is needed.
   */
  reloadToken?: number | string;
}

export function buildAppEntryUrl({
  applicationId,
  targetThreadId,
  reloadToken,
}: AppEntryUrlArgs): string {
  const params = new URLSearchParams();
  if (targetThreadId !== null) {
    params.set("targetThreadId", targetThreadId);
  }
  if (reloadToken !== undefined) {
    params.set("v", String(reloadToken));
  }
  const query = params.toString();
  return `/api/v1/apps/${encodeURIComponent(applicationId)}/${
    query ? `?${query}` : ""
  }`;
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
