type ImageSize = { width: number; height: number };

const IMAGE_SIZES = {
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
} satisfies Record<string, ImageSize>;

export function getImageSize(src: string): ImageSize | undefined {
  return Object.entries(IMAGE_SIZES).find(
    ([imagePath]) => imagePath === src,
  )?.[1];
}
