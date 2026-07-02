import { describe, expect, it } from "vitest";
import { getReservedInlinePanelToggleClassName } from "./ThreadSecondaryPanel";

// The reserved inline-toggle slot sits under root compose's pinned right-panel
// toggle. On macOS desktop the top chrome is an [app-region:drag] window-drag
// region; Electron resolves draggable regions in DOM order (later wins), so the
// slot, a descendant of the drag row, must re-declare itself no-drag to carve
// the toggle's footprint back out. Without it Electron swallows the toggle click
// as a window drag and the panel can be opened but never closed. The native
// region resolution can't run in jsdom, so this locks the class contract that
// drives it; before the fix the slot carried no app-region class and this failed.
describe("getReservedInlinePanelToggleClassName", () => {
  it("carves the slot out of the window-drag chrome row under macOS desktop chrome", () => {
    const className = getReservedInlinePanelToggleClassName(true);

    expect(className).toContain("[app-region:no-drag]");
    expect(className).toContain("[-webkit-app-region:no-drag]");
  });

  it("leaves the slot untouched off macOS desktop chrome", () => {
    const className = getReservedInlinePanelToggleClassName(false);

    expect(className).not.toContain("app-region");
  });
});
