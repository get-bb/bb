import { describe, expect, it } from "vitest";
import {
  MACOS_LEGACY_TRAFFIC_LIGHT_INSET_PX,
  MACOS_TRAFFIC_LIGHT_CLUSTER_WIDTH_PX,
  MACOS_TRAFFIC_LIGHT_INSET_PX,
  MACOS_TRAFFIC_LIGHT_SIZE_PX,
  MACOS_TRAFFIC_LIGHT_TOP_INSET_PX,
  type BbDesktopInfo,
} from "@bb/desktop-contract";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import {
  DEFAULT_WINDOW_FIND_TOP_OFFSET,
  applyMacosWindowChromeGeometry,
  getMacosWindowChromeGeometry,
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

  it.each([
    {
      name: "current desktop",
      inset: MACOS_TRAFFIC_LIGHT_INSET_PX,
      topInset: MACOS_TRAFFIC_LIGHT_TOP_INSET_PX,
    },
    { name: "older desktop", inset: undefined, topInset: undefined },
  ])(
    "keeps $name chrome clear of and centered on the traffic lights",
    ({ inset, topInset }) => {
      const reportedInset = inset ?? MACOS_LEGACY_TRAFFIC_LIGHT_INSET_PX;
      const reportedTopInset = topInset ?? reportedInset;
      const geometry = getMacosWindowChromeGeometry({
        ...macosDesktopApi,
        macosTrafficLightInset: inset,
        macosTrafficLightTopInset: topInset,
      });
      const CONTROL_SIZE = 28;
      const TRAFFIC_LIGHT_CLEARANCE = 12;
      const COLLAPSED_TRIGGER_GAP = 8;
      const PAGE_HEADER_BASE_INSET = 16;

      expect(geometry.trafficLightCenterY).toBe(
        reportedTopInset + MACOS_TRAFFIC_LIGHT_SIZE_PX / 2,
      );
      expect(geometry.titleBarHeight).toBe(2 * geometry.trafficLightCenterY);
      expect(geometry.trafficLightCenterY + CONTROL_SIZE / 2).toBeLessThan(
        geometry.titleBarHeight,
      );
      expect(geometry.trafficLightReserve).toBe(
        reportedInset +
          MACOS_TRAFFIC_LIGHT_CLUSTER_WIDTH_PX +
          TRAFFIC_LIGHT_CLEARANCE,
      );
      expect(PAGE_HEADER_BASE_INSET + geometry.collapsedTopLeftReserve).toBe(
        geometry.trafficLightReserve + CONTROL_SIZE + COLLAPSED_TRIGGER_GAP,
      );
    },
  );

  it("puts the close button above the rail icons on the current desktop", () => {
    const RAIL_PADDING = 11;
    const RAIL_CONTROL_SIZE = 24;

    expect(MACOS_TRAFFIC_LIGHT_INSET_PX + MACOS_TRAFFIC_LIGHT_SIZE_PX / 2).toBe(
      RAIL_PADDING + RAIL_CONTROL_SIZE / 2,
    );
  });

  it("applies the reported geometry to the document root", () => {
    const properties = new Map<string, string>();
    const root = {
      style: {
        setProperty: (name: string, value: string) =>
          properties.set(name, value),
      },
    };

    applyMacosWindowChromeGeometry(root, {
      ...macosDesktopApi,
      macosTrafficLightInset: MACOS_TRAFFIC_LIGHT_INSET_PX,
      macosTrafficLightTopInset: MACOS_TRAFFIC_LIGHT_TOP_INSET_PX,
    });
    expect(properties.get("--bb-window-title-bar-height")).toBe("44px");
    const cardMask = decodeURIComponent(
      properties.get("--bb-window-card-mask") ?? "",
    );
    expect(cardMask).toContain("<rect width='100%' height='44'/>");
    expect(cardMask).toContain(
      "<rect y='44' width='100%' height='100%' rx='12'/>",
    );
    expect(
      decodeURIComponent(
        properties.get("--bb-window-card-mask-square-left") ?? "",
      ),
    ).toContain("<rect y='44' width='12' height='12'/>");
    expect(properties.get("--bb-macos-traffic-light-reserve")).toBe("88px");

    properties.clear();
    applyMacosWindowChromeGeometry(root, null);
    expect(properties.size).toBe(0);
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
