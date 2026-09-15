// @vitest-environment jsdom

import type { Modifier } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";
import { snapSidebarThreadDragChipToCursor } from "./sidebarThreadDragChip";

type ModifierArgs = Parameters<Modifier>[0];

const MODIFIER_CONTEXT = {
  active: null,
  activeNodeRect: null,
  containerNodeRect: null,
  over: null,
  overlayNodeRect: null,
  scrollableAncestorRects: [],
  scrollableAncestors: [],
  windowRect: null,
} satisfies Omit<
  ModifierArgs,
  "activatorEvent" | "draggingNodeRect" | "transform"
>;

describe("sidebar thread drag chip", () => {
  it("centers the compact overlay on the pointer", () => {
    const transform = { x: 15, y: 30, scaleX: 1, scaleY: 1 };
    const draggingNodeRect = {
      bottom: 74,
      height: 24,
      left: 20,
      right: 120,
      top: 50,
      width: 100,
    };
    const result = snapSidebarThreadDragChipToCursor({
      ...MODIFIER_CONTEXT,
      activatorEvent: new MouseEvent("mousedown", {
        clientX: 260,
        clientY: 90,
      }),
      draggingNodeRect,
      transform,
    });

    expect(result).toEqual({ x: 205, y: 58, scaleX: 1, scaleY: 1 });
    expect(draggingNodeRect.left + result.x + draggingNodeRect.width / 2).toBe(
      275,
    );
    expect(draggingNodeRect.top + result.y + draggingNodeRect.height / 2).toBe(
      120,
    );
  });

  it("preserves keyboard positioning without pointer coordinates", () => {
    const transform = { x: 15, y: 30, scaleX: 1, scaleY: 1 };
    const result = snapSidebarThreadDragChipToCursor({
      ...MODIFIER_CONTEXT,
      activatorEvent: new KeyboardEvent("keydown", { key: " " }),
      draggingNodeRect: {
        bottom: 74,
        height: 24,
        left: 20,
        right: 120,
        top: 50,
        width: 100,
      },
      transform,
    });

    expect(result).toBe(transform);
  });
});
