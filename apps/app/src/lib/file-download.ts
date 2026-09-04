export type FileDownloadSource =
  | { kind: "contents"; contents: string }
  | { kind: "url"; url: string };

interface DownloadNamedFileArgs {
  fileName: string;
  source: FileDownloadSource;
}

export async function downloadNamedFile({
  fileName,
  source,
}: DownloadNamedFileArgs): Promise<void> {
  const blob =
    source.kind === "contents"
      ? new Blob([source.contents], { type: "application/octet-stream" })
      : await fetchFileDownloadBlob(source.url);
  const objectUrl = URL.createObjectURL(blob);
  try {
    triggerBrowserDownload(objectUrl, fileName);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function fetchFileDownloadBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`File download failed with ${response.status}`);
  }
  return response.blob();
}

function triggerBrowserDownload(objectUrl: string, fileName: string): void {
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
