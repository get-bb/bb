// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSplitResizeSnapSession,
  SPLIT_RESIZE_SNAP_THRESHOLD_PX,
} from "./split-resize-snap";

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

function divider(bounds: DOMRect): HTMLElement {
  const split = document.createElement("div");
  const element = document.createElement("div");
  element.getBoundingClientRect = () => bounds;
  split.appendChild(element);
  document.body.appendChild(split);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("split resize snapping", () => {
  it("snaps a vertical divider to its split's horizontal midpoint without another divider", () => {
    const source = divider(rect({ left: 300 }));
    const session = createSplitResizeSnapSession(source, "x");

    const result = session.resolve({
      end: 900,
      pointer: 500 + SPLIT_RESIZE_SNAP_THRESHOLD_PX,
      start: 100,
    });

    expect(result).toEqual({
      coordinate: 500,
      fraction: 0.5,
      snapped: true,
    });
    const guide = document.querySelector<HTMLElement>(
      "[data-split-resize-snap-guide]",
    );
    expect(guide?.dataset.splitResizeSnapGuide).toBe("x");
    expect(guide?.style.left).toBe("500px");

    session.clear();
    expect(document.querySelector("[data-split-resize-snap-guide]")).toBeNull();
  });

  it("snaps a horizontal divider to its split's vertical midpoint", () => {
    const source = divider(
      rect({ height: 1, left: 0, top: 300, width: 900 }),
    );
    const session = createSplitResizeSnapSession(source, "y");

    const result = session.resolve({
      end: 700,
      pointer: 400 - SPLIT_RESIZE_SNAP_THRESHOLD_PX,
      start: 100,
    });

    expect(result).toEqual({ coordinate: 400, fraction: 0.5, snapped: true });
    const guide = document.querySelector<HTMLElement>(
      "[data-split-resize-snap-guide]",
    );
    expect(guide?.dataset.splitResizeSnapGuide).toBe("y");
    expect(guide?.style.top).toBe("400px");
  });

  it("clears the midpoint guide after the pointer leaves the threshold", () => {
    const source = divider(rect({ left: 300 }));
    const session = createSplitResizeSnapSession(source, "x");

    expect(
      session.resolve({ end: 900, pointer: 500, start: 100 }).snapped,
    ).toBe(true);
    const result = session.resolve({
      end: 900,
      pointer: 500 + SPLIT_RESIZE_SNAP_THRESHOLD_PX + 0.1,
      start: 100,
    });

    expect(result.snapped).toBe(false);
    expect(result.fraction).toBeCloseTo(0.510125, 6);
    expect(document.querySelector("[data-split-resize-snap-guide]")).toBeNull();
  });

  it("does not read divider geometry during a drag", () => {
    const source = divider(rect({ left: 300 }));
    const sourceRect = vi.spyOn(source, "getBoundingClientRect");
    const session = createSplitResizeSnapSession(source, "x");

    for (let pointer = 495; pointer <= 505; pointer += 1) {
      session.resolve({ end: 900, pointer, start: 100 });
    }

    expect(sourceRect).not.toHaveBeenCalled();
  });
});
