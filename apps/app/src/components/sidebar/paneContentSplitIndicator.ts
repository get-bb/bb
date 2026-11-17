import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { multiPaneSplitLayoutAtom } from "@/lib/split-layout/atoms";
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
  isMe: boolean;
  isFocused: boolean;
}

interface PaneContentSplitIndicator {
  isOpenInSplit: boolean;
  miniMap: MiniMapSlot[] | null;
}

const NO_INDICATOR: PaneContentSplitIndicator = {
  isOpenInSplit: false,
  miniMap: null,
};

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

export function resolvePaneContentSplitIndicator({
  content,
  enabled,
  isCompact,
  layout,
}: {
  content: PaneContent;
  enabled: boolean;
  isCompact: boolean;
  layout: SplitLayout | null;
}): PaneContentSplitIndicator {
  if (!enabled || layout === null || isCompact || countPanes(layout.root) < 2) {
    return NO_INDICATOR;
  }
  const pane = findPaneByContent(layout.root, content);
  if (pane === null) {
    return NO_INDICATOR;
  }
  return buildSplitIndicator(layout, new Set([pane.paneId]));
}

function areRectsEqual(left: PaneRect, right: PaneRect): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.w === right.w &&
    left.h === right.h
  );
}

function areSplitIndicatorsEqual(
  left: PaneContentSplitIndicator,
  right: PaneContentSplitIndicator,
): boolean {
  if (left === right) return true;
  if (left.miniMap === null || right.miniMap === null) {
    return left.miniMap === right.miniMap;
  }
  const rightMiniMap = right.miniMap;
  return (
    left.miniMap.length === rightMiniMap.length &&
    left.miniMap.every((slot, index) => {
      const other = rightMiniMap[index];
      return (
        other !== undefined &&
        slot.paneId === other.paneId &&
        slot.isMe === other.isMe &&
        slot.isFocused === other.isFocused &&
        areRectsEqual(slot.rect, other.rect)
      );
    })
  );
}

export function usePaneContentSplitIndicator(
  content: PaneContent,
  enabled: boolean,
): PaneContentSplitIndicator {
  const isCompact = useIsCompactViewport();
  const indicatorAtom = useMemo(
    () =>
      selectAtom(
        multiPaneSplitLayoutAtom,
        (layout) =>
          resolvePaneContentSplitIndicator({
            content,
            enabled,
            isCompact,
            layout,
          }),
        areSplitIndicatorsEqual,
      ),
    [content, enabled, isCompact],
  );
  return useAtomValue(indicatorAtom);
}
