export type LayoutBand = "mobile" | "narrow" | "desktop";

export const MOBILE_MAX_WIDTH = 599;
export const DESKTOP_MIN_WIDTH = 1200;
export const SURFACE_RAIL_WIDTH = 340;

export function layoutBandForWidth(width: number): LayoutBand {
  if (width <= MOBILE_MAX_WIDTH) return "mobile";
  if (width < DESKTOP_MIN_WIDTH) return "narrow";
  return "desktop";
}

export function contentInsetForWidth(width: number): number {
  return width < 720 ? 16 : 20;
}

export const SIDEBAR_WIDTH = 248;
export const INFO_PANEL_WIDTH = 280;
export const THREAD_MIN_WIDTH = 360;
export const THREAD_COMFORTABLE_WIDTH = 500;

export interface FrameComposition {
  sidebar: boolean;
  infoPanel: boolean;
  splitColumns: boolean;
  narrow: boolean;
}

export function frameCompositionForWidth(width: number): FrameComposition {
  return {
    sidebar: width >= SIDEBAR_WIDTH + THREAD_MIN_WIDTH,
    infoPanel:
      width >= SIDEBAR_WIDTH + THREAD_COMFORTABLE_WIDTH + INFO_PANEL_WIDTH,
    splitColumns: width >= SIDEBAR_WIDTH + 2 * THREAD_MIN_WIDTH,
    narrow: width < SIDEBAR_WIDTH + THREAD_COMFORTABLE_WIDTH,
  };
}

export function frameHeightForWidth(width: number): number {
  return Math.min(720, Math.max(430, Math.round(width * 0.56)));
}
