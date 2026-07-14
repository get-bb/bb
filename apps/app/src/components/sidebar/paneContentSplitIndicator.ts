import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  computePaneRects,
  countPanes,
  findPaneByContent,
  listPanes,
  type PaneContent,
  type PaneRect,
} from "@/lib/split-layout";

export interface MiniMapSlot {
  paneId: string;
  rect: PaneRect;
  /** The pane represented by the sidebar item. */
  isMe: boolean;
  /** The focused pane (drawn in the accent token). */
  isFocused: boolean;
}

export interface PaneContentSplitIndicator {
  /** This content is open in a pane while the layout is split (>1 pane). */
  isOpenInSplit: boolean;
  /** Mini-map slots for the sidebar glyph, or null when there is nothing to show. */
  miniMap: MiniMapSlot[] | null;
}

const NO_INDICATOR: PaneContentSplitIndicator = {
  isOpenInSplit: false,
  miniMap: null,
};

/**
 * Split-membership state for any routable sidebar item. Reads the global split
 * layout so thread, compose, and plugin rows can draw the same pane-position
 * preview without prop threading through the sidebar tree.
 */
export function usePaneContentSplitIndicator(
  content: PaneContent,
  enabled: boolean,
): PaneContentSplitIndicator {
  const layout = useAtomValue(splitLayoutAtom);
  const isCompact = useIsCompactViewport();

  return useMemo<PaneContentSplitIndicator>(() => {
    if (
      !enabled ||
      layout === null ||
      isCompact ||
      countPanes(layout.root) < 2
    ) {
      return NO_INDICATOR;
    }
    const pane = findPaneByContent(layout.root, content);
    if (pane === null) {
      return NO_INDICATOR;
    }
    const rects = computePaneRects(layout.root);
    const miniMap: MiniMapSlot[] = listPanes(layout.root).flatMap((entry) => {
      const rect = rects.get(entry.paneId);
      return rect === undefined
        ? []
        : [
            {
              paneId: entry.paneId,
              rect,
              isMe: entry.paneId === pane.paneId,
              isFocused: entry.paneId === layout.focusedPaneId,
            },
          ];
    });
    return {
      isOpenInSplit: true,
      miniMap,
    };
  }, [content, enabled, isCompact, layout]);
}
