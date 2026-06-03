import { describe, expect, it } from "vitest";
import {
  bbDesktopBrowserViewBoundsFromLayoutDescriptor,
  bbDesktopBrowserViewLayoutDescriptorFromBounds,
  clampBbDesktopBrowserViewBounds,
  clampBbDesktopBrowserViewLayoutDescriptor,
  type BbDesktopBrowserViewBounds,
  type BbDesktopBrowserViewLayoutDescriptor,
  type BbDesktopBrowserViewportBounds,
} from "@bb/server-contract";

interface BrowserBoundsClampTestCase {
  bounds: BbDesktopBrowserViewBounds;
  expected: BbDesktopBrowserViewBounds;
  label: string;
  viewport: BbDesktopBrowserViewportBounds;
}

interface BrowserLayoutProjectionTestCase {
  expected: BbDesktopBrowserViewBounds;
  label: string;
  layout: BbDesktopBrowserViewLayoutDescriptor;
  viewport: BbDesktopBrowserViewportBounds;
}

const browserBoundsClampTestCases: BrowserBoundsClampTestCase[] = [
  {
    label: "anchors the left edge and trims overflow at the right and bottom",
    bounds: { x: 180, y: 48, width: 400, height: 420 },
    viewport: { width: 500, height: 360 },
    expected: { x: 180, y: 48, width: 320, height: 312 },
  },
  {
    label: "clamps negative origins to the host content edge",
    bounds: { x: -24, y: -10, width: 200, height: 120 },
    viewport: { width: 500, height: 360 },
    expected: { x: 0, y: 0, width: 176, height: 110 },
  },
  {
    label: "collapses bounds that start outside the host content area",
    bounds: { x: 640, y: 400, width: 120, height: 90 },
    viewport: { width: 500, height: 360 },
    expected: { x: 500, y: 360, width: 0, height: 0 },
  },
];

const browserLayoutProjectionTestCases: BrowserLayoutProjectionTestCase[] = [
  {
    label: "projects right and bottom edges from cached insets",
    layout: { left: 240, top: 72, rightInset: 0, bottomInset: 0 },
    viewport: { width: 900, height: 640 },
    expected: { x: 240, y: 72, width: 660, height: 568 },
  },
  {
    label: "collapses when insets exceed the live content size",
    layout: { left: 240, top: 72, rightInset: 700, bottomInset: 500 },
    viewport: { width: 500, height: 360 },
    expected: { x: 240, y: 72, width: 0, height: 0 },
  },
];

describe("desktop browser bounds containment", () => {
  it.each(browserBoundsClampTestCases)("$label", (testCase) => {
    expect(
      clampBbDesktopBrowserViewBounds({
        bounds: testCase.bounds,
        viewport: testCase.viewport,
      }),
    ).toEqual(testCase.expected);
  });

  it.each(browserLayoutProjectionTestCases)("$label", (testCase) => {
    expect(
      bbDesktopBrowserViewBoundsFromLayoutDescriptor({
        layout: testCase.layout,
        viewport: testCase.viewport,
      }),
    ).toEqual(testCase.expected);
  });

  it("round-trips a clamped absolute rect into resize-invariant insets", () => {
    const bounds: BbDesktopBrowserViewBounds = {
      x: 180,
      y: 48,
      width: 400,
      height: 420,
    };
    const viewport: BbDesktopBrowserViewportBounds = { width: 500, height: 360 };
    const layout = bbDesktopBrowserViewLayoutDescriptorFromBounds({
      bounds,
      viewport,
    });

    expect(layout).toEqual({
      left: 180,
      top: 48,
      rightInset: 0,
      bottomInset: 0,
    });
    expect(
      clampBbDesktopBrowserViewLayoutDescriptor({
        layout,
        viewport,
      }),
    ).toEqual(layout);
  });
});
