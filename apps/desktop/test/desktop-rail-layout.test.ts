import { describe, expect, it } from "vitest";
import {
  computeRailLayoutBounds,
  DESKTOP_RAIL_TRAFFIC_LIGHT_DEFAULT,
  DESKTOP_RAIL_TRAFFIC_LIGHT_WITH_RAIL,
  DESKTOP_RAIL_WIDTH_PX,
  offsetBrowserBoundsForRail,
  shouldUseRailLayout,
  trafficLightPositionForLayout,
} from "../src/desktop-rail-layout.js";

describe("shouldUseRailLayout", () => {
  it("requires at least two servers", () => {
    expect(shouldUseRailLayout(0)).toBe(false);
    expect(shouldUseRailLayout(1)).toBe(false);
    expect(shouldUseRailLayout(2)).toBe(true);
    expect(shouldUseRailLayout(5)).toBe(true);
  });
});

describe("computeRailLayoutBounds", () => {
  it("places the rail and insets the SPA by the rail width", () => {
    expect(computeRailLayoutBounds({ width: 1200, height: 800 })).toEqual({
      rail: { x: 0, y: 0, width: DESKTOP_RAIL_WIDTH_PX, height: 800 },
      spa: {
        x: DESKTOP_RAIL_WIDTH_PX,
        y: 0,
        width: 1200 - DESKTOP_RAIL_WIDTH_PX,
        height: 800,
      },
    });
  });

  it("clamps the rail when the window is narrower than the rail", () => {
    expect(computeRailLayoutBounds({ width: 40, height: 100 })).toEqual({
      rail: { x: 0, y: 0, width: 40, height: 100 },
      spa: { x: 40, y: 0, width: 0, height: 100 },
    });
  });

  it("never returns negative dimensions", () => {
    expect(computeRailLayoutBounds({ width: -10, height: -5 })).toEqual({
      rail: { x: 0, y: 0, width: 0, height: 0 },
      spa: { x: 0, y: 0, width: 0, height: 0 },
    });
  });
});

describe("trafficLightPositionForLayout", () => {
  it("tucks traffic lights inside the rail's top strip in rail mode", () => {
    expect(trafficLightPositionForLayout("rail")).toEqual(
      DESKTOP_RAIL_TRAFFIC_LIGHT_WITH_RAIL,
    );
    // The ~52px macOS light cluster must fit inside the rail with margin.
    expect(DESKTOP_RAIL_TRAFFIC_LIGHT_WITH_RAIL).toEqual({ x: 10, y: 18 });
    expect(DESKTOP_RAIL_TRAFFIC_LIGHT_WITH_RAIL.x + 52).toBeLessThan(
      DESKTOP_RAIL_WIDTH_PX,
    );
  });

  it("keeps the classic diagonal inset without a rail", () => {
    expect(trafficLightPositionForLayout("classic")).toEqual(
      DESKTOP_RAIL_TRAFFIC_LIGHT_DEFAULT,
    );
    expect(DESKTOP_RAIL_TRAFFIC_LIGHT_DEFAULT).toEqual({ x: 18, y: 18 });
  });
});

describe("offsetBrowserBoundsForRail", () => {
  it("offsets SPA-local browser bounds by the rail width", () => {
    expect(
      offsetBrowserBoundsForRail({
        bounds: { x: 100, y: 48, width: 400, height: 500 },
        railWidthPx: DESKTOP_RAIL_WIDTH_PX,
      }),
    ).toEqual({
      x: 100 + DESKTOP_RAIL_WIDTH_PX,
      y: 48,
      width: 400,
      height: 500,
    });
  });

  it("is a no-op when the rail is hidden", () => {
    const bounds = { x: 100, y: 48, width: 400, height: 500 };
    expect(
      offsetBrowserBoundsForRail({ bounds, railWidthPx: 0 }),
    ).toEqual(bounds);
  });
});
