import { describe, expect, it } from "vitest";
import {
  clampMermaidScale,
  getMermaidWheelZoomFactor,
  pinchMermaidDiagramView,
  zoomMermaidDiagramView,
} from "./markdown-mermaid-diagram";

describe("clampMermaidScale", () => {
  it("keeps zoom inside the supported diagram range", () => {
    expect(clampMermaidScale(0.1)).toBe(0.5);
    expect(clampMermaidScale(2)).toBe(2);
    expect(clampMermaidScale(8)).toBe(4);
  });
});

describe("getMermaidWheelZoomFactor", () => {
  it("zooms in for upward pixel wheel movement and out for downward movement", () => {
    expect(
      getMermaidWheelZoomFactor({ deltaMode: 0, deltaY: -100 }),
    ).toBeGreaterThan(1);
    expect(
      getMermaidWheelZoomFactor({ deltaMode: 0, deltaY: 100 }),
    ).toBeLessThan(1);
  });

  it("normalizes line-mode wheel deltas before computing the factor", () => {
    expect(getMermaidWheelZoomFactor({ deltaMode: 1, deltaY: 1 })).toBeCloseTo(
      Math.exp(-16 * 0.002),
    );
  });
});

describe("zoomMermaidDiagramView", () => {
  it("preserves the focal point while zooming", () => {
    expect(
      zoomMermaidDiagramView({
        focalPoint: { x: 100, y: 50 },
        nextScale: 2,
        view: { offset: { x: 0, y: 0 }, scale: 1 },
      }),
    ).toEqual({ offset: { x: -100, y: -50 }, scale: 2 });
  });

  it("clamps requested zoom levels", () => {
    expect(
      zoomMermaidDiagramView({
        focalPoint: { x: 0, y: 0 },
        nextScale: 10,
        view: { offset: { x: 0, y: 0 }, scale: 1 },
      }),
    ).toEqual({ offset: { x: 0, y: 0 }, scale: 4 });
  });
});

describe("pinchMermaidDiagramView", () => {
  it("zooms and pans around the pinch midpoint", () => {
    expect(
      pinchMermaidDiagramView({
        pinchState: {
          startCenter: { x: 40, y: 20 },
          startDistance: 100,
          startView: { offset: { x: 0, y: 0 }, scale: 1 },
        },
        touchPair: {
          center: { x: 50, y: 35 },
          distance: 200,
        },
      }),
    ).toEqual({ offset: { x: -30, y: -5 }, scale: 2 });
  });
});
