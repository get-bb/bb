import { describe, expect, it } from "vitest";
import {
  clampLightboxScale,
  clampLightboxTranslation,
  getWrappedImageIndex,
  LIGHTBOX_MAX_SCALE,
  openLightbox,
  stepLightbox,
} from "./lightbox-model";

const images = [
  { src: "a", alt: "A" },
  { src: "b", alt: "B" },
  { src: "c", alt: "C" },
];

describe("lightbox navigation", () => {
  it("wraps at both ends and clamps the opening index", () => {
    expect(
      getWrappedImageIndex({
        currentIndex: 2,
        direction: "next",
        itemCount: 3,
      }),
    ).toBe(0);
    expect(
      getWrappedImageIndex({
        currentIndex: 0,
        direction: "previous",
        itemCount: 3,
      }),
    ).toBe(2);
    expect(openLightbox(images, 7)).toEqual({ images, index: 2 });
    expect(openLightbox(images, -1)).toEqual({ images, index: 0 });
    expect(openLightbox([], 0)).toBeNull();
  });

  it("does not step a single image", () => {
    const single = { images: images.slice(0, 1), index: 0 };
    expect(stepLightbox(single, "next")).toBe(single);
    expect(stepLightbox({ images, index: 2 }, "next")).toEqual({
      images,
      index: 0,
    });
  });
});

describe("lightbox zoom", () => {
  it("clamps the scale into [1, max]", () => {
    expect(clampLightboxScale(0.2)).toBe(1);
    expect(clampLightboxScale(99)).toBe(LIGHTBOX_MAX_SCALE);
    expect(clampLightboxScale(Number.NaN)).toBe(1);
  });

  it("keeps a zoomed image covering the viewport and centres an unzoomed one", () => {
    const viewportSize = { width: 400, height: 800 };
    const contentSize = { width: 400, height: 300 };
    // At scale 1 no translation is allowed (the image is smaller than the viewport).
    expect(
      clampLightboxTranslation({
        translation: { x: 50, y: -40 },
        scale: 1,
        contentSize,
        viewportSize,
      }),
    ).toEqual({ x: 0, y: 0 });
    // At scale 3 the image is 1200×900: 400px of horizontal and 50px of
    // vertical slack on either side.
    expect(
      clampLightboxTranslation({
        translation: { x: 1000, y: -1000 },
        scale: 3,
        contentSize,
        viewportSize,
      }),
    ).toEqual({ x: 400, y: -50 });
    expect(
      clampLightboxTranslation({
        translation: { x: -10, y: 20 },
        scale: 3,
        contentSize,
        viewportSize,
      }),
    ).toEqual({ x: -10, y: 20 });
  });
});
