import { describe, expect, it } from "vitest";
import {
  getTabStripChevronEdgeClass,
  getTabStripChevronVisibilityClass,
  SECONDARY_PANEL_TAB_STRIP_FADE_TONE,
} from "./SecondaryPanelTabStrip";

describe("secondary panel tab-strip edge fades", () => {
  it("uses one opaque themed edge fade and no second caret gradient", () => {
    expect(SECONDARY_PANEL_TAB_STRIP_FADE_TONE).toBe("sidebar");
    expect(getTabStripChevronEdgeClass("left")).toBe(
      "left-0 justify-start",
    );
    expect(getTabStripChevronEdgeClass("right")).toBe(
      "right-0 justify-end",
    );
  });

  it("keeps an available scroll control visible without requiring hover", () => {
    const visibleClass = getTabStripChevronVisibilityClass(true);

    expect(visibleClass).toContain("pointer-events-auto");
    expect(visibleClass).toContain("opacity-100");
    expect(visibleClass).not.toContain("hover:");
    expect(getTabStripChevronVisibilityClass(false)).toBe(
      "pointer-events-none opacity-0",
    );
  });
});
