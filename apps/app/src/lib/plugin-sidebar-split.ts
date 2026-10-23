import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import type {
  PluginSidebarSplitLayout,
  PluginSidebarSplitPane,
  PluginSidebarThreadSplit,
  PluginSidebarThreadSplitOptions,
} from "@get-bb/plugin-sdk";
import { usePaneContentSplitIndicator } from "@/components/sidebar/paneContentSplitIndicator";
import { useThreadRowSplitDrag } from "@/components/sidebar/useThreadRowSplitDrag";
import { useThreadTitleDisplayText } from "@/components/thread/ThreadTitleMentions";
import { getThreadDisplayTitle } from "./thread-title";
import { useSidebarThreadEntries } from "./sidebar-thread-entries";
import type { DroppedThreadMention } from "./thread-mention-drop";
import {
  computePaneRects,
  countPanes,
  listPanes,
  type PaneContent,
  type SplitLayout,
} from "./split-layout";
import { splitLayoutAtom } from "./split-layout/atoms";

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
  const layout = useAtomValue(splitLayoutAtom);
  return useMemo(
    () => (isCompact ? null : toPluginSidebarSplitLayout(layout)),
    [isCompact, layout],
  );
}

const NO_SPLIT: PluginSidebarThreadSplit = {
  splitProps: {},
  isAvailable: false,
  layout: null,
};

export function useSidebarThreadSplit(
  threadId: string,
  options?: PluginSidebarThreadSplitOptions,
): PluginSidebarThreadSplit {
  const entries = useSidebarThreadEntries();
  const entry = entries.get(threadId) ?? null;
  const projectId = entry?.projectId ?? "";
  const title = useThreadTitleDisplayText(
    entry ? getThreadDisplayTitle(entry) : "",
  );
  const dragThreadIds = options?.dragThreadIds;
  const mentionThreads = useMemo<
    readonly DroppedThreadMention[] | undefined
  >(() => {
    if (dragThreadIds === undefined || dragThreadIds.length < 2) {
      return undefined;
    }
    return dragThreadIds.flatMap((id) => {
      const dragged = entries.get(id);
      return dragged === undefined
        ? []
        : [{ threadId: id, label: getThreadDisplayTitle(dragged) }];
    });
  }, [dragThreadIds, entries]);
  const { onPointerDown } = useThreadRowSplitDrag({
    projectId,
    threadId,
    title,
    mentionThreads,
  });
  const content = useMemo<PaneContent>(
    () => ({ kind: "thread", projectId, threadId }),
    [projectId, threadId],
  );
  const indicator = usePaneContentSplitIndicator(content, entry !== null);

  return useMemo<PluginSidebarThreadSplit>(() => {
    if (entry === null) return NO_SPLIT;
    const panes: PluginSidebarSplitPane[] | null =
      indicator.miniMap === null
        ? null
        : indicator.miniMap.map((slot) => ({
            paneId: slot.paneId,
            rect: {
              x: slot.rect.x,
              y: slot.rect.y,
              width: slot.rect.w,
              height: slot.rect.h,
            },
            isMe: slot.isMe,
            isFocused: slot.isFocused,
          }));
    return {
      splitProps: onPointerDown ? { onPointerDown } : {},
      isAvailable: onPointerDown !== undefined,
      layout: panes === null ? null : { panes },
    };
  }, [entry, indicator.miniMap, onPointerDown]);
}
