/**
 * Pure state behind the image lightbox: which image is open, wrapping
 * navigation (web `getWrappedImageIndex`), and the zoom clamp the gestures
 * settle to.
 */

export interface LightboxImage {
  /** Loadable URL. */
  src: string;
  alt: string;
}

export interface LightboxState {
  images: readonly LightboxImage[];
  index: number;
}

export const LIGHTBOX_MIN_SCALE = 1;
export const LIGHTBOX_MAX_SCALE = 5;
/** Double-tap zooms to this scale (and back to 1). */
export const LIGHTBOX_DOUBLE_TAP_SCALE = 2.5;

export function getWrappedImageIndex({
  currentIndex,
  direction,
  itemCount,
}: {
  currentIndex: number;
  direction: "previous" | "next";
  itemCount: number;
}): number {
  if (itemCount <= 0) return 0;
  const delta = direction === "next" ? 1 : -1;
  return (((currentIndex + delta) % itemCount) + itemCount) % itemCount;
}

/** Opens at `index` when it addresses an image; null for an empty set. */
export function openLightbox(
  images: readonly LightboxImage[],
  index: number,
): LightboxState | null {
  if (images.length === 0) return null;
  const clamped = Math.min(Math.max(Math.trunc(index), 0), images.length - 1);
  return { images, index: clamped };
}

export function stepLightbox(
  state: LightboxState,
  direction: "previous" | "next",
): LightboxState {
  if (state.images.length <= 1) return state;
  return {
    images: state.images,
    index: getWrappedImageIndex({
      currentIndex: state.index,
      direction,
      itemCount: state.images.length,
    }),
  };
}

export function clampLightboxScale(scale: number): number {
  "worklet";
  if (!Number.isFinite(scale)) return LIGHTBOX_MIN_SCALE;
  return Math.min(Math.max(scale, LIGHTBOX_MIN_SCALE), LIGHTBOX_MAX_SCALE);
}

/**
 * Keeps a zoomed image covering the viewport: the translation may not expose
 * empty space on any side (at scale 1 the image is centered, no pan).
 */
export function clampLightboxTranslation({
  translation,
  scale,
  contentSize,
  viewportSize,
}: {
  translation: { x: number; y: number };
  scale: number;
  contentSize: { width: number; height: number };
  viewportSize: { width: number; height: number };
}): { x: number; y: number } {
  "worklet";
  const scaledWidth = contentSize.width * scale;
  const scaledHeight = contentSize.height * scale;
  const maxX = Math.max(0, (scaledWidth - viewportSize.width) / 2);
  const maxY = Math.max(0, (scaledHeight - viewportSize.height) / 2);
  // `+ 0` folds a clamped -0 into 0 so callers can compare exactly.
  return {
    x: Math.min(Math.max(translation.x, -maxX), maxX) + 0,
    y: Math.min(Math.max(translation.y, -maxY), maxY) + 0,
  };
}
