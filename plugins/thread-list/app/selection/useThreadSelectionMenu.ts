import { useMemo, useRef } from "react";
import type {
  PluginThreadActionsInlineItem,
  PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { useSidebarData } from "../model/use-sidebar-data.js";
import { toThreadActionTarget } from "../rows/threadActionTarget.js";
import { useThreadSelectionStore } from "./threadSelection.js";

const SELECTION_GROUP = "5_selection";

export interface ThreadSelectionMenu {
  selection: readonly PluginThreadActionTarget[];
  inline: readonly PluginThreadActionsInlineItem[];
  onEscapeKeyDown: () => void;
  onCloseAutoFocus: (event: Event) => void;
}

export function useThreadSelectionMenu(
  threadIds: readonly string[] | null,
): ThreadSelectionMenu | null {
  const store = useThreadSelectionStore();
  const { projects } = useSidebarData();
  const dismissedWithEscape = useRef(false);
  const selection = useMemo(() => {
    if (threadIds === null) return null;
    const byId = new Map<string, SidebarThread>();
    for (const project of projects) {
      for (const thread of project.threads) byId.set(thread.id, thread);
    }
    return threadIds.flatMap((threadId) => {
      const thread = byId.get(threadId);
      return thread === undefined ? [] : [toThreadActionTarget(thread)];
    });
  }, [projects, threadIds]);
  return useMemo(
    () =>
      selection === null
        ? null
        : {
            selection,
            inline: [
              {
                key: "clear-selection",
                group: SELECTION_GROUP,
                action: {
                  label: "Clear selection",
                  icon: "X",
                  run: () => store.clear(),
                },
              },
            ],
            onEscapeKeyDown: () => {
              dismissedWithEscape.current = true;
            },
            onCloseAutoFocus: (event: Event) => {
              if (!dismissedWithEscape.current) return;
              dismissedWithEscape.current = false;
              event.preventDefault();
              store.clear();
              store.restoreActiveThreadFocus();
            },
          },
    [selection, store],
  );
}
