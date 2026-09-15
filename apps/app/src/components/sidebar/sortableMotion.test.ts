import { describe, expect, it } from "vitest";
import { SIDEBAR_DRAG_OVERLAY_DROP_ANIMATION } from "./sortableMotion";

describe("SIDEBAR_DRAG_OVERLAY_DROP_ANIMATION", () => {
  it("disables the overlay flight after a sidebar row is dropped", () => {
    expect(SIDEBAR_DRAG_OVERLAY_DROP_ANIMATION).toBeNull();
  });
});
