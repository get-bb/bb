import type { PluginFileOpenerSource } from "@get-bb/plugin-sdk/app";

const PDF_MIME_TYPE = "application/pdf";

function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function resolvePdfUrl(
  path: string,
  source: PluginFileOpenerSource,
): string | null {
  const filePath = encodePathSegments(path.replace(/^\/+/u, ""));
  switch (source.kind) {
    case "workspace":
      if (source.environmentId !== null) {
        return `/api/v1/environments/${encodeURIComponent(source.environmentId)}/files/${filePath}`;
      }
      if (source.projectId !== null) {
        const projectPath = `/api/v1/projects/${encodeURIComponent(source.projectId)}`;
        return source.experimental_hostId
          ? `${projectPath}/hosts/${encodeURIComponent(source.experimental_hostId)}/files/${filePath}`
          : `${projectPath}/files/${filePath}`;
      }
      return null;
    case "host":
      return source.threadId === null
        ? null
        : `/api/v1/threads/${encodeURIComponent(source.threadId)}/host-files/${filePath}`;
    case "thread-storage":
      return source.threadId === null
        ? null
        : `/api/v1/threads/${encodeURIComponent(source.threadId)}/thread-storage/files/${filePath}`;
  }
}

function normalizeMimeType(value: string): string {
  return value.split(";", 1)[0]!.trim().toLowerCase();
}

function requirePdfMimeType(value: string | null): void {
  if (value === null || normalizeMimeType(value) !== PDF_MIME_TYPE) {
    throw new Error("The file response was not a PDF.");
  }
}

export async function loadPdfBlob(
  url: string,
  signal: AbortSignal,
): Promise<Blob> {
  const response = await fetch(url, { credentials: "same-origin", signal });
  if (!response.ok) {
    throw new Error(`PDF request failed with status ${response.status}.`);
  }
  requirePdfMimeType(response.headers.get("content-type"));
  return response.blob();
}
