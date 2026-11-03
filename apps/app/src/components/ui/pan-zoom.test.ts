import { describe, expect, it } from "vitest";
import {
  constrainPanZoomOffset,
  getPanZoomGestureEventData,
  getPanZoomWheelZoomDelta,
  getPanZoomWheelZoomFactor,
  pinchPanZoomView,
  zoomPanZoomView,
} from "./pan-zoom";

const LIMITS = { max: 4, min: 0.5 };

describe("getPanZoomWheelZoomFactor", () => {
  it("normalizes line-mode wheel deltas before computing the factor", () => {
    expect(getPanZoomWheelZoomFactor({ deltaMode: 1, deltaY: 1 })).toBeCloseTo(
      Math.exp(-16 * 0.01),
    );
  });

  it("caps large wheel deltas so mouse wheels do not jump too far", () => {
    expect(getPanZoomWheelZoomFactor({ deltaMode: 0, deltaY: -100 })).toBe(
      1.22,
    );
    expect(getPanZoomWheelZoomFactor({ deltaMode: 0, deltaY: 100 })).toBe(0.82);
  });
});

describe("getPanZoomWheelZoomDelta", () => {
  it("prefers vertical wheel movement", () => {
    expect(
      getPanZoomWheelZoomDelta({ deltaX: 20, deltaY: -10, deltaZ: 5 }),
    ).toBe(-10);
  });

  it("falls back to horizontal or z-axis wheel movement", () => {
    expect(getPanZoomWheelZoomDelta({ deltaX: 20, deltaY: 0, deltaZ: 5 })).toBe(
      20,
    );
    expect(getPanZoomWheelZoomDelta({ deltaX: 0, deltaY: 0, deltaZ: 5 })).toBe(
      5,
    );
  });
});

describe("getPanZoomGestureEventData", () => {
  it("reads the nonstandard trackpad gesture event shape", () => {
    const event = new Event("gesturechange");
    Object.defineProperty(event, "clientX", { value: 120 });
    Object.defineProperty(event, "clientY", { value: 80 });
    Object.defineProperty(event, "scale", { value: 1.4 });

    expect(getPanZoomGestureEventData(event)).toEqual({
      clientX: 120,
      clientY: 80,
      scale: 1.4,
    });
  });

  it("ignores regular events", () => {
    expect(getPanZoomGestureEventData(new Event("gesturechange"))).toBeNull();
  });
});

describe("zoomPanZoomView", () => {
  it("preserves the focal point while zooming", () => {
    expect(
      zoomPanZoomView({
        focalPoint: { x: 100, y: 50 },
        limits: LIMITS,
        nextScale: 2,
        view: { offset: { x: 0, y: 0 }, scale: 1 },
      }),
    ).toEqual({ offset: { x: -100, y: -50 }, scale: 2 });
  });

  it("clamps requested zoom levels", () => {
    expect(
      zoomPanZoomView({
        focalPoint: { x: 0, y: 0 },
        limits: LIMITS,
        nextScale: 10,
        view: { offset: { x: 0, y: 0 }, scale: 1 },
      }),
    ).toEqual({ offset: { x: 0, y: 0 }, scale: 4 });
  });
});

describe("pinchPanZoomView", () => {
  it("zooms and pans around the pinch midpoint", () => {
    expect(
      pinchPanZoomView({
        limits: LIMITS,
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

describe("constrainPanZoomOffset", () => {
  it("keeps zoomed content covering the viewport edge it overflows", () => {
    expect(
      constrainPanZoomOffset({
        contentSize: { height: 300, width: 400 },
        view: { offset: { x: 500, y: -500 }, scale: 2 },
        viewportSize: { height: 400, width: 600 },
      }),
    ).toEqual({ offset: { x: 100, y: -100 }, scale: 2 });
  });

  it("recenters content that fits inside the viewport", () => {
    expect(
      constrainPanZoomOffset({
        contentSize: { height: 300, width: 400 },
        view: { offset: { x: -80, y: 40 }, scale: 1 },
        viewportSize: { height: 400, width: 600 },
      }),
    ).toEqual({ offset: { x: 0, y: 0 }, scale: 1 });
  });
});
