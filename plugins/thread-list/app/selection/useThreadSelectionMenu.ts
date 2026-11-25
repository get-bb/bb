import { useMemo, useRef, useSyncExternalStore } from "react";
import type { PluginThreadActionsInlineItem } from "@get-bb/plugin-sdk/app";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { useThreadSelectionStore } from "./threadSelection.js";

const SELECTION_GROUP = "5_selection";

export interface ThreadSelectionMenu {
  selection: readonly SidebarThread[];
  inline: readonly PluginThreadActionsInlineItem[];
  onEscapeKeyDown: () => void;
  onCloseAutoFocus: (event: Event) => void;
}

export function useThreadSelectionMenu(
  threadIds: readonly string[] | null,
): ThreadSelectionMenu | null {
  const store = useThreadSelectionStore();
  const dismissedWithEscape = useRef(false);
  const selection = useSyncExternalStore(store.subscribe, () =>
    threadIds === null ? null : store.getSelectionThreads(),
  );
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
