import { describe, expect, it } from "vitest";
import {
  MACOS_TRAFFIC_LIGHT_INSET_PX,
  MACOS_TRAFFIC_LIGHT_TOP_INSET_PX,
  RAIL_PADDING_PX,
  WINDOW_CARD_RADIUS_PX,
  type BbDesktopInfo,
} from "@bb/desktop-contract";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import {
  DEFAULT_WINDOW_FIND_TOP_OFFSET,
  applyAppFrameGeometry,
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

const macosDesktopApi = createBbDesktopApi(desktopInfo);

function applyGeometry(
  desktopApi: Parameters<typeof applyAppFrameGeometry>[1],
): Map<string, string> {
  const properties = new Map<string, string>();
  applyAppFrameGeometry(
    {
      style: {
        setProperty: (name: string, value: string) =>
          properties.set(name, value),
      },
    },
    desktopApi,
  );
  return properties;
}

describe("desktop chrome geometry", () => {
  it("reserves macOS traffic-light space only when lights are visible", () => {
    expect(
      shouldReserveMacosTrafficLights({
        desktopInfo: macosDesktopApi,
        windowState: { isFullScreen: false },
      }),
    ).toBe(true);
    expect(
      shouldReserveMacosTrafficLights({
        desktopInfo: macosDesktopApi,
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

  it("sizes the title bar around the lights the desktop shell reports", () => {
    const properties = applyGeometry({
      ...macosDesktopApi,
      macosTrafficLightInset: 20,
      macosTrafficLightTopInset: 21,
    });

    expect(properties.get("--bb-macos-traffic-light-center-y")).toBe("28px");
    expect(properties.get("--bb-window-title-bar-height")).toBe("56px");
    expect(properties.get("--bb-window-footer-row-height")).toBe("38px");
    expect(properties.get("--bb-macos-traffic-light-reserve")).toBe("92px");
    expect(
      decodeURIComponent(properties.get("--bb-window-card-mask") ?? ""),
    ).toContain(
      `<rect y='56' width='100%' height='100%' rx='${WINDOW_CARD_RADIUS_PX}'/>`,
    );
  });

  it("assumes the current light position when the shell reports none", () => {
    const properties = applyGeometry(macosDesktopApi);

    expect(properties.get("--bb-window-title-bar-height")).toBe(
      `${2 * (MACOS_TRAFFIC_LIGHT_TOP_INSET_PX + 7)}px`,
    );
    expect(properties.get("--bb-macos-traffic-light-reserve")).toBe(
      `${MACOS_TRAFFIC_LIGHT_INSET_PX + 72}px`,
    );
  });

  it("writes the frame sizes everywhere but the title bar only on macOS", () => {
    const properties = applyGeometry(null);

    expect(properties.get("--bb-frame-rail-padding")).toBe(
      `${RAIL_PADDING_PX}px`,
    );
    expect(properties.has("--bb-window-title-bar-height")).toBe(false);
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
