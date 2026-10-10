import type {
  BbDesktopApi,
  BbDesktopBrowserApi,
  BbDesktopWindowState,
} from "@bb/desktop-contract";

export const MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS = "left-[84px]";
export const MACOS_TRAFFIC_LIGHT_RESERVE_PADDING_CLASS = "pl-[84px]";
export const MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS = "pl-[104px]";

export const BROWSER_SIDEBAR_TRIGGER_INSET_CLASS =
  "pl-(--bb-sidebar-rail-padding)";
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
  "[transform:translateY(var(--bb-macos-chrome-control-y,2px))]";
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
