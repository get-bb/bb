import { useEffect, useState, type CSSProperties, type Key } from "react";

type PanelCollapseTransitionStyle = CSSProperties & {
  "--panel-collapse-duration": string;
};

/**
 * Shared collapse/expand easing for the thread-detail panels that animate
 * between sizes (the secondary panel, the terminal panel, and the collapsible
 * conversation/timeline panel). Kept in one place so the duration and easing
 * stay in lockstep across all of them.
 */
export const PANEL_COLLAPSE_TRANSITION_CLASS =
  "duration-[var(--panel-collapse-duration,220ms)] ease-[cubic-bezier(0.32,0.72,0,1)]";

export function getPanelCollapseTransitionStyle(
  transitionsReady: boolean,
): PanelCollapseTransitionStyle {
  return {
    "--panel-collapse-duration": transitionsReady ? "220ms" : "0ms",
  };
}

/**
 * Storage-backed panel state may settle during mount (for example, a transient
 * New tab is absent from the durable state). Keep that initial reconciliation
 * from looking like a user-requested open/close animation. Two paint frames
 * leave normal interactions animated while covering the mount subscription.
 */
export function usePanelCollapseTransitionsReady(
  resetKey: Key,
  enabled: boolean,
): boolean {
  const [readyKey, setReadyKey] = useState<Key | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let secondFrame: number | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setReadyKey(resetKey);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
    };
  }, [enabled, resetKey]);

  return !enabled || readyKey === resetKey;
}

/**
 * Hit-area margins for the thread-detail `PanelResizeHandle`s.
 *
 * The handles keep a zero/1px layout seam and render a real 12px-wide child as
 * their pointer target. react-resizable-panels still calculates its hit area
 * from the parent handle's bounding box, so these margins must fully envelop
 * the child: unlike the old pseudo-element, the child then owns pointer hit
 * testing while the library recognizes every point within it as a resize.
 *
 * `fine` stays slightly larger than the child's 6px overhang for fractional
 * layout positions and HiDPI rounding. `coarse` keeps the library default.
 */
export const PANEL_RESIZE_HIT_AREA_MARGINS = { coarse: 15, fine: 8 };

/**
 * Keep panel resize targets above bounded pane headers and focus scrims.
 *
 * This matches SplitDivider: a lower layer lets a pane header cover the half
 * of the grab strip that overhangs into the main panel at the header row.
 */
export const PANEL_RESIZE_HANDLE_LAYER_CLASS = "z-[25]";

/**
 * A physical grab strip centered over a panel's zero/1px layout seam.
 *
 * Keep this on a real child rather than a pseudo-element: it must sit above the
 * adjacent panel content and become the pointer target itself, matching the
 * sidebar's dependable 12px-wide resize strip without consuming layout space.
 */
export const PANEL_RESIZE_HIT_TARGET_CLASS =
  "absolute inset-y-0 left-1/2 z-10 w-3 -translate-x-1/2 touch-none cursor-col-resize bg-transparent";
