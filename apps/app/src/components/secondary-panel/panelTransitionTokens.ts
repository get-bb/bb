import { useEffect, useState, type CSSProperties, type Key } from "react";
import {
  PANEL_MOTION_DURATION_MS,
  PANEL_SPRING_CSS_EASING,
} from "@/lib/panel-motion";

type PanelCollapseTransitionStyle = CSSProperties & {
  "--panel-collapse-duration": string;
  "--panel-collapse-easing": string;
};

export const PANEL_COLLAPSE_TRANSITION_CLASS =
  "duration-[var(--panel-collapse-duration,500ms)] ease-[var(--panel-collapse-easing)] motion-reduce:duration-0";

export function getPanelCollapseTransitionStyle(
  transitionsReady: boolean,
): PanelCollapseTransitionStyle {
  return {
    "--panel-collapse-duration": transitionsReady
      ? `${PANEL_MOTION_DURATION_MS}ms`
      : "0ms",
    "--panel-collapse-easing": PANEL_SPRING_CSS_EASING,
  };
}

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

export const PANEL_RESIZE_HIT_AREA_MARGINS = { coarse: 15, fine: 8 };

export const PANEL_RESIZE_HANDLE_LAYER_CLASS = "z-[25]";

export const PANEL_RESIZE_HIT_TARGET_CLASS =
  "absolute inset-y-0 left-1/2 z-10 w-3 -translate-x-1/2 touch-none cursor-col-resize bg-transparent";
