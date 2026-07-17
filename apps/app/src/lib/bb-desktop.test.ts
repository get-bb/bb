import { describe, expect, it } from "vitest";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import {
  MACOS_COLLAPSED_HEADER_RESERVE_CLASS,
  MACOS_COLLAPSED_PANEL_TRAFFIC_LIGHT_RESERVE_CLASS,
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

  // The traffic-light reserves are paired px geometry, not typography. Both the
  // page header and the collapsed split-workspace panel must land their leading
  // content at the SAME absolute x (just right of the pinned sidebar trigger)
  // despite starting from different base insets — the header from its `px-4`
  // (16px) and the panel from behind the 36px conversation rail plus its own
  // `px-4` (52px). A silent drift here reintroduces BB-46's overlap, so lock the
  // shared target.
  it("lands both collapsed reserves at the same traffic-light-clearing target", () => {
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

    const HEADER_BASE_INSET = 16; // header px-4
    const RAIL_WIDTH = 36; // ConversationCollapsedRail (w-9)
    const PANEL_BASE_INSET = RAIL_WIDTH + 16; // rail + panel top-chrome px-4

    expect(HEADER_BASE_INSET + px(MACOS_COLLAPSED_HEADER_RESERVE_CLASS)).toBe(
      TARGET,
    );
    expect(
      PANEL_BASE_INSET + px(MACOS_COLLAPSED_PANEL_TRAFFIC_LIGHT_RESERVE_CLASS),
    ).toBe(TARGET);
  });
});
