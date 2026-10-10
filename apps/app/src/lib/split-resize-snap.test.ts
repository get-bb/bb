import { describe, expect, it } from "vitest";
import {
  createSplitResizeSnapResolver,
  SPLIT_RESIZE_SNAP_RELEASE_PX,
} from "./split-resize-snap";

function createMidpointResolver() {
  return createSplitResizeSnapResolver({
    extent: 1,
    gridCoordinate: 500,
    usesPanelWidthLimits: false,
  });
}

describe("split resize snapping", () => {
  it("retains the 15% width limit for nested splits", () => {
    const resolver = createMidpointResolver();

    expect(
      resolver.resolve({ start: 100, end: 900, pointer: 100 }).fraction,
    ).toBe(0.15);
    resolver.reset();
    expect(
      resolver.resolve({ start: 100, end: 900, pointer: 900 }).fraction,
    ).toBe(0.85);
  });

  it("captures a fast crossing and holds until the pointer clears the release threshold", () => {
    const resolver = createMidpointResolver();

    expect(
      resolver.resolve({ end: 900, pointer: 470, start: 100 }).snapped,
    ).toBe(false);
    expect(
      resolver.resolve({ end: 900, pointer: 518, start: 100 }).snapped,
    ).toBe(true);
    expect(
      resolver.resolve({
        end: 900,
        pointer: 500 + SPLIT_RESIZE_SNAP_RELEASE_PX,
        start: 100,
      }).snapped,
    ).toBe(true);
    expect(
      resolver.resolve({
        end: 900,
        pointer: 500 + SPLIT_RESIZE_SNAP_RELEASE_PX + 1,
        start: 100,
      }).snapped,
    ).toBe(true);
    const result = resolver.resolve({
      end: 900,
      pointer: 500 + SPLIT_RESIZE_SNAP_RELEASE_PX + 2,
      start: 100,
    });

    expect(result.snapped).toBe(false);
    expect(result.fraction).toBeCloseTo(
      (500 + SPLIT_RESIZE_SNAP_RELEASE_PX + 2 - 100 - 0.5) / 799,
      6,
    );
  });

  it("captures a fast crossing when the next pointer sample lands beyond the release threshold", () => {
    const resolver = createMidpointResolver();

    expect(
      resolver.resolve({ end: 900, pointer: 470, start: 100 }).snapped,
    ).toBe(false);
    expect(
      resolver.resolve({ end: 900, pointer: 560, start: 100 }),
    ).toMatchObject({ coordinate: 500, snapped: true });
    expect(
      resolver.resolve({ end: 900, pointer: 560, start: 100 }).snapped,
    ).toBe(true);
    expect(
      resolver.resolve({
        end: 900,
        pointer: 560 + SPLIT_RESIZE_SNAP_RELEASE_PX,
        start: 100,
      }).snapped,
    ).toBe(true);
    expect(
      resolver.resolve({
        end: 900,
        pointer: 560 + SPLIT_RESIZE_SNAP_RELEASE_PX + 1,
        start: 100,
      }).snapped,
    ).toBe(true);
    expect(
      resolver.resolve({
        end: 900,
        pointer: 560 + SPLIT_RESIZE_SNAP_RELEASE_PX + 2,
        start: 100,
      }).snapped,
    ).toBe(false);
  });

  it("confirms release after a fast crossing instead of dropping the snap on the next coarse sample", () => {
    const resolver = createMidpointResolver();

    expect(
      resolver.resolve({ end: 900, pointer: 470, start: 100 }).snapped,
    ).toBe(false);
    expect(
      resolver.resolve({ end: 900, pointer: 560, start: 100 }).snapped,
    ).toBe(true);
    expect(
      resolver.resolve({ end: 900, pointer: 640, start: 100 }).snapped,
    ).toBe(true);
    expect(
      resolver.resolve({ end: 900, pointer: 641, start: 100 }).snapped,
    ).toBe(false);
  });
});
