import { describe, expect, it } from "vitest";
import {
  clampMermaidScale,
  getMermaidGestureEventData,
  getMermaidWheelZoomDelta,
  getMermaidWheelZoomFactor,
  pinchMermaidDiagramView,
  shouldHandleMermaidWheelZoom,
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
      Math.exp(-16 * 0.01),
    );
  });

  it("caps large wheel deltas so mouse wheels do not jump too far", () => {
    expect(getMermaidWheelZoomFactor({ deltaMode: 0, deltaY: -100 })).toBe(
      1.22,
    );
    expect(getMermaidWheelZoomFactor({ deltaMode: 0, deltaY: 100 })).toBe(0.82);
  });
});

describe("shouldHandleMermaidWheelZoom", () => {
  it("handles vertical wheel input without requiring keyboard modifiers", () => {
    expect(shouldHandleMermaidWheelZoom({ zoomDelta: 1 })).toBe(true);
    expect(shouldHandleMermaidWheelZoom({ zoomDelta: -1 })).toBe(true);
  });

  it("ignores wheel events without movement", () => {
    expect(shouldHandleMermaidWheelZoom({ zoomDelta: 0 })).toBe(false);
  });
});

describe("getMermaidWheelZoomDelta", () => {
  it("prefers vertical wheel movement", () => {
    expect(
      getMermaidWheelZoomDelta({ deltaX: 20, deltaY: -10, deltaZ: 5 }),
    ).toBe(-10);
  });

  it("falls back to horizontal or z-axis wheel movement", () => {
    expect(getMermaidWheelZoomDelta({ deltaX: 20, deltaY: 0, deltaZ: 5 })).toBe(
      20,
    );
    expect(getMermaidWheelZoomDelta({ deltaX: 0, deltaY: 0, deltaZ: 5 })).toBe(
      5,
    );
  });
});

describe("getMermaidGestureEventData", () => {
  it("reads the nonstandard trackpad gesture event shape", () => {
    const event = new Event("gesturechange");
    Object.defineProperty(event, "clientX", { value: 120 });
    Object.defineProperty(event, "clientY", { value: 80 });
    Object.defineProperty(event, "scale", { value: 1.4 });

    expect(getMermaidGestureEventData({ event })).toEqual({
      clientX: 120,
      clientY: 80,
      scale: 1.4,
    });
  });

  it("ignores regular events", () => {
    expect(
      getMermaidGestureEventData({ event: new Event("gesturechange") }),
    ).toBeNull();
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
