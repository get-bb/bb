import { describe, expect, it } from "vitest";
import {
  clampBbDesktopBrowserViewBounds,
  type BbDesktopBrowserViewBounds,
  type BbDesktopBrowserViewportBounds,
} from "@bb/server-contract";

interface BrowserBoundsClampTestCase {
  bounds: BbDesktopBrowserViewBounds;
  expected: BbDesktopBrowserViewBounds;
  label: string;
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

describe("desktop browser bounds containment", () => {
  it.each(browserBoundsClampTestCases)("$label", (testCase) => {
    expect(
      clampBbDesktopBrowserViewBounds({
        bounds: testCase.bounds,
        viewport: testCase.viewport,
      }),
    ).toEqual(testCase.expected);
  });
});
