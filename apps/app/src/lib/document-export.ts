import { apiClient, toRelativeUrl } from "./api-server";
import { appSurfaceRequestInit } from "./app-surface";

export type DocumentExportSourceKind = "html" | "markdown";
export type DocumentExportFormat = "docx" | "print" | "capture";

export interface DocumentExportInput {
  content: string;
  sourceKind: DocumentExportSourceKind;
  format: DocumentExportFormat;
  baseHref?: string | null;
  filename?: string;
}

export interface WordExportInput {
  content: string;
  sourceKind: DocumentExportSourceKind;
  baseHref?: string | null;
  filename?: string;
}

const PRINT_IFRAME_SANDBOX = "allow-scripts allow-modals";
const CAPTURE_IFRAME_SANDBOX = "allow-scripts";
const PRINT_IFRAME_REMOVE_DELAY_MS = 60_000;
const CAPTURE_TIMEOUT_MS = 15_000;
const POST_MESSAGE_CHANNEL = "bb-document-export";
const RENDERED_CONTENT_PATTERN = /<(?:canvas|svg|script)\b/i;

export function shouldCaptureRenderedHtml(
  sourceKind: DocumentExportSourceKind,
  content: string,
): boolean {
  return sourceKind === "html" && RENDERED_CONTENT_PATTERN.test(content);
}

async function readErrorMessage(response: Response): Promise<string> {
  const raw = await response.text().catch(() => "");
  if (raw.length === 0) {
    return `Export failed (${response.status})`;
  }
  try {
    const parsed = JSON.parse(raw) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.length > 0) {
      return parsed.message;
    }
  } catch {}
  return raw.replace(/\s+/g, " ").trim().slice(0, 300);
}

export async function requestDocumentExport(
  input: DocumentExportInput,
): Promise<Blob> {
  const response = await fetch(
    toRelativeUrl(apiClient.files.export.$url()),
    appSurfaceRequestInit({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: input.content,
        sourceKind: input.sourceKind,
        format: input.format,
        baseHref: input.baseHref ?? null,
        ...(input.filename === undefined ? {} : { filename: input.filename }),
      }),
    }),
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.blob();
}

export function resolveExportBaseHref(
  url: string | null | undefined,
): string | null {
  if (url === null || url === undefined || url.length === 0) {
    return null;
  }
  if (
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.includes("?")
  ) {
    return null;
  }
  try {
    return new URL(url, window.location.href).toString();
  } catch {
    return null;
  }
}

export function fileBaseName(fileName: string): string {
  const name = fileName.split(/[\\/]/).pop() ?? fileName;
  const extensionIndex = name.lastIndexOf(".");
  return extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadTextFile(
  contents: string,
  mimeType: string,
  fileName: string,
): void {
  downloadBlob(new Blob([contents], { type: mimeType }), fileName);
}

export function printHtmlDocument(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", PRINT_IFRAME_SANDBOX);
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("tabindex", "-1");
  iframe.style.position = "fixed";
  iframe.style.top = "0";
  iframe.style.left = "0";
  iframe.style.width = "1024px";
  iframe.style.height = "768px";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  iframe.style.border = "0";
  iframe.srcdoc = html;
  document.body.append(iframe);
  window.setTimeout(() => iframe.remove(), PRINT_IFRAME_REMOVE_DELAY_MS);
}

export function runCaptureFrame(html: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", CAPTURE_IFRAME_SANDBOX);
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("tabindex", "-1");
    iframe.style.position = "fixed";
    iframe.style.top = "0";
    iframe.style.left = "0";
    iframe.style.width = "1024px";
    iframe.style.height = "768px";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    iframe.style.border = "0";

    let settled = false;
    const cleanup = (): void => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      iframe.remove();
    };
    const finish = (result: { html: string } | { error: string }): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if ("html" in result) {
        resolve(result.html);
        return;
      }
      reject(new Error(result.error));
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== iframe.contentWindow) return;
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null) return;
      const message = data as {
        channel?: unknown;
        ok?: unknown;
        html?: unknown;
        error?: unknown;
      };
      if (message.channel !== POST_MESSAGE_CHANNEL) return;
      if (message.ok === true && typeof message.html === "string") {
        finish({ html: message.html });
        return;
      }
      finish({
        error:
          typeof message.error === "string"
            ? message.error
            : "Rendered capture failed",
      });
    };
    const timeout = window.setTimeout(() => {
      finish({ error: "Rendered capture timed out" });
    }, CAPTURE_TIMEOUT_MS);

    window.addEventListener("message", onMessage);
    iframe.srcdoc = html;
    document.body.append(iframe);
  });
}

export async function captureDocumentHtml(
  input: WordExportInput,
): Promise<string> {
  const captureBlob = await requestDocumentExport({
    baseHref: input.baseHref,
    content: input.content,
    filename: input.filename,
    format: "capture",
    sourceKind: input.sourceKind,
  });
  return runCaptureFrame(await captureBlob.text());
}

export async function buildWordExport(input: WordExportInput): Promise<Blob> {
  if (shouldCaptureRenderedHtml(input.sourceKind, input.content)) {
    try {
      const captured = await captureDocumentHtml(input);
      return await requestDocumentExport({
        baseHref: input.baseHref,
        content: captured,
        filename: input.filename,
        format: "docx",
        sourceKind: "html",
      });
    } catch {
      // Fall back to the static document when rendering cannot be captured.
    }
  }
  return requestDocumentExport({
    baseHref: input.baseHref,
    content: input.content,
    filename: input.filename,
    format: "docx",
    sourceKind: input.sourceKind,
  });
}
