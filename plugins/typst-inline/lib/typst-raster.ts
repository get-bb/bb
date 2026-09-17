import { splitTypstPages, type TypstPage } from "./typst-pages.js";

const PNG_SCALE = 2;
const BACKGROUND_COLOR = "#ffffff";
const IMAGE_LOAD_TIMEOUT_MS = 30_000;
const ENCODE_TIMEOUT_MS = 30_000;

const TEXT_SEMANTICS_TAGS: readonly string[] = ["foreignObject"];

export async function rasterizeTypstPages(svg: string): Promise<Blob[]> {
  return await rasterizeTypstPageList(splitTypstPages(svg), PNG_SCALE);
}

export async function rasterizeTypstPageList(
  pages: readonly TypstPage[],
  scale: number,
): Promise<Blob[]> {
  const blobs: Blob[] = [];
  for (const page of pages) {
    blobs.push(await rasterizePage(page, scale));
  }
  return blobs;
}

function withoutTextSemantics(page: TypstPage): string {
  const parsed = new DOMParser().parseFromString(page.svg, "image/svg+xml");
  const root = parsed.documentElement;
  if (root === null) return page.svg;
  for (const node of [...root.querySelectorAll("*")]) {
    if (TEXT_SEMANTICS_TAGS.includes(node.localName)) node.remove();
  }
  return new XMLSerializer().serializeToString(root);
}

async function rasterizePage(page: TypstPage, scale: number): Promise<Blob> {
  const width = Math.max(1, Math.ceil(page.widthPt * scale));
  const height = Math.max(1, Math.ceil(page.heightPt * scale));
  const url = URL.createObjectURL(
    new Blob([withoutTextSemantics(page)], {
      type: "image/svg+xml;charset=utf-8",
    }),
  );
  try {
    const image = await withTimeout(
      loadImage(url),
      IMAGE_LOAD_TIMEOUT_MS,
      "Timed out while drawing the Typst page.",
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("The browser did not provide a 2D canvas context.");
    }
    context.fillStyle = BACKGROUND_COLOR;
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return await withTimeout(
      encodePng(canvas),
      ENCODE_TIMEOUT_MS,
      "Timed out while encoding the Typst page.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new Error("The browser could not draw the Typst page."));
    };
    image.src = url;
  });
}

function encodePng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("The browser could not encode the Typst page as PNG."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
