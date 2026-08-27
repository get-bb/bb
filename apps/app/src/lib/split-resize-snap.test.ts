// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSplitResizeSnapSession } from "./split-resize-snap";

const SNAP_CAPTURE_PX = 12;
const SNAP_RELEASE_PX = 24;

function rect({
  height = 600,
  left,
  top = 0,
  width = 1,
}: {
  height?: number;
  left: number;
  top?: number;
  width?: number;
}): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function divider(bounds: DOMRect, gridBounds: DOMRect): HTMLElement {
  const grid = document.createElement("div");
  grid.dataset.splitResizeGridRoot = "";
  grid.getBoundingClientRect = () => gridBounds;
  const split = document.createElement("div");
  const element = document.createElement("div");
  element.getBoundingClientRect = () => bounds;
  split.appendChild(element);
  grid.appendChild(split);
  document.body.appendChild(grid);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("split resize snapping", () => {
  it("snaps a vertical divider to the split surface's horizontal grid line", () => {
    const source = divider(
      rect({ left: 650 }),
      rect({ height: 600, left: 100, top: 50, width: 800 }),
    );
    const session = createSplitResizeSnapSession(source, "x");

    const result = session.resolve({
      end: 900,
      pointer: 500 + SNAP_CAPTURE_PX,
      start: 300,
    });

    expect(result).toEqual({
      coordinate: 500,
      fraction: 199.5 / 599,
      snapped: true,
    });
    const guide = document.querySelector<HTMLElement>(
      "[data-split-resize-snap-guide]",
    );
    expect(guide?.dataset.splitResizeSnapGuide).toBe("x");
    expect(guide?.style.left).toBe("500px");
    expect(guide?.style.top).toBe("50px");
    expect(guide?.style.height).toBe("600px");

    session.clear();
    expect(document.querySelector("[data-split-resize-snap-guide]")).toBeNull();
  });

  it("snaps a horizontal divider to the split surface's vertical grid line", () => {
    const source = divider(
      rect({ height: 1, left: 0, top: 600, width: 900 }),
      rect({ height: 800, left: 40, top: 100, width: 900 }),
    );
    const session = createSplitResizeSnapSession(source, "y");

    const result = session.resolve({
      end: 900,
      pointer: 500 - SNAP_CAPTURE_PX,
      start: 300,
    });

    expect(result).toEqual({
      coordinate: 500,
      fraction: 199.5 / 599,
      snapped: true,
    });
    const guide = document.querySelector<HTMLElement>(
      "[data-split-resize-snap-guide]",
    );
    expect(guide?.dataset.splitResizeSnapGuide).toBe("y");
    expect(guide?.style.left).toBe("40px");
    expect(guide?.style.top).toBe("500px");
    expect(guide?.style.width).toBe("900px");
  });

  it("captures a fast crossing and holds until the pointer clears the release threshold", () => {
    const source = divider(
      rect({ left: 500 }),
      rect({ left: 100, width: 800 }),
    );
    const session = createSplitResizeSnapSession(source, "x");

    expect(
      session.resolve({ end: 900, pointer: 470, start: 100 }).snapped,
    ).toBe(false);
    expect(
      session.resolve({ end: 900, pointer: 518, start: 100 }).snapped,
    ).toBe(true);
    expect(
      session.resolve({
        end: 900,
        pointer: 500 + SNAP_RELEASE_PX,
        start: 100,
      }).snapped,
    ).toBe(true);
    const result = session.resolve({
      end: 900,
      pointer: 500 + SNAP_RELEASE_PX + 1,
      start: 100,
    });

    expect(result.snapped).toBe(false);
    expect(result.fraction).toBeCloseTo(0.53125, 6);
    expect(document.querySelector("[data-split-resize-snap-guide]")).toBeNull();
  });

  it("reads the divider and grid geometry once instead of during pointer movement", () => {
    const source = divider(
      rect({ left: 500 }),
      rect({ left: 100, width: 800 }),
    );
    const grid = source.closest<HTMLElement>("[data-split-resize-grid-root]");
    if (grid === null) throw new Error("Expected a split resize grid root");
    const sourceRect = vi.spyOn(source, "getBoundingClientRect");
    const gridRect = vi.spyOn(grid, "getBoundingClientRect");
    const session = createSplitResizeSnapSession(source, "x");

    for (let pointer = 495; pointer <= 505; pointer += 1) {
      session.resolve({ end: 900, pointer, start: 100 });
    }

    expect(sourceRect).toHaveBeenCalledTimes(1);
    expect(gridRect).toHaveBeenCalledTimes(1);
  });
});
