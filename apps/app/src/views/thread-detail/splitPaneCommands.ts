import type { PaneNode } from "@/lib/split-layout";

/** Resolve previous/next pane focus in reading order, wrapping at both ends. */
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

/** Resolve a one-based shortcut slot against pane reading order. */
export function getPaneIdAtReadingIndex(
  panes: readonly PaneNode[],
  index: number,
): string | null {
  return panes[index]?.paneId ?? null;
}
