import { describe, expect, it } from "vitest";
import { CONTEXT_SELECTION_SURFACE_CLASS } from "@/components/ui/context-selection";
import {
  SIDEBAR_CONTROL_BUTTON_CLASS,
  SIDEBAR_ROW_OPEN_IN_SPLIT_STATE_CLASS,
  SIDEBAR_ROW_SELECTED_STATE_CLASS,
} from "./sidebarRowClasses";

describe("sidebar control buttons", () => {
  it("scales the icon with the coarse-pointer touch target", () => {
    // Must be a `[&_svg]` rule: a size class on the icon itself loses to the
    // Button base `[&_svg]:size-4` descendant rule.
    expect(SIDEBAR_CONTROL_BUTTON_CLASS).toContain(
      "max-md:pointer-coarse:[&_svg]:size-5",
    );
  });
});

describe("sidebar thread state styling", () => {
  it("uses the shared active-context surface", () => {
    expect(SIDEBAR_ROW_SELECTED_STATE_CLASS).toContain(
      CONTEXT_SELECTION_SURFACE_CLASS,
    );
    expect(CONTEXT_SELECTION_SURFACE_CLASS).toBe("bg-state-active");
  });

  it("marks the row for an opaque backing surface when it becomes sticky", () => {
    expect(SIDEBAR_ROW_SELECTED_STATE_CLASS).toContain(
      "bb-sidebar-selected-row",
    );
  });

  it("marks open-in-split rows for an opaque sidebar-resolved tint", () => {
    expect(SIDEBAR_ROW_OPEN_IN_SPLIT_STATE_CLASS).toBe(
      "bb-sidebar-open-in-split-row",
    );
  });
});
