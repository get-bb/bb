import { useMemo } from "react";
import {
  useSidebarSplitLayout,
  useSidebarThreadRowStatuses,
  type PluginSidebarSplitPane,
  type PluginSidebarThreadRowStatus,
} from "@get-bb/plugin-sdk/app";

export interface ThreadSplitIndicatorTarget {
  id: string;
}

interface ThreadGroupSplitIndicator {
  isOpenInSplit: boolean;
  miniMap: PluginSidebarSplitPane[] | null;
}

const NO_INDICATOR: ThreadGroupSplitIndicator = {
  isOpenInSplit: false,
  miniMap: null,
};

export function useThreadGroupSplitIndicator(
  threads: readonly ThreadSplitIndicatorTarget[],
  enabled: boolean,
): ThreadGroupSplitIndicator {
  const layout = useSidebarSplitLayout();
  return useMemo<ThreadGroupSplitIndicator>(() => {
    if (!enabled || threads.length === 0 || layout === null) {
      return NO_INDICATOR;
    }
    const threadIds = new Set(threads.map((thread) => thread.id));
    const slots = layout.panes.map<PluginSidebarSplitPane>((pane) => ({
      paneId: pane.paneId,
      rect: pane.rect,
      isMe: pane.threadId !== null && threadIds.has(pane.threadId),
      isFocused: pane.isFocused,
    }));
    return slots.some((slot) => slot.isMe)
      ? { isOpenInSplit: true, miniMap: slots }
      : NO_INDICATOR;
  }, [enabled, layout, threads]);
}

export function usePluginThreadRowStatusForThreads(
  threads: readonly { id: string }[],
): PluginSidebarThreadRowStatus | null {
  const statuses = useSidebarThreadRowStatuses();
  return useMemo(() => {
    for (const thread of threads) {
      const status = statuses.get(thread.id);
      if (status) return status;
    }
    return null;
  }, [statuses, threads]);
}
