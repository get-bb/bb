/**
 * Intrinsic pixel sizes for blog images in `public/blog`.
 *
 * The browser needs the width and height to reserve space for a lazy image.
 * Markdown carries no size, so record the sizes here. Update this map when you
 * add or replace an image.
 */
type ImageSize = { width: number; height: number };

const IMAGE_SIZES: Record<string, ImageSize> = {
  "/blog/an-agentic-ide-that-builds-itself/header.png": {
    width: 680,
    height: 272,
  },
  "/blog/an-agentic-ide-that-builds-itself/first-open.jpg": {
    width: 1360,
    height: 919,
  },
  "/blog/an-agentic-ide-that-builds-itself/custom.jpg": {
    width: 1660,
    height: 1127,
  },
  "/blog/an-agentic-ide-that-builds-itself/daw.jpg": {
    width: 1200,
    height: 900,
  },
};

export function getImageSize(src: string): ImageSize | undefined {
  return IMAGE_SIZES[src];
}
