import { useCallback, useMemo } from "react";
import type {
  PluginSidebarSplitPane,
  PluginSidebarThreadSplit,
  PluginSidebarThreadSplitOptions,
} from "@get-bb/plugin-sdk";
import { usePaneContentSplitIndicator } from "@/components/sidebar/paneContentSplitIndicator";
import { useThreadRowSplitDrag } from "@/components/sidebar/useThreadRowSplitDrag";
import {
  resolveThreadTitleDisplayText,
  useThreadTitleMentionResourcesGetter,
} from "@/components/thread/ThreadTitleMentions";
import { getThreadDisplayTitle } from "./thread-title";
import {
  useSidebarThreadEntriesStore,
  useSidebarThreadEntry,
} from "./sidebar-thread-entries";
import type { DroppedThreadMention } from "./thread-mention-drop";
import type { PaneContent } from "./split-layout";

const NO_SPLIT: PluginSidebarThreadSplit = {
  splitProps: {},
  isAvailable: false,
  layout: null,
};

export function useSidebarThreadSplit(
  threadId: string,
  options?: PluginSidebarThreadSplitOptions,
): PluginSidebarThreadSplit {
  const entries = useSidebarThreadEntriesStore();
  const entry = useSidebarThreadEntry(threadId);
  const projectId = entry?.projectId ?? "";
  const getTitleResources = useThreadTitleMentionResourcesGetter();
  const getTitle = useCallback(
    () =>
      entry === null
        ? ""
        : resolveThreadTitleDisplayText(
            getThreadDisplayTitle(entry),
            getTitleResources(),
          ),
    [entry, getTitleResources],
  );
  const dragThreadIds = options?.dragThreadIds;
  const getMentionThreads = useMemo(() => {
    if (dragThreadIds === undefined || dragThreadIds.length < 2) {
      return undefined;
    }
    return (): readonly DroppedThreadMention[] =>
      dragThreadIds.flatMap((id) => {
        const dragged = entries.get(id);
        return dragged === null
          ? []
          : [{ threadId: id, label: getThreadDisplayTitle(dragged) }];
      });
  }, [dragThreadIds, entries]);
  const { onPointerDown } = useThreadRowSplitDrag({
    projectId,
    threadId,
    getTitle,
    getMentionThreads,
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
