const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".csv": "text/csv",
  ".gif": "image/gif",
  ".htm": "text/html",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
};

function fileExtension(fileName: string): string | null {
  return fileName.toLowerCase().match(/\.[^.]+$/u)?.[0] ?? null;
}

export function inferAttachmentMimeFromFileName(
  fileName: string,
): string | null {
  const extension = fileExtension(fileName);
  return extension === null ? null : (MIME_BY_EXTENSION[extension] ?? null);
}

export function canonicalAttachmentMime(
  storedMime: string,
  fileName: string,
): string {
  const normalized = storedMime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (normalized !== "application/octet-stream") return normalized;
  return inferAttachmentMimeFromFileName(fileName) ?? normalized;
}
