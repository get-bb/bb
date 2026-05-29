import type { BbDesktopApi, BbDesktopBrowserApi } from "@bb/server-contract";

// The macOS traffic-light cluster sits in a fixed strip on the left of the
// frameless window. In-flow chrome clears it with left padding; the pinned
// sidebar trigger clears it with a matching left offset. Keep the `pl-*` and
// `left-*` steps in sync so the trigger lands just right of the lights.
export const MACOS_TRAFFIC_LIGHT_RESERVE_CLASS = "pl-20";
export const MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS = "left-20";
export const MACOS_COLLAPSED_HEADER_RESERVE_CLASS = "pl-16";
// Vertical sibling of the horizontal reserves above: drops content one
// header-row (48px) below the window top so the traffic-light cluster sits in
// the cleared space. Used when a surface — like the collapsed-conversation
// rail's chevron — is the top-left-most element with no header to absorb the
// lights above it. Implemented as a top margin (not padding) so it can be
// applied directly to a flex child without depending on box-model behavior of
// the underlying element (e.g. an SVG icon).
export const MACOS_TRAFFIC_LIGHT_RESERVE_TOP_CLASS = "mt-12";
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

/**
 * The desktop browser control surface, or `null` on the web build (where
 * `window.bbDesktop` is undefined). Also tolerates a desktop build whose
 * preload predates the browser surface. This is the single gate for the
 * desktop-only browser tab entry and the `WebContentsView` host.
 */
export function getDesktopBrowserApi(): BbDesktopBrowserApi | null {
  return getBbDesktopInfo()?.browser ?? null;
}

export function isDesktopBrowserAvailable(): boolean {
  return getDesktopBrowserApi() !== null;
}
