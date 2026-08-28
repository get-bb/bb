import {
  buildProjectAttachmentContentUrl,
  buildThreadHostFileContentUrl,
} from "./file-content-urls";

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/u;
const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u;

export function isAbsoluteLocalAttachmentPath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("\\\\") ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(path)
  );
}

export function isProjectAttachmentPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("\\") &&
    !isAbsoluteLocalAttachmentPath(path) &&
    !URL_SCHEME_PATTERN.test(path)
  );
}

export function toUserAttachmentImageSrc(
  pathOrUrl: string,
  projectId?: string,
  threadId?: string,
): string {
  const hostPath = hostPathFromImageReference(pathOrUrl);
  if (hostPath && threadId) {
    return buildThreadHostFileContentUrl(threadId, hostPath);
  }

  const normalized = pathOrUrl.replaceAll("\\", "/");
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }
  if (normalized.startsWith("/")) {
    return `file://${encodeURI(normalized)}`;
  }
  if (URL_SCHEME_PATTERN.test(pathOrUrl)) {
    return pathOrUrl;
  }
  if (projectId && isProjectAttachmentPath(pathOrUrl)) {
    return buildProjectAttachmentContentUrl(projectId, pathOrUrl);
  }
  return pathOrUrl;
}

function hostPathFromImageReference(pathOrUrl: string): string | null {
  if (isAbsoluteLocalAttachmentPath(pathOrUrl)) {
    return pathOrUrl;
  }
  if (!pathOrUrl.toLowerCase().startsWith("file:")) {
    return null;
  }

  try {
    const url = new URL(pathOrUrl);
    if (url.protocol !== "file:") {
      return null;
    }
    const pathname = decodeURIComponent(url.pathname);
    if (/^\/[a-zA-Z]:\//u.test(pathname)) {
      return pathname.slice(1);
    }
    return url.hostname ? `//${url.hostname}${pathname}` : pathname;
  } catch {
    return null;
  }
}
