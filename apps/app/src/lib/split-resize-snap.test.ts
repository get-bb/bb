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

function divider(axis: "x" | "y", bounds: DOMRect): HTMLElement {
  const split = document.createElement("div");
  const element = document.createElement("div");
  element.dataset.splitResizeAxis = axis;
  element.getBoundingClientRect = () => bounds;
  split.appendChild(element);
  document.body.appendChild(split);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("split resize snapping", () => {
  it("snaps within the threshold to the exact same-axis coordinate", () => {
    const source = divider("x", rect({ left: 300 }));
    const target = divider("x", rect({ left: 500 }));
    const session = createSplitResizeSnapSession(source, "x");

    const result = session.resolve({
      end: 900,
      pointer: 500.5 + SPLIT_RESIZE_SNAP_THRESHOLD_PX,
      start: 100,
    });

    expect(result).toEqual({
      coordinate: 500.5,
      fraction: 400 / 799,
      snapped: true,
    });
    expect(target.dataset.splitResizeSnapTarget).toBe("true");
    const guide = document.querySelector<HTMLElement>(
      "[data-split-resize-snap-guide]",
    );
    expect(guide?.dataset.splitResizeSnapGuide).toBe("x");
    expect(guide?.style.left).toBe("500.5px");

    session.clear();
    expect(target.dataset.splitResizeSnapTarget).toBeUndefined();
    expect(document.querySelector("[data-split-resize-snap-guide]")).toBeNull();
  });

  it("clears the guide outside the threshold and ignores the cross axis", () => {
    const source = divider("x", rect({ left: 300 }));
    const sameAxis = divider("x", rect({ left: 500 }));
    divider("y", rect({ height: 1, left: 0, top: 510, width: 900 }));
    const session = createSplitResizeSnapSession(source, "x");

    expect(
      session.resolve({ end: 900, pointer: 500, start: 100 }).snapped,
    ).toBe(true);
    const unsnapped = session.resolve({
      end: 900,
      pointer: 500.5 + SPLIT_RESIZE_SNAP_THRESHOLD_PX + 0.1,
      start: 100,
    });

    expect(unsnapped.snapped).toBe(false);
    expect(unsnapped.fraction).toBeCloseTo(0.51075, 5);
    expect(sameAxis.dataset.splitResizeSnapTarget).toBeUndefined();
    expect(document.querySelector("[data-split-resize-snap-guide]")).toBeNull();
  });

  it("does not advertise an aligned target that the resize bounds cannot reach", () => {
    const source = divider("x", rect({ left: 300 }));
    const target = divider("x", rect({ left: 40 }));
    const session = createSplitResizeSnapSession(source, "x");

    const result = session.resolve({ end: 900, pointer: 40.5, start: 100 });

    expect(result.snapped).toBe(false);
    expect(result.fraction).toBe(0.15);
    expect(target.dataset.splitResizeSnapTarget).toBeUndefined();
    expect(document.querySelector("[data-split-resize-snap-guide]")).toBeNull();
  });

  it("reads target geometry once per drag instead of forcing layout on every pointer move", () => {
    const source = divider("x", rect({ left: 300 }));
    const target = divider("x", rect({ left: 500 }));
    const sourceRect = vi.spyOn(source, "getBoundingClientRect");
    const targetRect = vi.spyOn(target, "getBoundingClientRect");
    const session = createSplitResizeSnapSession(source, "x");

    for (let pointer = 495; pointer <= 505; pointer += 1) {
      session.resolve({ end: 900, pointer, start: 100 });
    }

    expect(sourceRect).toHaveBeenCalledTimes(1);
    expect(targetRect).toHaveBeenCalledTimes(1);
  });
});
