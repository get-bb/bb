import { useMemo } from "react";
import type {
  PluginSidebarSplitPane,
  PluginSidebarThreadSplit,
} from "@get-bb/plugin-sdk";
import { usePaneContentSplitIndicator } from "@/components/sidebar/paneContentSplitIndicator";
import { useThreadRowSplitDrag } from "@/components/sidebar/useThreadRowSplitDrag";
import { getThreadDisplayTitle } from "./thread-title";
import { useSidebarThreadEntry } from "./plugin-sidebar-hooks";
import type { PaneContent } from "./split-layout";

const NO_SPLIT: PluginSidebarThreadSplit = {
  splitProps: {},
  isAvailable: false,
  layout: null,
};

/**
 * Per-row drag-to-split support for a plugin thread list — the same two host
 * hooks the built-in `ThreadRow` uses, re-exposed as a prop bag plus plain
 * data. The plugin owns the element; the host owns the gesture.
 */
export function useSidebarThreadSplit(
  threadId: string,
): PluginSidebarThreadSplit {
  const entry = useSidebarThreadEntry(threadId);
  // An unknown thread still has to run both hooks unconditionally, so it uses
  // placeholder content that can never match a real pane.
  const projectId = entry?.projectId ?? "";
  const title = entry ? getThreadDisplayTitle(entry) : "";
  const { onPointerDown } = useThreadRowSplitDrag({
    projectId,
    threadId,
    title,
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
            // Renamed from the host's terse w/h: a plugin contract should not
            // inherit an internal abbreviation.
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
