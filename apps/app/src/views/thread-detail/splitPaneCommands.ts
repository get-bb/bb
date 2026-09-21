import {
  computePaneRects,
  type LayoutNode,
  type SplitSide,
  type PaneNode,
} from "@/lib/split-layout";

export function getAdjacentPaneId(
  panes: readonly PaneNode[],
  focusedPaneId: string,
  offset: -1 | 1,
): string | null {
  if (panes.length < 2) {
    return null;
  }
  const focusedIndex = panes.findIndex((pane) => pane.paneId === focusedPaneId);
  const startIndex = focusedIndex === -1 ? 0 : focusedIndex;
  const nextIndex = (startIndex + offset + panes.length) % panes.length;
  return panes[nextIndex]?.paneId ?? null;
}

export function getDirectionalPaneId(
  root: LayoutNode,
  focusedPaneId: string,
  direction: SplitSide,
): string | null {
  const rects = computePaneRects(root);
  const focused = rects.get(focusedPaneId);
  if (!focused) return null;
  const horizontal = direction === "left" || direction === "right";
  const forward = direction === "right" || direction === "bottom";
  const start = horizontal ? focused.x : focused.y;
  const size = horizontal ? focused.w : focused.h;
  const crossStart = horizontal ? focused.y : focused.x;
  const crossSize = horizontal ? focused.h : focused.w;
  let nearest: string | null = null;
  let nearestGap = Infinity;
  let nearestOffset = Infinity;
  for (const [paneId, rect] of rects) {
    if (paneId === focusedPaneId) continue;
    const candidateStart = horizontal ? rect.x : rect.y;
    const candidateSize = horizontal ? rect.w : rect.h;
    const candidateCrossStart = horizontal ? rect.y : rect.x;
    const candidateCrossSize = horizontal ? rect.h : rect.w;
    const overlap =
      Math.min(
        crossStart + crossSize,
        candidateCrossStart + candidateCrossSize,
      ) - Math.max(crossStart, candidateCrossStart);
    const gap = forward
      ? candidateStart - start - size
      : start - candidateStart - candidateSize;
    if (gap < -1e-9 || overlap <= 1e-9) continue;
    const offset = Math.abs(
      candidateCrossStart + candidateCrossSize / 2 - crossStart - crossSize / 2,
    );
    if (
      gap < nearestGap - 1e-9 ||
      (Math.abs(gap - nearestGap) <= 1e-9 && offset < nearestOffset)
    ) {
      nearest = paneId;
      nearestGap = gap;
      nearestOffset = offset;
    }
  }
  return nearest;
}
