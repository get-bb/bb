import { describe, expect, it } from "vitest";
import {
  getSecondaryPanelChromeStackClassName,
  getReservedInlinePanelToggleClassName,
  resolveCollapsedPanelTrafficLightReserveClassName,
  resolveSecondaryPanelHideControl,
} from "./ThreadSecondaryPanel";
import {
  CHROME_ROW_CLASS,
  CHROME_ROW_HEIGHT_CLASS,
  MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS,
} from "@/lib/bb-desktop";
import { SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS } from "./panelChromeClasses";

describe("secondary panel surface tone", () => {
  it("uses the same sidebar background token as the primary sidebar", () => {
    expect(SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS).toBe("bg-sidebar");
  });
});

describe("secondary panel hide control", () => {
  it("uses the existing collapse affordance in the compact drawer", () => {
    expect(resolveSecondaryPanelHideControl()).toEqual({
      iconName: "PanelRight",
      label: "Hide right panel",
    });
  });
});

describe("getSecondaryPanelChromeStackClassName", () => {
  it("reserves the combined navigation and active Diff toolbar height", () => {
    const className = getSecondaryPanelChromeStackClassName(true);

    expect(className).toContain("flex");
    expect(className).toContain("flex-col");
    expect(className).toContain("shrink-0");
    expect(className).not.toContain(CHROME_ROW_HEIGHT_CLASS);
    expect(CHROME_ROW_CLASS).toContain(CHROME_ROW_HEIGHT_CLASS);
  });
});

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

// BB-46: while the conversation is collapsed inside the split-workspace host and
// the main sidebar is collapsed, the panel is the window's flush top-left
// surface, so its leading toolbar shares the title-bar row with the macOS
// traffic lights and the pinned sidebar trigger. Without the reserve the
// leading Info/tab controls render under the lights and directly over the
// sidebar trigger (BB-46's collapsed-left / expanded-right conflict).
describe("resolveCollapsedPanelTrafficLightReserveClassName", () => {
  const base = {
    isConversationCollapsed: true,
    renderAsDrawer: false,
    isInSplitHost: true,
    isSidebarShowing: false as boolean | null,
    reserveMacosTrafficLights: true,
  };

  it("reserves the safe area for the collapsed-left / expanded-right split host case", () => {
    expect(resolveCollapsedPanelTrafficLightReserveClassName(base)).toBe(
      MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS,
    );
  });

  it("does not reserve when the main sidebar is showing (it hosts the lights)", () => {
    expect(
      resolveCollapsedPanelTrafficLightReserveClassName({
        ...base,
        isSidebarShowing: true,
      }),
    ).toBe(false);
  });

  it("does not reserve inline (non-host) thread detail, which keeps a header on the lights' row", () => {
    expect(
      resolveCollapsedPanelTrafficLightReserveClassName({
        ...base,
        isInSplitHost: false,
      }),
    ).toBe(false);
  });

  it("does not reserve when the conversation is expanded (panel sits on the right)", () => {
    expect(
      resolveCollapsedPanelTrafficLightReserveClassName({
        ...base,
        isConversationCollapsed: false,
      }),
    ).toBe(false);
  });

  it("does not reserve in the compact drawer layout", () => {
    expect(
      resolveCollapsedPanelTrafficLightReserveClassName({
        ...base,
        renderAsDrawer: true,
      }),
    ).toBe(false);
  });

  it("does not reserve off macOS chrome or in fullscreen (no visible lights)", () => {
    expect(
      resolveCollapsedPanelTrafficLightReserveClassName({
        ...base,
        reserveMacosTrafficLights: false,
      }),
    ).toBe(false);
  });

  it("treats an absent sidebar context (null) as showing, so it does not reserve", () => {
    expect(
      resolveCollapsedPanelTrafficLightReserveClassName({
        ...base,
        isSidebarShowing: null,
      }),
    ).toBe(false);
  });
});
