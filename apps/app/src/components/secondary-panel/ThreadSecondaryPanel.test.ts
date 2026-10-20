import { describe, expect, it } from "vitest";
import {
  getSecondaryPanelChromeStackClassName,
  resolveCollapsedPanelTrafficLightReserveClassName,
} from "./ThreadSecondaryPanel";
import {
  CHROME_ROW_HEIGHT_CLASS,
  MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS,
  MACOS_TITLE_BAR_COLLAPSED_SIDEBAR_RESERVE_CLASS,
} from "@/lib/bb-desktop";

describe("getSecondaryPanelChromeStackClassName", () => {
  it("reserves the combined navigation and active Diff toolbar height", () => {
    const className = getSecondaryPanelChromeStackClassName(true);

    expect(className).toContain("flex");
    expect(className).toContain("flex-col");
    expect(className).toContain("shrink-0");
    expect(className).not.toContain(CHROME_ROW_HEIGHT_CLASS);
  });
});

describe("resolveCollapsedPanelTrafficLightReserveClassName", () => {
  const base = {
    isConversationCollapsed: true,
    isPanelInFrame: false,
    renderAsDrawer: false,
    isSidebarShowing: false as boolean | null,
    sidebarKeepsCollapsedRail: false,
    reserveMacosTrafficLights: true,
  };

  it("reserves the safe area for the panel full-screen case", () => {
    expect(resolveCollapsedPanelTrafficLightReserveClassName(base)).toBe(
      MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS,
    );
  });

  it("does not reserve beside a collapsed nav rail, where the title bar hosts the lights", () => {
    expect(
      resolveCollapsedPanelTrafficLightReserveClassName({
        ...base,
        sidebarKeepsCollapsedRail: true,
      }),
    ).toBe(false);
  });

  it("clears the title bar controls when a full-width framed panel sits beside a collapsed rail", () => {
    expect(
      resolveCollapsedPanelTrafficLightReserveClassName({
        ...base,
        isPanelInFrame: true,
        sidebarKeepsCollapsedRail: true,
      }),
    ).toBe(MACOS_TITLE_BAR_COLLAPSED_SIDEBAR_RESERVE_CLASS);
    expect(
      resolveCollapsedPanelTrafficLightReserveClassName({
        ...base,
        isPanelInFrame: true,
        sidebarKeepsCollapsedRail: true,
        isSidebarShowing: true,
      }),
    ).toBe(false);
  });

  it("still clears the title bar controls in full screen, where the lights hide but the controls stay", () => {
    expect(
      resolveCollapsedPanelTrafficLightReserveClassName({
        ...base,
        isPanelInFrame: true,
        sidebarKeepsCollapsedRail: true,
        reserveMacosTrafficLights: false,
      }),
    ).toBe(MACOS_TITLE_BAR_COLLAPSED_SIDEBAR_RESERVE_CLASS);
  });

  it("does not reserve when the main sidebar is showing (it hosts the lights)", () => {
    expect(
      resolveCollapsedPanelTrafficLightReserveClassName({
        ...base,
        isSidebarShowing: true,
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

  it("reserves in the full-page compact drawer even when the underlying sidebar is showing", () => {
    expect(
      resolveCollapsedPanelTrafficLightReserveClassName({
        ...base,
        isConversationCollapsed: false,
        renderAsDrawer: true,
        isSidebarShowing: true,
      }),
    ).toBe(MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS);
  });

  it.each([false, true])(
    "does not reserve without visible lights (drawer=%s)",
    (renderAsDrawer) => {
      expect(
        resolveCollapsedPanelTrafficLightReserveClassName({
          ...base,
          renderAsDrawer,
          reserveMacosTrafficLights: false,
        }),
      ).toBe(false);
    },
  );

  it("treats an absent sidebar context (null) as showing, so it does not reserve", () => {
    expect(
      resolveCollapsedPanelTrafficLightReserveClassName({
        ...base,
        isSidebarShowing: null,
      }),
    ).toBe(false);
  });
});
