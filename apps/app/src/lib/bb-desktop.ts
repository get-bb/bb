import type { BbDesktopApi } from "@bb/server-contract";

// The macOS traffic-light cluster sits in a fixed strip on the left of the
// frameless window. In-flow chrome clears it with left padding; the pinned
// sidebar trigger clears it with a matching left offset. Keep the `pl-*` and
// `left-*` steps in sync so the trigger lands just right of the lights.
export const MACOS_TRAFFIC_LIGHT_RESERVE_CLASS = "pl-20";
export const MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS = "left-20";
export const MACOS_COLLAPSED_HEADER_RESERVE_CLASS = "pl-16";
export const MACOS_WINDOW_DRAG_CLASS =
  "select-none [app-region:drag] [-webkit-app-region:drag]";
export const MACOS_APP_REGION_NO_DRAG_CLASS =
  "[app-region:no-drag] [-webkit-app-region:no-drag]";
export const MACOS_WINDOW_NO_DRAG_CLASS = `relative z-50 ${MACOS_APP_REGION_NO_DRAG_CLASS}`;
export const MACOS_SIDEBAR_TRIGGER_OFFSET_CLASS = "mt-px";

export type BbDesktopInfoResult = BbDesktopApi | null;

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
