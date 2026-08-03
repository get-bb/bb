import { describe, expect, it } from "vitest";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import {
  MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS,
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

  // The traffic-light reserve is px geometry, not typography. Both the page
  // header and the collapsed split-workspace panel land their leading content
  // at the same absolute x (just right of the pinned sidebar trigger) from the
  // same `px-4` base inset. A silent drift here reintroduces BB-46's overlap,
  // so lock the target.
  it("lands the collapsed reserve at the traffic-light-clearing target", () => {
    const px = (className: string): number => {
      const match = /\[(\d+)px\]/.exec(className);
      if (match === null) {
        throw new Error(`no px token in "${className}"`);
      }
      return Number(match[1]);
    };

    const TRIGGER_OFFSET = px(MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS); // 84
    const TRIGGER_BUTTON = 28;
    const TRIGGER_GAP = 8;
    // Where the pinned sidebar trigger ends: leading content must clear it.
    const TARGET = TRIGGER_OFFSET + TRIGGER_BUTTON + TRIGGER_GAP; // 120

    // Both surfaces are flush at the window top-left and inset their content
    // with `px-4`: the page header content row and the collapsed
    // split-workspace panel's top chrome.
    const BASE_INSET = 16;

    expect(BASE_INSET + px(MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS)).toBe(
      TARGET,
    );
  });
});
