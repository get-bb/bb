type ImageSize = { width: number; height: number };

const IMAGE_SIZES: Record<string, ImageSize> = {
  "/blog/building-a-restrained-software-factory/cover.jpg": {
    width: 1983,
    height: 793,
  },
  "/blog/building-a-restrained-software-factory/sub-thread.png": {
    width: 387,
    height: 120,
  },
  "/blog/building-a-restrained-software-factory/marketplace-manager.jpg": {
    width: 1200,
    height: 356,
  },
  "/blog/building-a-restrained-software-factory/workflow.jpg": {
    width: 1200,
    height: 691,
  },
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
