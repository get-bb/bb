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

export function buildProjectFileContentUrl(
  projectId: string,
  path: string,
  routing: { environmentId?: string; hostId?: string } = {},
  disposition?: "attachment",
): string {
  return toRelativeUrl(
    apiClient.projects[":id"].files.content.$url({
      param: { id: projectId },
      query: { disposition, path, ...routing },
    }),
  );
}

export function buildThreadStorageContentUrl(
  threadId: string,
  path: string,
  disposition?: "attachment",
): string {
  return toRelativeUrl(
    apiClient.threads[":id"]["thread-storage"].content.$url({
      param: { id: threadId },
      query: { disposition, path },
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
  disposition?: "attachment",
): string {
  return toRelativeUrl(
    apiClient.threads[":id"]["host-files"].content.$url({
      param: { id: threadId },
      query: { disposition, path },
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

export function getFilePreviewLeaseBaseUrl(url: string): string | null {
  return (
    /^((?:https?:\/\/[^/?#]+)?\/api\/v1\/file-previews\/[^/?#]+)(?:\/|$)/u.exec(
      url,
    )?.[1] ?? null
  );
}

export function buildFilePreviewLeaseContentUrl(
  baseUrl: string,
  path: string,
): string {
  return `${baseUrl.replace(/\/+$/u, "")}/${encodePathSegments(path)}`;
}
