/**
 * Absolute URLs for the server's binary content routes, built against the
 * active profile's server URL (mirrors apps/app/src/lib/file-content-urls.ts,
 * which builds relative URLs through the Hono client). Auth is the native
 * cookie jar, shared with expo-image, so the URL alone is enough to load.
 */

function apiBase(serverUrl: string): string {
  return `${serverUrl.replace(/\/+$/u, "")}/api/v1`;
}

/** `GET /projects/:id/attachments/content?path=` — uploaded prompt attachments. */
export function buildProjectAttachmentContentUrl(
  serverUrl: string,
  projectId: string,
  path: string,
): string {
  return `${apiBase(serverUrl)}/projects/${encodeURIComponent(projectId)}/attachments/content?path=${encodeURIComponent(path)}`;
}

/** `GET /threads/:id/host-files/content?path=` — a file on the thread's host. */
export function buildThreadHostFileContentUrl(
  serverUrl: string,
  threadId: string,
  path: string,
): string {
  return `${apiBase(serverUrl)}/threads/${encodeURIComponent(threadId)}/host-files/content?path=${encodeURIComponent(path)}`;
}

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/u;
const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u;

function isAbsoluteLocalPath(path: string): boolean {
  return path.startsWith("/") || WINDOWS_ABSOLUTE_PATH_PATTERN.test(path);
}

/** Relative, scheme-less, non-UNC: an attachment stored under the project. */
function isProjectAttachmentPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("\\") &&
    !isAbsoluteLocalPath(path) &&
    !URL_SCHEME_PATTERN.test(path)
  );
}

/**
 * Image source for a user-attached image (web `toUserAttachmentImageSrc`):
 * web URLs pass through, project-relative attachment paths go to the
 * attachment content route, and absolute host paths — which the phone cannot
 * read itself (no local daemon) — load through the thread's host-files route.
 */
export function resolveUserAttachmentImageUrl(
  pathOrUrl: string,
  context: { projectId: string | null; threadId: string; serverUrl: string },
): string | null {
  if (/^(https?:|data:)/iu.test(pathOrUrl)) return pathOrUrl;
  if (context.projectId !== null && isProjectAttachmentPath(pathOrUrl)) {
    return buildProjectAttachmentContentUrl(
      context.serverUrl,
      context.projectId,
      pathOrUrl,
    );
  }
  const path = pathOrUrl.replace(/^file:\/\//iu, "");
  if (isAbsoluteLocalPath(path)) {
    return buildThreadHostFileContentUrl(
      context.serverUrl,
      context.threadId,
      path,
    );
  }
  return null;
}

/**
 * Image source for an image referenced from assistant markdown: web URLs
 * pass through, absolute host paths load through the thread's host-files
 * route, and relative paths resolve against the workspace root when known.
 */
export function resolveAssistantImageUrl(
  src: string,
  threadId: string,
  workspaceRootPath: string | undefined,
  serverUrl: string,
): string | null {
  if (/^(https?:|data:)/iu.test(src)) return src;
  if (URL_SCHEME_PATTERN.test(src) && !/^file:/iu.test(src)) return null;
  const path = src.replace(/^file:\/\//iu, "");
  if (isAbsoluteLocalPath(path)) {
    return buildThreadHostFileContentUrl(serverUrl, threadId, path);
  }
  if (workspaceRootPath === undefined || path.startsWith("\\")) return null;
  const joined = `${workspaceRootPath.replace(/\/+$/u, "")}/${path.replace(/^\.\//u, "")}`;
  return buildThreadHostFileContentUrl(serverUrl, threadId, joined);
}
