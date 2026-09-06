import type { BrowserElementAnnotation } from "./element-capture";

const MAX_CROP_EDGE_PX = 640;
const CROP_JPEG_QUALITY = 0.82;

async function loadScreenshotImage(dataUrl: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = dataUrl;
  try {
    await image.decode();
  } catch {
    return image;
  }
  return image;
}

export async function cropBrowserElementScreenshot(args: {
  annotation: BrowserElementAnnotation;
  dataUrl: string;
}): Promise<string | null> {
  if (typeof Image === "undefined") return null;
  const image = await loadScreenshotImage(args.dataUrl);
  if (image.naturalWidth === 0 || image.naturalHeight === 0) return null;
  const scaleX = image.naturalWidth / args.annotation.viewport.width;
  const scaleY = image.naturalHeight / args.annotation.viewport.height;
  const sourceX = Math.max(0, Math.floor(args.annotation.rect.x * scaleX));
  const sourceY = Math.max(0, Math.floor(args.annotation.rect.y * scaleY));
  const sourceWidth = Math.min(
    image.naturalWidth - sourceX,
    Math.max(1, Math.ceil(args.annotation.rect.width * scaleX)),
  );
  const sourceHeight = Math.min(
    image.naturalHeight - sourceY,
    Math.max(1, Math.ceil(args.annotation.rect.height * scaleY)),
  );
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;
  const scale = Math.min(
    1,
    MAX_CROP_EDGE_PX / Math.max(sourceWidth, sourceHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL("image/jpeg", CROP_JPEG_QUALITY);
}
