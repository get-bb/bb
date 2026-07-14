import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useThreadSplitsEnabled } from "@/hooks/useThreadSplitsEnabled";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  computePaneRects,
  countPanes,
  findPaneByThread,
  listPanes,
  type PaneRect,
} from "@/lib/split-layout";

export interface MiniMapSlot {
  paneId: string;
  rect: PaneRect;
  /** This row's own pane. */
  isMe: boolean;
  /** The focused pane (drawn in the accent token). */
  isFocused: boolean;
}

export interface ThreadSplitIndicator {
  /** Thread is open in a pane while the layout is split (>1 pane). */
  isOpenInSplit: boolean;
  /** Thread is open in the currently focused pane. */
  isFocusedPaneThread: boolean;
  /** Mini-map slots for the sidebar glyph, or null when there is nothing to show. */
  miniMap: MiniMapSlot[] | null;
}

const NO_INDICATOR: ThreadSplitIndicator = {
  isOpenInSplit: false,
  isFocusedPaneThread: false,
  miniMap: null,
};

/**
 * Split-membership state for one sidebar thread row: whether the thread is open
 * in a split pane, whether that pane is focused, and the mini-map slots for the
 * trailing glyph. Reads the global split layout so a row can tint and draw its
 * arrangement without any prop threading through the sidebar tree. Splits are
 * disabled on compact viewports, so it stays inert there.
 */
export function useThreadSplitIndicator(
  projectId: string,
  threadId: string,
): ThreadSplitIndicator {
  const layout = useAtomValue(splitLayoutAtom);
  const isCompact = useIsCompactViewport();
  const threadSplitsEnabled = useThreadSplitsEnabled();

  return useMemo<ThreadSplitIndicator>(() => {
    if (!threadSplitsEnabled || layout === null || isCompact) {
      return NO_INDICATOR;
    }
    const paneCount = countPanes(layout.root);
    if (paneCount < 2) {
      // A single pane is already reflected by the active-row treatment; the
      // split indicators only add signal once the layout actually splits.
      return NO_INDICATOR;
    }
    const pane = findPaneByThread(layout.root, projectId, threadId);
    if (pane === null) {
      return NO_INDICATOR;
    }
    const rects = computePaneRects(layout.root);
    const orderedPaneIds = listPanes(layout.root).map((entry) => entry.paneId);
    const miniMap: MiniMapSlot[] = orderedPaneIds.flatMap((paneId) => {
      const rect = rects.get(paneId);
      return rect === undefined
        ? []
        : [
            {
              paneId,
              rect,
              isMe: paneId === pane.paneId,
              isFocused: paneId === layout.focusedPaneId,
            },
          ];
    });
    return {
      isOpenInSplit: true,
      isFocusedPaneThread: pane.paneId === layout.focusedPaneId,
      miniMap,
    };
  }, [isCompact, layout, projectId, threadId, threadSplitsEnabled]);
}
