import { useEffect, useState, type Key } from "react";

export const PANEL_COLLAPSE_INSTANT_ATTRIBUTE = "data-panel-collapse-instant";

export const PANEL_COLLAPSE_TRANSITION_CLASS =
  "duration-[220ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none [[data-panel-collapse-instant]_&]:duration-0";

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

export const PANEL_RESIZE_HANDLE_LAYER_CLASS = "z-[25]";

export const PANEL_RESIZE_HIT_TARGET_CLASS =
  "absolute inset-y-0 left-1/2 z-10 w-4 -translate-x-1/2 touch-none cursor-col-resize pointer-coarse:w-8 bg-transparent";
