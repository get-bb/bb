import type { TypstPage } from "./typst-pages.js";

const PRINT_IFRAME_SANDBOX = "allow-scripts allow-modals";
const PRINT_IFRAME_REMOVE_DELAY_MS = 60_000;
const PRINT_SETTLE_DELAY_MS = 50;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

export function typstDocumentBaseName(file: string): string {
  const name = file.split("/").pop() ?? file;
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

export function buildTypstPrintHtml(
  pages: readonly TypstPage[],
  title: string,
): string {
  const first = pages[0];
  if (first === undefined) {
    throw new Error("The Typst document has no pages to print.");
  }
  const sheets = pages
    .map((page) => `  <section class="typst-page">${page.svg}</section>`)
    .join("\n");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    "<style>",
    `  @page { size: ${first.widthPt}pt ${first.heightPt}pt; margin: 0; }`,
    "  html, body { margin: 0; padding: 0; background: #ffffff; }",
    "  .typst-page {",
    `    width: ${first.widthPt}pt;`,
    `    height: ${first.heightPt}pt;`,
    "    overflow: hidden;",
    "    break-after: page;",
    "    page-break-after: always;",
    "  }",
    "  .typst-page:last-child { break-after: auto; page-break-after: auto; }",
    "  .typst-page svg { display: block; width: 100%; height: 100%; }",
    "</style>",
    "</head>",
    "<body>",
    sheets,
    "  <script>",
    `    window.addEventListener("load", () => {`,
    `      window.setTimeout(() => window.print(), ${PRINT_SETTLE_DELAY_MS});`,
    "    });",
    "  </script>",
    "</body>",
    "</html>",
  ].join("\n");
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
