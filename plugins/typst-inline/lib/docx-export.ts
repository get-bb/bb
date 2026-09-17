import type { TypstPage } from "./typst-pages.js";

const EXPORT_ENDPOINT = "/api/v1/files/export";

const MAX_EXPORT_CONTENT_BYTES = 5 * 1024 * 1024;

const EXPORT_CONTENT_BUDGET_BYTES = Math.floor(MAX_EXPORT_CONTENT_BYTES * 0.9);

const PT_TO_CSS_PX = 96 / 72;

const DOCX_CONTENT_WIDTH_PT = 451;

const DOCX_CONTENT_HEIGHT_PT = 698;

export const DOCX_RASTER_SCALES: readonly number[] = [2, 1.5, 1];

export interface TypstDocxPageImages {
  images: readonly string[];
  pages: readonly TypstPage[];
}

export interface TypstDocxRequest {
  fileName: string;
  html: string;
}

export interface BuildTypstDocxInput {
  fileName: string;
  pages: readonly TypstPage[];
  rasterize: (
    pages: readonly TypstPage[],
    scale: number,
  ) => Promise<readonly Blob[]>;
}

function fitPageSize(page: TypstPage): { heightPx: number; widthPx: number } {
  const ratio = Math.min(
    DOCX_CONTENT_WIDTH_PT / page.widthPt,
    DOCX_CONTENT_HEIGHT_PT / page.heightPt,
    1,
  );
  return {
    heightPx: Math.max(1, Math.round(page.heightPt * ratio * PT_TO_CSS_PX)),
    widthPx: Math.max(1, Math.round(page.widthPt * ratio * PT_TO_CSS_PX)),
  };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("The Word export could not read a page image."));
    };
    reader.onerror = () => {
      reject(new Error("The Word export could not read a page image."));
    };
    reader.readAsDataURL(blob);
  });
}

export function buildTypstDocxHtml(input: TypstDocxPageImages): string {
  return input.pages
    .map((page, index) => {
      const image = input.images[index] ?? "";
      const { heightPx, widthPx } = fitPageSize(page);
      return `<p style="text-align: center"><img src="${image}" style="width: ${widthPx}px; height: ${heightPx}px"></p>`;
    })
    .join("");
}

export async function requestTypstDocx(input: TypstDocxRequest): Promise<Blob> {
  const response = await fetch(EXPORT_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      baseHref: null,
      content: input.html,
      filename: input.fileName,
      format: "docx",
      sourceKind: "html",
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

export async function buildTypstDocx(
  input: BuildTypstDocxInput,
): Promise<Blob> {
  for (const scale of DOCX_RASTER_SCALES) {
    const blobs = await input.rasterize(input.pages, scale);
    const images = await Promise.all(blobs.map(blobToDataUrl));
    const html = buildTypstDocxHtml({ images, pages: input.pages });
    if (html.length > EXPORT_CONTENT_BUDGET_BYTES) continue;
    return await requestTypstDocx({ fileName: input.fileName, html });
  }
  throw new Error(
    "The document is too large to save as Word. Save PDF or print it instead.",
  );
}
