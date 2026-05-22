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

export function buildThreadStatusContentUrl(
  threadId: string,
  hash?: string,
): string {
  const baseUrl = `/api/v1/threads/${encodeURIComponent(threadId)}/status/`;
  return hash === undefined
    ? baseUrl
    : `${baseUrl}?v=${encodeURIComponent(hash)}`;
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

export function buildThreadWorktreeRawContentUrl(
  threadId: string,
  path: string,
): string {
  return `/api/v1/threads/${encodeURIComponent(threadId)}/worktree/files/${encodePathSegments(path)}`;
}
