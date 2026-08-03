import { describe, expect, it } from "vitest";
import { CONTEXT_SELECTION_SURFACE_CLASS } from "@/components/ui/context-selection";
import { SIDEBAR_ROW_SELECTED_STATE_CLASS } from "./sidebarRowClasses";

describe("sidebar selected thread styling", () => {
  it("uses the shared active-context surface", () => {
    expect(SIDEBAR_ROW_SELECTED_STATE_CLASS).toContain(
      CONTEXT_SELECTION_SURFACE_CLASS,
    );
    expect(CONTEXT_SELECTION_SURFACE_CLASS).toBe("bg-state-active");
  });
});
