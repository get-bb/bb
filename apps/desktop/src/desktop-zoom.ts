import {
  BB_DESKTOP_MAX_ZOOM_PERCENT,
  BB_DESKTOP_MIN_ZOOM_PERCENT,
  type BbDesktopZoomCommand,
} from "@bb/desktop-contract";

const ZOOM_STEP_PERCENT = 10;

export function nextZoomFactor(
  zoomFactor: number,
  command: BbDesktopZoomCommand,
): number {
  if (command === "reset") {
    return 1;
  }
  const step = command === "in" ? ZOOM_STEP_PERCENT : -ZOOM_STEP_PERCENT;
  const percent =
    Math.round((zoomFactor * 100 + step) / ZOOM_STEP_PERCENT) *
    ZOOM_STEP_PERCENT;
  return (
    Math.min(
      BB_DESKTOP_MAX_ZOOM_PERCENT,
      Math.max(BB_DESKTOP_MIN_ZOOM_PERCENT, percent),
    ) / 100
  );
}
