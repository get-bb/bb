import { buildProjectAttachmentPreviewUrl } from "./file-content-urls";

export function toUserAttachmentImageSrc(
  pathOrUrl: string,
  projectId?: string,
): string {
  if (/^(https?:|data:|blob:)/i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  if (/^file:/i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const normalized = pathOrUrl.replaceAll("\\", "/");
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }
  if (normalized.startsWith("/")) {
    return `file://${encodeURI(normalized)}`;
  }
  if (projectId) {
    return buildProjectAttachmentPreviewUrl(projectId, pathOrUrl);
  }
  return pathOrUrl;
}
