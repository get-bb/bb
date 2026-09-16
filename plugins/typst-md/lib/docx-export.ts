const EXPORT_ENDPOINT = "/api/v1/files/export";

export type TypstMdSourceKind = "workspace" | "thread-storage";

function encodePathSegments(file: string): string {
  return file.split("/").map(encodeURIComponent).join("/");
}

export function buildSourceBaseHref(input: {
  threadId: string;
  file: string;
  sourceKind: TypstMdSourceKind;
}): string {
  const route =
    input.sourceKind === "thread-storage"
      ? "thread-storage/files"
      : "worktree/files";
  const path = `/api/v1/threads/${encodeURIComponent(input.threadId)}/${route}/${encodePathSegments(input.file)}`;
  return new URL(path, window.location.href).toString();
}

export async function requestMarkdownDocx(input: {
  baseHref: string;
  content: string;
  fileName: string;
}): Promise<Blob> {
  const response = await fetch(EXPORT_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      baseHref: input.baseHref,
      content: input.content,
      filename: input.fileName,
      format: "docx",
      sourceKind: "markdown",
    }),
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(
      raw.replace(/\s+/g, " ").trim() || `Export failed (${response.status})`,
    );
  }
  return response.blob();
}
