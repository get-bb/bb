import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { APP_OVERLAY_LAYER } from "@/components/ui/app-overlay-layers";
import {
  getBbDesktopInfo,
  MACOS_APP_REGION_NO_DRAG_CLASS,
} from "@/lib/bb-desktop";

const HIDE_DELAY_MS = 2000;

export function DesktopZoomIndicator() {
  const desktop = getBbDesktopInfo();
  const onZoomChange = desktop?.onZoomChange;
  const zoom = desktop?.zoom;
  const [zoomFactor, setZoomFactor] = useState<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hovered = useRef(false);

  const restartHideTimer = useCallback(() => {
    clearTimeout(hideTimer.current);
    if (!hovered.current) {
      hideTimer.current = setTimeout(() => setZoomFactor(null), HIDE_DELAY_MS);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onZoomChange?.((factor) => {
      setZoomFactor(factor);
      restartHideTimer();
    });
    return () => {
      unsubscribe?.();
      clearTimeout(hideTimer.current);
    };
  }, [onZoomChange, restartHideTimer]);

  if (zoomFactor === null) {
    return null;
  }

  return (
    <div
      className={`fixed right-0 top-(--bb-app-chrome-row-height) ${MACOS_APP_REGION_NO_DRAG_CLASS}`}
      style={{ zIndex: APP_OVERLAY_LAYER.sharedPortaledOverlay }}
    >
      <div
        role="toolbar"
        aria-label="Zoom"
        className="mt-2 mr-3 flex origin-top-right items-center gap-1 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
        style={{ zoom: 1 / zoomFactor }}
        onPointerEnter={() => {
          hovered.current = true;
          clearTimeout(hideTimer.current);
        }}
        onPointerLeave={() => {
          hovered.current = false;
          restartHideTimer();
        }}
      >
        <span
          aria-live="polite"
          className="min-w-12 text-center text-sm font-medium tabular-nums"
        >
          {Math.round(zoomFactor * 100)}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Zoom out"
          onClick={() => zoom?.("out")}
        >
          <Icon name="Minus" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Zoom in"
          onClick={() => zoom?.("in")}
        >
          <Icon name="Plus" />
        </Button>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          aria-label="Reset zoom"
          disabled={zoomFactor === 1}
          onClick={() => zoom?.("reset")}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}
