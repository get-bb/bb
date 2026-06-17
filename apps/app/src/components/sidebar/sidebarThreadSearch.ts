import type { RefObject } from "react";

export const SIDEBAR_THREAD_SEARCH_LISTBOX_ID =
  "bb-sidebar-thread-search-results";

export interface SidebarThreadSearchNavigationItem {
  id: string;
  optionId: string;
  projectId: string;
  threadId: string;
}

export interface SidebarThreadSearchInputController {
  activeDescendantId: string | undefined;
  inputRef: RefObject<HTMLInputElement | null>;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  query: string;
}

export interface SidebarThreadSearchPanelController {
  activeIndex: number;
  isActive: boolean;
  onActiveIndexChange: (index: number) => void;
  onNavigationItemsChange: (
    items: readonly SidebarThreadSearchNavigationItem[],
  ) => void;
  onSelectItem: (item: SidebarThreadSearchNavigationItem) => void;
  query: string;
}

export function getSidebarThreadSearchShortcutLabel(): "Cmd+K" | "Ctrl+K" {
  if (typeof navigator === "undefined") {
    return "Ctrl+K";
  }
  return /Mac|iPhone|iPad|iPod/u.test(navigator.platform) ? "Cmd+K" : "Ctrl+K";
}

export function getSidebarThreadSearchOptionId(rowId: string): string {
  return `${SIDEBAR_THREAD_SEARCH_LISTBOX_ID}-option-${rowId}`;
}

export function haveSameSidebarThreadSearchNavigationItems(
  left: readonly SidebarThreadSearchNavigationItem[],
  right: readonly SidebarThreadSearchNavigationItem[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every(
    (item, index) =>
      item.id === right[index]?.id && item.optionId === right[index]?.optionId,
  );
}
