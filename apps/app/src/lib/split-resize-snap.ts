import { clampSplitPairFraction } from "@/lib/split-layout";

export type SplitResizeAxis = "x" | "y";

export const SPLIT_RESIZE_SNAP_THRESHOLD_PX = 8;

interface ResolveSplitResizePositionArgs {
  end: number;
  pointer: number;
  start: number;
}

export interface ResolvedSplitResizePosition {
  coordinate: number;
  fraction: number;
  snapped: boolean;
}

export interface SplitResizeSnapSession {
  clear: () => void;
  resolve: (
    args: ResolveSplitResizePositionArgs,
  ) => ResolvedSplitResizePosition;
}

function createGuide(
  document: Document,
  axis: SplitResizeAxis,
  coordinate: number,
): HTMLElement {
  const guide = document.createElement("div");
  guide.setAttribute("aria-hidden", "true");
  guide.dataset.splitResizeSnapGuide = axis;
  guide.className =
    axis === "x"
      ? "pointer-events-none fixed inset-y-0 z-[100] w-px -translate-x-1/2 bg-ring/50"
      : "pointer-events-none fixed inset-x-0 z-[100] h-px -translate-y-1/2 bg-ring/50";
  if (axis === "x") guide.style.left = `${coordinate}px`;
  else guide.style.top = `${coordinate}px`;
  document.body.appendChild(guide);
  return guide;
}

/**
 * Starts one divider drag's snap lifecycle. Each split has one fixed grid
 * point at 50/50 on the divider's active axis: vertical dividers move only
 * left/right, and horizontal dividers move only up/down. The pointer-move path
 * uses the adjacent pair bounds captured by the caller and never reads layout.
 */
export function createSplitResizeSnapSession(
  divider: HTMLElement,
  axis: SplitResizeAxis,
): SplitResizeSnapSession {
  let guide: HTMLElement | null = null;

  const clear = () => {
    guide?.remove();
    guide = null;
  };

  const showGuide = (coordinate: number) => {
    guide ??= createGuide(divider.ownerDocument, axis, coordinate);
    if (axis === "x") guide.style.left = `${coordinate}px`;
    else guide.style.top = `${coordinate}px`;
  };

  return {
    clear,
    resolve: ({ end, pointer, start }) => {
      const span = end - start;
      const unsnappedFraction = clampSplitPairFraction(
        span > 0 ? (pointer - start) / span : 0.5,
      );
      if (span <= 0) {
        clear();
        return {
          coordinate: start + span * unsnappedFraction,
          fraction: unsnappedFraction,
          snapped: false,
        };
      }

      const coordinate = start + span / 2;
      if (Math.abs(pointer - coordinate) > SPLIT_RESIZE_SNAP_THRESHOLD_PX) {
        clear();
        return {
          coordinate: start + span * unsnappedFraction,
          fraction: unsnappedFraction,
          snapped: false,
        };
      }

      showGuide(coordinate);
      return { coordinate, fraction: 0.5, snapped: true };
    },
  };
}
