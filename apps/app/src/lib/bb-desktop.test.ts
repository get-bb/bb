import { describe, expect, it } from "vitest";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import {
  MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS,
  MACOS_NAV_RAIL_SIDEBAR_TRIGGER_TOP_CLASS,
  MACOS_NAV_RAIL_TRAFFIC_LIGHT_ROW_HEIGHT_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS,
  shouldDockMacosSidebarTriggerBelowTrafficLights,
  shouldReserveMacosTrafficLights,
} from "./bb-desktop";

const desktopInfo: BbDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

const px = (className: string): number => {
  const match = /\[(\d+)px\]/.exec(className);
  if (match === null) {
    throw new Error(`no px token in "${className}"`);
  }
  return Number(match[1]);
};

describe("desktop chrome geometry", () => {
  it("reserves macOS traffic-light space only when lights are visible", () => {
    const desktopApi = createBbDesktopApi(desktopInfo);

    expect(
      shouldReserveMacosTrafficLights({
        desktopInfo: desktopApi,
        windowState: { isFullScreen: false },
      }),
    ).toBe(true);
    expect(
      shouldReserveMacosTrafficLights({
        desktopInfo: desktopApi,
        windowState: { isFullScreen: true },
      }),
    ).toBe(false);
    expect(
      shouldReserveMacosTrafficLights({
        desktopInfo: null,
        windowState: { isFullScreen: false },
      }),
    ).toBe(false);
  });

  it("lands the collapsed reserve at the traffic-light-clearing target", () => {
    const TRIGGER_OFFSET = px(MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS);
    const TRIGGER_BUTTON = 28;
    const TRIGGER_GAP = 8;
    const TARGET = TRIGGER_OFFSET + TRIGGER_BUTTON + TRIGGER_GAP;

    const BASE_INSET = 16;

    expect(BASE_INSET + px(MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS)).toBe(
      TARGET,
    );
  });

  it("docks the nav rail sidebar trigger under a row that clears the traffic lights", () => {
    const TRAFFIC_LIGHT_TOP = 18;
    const TRAFFIC_LIGHT_MAX_DIAMETER = 14;
    const ROW_HEIGHT = px(MACOS_NAV_RAIL_TRAFFIC_LIGHT_ROW_HEIGHT_CLASS);

    expect(px(MACOS_NAV_RAIL_SIDEBAR_TRIGGER_TOP_CLASS)).toBe(ROW_HEIGHT);
    expect(ROW_HEIGHT).toBeGreaterThanOrEqual(
      TRAFFIC_LIGHT_TOP + TRAFFIC_LIGHT_MAX_DIAMETER,
    );
  });

  it("docks the sidebar trigger below the traffic lights only beside an open nav rail", () => {
    const docked = {
      reserveMacosTrafficLights: true,
      navigationRail: true,
      isCompactViewport: false,
      isSidebarOpen: true,
    };

    expect(shouldDockMacosSidebarTriggerBelowTrafficLights(docked)).toBe(true);
    expect(
      shouldDockMacosSidebarTriggerBelowTrafficLights({
        ...docked,
        isSidebarOpen: false,
      }),
    ).toBe(false);
    expect(
      shouldDockMacosSidebarTriggerBelowTrafficLights({
        ...docked,
        navigationRail: false,
      }),
    ).toBe(false);
    expect(
      shouldDockMacosSidebarTriggerBelowTrafficLights({
        ...docked,
        isCompactViewport: true,
      }),
    ).toBe(false);
    expect(
      shouldDockMacosSidebarTriggerBelowTrafficLights({
        ...docked,
        reserveMacosTrafficLights: false,
      }),
    ).toBe(false);
  });
});
