import { describe, expect, it } from "vitest";
import {
  getTabStripChevronGradientClass,
  getTabStripChevronVisibilityClass,
  SECONDARY_PANEL_TAB_STRIP_FADE_TONE,
} from "./SecondaryPanelTabStrip";

describe("secondary panel tab-strip edge fades", () => {
  it("fades both edge layers into the themeable sidebar surface", () => {
    expect(SECONDARY_PANEL_TAB_STRIP_FADE_TONE).toBe("sidebar");
    expect(getTabStripChevronGradientClass("left")).toContain("to-sidebar");
    expect(getTabStripChevronGradientClass("right")).toContain("to-sidebar");
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
