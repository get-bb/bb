import { useMemo } from "react";
import { atom, useAtomValue } from "jotai";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  computePaneRects,
  countPanes,
  findPaneByContent,
  listPanes,
  type PaneContent,
  type PaneRect,
  type SplitLayout,
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
 * Subscribed instead of `splitLayoutAtom` when the indicator cannot show
 * (compact viewport, or the caller disabled it). Every sidebar row calls these
 * hooks; a live layout subscription there re-rendered every mounted row on
 * each thread navigation on phones, where the layout still reconciles but the
 * result is always {@link NO_INDICATOR}.
 */
const NULL_LAYOUT_ATOM = atom<SplitLayout | null>(null);

function useSplitLayoutForIndicator(enabled: boolean): {
  layout: SplitLayout | null;
  isCompact: boolean;
} {
  const isCompact = useIsCompactViewport();
  const layout = useAtomValue(
    enabled && !isCompact ? splitLayoutAtom : NULL_LAYOUT_ATOM,
  );
  return { layout, isCompact };
}

export interface ThreadSplitIndicatorTarget {
  id: string;
  projectId: string;
}

function buildSplitIndicator(
  layout: SplitLayout,
  matchingPaneIds: ReadonlySet<string>,
): PaneContentSplitIndicator {
  if (matchingPaneIds.size === 0) {
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
            isMe: matchingPaneIds.has(entry.paneId),
            isFocused: entry.paneId === layout.focusedPaneId,
          },
        ];
  });
  return {
    isOpenInSplit: true,
    miniMap,
  };
}

/**
 * Split-membership state for any routable sidebar item. Reads the global split
 * layout so thread, compose, and plugin rows can draw the same pane-position
 * preview without prop threading through the sidebar tree.
 */
export function usePaneContentSplitIndicator(
  content: PaneContent,
  enabled: boolean,
): PaneContentSplitIndicator {
  const { layout, isCompact } = useSplitLayoutForIndicator(enabled);

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
    return buildSplitIndicator(layout, new Set([pane.paneId]));
  }, [content, enabled, isCompact, layout]);
}

/**
 * Split-membership state for a collapsed sidebar area. Every pane occupied by
 * one of the area's hidden threads is filled, so one rollup remains accurate
 * when more than one descendant is open in the split layout.
 */
export function useThreadGroupSplitIndicator(
  threads: readonly ThreadSplitIndicatorTarget[],
  enabled: boolean,
): PaneContentSplitIndicator {
  const { layout, isCompact } = useSplitLayoutForIndicator(enabled);

  return useMemo<PaneContentSplitIndicator>(() => {
    if (
      !enabled ||
      threads.length === 0 ||
      layout === null ||
      isCompact ||
      countPanes(layout.root) < 2
    ) {
      return NO_INDICATOR;
    }
    const threadKeys = new Set(
      threads.map((thread) => `${thread.projectId}\0${thread.id}`),
    );
    const matchingPaneIds = new Set<string>();
    for (const pane of listPanes(layout.root)) {
      if (
        pane.content.kind === "thread" &&
        threadKeys.has(`${pane.content.projectId}\0${pane.content.threadId}`)
      ) {
        matchingPaneIds.add(pane.paneId);
      }
    }
    return buildSplitIndicator(layout, matchingPaneIds);
  }, [enabled, isCompact, layout, threads]);
}
