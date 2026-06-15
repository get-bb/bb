import type {
  BbDesktopApi,
  BbDesktopBrowserApi,
  BbDesktopPopoutApi,
} from "@bb/server-contract";

// The macOS traffic-light cluster sits in a fixed strip on the left of the
// frameless window. In-flow chrome clears it with left padding; the pinned
// sidebar trigger clears it with a matching left offset. Keep the `pl-*` and
// `left-*` steps in sync so the trigger lands just right of the lights.
//
// Two reserve steps, one target — the leading content lands just right of the
// pinned sidebar trigger (`left-20`), not merely past the lights:
//  - RESERVE (`pl-20`): the full reserve, applied directly by a surface whose
//    left padding replaces its base inset. The secondary-panel header uses it —
//    it sits right of the 36px conversation rail, so the trigger overhangs the
//    header's left edge and the leading tab has to clear the trigger, not just
//    the lights.
//  - COLLAPSED_HEADER_RESERVE (`pl-25` = 100px): the page header folds the
//    whole pinned-trigger footprint into a single left padding: the `pl-20`
//    clear-the-lights step less the header's own `px-4` (80 − 16 = 64) lands at
//    the trigger's left edge, plus the trigger's own width (`w-7`, 28px) and the
//    `gap-2` after it (8px) = 100px, so the leading content sits just right of
//    the trigger. It is one padding rather than padding + a spacer element so it
//    can transition in lockstep with the sidebar slide — otherwise it snaps on
//    and off instantly while the inset animates and the header jumps on toggle.
export const MACOS_TRAFFIC_LIGHT_RESERVE_CLASS = "pl-20";
export const MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS = "left-20";
export const MACOS_COLLAPSED_HEADER_RESERVE_CLASS = "pl-25";

// Browser-chrome analogs of the macOS reserve above. The web build has no
// traffic lights, so it pins the sidebar toggle flush at the app's top-left with
// a small inset (see AppLayout's SidebarTriggerOverlay), and the collapsed page
// header reserves that footprint as left padding so its content clears the
// pinned toggle — the same trick as macOS, just smaller. Keep the inset and the
// reserve in sync: `pl-8` (32px) on top of the header's own `px-4` (16px) sums to
// 48px, which clears the 12px inset + the 28px trigger + an 8px gap;
// `max-md:pointer-coarse:pl-10` (40px) covers the larger 36px touch trigger.
export const BROWSER_SIDEBAR_TRIGGER_INSET_CLASS = "pl-3";
export const BROWSER_COLLAPSED_HEADER_RESERVE_CLASS =
  "pl-8 max-md:pointer-coarse:pl-10";
export const MACOS_WINDOW_DRAG_CLASS =
  "select-none [app-region:drag] [-webkit-app-region:drag]";
export const MACOS_APP_REGION_NO_DRAG_CLASS =
  "[app-region:no-drag] [-webkit-app-region:no-drag]";
export const MACOS_WINDOW_NO_DRAG_CLASS = `relative z-50 ${MACOS_APP_REGION_NO_DRAG_CLASS}`;

// Single source of truth for the top chrome row — the titlebar axis shared by
// the macOS traffic lights, the pinned sidebar collapse trigger, and the
// sidebar's route-history arrows. The native traffic-light inset
// (`MACOS_TRAFFIC_LIGHT_DIAGONAL_INSET` in apps/desktop's window factory) is
// tuned to vertically center the lights within this height and to sit on the
// sidebar icon column's left rail. Electron main and the renderer are separate
// bundles, so they cannot share one runtime value — keep this height and that
// inset in sync as a paired geometry contract.
export const CHROME_ROW_HEIGHT_CLASS = "h-12";
// Base layout for an in-flow chrome row: the shared height, laid out as a flex
// row and vertically centered so its contents share the titlebar axis.
export const CHROME_ROW_CLASS = `flex ${CHROME_ROW_HEIGHT_CLASS} items-center`;

// macOS renders the traffic-light cluster ~2 CSS px BELOW the chrome row's
// geometric center: a native window screenshot (Retina 2x) measures the light
// centers at y≈51.5 device px (≈25.8 CSS) while the renderer chrome box-centers
// at 24. Box-centering alone (CDP y=24) therefore looks ~2 px high next to the
// native lights. This nudges the top-of-window chrome down onto the lights'
// axis. It is the single knob for the collapse trigger, the route-history
// arrows, and the page/thread header content, and is applied ONLY under macOS
// desktop chrome — the web build has no traffic lights and stays row-centered.
// 2 CSS px = 4 device px at 2x, so the shift stays crisp (no sub-pixel blur).
export const MACOS_CHROME_TRAFFIC_LIGHT_AXIS_NUDGE_CLASS =
  "[transform:translateY(2px)]";

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

export function getDesktopPopoutApi(): BbDesktopPopoutApi | null {
  return getBbDesktopInfo()?.popout ?? null;
}

export function isDesktopPopoutAvailable(): boolean {
  return getDesktopPopoutApi() !== null;
}
