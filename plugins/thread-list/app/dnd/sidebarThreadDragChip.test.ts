// @vitest-environment jsdom

import type { Active, ClientRect, Modifier } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";
import { createSnapSidebarThreadDragChipToCursor } from "./sidebarThreadDragChip.js";

type ModifierArgs = Parameters<Modifier>[0];

const ACTIVE: Active = {
  id: "thr_1",
  data: { current: undefined },
  rect: { current: { initial: null, translated: null } },
};

const MODIFIER_CONTEXT = {
  active: ACTIVE,
  containerNodeRect: null,
  over: null,
  overlayNodeRect: null,
  scrollableAncestorRects: [],
  scrollableAncestors: [],
  windowRect: null,
} satisfies Omit<
  ModifierArgs,
  "activatorEvent" | "activeNodeRect" | "draggingNodeRect" | "transform"
>;

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
  modifier: Modifier,
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
  const result = modifier({
    ...MODIFIER_CONTEXT,
    activatorEvent: new MouseEvent("mousedown", {
      clientX: pointerDown.x,
      clientY: pointerDown.y,
    }),
    activeNodeRect,
    draggingNodeRect,
    transform: { ...transform, scaleX: 1, scaleY: 1 },
  });
  return {
    x: ROW_RECT.left + result.x + draggingNodeRect.width / 2,
    y: ROW_RECT.top + result.y + draggingNodeRect.height / 2,
  };
}

describe("sidebar thread drag chip", () => {
  it("centers the chip on the pointer", () => {
    const modifier = createSnapSidebarThreadDragChipToCursor();
    const pointerDown = { x: 130, y: 22 };
    const transform = { x: 15, y: 30 };

    expect(
      chipCenterFor(modifier, {
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
    const modifier = createSnapSidebarThreadDragChipToCursor();
    const pointerDown = { x: 130, y: 22 };
    const transform = { x: 25, y: 300 };
    const measuredWhileDragging = rect(
      ROW_RECT.left + transform.x,
      ROW_RECT.top + transform.y,
      CHIP_WIDTH,
      CHIP_HEIGHT,
    );

    expect(
      chipCenterFor(modifier, {
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
    const modifier = createSnapSidebarThreadDragChipToCursor();
    const pointerDown = { x: 130, y: 22 };
    const draggingNodeRect = rect(
      ROW_RECT.left,
      ROW_RECT.top,
      CHIP_WIDTH,
      CHIP_HEIGHT,
    );
    chipCenterFor(modifier, {
      transform: { x: 0, y: 0 },
      draggingNodeRect,
      pointerDown,
    });

    const transform = { x: 4, y: 120 };
    expect(
      chipCenterFor(modifier, {
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
    const modifier = createSnapSidebarThreadDragChipToCursor();
    const draggingNodeRect = rect(
      ROW_RECT.left,
      ROW_RECT.top,
      CHIP_WIDTH,
      CHIP_HEIGHT,
    );
    chipCenterFor(modifier, {
      transform: { x: 0, y: 0 },
      draggingNodeRect,
      pointerDown: { x: 130, y: 22 },
    });

    const idleTransform = { x: 9, y: 9, scaleX: 1, scaleY: 1 };
    expect(
      modifier({
        ...MODIFIER_CONTEXT,
        active: null,
        activatorEvent: null,
        activeNodeRect: null,
        draggingNodeRect: null,
        transform: idleTransform,
      }),
    ).toBe(idleTransform);

    const secondRow = rect(8, 200, 244, 28);
    const pointerDown = { x: 140, y: 214 };
    const transform = { x: 12, y: 40 };
    const result = modifier({
      ...MODIFIER_CONTEXT,
      activatorEvent: new MouseEvent("mousedown", {
        clientX: pointerDown.x,
        clientY: pointerDown.y,
      }),
      activeNodeRect: secondRow,
      draggingNodeRect: rect(
        secondRow.left,
        secondRow.top,
        CHIP_WIDTH,
        CHIP_HEIGHT,
      ),
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
    const modifier = createSnapSidebarThreadDragChipToCursor();
    const transform = { x: 15, y: 30, scaleX: 1, scaleY: 1 };
    const result = modifier({
      ...MODIFIER_CONTEXT,
      activatorEvent: new KeyboardEvent("keydown", { key: " " }),
      activeNodeRect: ROW_RECT,
      draggingNodeRect: rect(
        ROW_RECT.left,
        ROW_RECT.top,
        CHIP_WIDTH,
        CHIP_HEIGHT,
      ),
      transform,
    });

    expect(result).toBe(transform);
  });
});
