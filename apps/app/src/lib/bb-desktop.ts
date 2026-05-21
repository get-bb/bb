import type { BbDesktopInfo } from "@bb/server-contract";

export const MACOS_TRAFFIC_LIGHT_RESERVE_CLASS = "pl-20";
export const MACOS_COLLAPSED_HEADER_RESERVE_CLASS = "pl-16";
export const MACOS_WINDOW_DRAG_CLASS =
  "select-none [app-region:drag] [-webkit-app-region:drag]";
export const MACOS_WINDOW_NO_DRAG_CLASS =
  "relative z-50 [app-region:no-drag] [-webkit-app-region:no-drag]";
export const MACOS_SIDEBAR_TRIGGER_OFFSET_CLASS = "mt-0";

export type BbDesktopInfoResult = BbDesktopInfo | null;

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
