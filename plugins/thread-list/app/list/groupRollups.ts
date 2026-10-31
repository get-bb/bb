import { useMemo } from "react";
import {
  useSidebarSplitLayout,
  useSidebarThreadDraftIds,
  useSidebarThreadRowStatuses,
  type PluginSidebarSplitPane,
  type PluginSidebarThread,
  type PluginSidebarThreadRowStatus,
} from "@get-bb/plugin-sdk/app";

import {
  resolveThreadStatus,
  threadListIndicatorStateForThread,
  type ThreadListIndicatorKind,
} from "../model/thread-activity.js";

export type ThreadSplitIndicatorTarget = Pick<PluginSidebarThread, "id">;

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

export function usePluginThreadRowStatusForThreadIds(
  threadIds: readonly string[],
): PluginSidebarThreadRowStatus | null {
  const statuses = useSidebarThreadRowStatuses();
  return useMemo(() => {
    for (const threadId of threadIds) {
      const status = statuses.get(threadId);
      if (status) return status;
    }
    return null;
  }, [statuses, threadIds]);
}

const STATUS_PRIORITY: Record<
  ThreadListIndicatorKind | "plugin" | "archived",
  number
> = {
  "unread-error": 0,
  "waiting-for-input": 1,
  runtime: 2,
  plugin: 3,
  "working-draft": 4,
  "plan-mode": 5,
  goal: 6,
  workflow: 7,
  "background-agent": 8,
  "background-command": 9,
  "queued-failed": 10,
  "unread-success": 11,
  "queued-waiting": 12,
  draft: 13,
  archived: 14,
  none: 15,
};

export function useThreadGroupStatus(threads: readonly PluginSidebarThread[]) {
  const statuses = useSidebarThreadRowStatuses();
  const draftThreadIds = useSidebarThreadDraftIds();
  return useMemo(() => {
    let result: {
      indicator: ThreadListIndicatorKind;
      rowStatus: PluginSidebarThreadRowStatus | null;
      archived: boolean;
    } = { indicator: "none", rowStatus: null, archived: false };
    let priority = STATUS_PRIORITY.none;
    for (const thread of threads) {
      const state = threadListIndicatorStateForThread(
        thread,
        draftThreadIds.has(thread.id),
      );
      const status = statuses.get(thread.id) ?? null;
      const resolved = resolveThreadStatus(state, status);
      const archived = thread.archivedAt !== null;
      const rowStatus =
        !archived && resolved.rowStatusIsVisible ? status : null;
      const nextPriority =
        STATUS_PRIORITY[
          archived ? "archived" : rowStatus ? "plugin" : resolved.indicatorKind
        ];
      if (nextPriority < priority) {
        priority = nextPriority;
        result = { indicator: resolved.indicatorKind, rowStatus, archived };
      }
    }
    return result;
  }, [threads, statuses, draftThreadIds]);
}
