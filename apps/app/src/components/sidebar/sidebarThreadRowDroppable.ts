const SIDEBAR_THREAD_ROW_DROPPABLE_PREFIX = "sidebar:thread-row:";

export type SidebarNestTargetState = "valid" | "blocked" | "unchanged";

export type SidebarReorderPlacement = "before" | "after";

export interface ThreadRowNestDrop {
  setNodeRef: (element: HTMLElement | null) => void;
  state: SidebarNestTargetState | null;
  reorderPlacement: SidebarReorderPlacement | null;
}

export function getSidebarThreadRowDroppableId(threadId: string): string {
  return `${SIDEBAR_THREAD_ROW_DROPPABLE_PREFIX}${threadId}`;
}

export function parseSidebarThreadRowDroppableId(id: string): string | null {
  return id.startsWith(SIDEBAR_THREAD_ROW_DROPPABLE_PREFIX)
    ? id.slice(SIDEBAR_THREAD_ROW_DROPPABLE_PREFIX.length)
    : null;
}
