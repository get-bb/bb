export const SIDEBAR_WINDOWED_NAV_ATTRIBUTE = "data-sidebar-windowed-nav";

export interface SidebarWindowedNavigationEntry {
  threadId: string;
  projectId: string;
}

export function encodeSidebarWindowedNavigationEntries(
  entries: readonly SidebarWindowedNavigationEntry[],
): string {
  return entries
    .map((entry) => `${entry.threadId}:${entry.projectId}`)
    .join(" ");
}
