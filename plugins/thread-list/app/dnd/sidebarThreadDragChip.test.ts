import type { Active, ClientRect } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";
import { createSidebarThreadDragChipSnap } from "./sidebarThreadDragChip.js";

type Snap = ReturnType<typeof createSidebarThreadDragChipSnap>;

const ACTIVE: Active = {
  id: "thr_1",
  data: { current: undefined },
  rect: { current: { initial: null, translated: null } },
};

function rect(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  } satisfies ClientRect;
}

const ROW_RECT = rect(8, 8, 244, 28);
const CHIP_WIDTH = 100;
const CHIP_HEIGHT = 24;

function chipCenterFor(
  snap: Snap,
  {
    transform,
    draggingNodeRect,
    activeNodeRect = ROW_RECT,
    pointerDown,
  }: {
    transform: { x: number; y: number };
    draggingNodeRect: ClientRect;
    activeNodeRect?: ClientRect;
    pointerDown: { x: number; y: number };
  },
) {
  const result = snap({
    active: ACTIVE,
    activeNodeRect,
    draggingNodeRect,
    pointer: pointerDown,
    transform: { ...transform, scaleX: 1, scaleY: 1 },
  });
  return {
    x: ROW_RECT.left + result.x + draggingNodeRect.width / 2,
    y: ROW_RECT.top + result.y + draggingNodeRect.height / 2,
  };
}

describe("sidebar thread drag chip", () => {
  it("centers the chip on the pointer", () => {
    const snap = createSidebarThreadDragChipSnap();
    const pointerDown = { x: 130, y: 22 };
    const transform = { x: 15, y: 30 };

    expect(
      chipCenterFor(snap, {
        transform,
        draggingNodeRect: rect(
          ROW_RECT.left,
          ROW_RECT.top,
          CHIP_WIDTH,
          CHIP_HEIGHT,
        ),
        pointerDown,
      }),
    ).toEqual({
      x: pointerDown.x + transform.x,
      y: pointerDown.y + transform.y,
    });
  });

  it("ignores the in-flight transform baked into the measured overlay rect", () => {
    const snap = createSidebarThreadDragChipSnap();
    const pointerDown = { x: 130, y: 22 };
    const transform = { x: 25, y: 300 };
    const measuredWhileDragging = rect(
      ROW_RECT.left + transform.x,
      ROW_RECT.top + transform.y,
      CHIP_WIDTH,
      CHIP_HEIGHT,
    );

    expect(
      chipCenterFor(snap, {
        transform,
        draggingNodeRect: measuredWhileDragging,
        pointerDown,
      }),
    ).toEqual({
      x: pointerDown.x + transform.x,
      y: pointerDown.y + transform.y,
    });
  });

  it("keeps the origin fixed when the dragged row is remeasured mid-drag", () => {
    const snap = createSidebarThreadDragChipSnap();
    const pointerDown = { x: 130, y: 22 };
    const draggingNodeRect = rect(
      ROW_RECT.left,
      ROW_RECT.top,
      CHIP_WIDTH,
      CHIP_HEIGHT,
    );
    chipCenterFor(snap, {
      transform: { x: 0, y: 0 },
      draggingNodeRect,
      pointerDown,
    });

    const transform = { x: 4, y: 120 };
    expect(
      chipCenterFor(snap, {
        transform,
        draggingNodeRect,
        activeNodeRect: rect(ROW_RECT.left, ROW_RECT.top + 64, 244, 28),
        pointerDown,
      }),
    ).toEqual({
      x: pointerDown.x + transform.x,
      y: pointerDown.y + transform.y,
    });
  });

  it("re-anchors on the next drag after the previous one ends", () => {
    const snap = createSidebarThreadDragChipSnap();
    const draggingNodeRect = rect(
      ROW_RECT.left,
      ROW_RECT.top,
      CHIP_WIDTH,
      CHIP_HEIGHT,
    );
    chipCenterFor(snap, {
      transform: { x: 0, y: 0 },
      draggingNodeRect,
      pointerDown: { x: 130, y: 22 },
    });

    const idleTransform = { x: 9, y: 9, scaleX: 1, scaleY: 1 };
    expect(
      snap({
        active: null,
        activeNodeRect: null,
        draggingNodeRect: null,
        pointer: null,
        transform: idleTransform,
      }),
    ).toBe(idleTransform);

    const secondRow = rect(8, 200, 244, 28);
    const pointerDown = { x: 140, y: 214 };
    const transform = { x: 12, y: 40 };
    const result = snap({
      active: ACTIVE,
      activeNodeRect: secondRow,
      draggingNodeRect: rect(
        secondRow.left,
        secondRow.top,
        CHIP_WIDTH,
        CHIP_HEIGHT,
      ),
      pointer: pointerDown,
      transform: { ...transform, scaleX: 1, scaleY: 1 },
    });

    expect({
      x: secondRow.left + result.x + CHIP_WIDTH / 2,
      y: secondRow.top + result.y + CHIP_HEIGHT / 2,
    }).toEqual({
      x: pointerDown.x + transform.x,
      y: pointerDown.y + transform.y,
    });
  });

  it("preserves keyboard positioning without pointer coordinates", () => {
    const snap = createSidebarThreadDragChipSnap();
    const transform = { x: 15, y: 30, scaleX: 1, scaleY: 1 };
    const result = snap({
      active: ACTIVE,
      activeNodeRect: ROW_RECT,
      draggingNodeRect: rect(
        ROW_RECT.left,
        ROW_RECT.top,
        CHIP_WIDTH,
        CHIP_HEIGHT,
      ),
      pointer: null,
      transform,
    });

    expect(result).toBe(transform);
  });
});
