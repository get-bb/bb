import type { CSSProperties } from "react";

const IMAGE_TRANSPARENCY_CHECKER_BASE =
  "color-mix(in oklch, var(--ink) 5%, var(--canvas))";
const IMAGE_TRANSPARENCY_CHECKER_MARK =
  "color-mix(in oklch, var(--ink) 14%, var(--canvas))";

export const IMAGE_TRANSPARENCY_CHECKER_STYLE: CSSProperties = {
  backgroundColor: IMAGE_TRANSPARENCY_CHECKER_BASE,
  backgroundImage: `conic-gradient(${IMAGE_TRANSPARENCY_CHECKER_MARK} 25%, ${IMAGE_TRANSPARENCY_CHECKER_BASE} 0 50%, ${IMAGE_TRANSPARENCY_CHECKER_MARK} 0 75%, ${IMAGE_TRANSPARENCY_CHECKER_BASE} 0)`,
  backgroundSize: "16px 16px",
};

interface WrappedImageIndexInput {
  currentIndex: number;
  direction: "next" | "previous";
  itemCount: number;
}

export function getWrappedImageIndex({
  currentIndex,
  direction,
  itemCount,
}: WrappedImageIndexInput): number {
  if (itemCount <= 0) {
    return currentIndex;
  }
  if (direction === "previous") {
    return currentIndex === 0 ? itemCount - 1 : currentIndex - 1;
  }
  return currentIndex === itemCount - 1 ? 0 : currentIndex + 1;
}
