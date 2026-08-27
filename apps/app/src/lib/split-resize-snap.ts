import { clampSplitPairFraction } from "@/lib/split-layout";

export type SplitResizeAxis = "x" | "y";

export const SPLIT_RESIZE_SNAP_THRESHOLD_PX = 8;

interface ResolveSplitResizePositionArgs {
  axis: SplitResizeAxis;
  divider: HTMLElement;
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
    args: Omit<ResolveSplitResizePositionArgs, "axis" | "divider">,
  ) => ResolvedSplitResizePosition;
}

function dividerCoordinate(rect: DOMRect, axis: SplitResizeAxis): number {
  return axis === "x" ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
}

function dividerExtent(rect: DOMRect, axis: SplitResizeAxis): number {
  return axis === "x" ? rect.width : rect.height;
}

function isVisibleSnapTarget(element: HTMLElement, rect: DOMRect): boolean {
  if (
    element.getAttribute("aria-hidden") === "true" ||
    element.closest('[aria-hidden="true"]') !== null
  ) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  );
}

interface SplitResizeSnapTarget {
  coordinate: number;
  element: HTMLElement;
}

function listSnapTargets(
  divider: HTMLElement,
  axis: SplitResizeAxis,
): SplitResizeSnapTarget[] {
  const targets: SplitResizeSnapTarget[] = [];
  const candidates = divider.ownerDocument.querySelectorAll<HTMLElement>(
    `[data-split-resize-axis="${axis}"]`,
  );
  for (const candidate of candidates) {
    const sourceSplit = divider.parentElement;
    const candidateSplit = candidate.parentElement;
    if (
      candidate === divider ||
      sourceSplit?.contains(candidate) === true ||
      candidateSplit?.contains(divider) === true
    ) {
      continue;
    }
    const rect = candidate.getBoundingClientRect();
    if (!isVisibleSnapTarget(candidate, rect)) continue;
    targets.push({
      coordinate: dividerCoordinate(rect, axis),
      element: candidate,
    });
  }
  return targets;
}

function nearestSnapTarget(
  targets: SplitResizeSnapTarget[],
  pointer: number,
): SplitResizeSnapTarget | null {
  let nearest: SplitResizeSnapTarget | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of targets) {
    if (!candidate.element.isConnected) continue;
    const distance = Math.abs(candidate.coordinate - pointer);
    if (
      distance > SPLIT_RESIZE_SNAP_THRESHOLD_PX ||
      distance >= nearestDistance
    ) {
      continue;
    }
    nearest = candidate;
    nearestDistance = distance;
  }
  return nearest;
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
 * Starts one divider drag's snap lifecycle. Compatible dividers opt in with
 * `data-split-resize-axis`. Candidate geometry is captured once so the hot
 * pointer-move path never forces layout after it writes the source pair's flex
 * values. Ancestor and descendant dividers are excluded because their
 * coordinates can move with the source pair.
 */
export function createSplitResizeSnapSession(
  divider: HTMLElement,
  axis: SplitResizeAxis,
): SplitResizeSnapSession {
  let guide: HTMLElement | null = null;
  let target: HTMLElement | null = null;
  const targets = listSnapTargets(divider, axis);
  const extent = dividerExtent(divider.getBoundingClientRect(), axis);

  const clear = () => {
    guide?.remove();
    guide = null;
    if (target !== null) delete target.dataset.splitResizeSnapTarget;
    target = null;
  };

  const showSnapTarget = (element: HTMLElement, coordinate: number) => {
    if (target !== element) {
      if (target !== null) delete target.dataset.splitResizeSnapTarget;
      target = element;
      target.dataset.splitResizeSnapTarget = "true";
    }
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
      const candidate = nearestSnapTarget(targets, pointer);
      if (candidate === null || span <= 0) {
        clear();
        return {
          coordinate: start + span * unsnappedFraction,
          fraction: unsnappedFraction,
          snapped: false,
        };
      }

      // Flex lays the adjacent panes out in the pair's outer span minus this
      // divider. Account for that one-pixel seam so the divider centers land
      // on the same viewport coordinate instead of merely sharing a ratio.
      const contentSpan = span - extent;
      if (contentSpan <= 0) {
        clear();
        return {
          coordinate: start + span * unsnappedFraction,
          fraction: unsnappedFraction,
          snapped: false,
        };
      }
      const fraction = clampSplitPairFraction(
        (candidate.coordinate - start - extent / 2) / contentSpan,
      );
      const coordinate = start + contentSpan * fraction + extent / 2;
      // A target outside the pair's 15–85% resize bounds is not reachable.
      if (Math.abs(coordinate - candidate.coordinate) > 0.01) {
        clear();
        return {
          coordinate: start + span * unsnappedFraction,
          fraction: unsnappedFraction,
          snapped: false,
        };
      }

      showSnapTarget(candidate.element, coordinate);
      return { coordinate, fraction, snapped: true };
    },
  };
}
