import type { EnvironmentDiffFileQuery } from "@bb/server-contract";
import { buildThreadHostFileContentUrl } from "../thread-detail/file-content-urls";

/**
 * Absolute URLs for the server's file content routes (mirrors
 * apps/app/src/lib/file-content-urls.ts, which builds relative URLs through
 * the Hono client). Auth is the native cookie jar shared by fetch, expo-image
 * and the WebView, so a URL alone is enough to load.
 */

export { buildThreadHostFileContentUrl };

function apiBase(serverUrl: string): string {
  return `${serverUrl.replace(/\/+$/u, "")}/api/v1`;
}

/**
 * Percent-encode each segment of a path-suffix route param
 * (`:filePath{.+}` matches across slashes; everything else needs encoding).
 */
function encodePathSegments(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

export interface ProjectFileRouting {
  environmentId?: string | null;
  hostId?: string | null;
}

/** `GET /projects/:id/files/content?path=[&environmentId|hostId]` (raw bytes). */
export function buildProjectFileContentUrl(
  serverUrl: string,
  projectId: string,
  path: string,
  routing: ProjectFileRouting = {},
): string {
  const params = new URLSearchParams({ path });
  if (routing.environmentId) {
    params.set("environmentId", routing.environmentId);
  } else if (routing.hostId) {
    params.set("hostId", routing.hostId);
  }
  return `${apiBase(serverUrl)}/projects/${encodeURIComponent(projectId)}/files/content?${params.toString()}`;
}

/** `GET /threads/:id/thread-storage/content?path=` (raw bytes, storage-relative path). */
export function buildThreadStorageContentUrl(
  serverUrl: string,
  threadId: string,
  path: string,
): string {
  return `${apiBase(serverUrl)}/threads/${encodeURIComponent(threadId)}/thread-storage/content?path=${encodeURIComponent(path)}`;
}

/**
 * `GET /threads/:id/thread-storage/files/<path>` — path-shaped so an HTML
 * preview's relative links resolve beside the file; served with the
 * `sandbox allow-scripts` CSP.
 */
export function buildThreadStorageRawContentUrl(
  serverUrl: string,
  threadId: string,
  path: string,
): string {
  return `${apiBase(serverUrl)}/threads/${encodeURIComponent(threadId)}/thread-storage/files/${encodePathSegments(path)}`;
}

/** `GET /threads/:id/worktree/files/<path>` — the workspace working tree, path-shaped. */
export function buildThreadWorktreeRawContentUrl(
  serverUrl: string,
  threadId: string,
  path: string,
): string {
  return `${apiBase(serverUrl)}/threads/${encodeURIComponent(threadId)}/worktree/files/${encodePathSegments(path)}`;
}

/** `GET /threads/:id/files/raw?path=` — an absolute HTML file on the thread's host. */
export function buildRawFilesystemHtmlContentUrl(
  serverUrl: string,
  threadId: string,
  path: string,
): string {
  return `${apiBase(serverUrl)}/threads/${encodeURIComponent(threadId)}/files/raw?path=${encodeURIComponent(path)}`;
}

/**
 * The `/environments/:id/diff/file` JSON route a workspace file preview was
 * read from: the text preview's `url` identity, not a raw byte stream.
 */
export function buildEnvironmentDiffFileContentUrl(
  serverUrl: string,
  environmentId: string,
  query: EnvironmentDiffFileQuery,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") params.set(key, value);
  }
  return `${apiBase(serverUrl)}/environments/${encodeURIComponent(environmentId)}/diff/file?${params.toString()}`;
}
