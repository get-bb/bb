import { useMemo } from "react";
import { useAtomValue } from "jotai";
import type { PluginSidebarSplitLayout } from "@get-bb/plugin-sdk";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  computePaneRects,
  countPanes,
  listPanes,
  type SplitLayout,
} from "./split-layout";
import { multiPaneSplitLayoutAtom } from "./split-layout/atoms";

export function toPluginSidebarSplitLayout(
  layout: SplitLayout | null,
): PluginSidebarSplitLayout | null {
  if (layout === null || countPanes(layout.root) < 2) return null;
  const rects = computePaneRects(layout.root);
  return {
    panes: listPanes(layout.root).flatMap((pane) => {
      const rect = rects.get(pane.paneId);
      return rect === undefined
        ? []
        : [
            {
              paneId: pane.paneId,
              rect: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
              threadId:
                pane.content.kind === "thread" ? pane.content.threadId : null,
              isFocused: pane.paneId === layout.focusedPaneId,
            },
          ];
    }),
  };
}

export function useSidebarSplitLayout(): PluginSidebarSplitLayout | null {
  const isCompact = useIsCompactViewport();
  const layout = useAtomValue(multiPaneSplitLayoutAtom);
  return useMemo(
    () => (isCompact ? null : toPluginSidebarSplitLayout(layout)),
    [isCompact, layout],
  );
}
