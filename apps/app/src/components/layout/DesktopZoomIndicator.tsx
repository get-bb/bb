import { useEffect, useRef, useState } from "react";
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
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interaction = useRef({ focused: false, hovered: false });

  useEffect(() => {
    if (onZoomChange === undefined) {
      return;
    }
    return onZoomChange((factor) => {
      setZoomFactor(factor);
      if (hideTimer.current !== null) {
        clearTimeout(hideTimer.current);
      }
      if (!interaction.current.focused && !interaction.current.hovered) {
        hideTimer.current = setTimeout(() => setZoomFactor(null), HIDE_DELAY_MS);
      }
    });
  }, [onZoomChange]);

  useEffect(
    () => () => {
      if (hideTimer.current !== null) {
        clearTimeout(hideTimer.current);
      }
    },
    [],
  );

  if (zoomFactor === null || onZoomChange === undefined) {
    return null;
  }

  const scheduleHide = () => {
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current);
    }
    hideTimer.current = setTimeout(() => setZoomFactor(null), HIDE_DELAY_MS);
  };

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
          interaction.current.hovered = true;
          if (hideTimer.current !== null) {
            clearTimeout(hideTimer.current);
            hideTimer.current = null;
          }
        }}
        onPointerLeave={() => {
          interaction.current.hovered = false;
          if (!interaction.current.focused) {
            scheduleHide();
          }
        }}
        onFocus={() => {
          interaction.current.focused = true;
          if (hideTimer.current !== null) {
            clearTimeout(hideTimer.current);
            hideTimer.current = null;
          }
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            interaction.current.focused = false;
            if (!interaction.current.hovered) {
              scheduleHide();
            }
          }
        }}
      >
        <span aria-live="polite" className="min-w-12 text-center text-sm font-medium tabular-nums">
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
          className="h-7 px-2 text-xs"
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
