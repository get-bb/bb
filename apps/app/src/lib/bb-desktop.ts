import {
  MACOS_LEGACY_TRAFFIC_LIGHT_INSET_PX,
  MACOS_TRAFFIC_LIGHT_CLUSTER_WIDTH_PX,
  MACOS_TRAFFIC_LIGHT_SIZE_PX,
  type BbDesktopApi,
  type BbDesktopBrowserApi,
  type BbDesktopWindowState,
} from "@bb/desktop-contract";

export const MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS =
  "left-(--bb-macos-traffic-light-reserve)";
export const MACOS_TRAFFIC_LIGHT_RESERVE_PADDING_CLASS =
  "pl-(--bb-macos-traffic-light-reserve)";
export const MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS =
  "pl-(--bb-macos-collapsed-top-left-reserve)";

export const BROWSER_SIDEBAR_TRIGGER_INSET_CLASS =
  "pl-[calc(var(--bb-sidebar-rail-padding)-2px)] max-md:pointer-coarse:pl-(--bb-sidebar-rail-padding)";
export const BROWSER_COLLAPSED_HEADER_RESERVE_CLASS =
  "pl-[32px] max-md:pointer-coarse:pl-[40px]";
export const MACOS_WINDOW_DRAG_CLASS =
  "select-none [app-region:drag] [-webkit-app-region:drag]";
export const MACOS_APP_REGION_NO_DRAG_CLASS =
  "[app-region:no-drag] [-webkit-app-region:no-drag]";
export const MACOS_WINDOW_NO_DRAG_CLASS = `relative z-50 ${MACOS_APP_REGION_NO_DRAG_CLASS}`;

export const CHROME_ROW_HEIGHT_CLASS = "h-(--bb-app-chrome-row-height)";
export const CHROME_ROW_CLASS = `flex ${CHROME_ROW_HEIGHT_CLASS} items-center`;

export const MACOS_CHROME_CONTROL_AXIS_CLASS =
  "[transform:translateY(var(--bb-macos-chrome-control-y,calc(var(--bb-macos-traffic-light-center-y)_-_var(--bb-app-chrome-row-height)/2)))]";
export const MACOS_TITLE_BAR_ROW_CLASS = "h-(--bb-window-title-bar-height)";
export const MACOS_TITLE_BAR_TRAILING_TOGGLE_CLASS =
  "w-7 -mr-(--bb-panel-chrome-padding) [&_[data-icon-root]]:translate-x-0.5";
export const MACOS_TITLE_BAR_CONTROL_SIZE_CLASS =
  "[&_button]:h-7 [&_[data-tab-pill]]:h-7";
export const MACOS_TITLE_BAR_BAND_CLASS = `${MACOS_TITLE_BAR_ROW_CLASS} box-content pb-px`;
export const MACOS_TITLE_BAR_COLLAPSED_SIDEBAR_RESERVE_CLASS =
  "pl-[calc(var(--bb-window-title-bar-controls-end)_+_12px_-_var(--bb-sidebar-control-size)_-_2*var(--bb-sidebar-rail-padding)_-_1px_-_1rem)]";
export const MACOS_TITLE_BAR_CONTROL_AXIS_CLASS =
  "[--bb-macos-chrome-control-y:calc(var(--bb-macos-traffic-light-center-y)_-_var(--bb-window-title-bar-height)/2)]";
export const MACOS_CHROME_CONTROL_NO_DRAG_CLASS = `${MACOS_WINDOW_NO_DRAG_CLASS} ${MACOS_CHROME_CONTROL_AXIS_CLASS}`;

type BbDesktopInfoResult = BbDesktopApi | null;
export const DEFAULT_DESKTOP_WINDOW_STATE: BbDesktopWindowState = {
  isFullScreen: false,
};

export function getBbDesktopInfo(): BbDesktopInfoResult {
  if (typeof window === "undefined") {
    return null;
  }
  return window.bbDesktop ?? null;
}

export function shouldUseMacosDesktopChrome(
  desktopInfo: BbDesktopInfoResult,
): boolean {
  return desktopInfo?.platform === "macos";
}

export function shouldReserveMacosTrafficLights({
  desktopInfo,
  windowState,
}: {
  desktopInfo: BbDesktopInfoResult;
  windowState: BbDesktopWindowState;
}): boolean {
  return shouldUseMacosDesktopChrome(desktopInfo) && !windowState.isFullScreen;
}

const MACOS_TRAFFIC_LIGHT_CLEARANCE_PX = 12;
const WINDOW_CARD_RADIUS_PX = 12;
const MACOS_CHROME_CONTROL_SIZE_PX = 28;
const COLLAPSED_SIDEBAR_TRIGGER_GAP_PX = 8;
const TITLE_BAR_CONTROL_COUNT = 3;
const TITLE_BAR_CONTROL_GAP_PX = 4;
const PAGE_HEADER_BASE_INSET_PX = 16;

export interface MacosWindowChromeGeometry {
  trafficLightCenterY: number;
  titleBarHeight: number;
  trafficLightReserve: number;
  titleBarControlsEnd: number;
  collapsedTopLeftReserve: number;
}

export function getMacosWindowChromeGeometry(
  desktopInfo: BbDesktopInfoResult,
): MacosWindowChromeGeometry {
  const inset =
    desktopInfo?.macosTrafficLightInset ?? MACOS_LEGACY_TRAFFIC_LIGHT_INSET_PX;
  const topInset = desktopInfo?.macosTrafficLightTopInset ?? inset;
  const trafficLightCenterY = topInset + MACOS_TRAFFIC_LIGHT_SIZE_PX / 2;
  const trafficLightReserve =
    inset +
    MACOS_TRAFFIC_LIGHT_CLUSTER_WIDTH_PX +
    MACOS_TRAFFIC_LIGHT_CLEARANCE_PX;
  return {
    trafficLightCenterY,
    titleBarHeight: 2 * trafficLightCenterY,
    trafficLightReserve,
    titleBarControlsEnd:
      trafficLightReserve +
      TITLE_BAR_CONTROL_COUNT * MACOS_CHROME_CONTROL_SIZE_PX +
      (TITLE_BAR_CONTROL_COUNT - 1) * TITLE_BAR_CONTROL_GAP_PX,
    collapsedTopLeftReserve:
      trafficLightReserve +
      MACOS_CHROME_CONTROL_SIZE_PX +
      COLLAPSED_SIDEBAR_TRIGGER_GAP_PX -
      PAGE_HEADER_BASE_INSET_PX,
  };
}

export function getWindowCardMask(
  titleBarHeight: number,
  squareTopLeft: boolean,
): string {
  const corner = squareTopLeft
    ? `<rect y='${titleBarHeight}' width='${WINDOW_CARD_RADIUS_PX}' height='${WINDOW_CARD_RADIUS_PX}'/>`
    : "";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='100%' height='100%'><rect width='100%' height='${titleBarHeight}'/><rect y='${titleBarHeight}' width='100%' height='100%' rx='${WINDOW_CARD_RADIUS_PX}'/>${corner}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

interface StyleTarget {
  style: Pick<CSSStyleDeclaration, "setProperty">;
}

export function applyMacosWindowChromeGeometry(
  root: StyleTarget,
  desktopInfo: BbDesktopInfoResult,
): void {
  if (!shouldUseMacosDesktopChrome(desktopInfo)) return;
  const geometry = getMacosWindowChromeGeometry(desktopInfo);
  root.style.setProperty(
    "--bb-macos-traffic-light-center-y",
    `${geometry.trafficLightCenterY}px`,
  );
  root.style.setProperty(
    "--bb-window-title-bar-height",
    `${geometry.titleBarHeight}px`,
  );
  root.style.setProperty(
    "--bb-window-card-mask",
    getWindowCardMask(geometry.titleBarHeight, false),
  );
  root.style.setProperty(
    "--bb-window-card-mask-square-left",
    getWindowCardMask(geometry.titleBarHeight, true),
  );
  root.style.setProperty(
    "--bb-macos-traffic-light-reserve",
    `${geometry.trafficLightReserve}px`,
  );
  root.style.setProperty(
    "--bb-window-title-bar-controls-end",
    `${geometry.titleBarControlsEnd}px`,
  );
  root.style.setProperty(
    "--bb-macos-collapsed-top-left-reserve",
    `${geometry.collapsedTopLeftReserve}px`,
  );
}

export const DEFAULT_WINDOW_FIND_TOP_OFFSET = 48;

export function readWindowFindTopOffset(): number {
  if (typeof window === "undefined") {
    return DEFAULT_WINDOW_FIND_TOP_OFFSET;
  }
  const rootStyle = window.getComputedStyle(document.documentElement);
  return resolveWindowFindTopOffset(
    rootStyle.getPropertyValue("--bb-app-chrome-row-height"),
    rootStyle.fontSize,
  );
}

export function resolveWindowFindTopOffset(
  chromeRowHeight: string,
  rootFontSize: string,
): number {
  const declared = chromeRowHeight.trim();
  const value = Number.parseFloat(declared);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_WINDOW_FIND_TOP_OFFSET;
  }
  if (declared.endsWith("rem")) {
    const fontSize = Number.parseFloat(rootFontSize);
    return Math.round(value * (Number.isFinite(fontSize) ? fontSize : 16));
  }
  if (declared.endsWith("px")) {
    return Math.round(value);
  }
  return DEFAULT_WINDOW_FIND_TOP_OFFSET;
}

export function getDesktopBrowserApi(): BbDesktopBrowserApi | null {
  return getBbDesktopInfo()?.browser ?? null;
}

export function isDesktopBrowserAvailable(): boolean {
  return getDesktopBrowserApi() !== null;
}
