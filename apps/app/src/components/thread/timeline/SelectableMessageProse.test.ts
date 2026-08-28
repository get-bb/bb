// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  isSelectionWithinNode,
  selectionAnchorFromPointerRelease,
} from "./SelectableMessageProse.js";

function makeProse() {
  const node = document.createElement("div");
  const inside = document.createElement("span");
  const alsoInside = document.createElement("span");
  node.append(inside, alsoInside);
  return { node, inside, alsoInside, outside: document.createElement("span") };
}

describe("isSelectionWithinNode", () => {
  it("rejects a collapsed selection", () => {
    const { node, inside } = makeProse();
    expect(
      isSelectionWithinNode(node, {
        isCollapsed: true,
        anchorNode: inside,
        focusNode: inside,
        commonAncestorContainer: inside,
      }),
    ).toBe(false);
  });

  it("rejects a selection with an endpoint outside the node", () => {
    const { node, inside, outside } = makeProse();
    expect(
      isSelectionWithinNode(node, {
        isCollapsed: false,
        anchorNode: inside,
        focusNode: outside,
        commonAncestorContainer: outside,
      }),
    ).toBe(false);
  });

  it("accepts an in-bounds non-empty selection", () => {
    const { node, inside, alsoInside } = makeProse();
    expect(
      isSelectionWithinNode(node, {
        isCollapsed: false,
        anchorNode: inside,
        focusNode: alsoInside,
        commonAncestorContainer: node,
      }),
    ).toBe(true);
  });

  it("rejects a null node or null selection", () => {
    expect(isSelectionWithinNode(null, null)).toBe(false);
  });
});

describe("selectionAnchorFromPointerRelease", () => {
  it("uses the live range instead of a stale touch release point", () => {
    expect(
      selectionAnchorFromPointerRelease(
        { x: 10, y: 20 },
        { clientX: 30, clientY: 40, pointerType: "touch" },
      ),
    ).toBeNull();
  });

  it("keeps mouse release anchoring", () => {
    expect(
      selectionAnchorFromPointerRelease(
        { x: 10, y: 20 },
        { clientX: 30, clientY: 40, pointerType: "mouse" },
      ),
    ).toEqual({ point: { x: 30, y: 40 }, side: "bottom" });
  });
});
