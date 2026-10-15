import {
  MACOS_TRAFFIC_LIGHT_CLUSTER_WIDTH_PX,
  MACOS_TRAFFIC_LIGHT_INSET_PX,
  MACOS_TRAFFIC_LIGHT_SIZE_PX,
  MACOS_TRAFFIC_LIGHT_TOP_INSET_PX,
  RAIL_CONTROL_SIZE_PX,
  RAIL_PADDING_PX,
  SIDEBAR_FOOTER_CARD_GAP_PX,
  TITLE_BAR_CONTROL_SIZE_PX,
  TITLE_BAR_SIDEBAR_TOGGLE_GAP_PX,
  TITLE_BAR_TRAILING_CONTROL_CENTER_INSET_PX,
  WINDOW_CARD_RADIUS_PX,
  WINDOW_FRAME_LIP_PX,
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
  "w-(--bb-title-bar-control-size) -mr-[calc(var(--bb-panel-chrome-padding)_-_var(--bb-title-bar-trailing-edge-gap)_+_var(--bb-window-frame-lip))]";
export const MACOS_TITLE_BAR_PINNED_TOGGLE_CLASS =
  "right-[calc(var(--bb-title-bar-trailing-edge-gap)_-_var(--bb-window-frame-lip))] [&_button]:w-(--bb-title-bar-control-size)";
export const MACOS_TITLE_BAR_CONTROL_SIZE_CLASS =
  "[&_button]:h-(--bb-title-bar-control-size) [&_[data-tab-pill]]:h-(--bb-title-bar-control-size)";
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
const CARD_BORDER_PX = 1;
const COLLAPSED_SIDEBAR_TRIGGER_GAP_PX = 8;
const TITLE_BAR_CONTROL_COUNT = 3;
const PAGE_HEADER_BASE_INSET_PX = 16;

function getWindowCardMask(
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

export function applyAppFrameGeometry(
  root: StyleTarget,
  desktopInfo: BbDesktopInfoResult,
): void {
  const properties: Record<string, string> = {
    "--bb-frame-rail-padding": `${RAIL_PADDING_PX}px`,
    "--bb-frame-rail-control-size": `${RAIL_CONTROL_SIZE_PX}px`,
    "--bb-frame-window-lip": `${WINDOW_FRAME_LIP_PX}px`,
    "--bb-frame-card-radius": `${WINDOW_CARD_RADIUS_PX}px`,
    "--bb-frame-footer-inset": `${SIDEBAR_FOOTER_CARD_GAP_PX - CARD_BORDER_PX}px`,
    "--bb-title-bar-control-size": `${TITLE_BAR_CONTROL_SIZE_PX}px`,
    "--bb-title-bar-sidebar-toggle-gap": `${TITLE_BAR_SIDEBAR_TOGGLE_GAP_PX}px`,
    "--bb-title-bar-trailing-edge-gap": `${TITLE_BAR_TRAILING_CONTROL_CENTER_INSET_PX - TITLE_BAR_CONTROL_SIZE_PX / 2 - CARD_BORDER_PX}px`,
  };
  if (shouldUseMacosDesktopChrome(desktopInfo)) {
    const inset =
      desktopInfo?.macosTrafficLightInset ?? MACOS_TRAFFIC_LIGHT_INSET_PX;
    const centerY =
      (desktopInfo?.macosTrafficLightTopInset ??
        MACOS_TRAFFIC_LIGHT_TOP_INSET_PX) +
      MACOS_TRAFFIC_LIGHT_SIZE_PX / 2;
    const titleBarHeight = 2 * centerY;
    const reserve =
      inset +
      MACOS_TRAFFIC_LIGHT_CLUSTER_WIDTH_PX +
      MACOS_TRAFFIC_LIGHT_CLEARANCE_PX;
    Object.assign(properties, {
      "--bb-macos-traffic-light-center-y": `${centerY}px`,
      "--bb-window-title-bar-height": `${titleBarHeight}px`,
      "--bb-window-card-mask": getWindowCardMask(titleBarHeight, false),
      "--bb-window-card-mask-square-left": getWindowCardMask(
        titleBarHeight,
        true,
      ),
      "--bb-macos-traffic-light-reserve": `${reserve}px`,
      "--bb-window-title-bar-controls-end": `${reserve + TITLE_BAR_CONTROL_COUNT * TITLE_BAR_CONTROL_SIZE_PX + TITLE_BAR_SIDEBAR_TOGGLE_GAP_PX}px`,
      "--bb-macos-collapsed-top-left-reserve": `${reserve + TITLE_BAR_CONTROL_SIZE_PX + COLLAPSED_SIDEBAR_TRIGGER_GAP_PX - PAGE_HEADER_BASE_INSET_PX}px`,
    });
  }
  for (const [name, value] of Object.entries(properties)) {
    root.style.setProperty(name, value);
  }
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
