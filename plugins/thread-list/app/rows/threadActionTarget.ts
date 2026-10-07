import type {
  PluginThreadActionItem,
  PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";
import type { SidebarThread } from "../model/sidebar-thread.js";

export const RENAME_ACTION_KEY = "core:rename";
export const ARCHIVE_ACTION_KEY = "core:archive";

export function toThreadActionTarget(
  thread: SidebarThread,
): PluginThreadActionTarget {
  const environment = thread.environment;
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    sectionId: thread.sectionId,
    isUnread: thread.isUnread,
    status: thread.status,
    environment:
      environment === null || environment.id === null
        ? null
        : { id: environment.id, path: environment.path },
  };
}

export function withInlineRename(
  items: readonly PluginThreadActionItem[],
  onRename: () => void,
): PluginThreadActionItem[] {
  return items.map((item) =>
    item.key === RENAME_ACTION_KEY
      ? { ...item, action: { ...item.action, run: onRename } }
      : item,
  );
}

export function selectRowActionItems(
  items: readonly PluginThreadActionItem[],
  rowActionKeys: readonly string[],
): PluginThreadActionItem[] {
  return rowActionKeys.flatMap((key) => {
    const item = items.find((candidate) => candidate.key === key);
    return item === undefined ? [] : [item];
  });
}
