/**
 * Pure layout geometry for the native server rail. The rail is a fixed-left
 * 52px strip; the SPA fills the remaining content area. Traffic lights shift
 * right by the rail width so they clear the strip (Electron 41 uses
 * setWindowButtonPosition; the constructor still accepts trafficLightPosition).
 */

export const DESKTOP_RAIL_WIDTH_PX = 52;
export const DESKTOP_RAIL_DRAG_HEIGHT_PX = 48;

/** Matches desktop-window-factory MACOS_TRAFFIC_LIGHT_DIAGONAL_INSET. */
export const DESKTOP_RAIL_TRAFFIC_LIGHT_BASE_INSET = 18;

export type DesktopWindowLayoutMode = "classic" | "rail";

export interface DesktopContentBounds {
  height: number;
  width: number;
}

export interface DesktopViewBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface DesktopRailLayoutBounds {
  rail: DesktopViewBounds;
  spa: DesktopViewBounds;
}

export interface DesktopTrafficLightPosition {
  x: number;
  y: number;
}

export const DESKTOP_RAIL_TRAFFIC_LIGHT_DEFAULT: DesktopTrafficLightPosition = {
  x: DESKTOP_RAIL_TRAFFIC_LIGHT_BASE_INSET,
  y: DESKTOP_RAIL_TRAFFIC_LIGHT_BASE_INSET,
};

export const DESKTOP_RAIL_TRAFFIC_LIGHT_WITH_RAIL: DesktopTrafficLightPosition = {
  x: DESKTOP_RAIL_TRAFFIC_LIGHT_BASE_INSET + DESKTOP_RAIL_WIDTH_PX,
  y: DESKTOP_RAIL_TRAFFIC_LIGHT_BASE_INSET,
};

/** Rail layout only when the registry has two or more servers. */
export function shouldUseRailLayout(serverCount: number): boolean {
  return serverCount >= 2;
}

export function trafficLightPositionForLayout(
  layoutMode: DesktopWindowLayoutMode,
): DesktopTrafficLightPosition {
  if (layoutMode === "rail") {
    return DESKTOP_RAIL_TRAFFIC_LIGHT_WITH_RAIL;
  }
  return DESKTOP_RAIL_TRAFFIC_LIGHT_DEFAULT;
}

export function computeRailLayoutBounds(
  content: DesktopContentBounds,
): DesktopRailLayoutBounds {
  const width = Math.max(0, content.width);
  const height = Math.max(0, content.height);
  const railWidth = Math.min(DESKTOP_RAIL_WIDTH_PX, width);
  return {
    rail: { x: 0, y: 0, width: railWidth, height },
    spa: {
      x: railWidth,
      y: 0,
      width: Math.max(0, width - railWidth),
      height,
    },
  };
}

/**
 * In-app browser tab bounds from the SPA renderer are SPA-local (origin at the
 * SPA view's top-left). Native WebContentsView bounds are window-content-local,
 * so offset x by the rail width when a rail is present.
 */
export function offsetBrowserBoundsForRail(args: {
  bounds: DesktopViewBounds;
  railWidthPx: number;
}): DesktopViewBounds {
  if (args.railWidthPx <= 0) {
    return args.bounds;
  }
  return {
    ...args.bounds,
    x: args.bounds.x + args.railWidthPx,
  };
}
