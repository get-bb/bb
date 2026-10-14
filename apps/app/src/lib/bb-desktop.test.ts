import { describe, expect, it } from "vitest";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import {
  DEFAULT_WINDOW_FIND_TOP_OFFSET,
  MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_PADDING_CLASS,
  resolveWindowFindTopOffset,
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

  it("starts the framed title bar controls where the lone trigger sits", () => {
    expect(px(MACOS_TRAFFIC_LIGHT_RESERVE_PADDING_CLASS)).toBe(
      px(MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS),
    );
  });
});

describe("resolveWindowFindTopOffset", () => {
  it.each([
    { chromeRowHeight: "3rem", rootFontSize: "20px", expected: 60 },
    {
      chromeRowHeight: "",
      rootFontSize: "16px",
      expected: DEFAULT_WINDOW_FIND_TOP_OFFSET,
    },
    {
      chromeRowHeight: "4vh",
      rootFontSize: "16px",
      expected: DEFAULT_WINDOW_FIND_TOP_OFFSET,
    },
  ])(
    "resolves $chromeRowHeight against a $rootFontSize root to $expected",
    ({ chromeRowHeight, rootFontSize, expected }) => {
      expect(resolveWindowFindTopOffset(chromeRowHeight, rootFontSize)).toBe(
        expected,
      );
    },
  );
});
