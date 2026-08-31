import type { EnvironmentDiffFileQuery } from "@bb/server-contract";
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

export function buildProjectAttachmentPreviewUrl(
  projectId: string,
  path: string,
): string {
  return toRelativeUrl(
    apiClient.projects[":id"].attachments.preview.$url({
      param: { id: projectId },
      query: { path },
    }),
  );
}

export function buildProjectAttachmentDownloadUrl(
  projectId: string,
  path: string,
): string {
  return toRelativeUrl(
    apiClient.projects[":id"].attachments.download.$url({
      param: { id: projectId },
      query: { path },
    }),
  );
}

export function buildProjectFileContentUrl(
  projectId: string,
  path: string,
  routing: { environmentId?: string; hostId?: string } = {},
): string {
  return toRelativeUrl(
    apiClient.projects[":id"].files.content.$url({
      param: { id: projectId },
      query: { path, ...routing },
    }),
  );
}

export function buildProjectFilePreviewUrl(
  projectId: string,
  path: string,
  routing: { environmentId?: string; hostId?: string } = {},
): string {
  return toRelativeUrl(
    apiClient.projects[":id"].files.preview.$url({
      param: { id: projectId },
      query: { path, ...routing },
    }),
  );
}

export function buildProjectFileDownloadUrl(
  projectId: string,
  path: string,
  routing: { environmentId?: string; hostId?: string } = {},
): string {
  return toRelativeUrl(
    apiClient.projects[":id"].files.download.$url({
      param: { id: projectId },
      query: { path, ...routing },
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

export function buildThreadStoragePreviewUrl(
  threadId: string,
  path: string,
): string {
  return toRelativeUrl(
    apiClient.threads[":id"]["thread-storage"].preview.$url({
      param: { id: threadId },
      query: { path },
    }),
  );
}

export function buildThreadStorageDownloadUrl(
  threadId: string,
  path: string,
): string {
  return toRelativeUrl(
    apiClient.threads[":id"]["thread-storage"].download.$url({
      param: { id: threadId },
      query: { path },
    }),
  );
}

export function buildThreadStorageRawContentUrl(
  threadId: string,
  path: string,
): string {
  return toRelativeUrl(
    apiClient.threads[":id"]["thread-storage"].files[":filePath{.+}"].$url({
      param: { id: threadId, filePath: encodePathSegments(path) },
    }),
  );
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

export function buildThreadHostFilePreviewUrl(
  threadId: string,
  path: string,
): string {
  return toRelativeUrl(
    apiClient.threads[":id"]["host-files"].preview.$url({
      param: { id: threadId },
      query: { path },
    }),
  );
}

export function buildThreadHostFileDownloadUrl(
  threadId: string,
  path: string,
): string {
  return toRelativeUrl(
    apiClient.threads[":id"]["host-files"].download.$url({
      param: { id: threadId },
      query: { path },
    }),
  );
}

export function buildRawFilesystemHtmlContentUrl(
  threadId: string,
  path: string,
): string {
  return toRelativeUrl(
    apiClient.threads[":id"].files.raw.$url({
      param: { id: threadId },
      query: { path },
    }),
  );
}

export function buildThreadWorktreeRawContentUrl(
  threadId: string,
  path: string,
): string {
  return toRelativeUrl(
    apiClient.threads[":id"].worktree.files[":filePath{.+}"].$url({
      param: { id: threadId, filePath: encodePathSegments(path) },
    }),
  );
}

export function buildThreadWorktreeDownloadUrl(
  threadId: string,
  path: string,
): string {
  return toRelativeUrl(
    apiClient.threads[":id"].worktree.download[":filePath{.+}"].$url({
      param: { id: threadId, filePath: encodePathSegments(path) },
    }),
  );
}

export function buildHostFilePreviewUrl(
  hostId: string,
  path: string,
  rootPath?: string,
): string {
  return toRelativeUrl(
    apiClient.files.preview.$url({
      query: { hostId, path, ...(rootPath === undefined ? {} : { rootPath }) },
    }),
  );
}

export function buildHostFileDownloadUrl(
  hostId: string,
  path: string,
  rootPath?: string,
): string {
  return toRelativeUrl(
    apiClient.files.download.$url({
      query: { hostId, path, ...(rootPath === undefined ? {} : { rootPath }) },
    }),
  );
}

export function buildEnvironmentFilePreviewUrl(
  environmentId: string,
  path: string,
): string {
  return toRelativeUrl(
    apiClient.environments[":id"].files.preview.$url({
      param: { id: environmentId },
      query: { path },
    }),
  );
}

export function buildEnvironmentFileDownloadUrl(
  environmentId: string,
  path: string,
): string {
  return toRelativeUrl(
    apiClient.environments[":id"].files.download.$url({
      param: { id: environmentId },
      query: { path },
    }),
  );
}

export function buildEnvironmentDiffFileContentUrl(
  environmentId: string,
  query: EnvironmentDiffFileQuery,
): string {
  return toRelativeUrl(
    apiClient.environments[":id"].diff.file.$url({
      param: { id: environmentId },
      query,
    }),
  );
}
