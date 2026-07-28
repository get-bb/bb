import { defaultDropAnimation } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";
import { SIDEBAR_DRAG_OVERLAY_DROP_ANIMATION } from "./sortableMotion";

describe("SIDEBAR_DRAG_OVERLAY_DROP_ANIMATION", () => {
  // Sidebar rows dim their drag source through a React-owned inline opacity, so
  // dnd-kit must not capture and restore that property from its drop-animation
  // finish callback: a restore that lands after the drop settles re-applies the
  // dim value as a raw DOM write React can no longer diff away, leaving the row
  // greyed out for good. dnd-kit merges caller options over its defaults, so an
  // omitted `sideEffects` silently reinstates the mutating default.
  it("cancels dnd-kit's opacity-mutating drop side effect", () => {
    expect(defaultDropAnimation.sideEffects).toBeTypeOf("function");

    const effectiveConfig = {
      ...defaultDropAnimation,
      ...SIDEBAR_DRAG_OVERLAY_DROP_ANIMATION,
    };

    expect(effectiveConfig.sideEffects).toBeNull();
  });
});
