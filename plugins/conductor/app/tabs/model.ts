import type {
  ExperimentalPanelTab,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

const GIT_PLUGIN_ID = "bb--git";
const GIT_DIFF_TAB_ID = "diff";

export function workspaceChats(
  threads: readonly PluginSidebarThread[],
  environmentId: string | null,
  currentThreadId: string | null,
): PluginSidebarThread[] {
  if (environmentId === null) return [];
  return threads
    .filter(
      (thread) =>
        thread.environment?.id === environmentId &&
        !thread.isArchived &&
        (thread.id === currentThreadId ||
          (!thread.isHidden && thread.parentThreadId === null)),
    )
    .sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    );
}

export function findDiffTabKey(
  tabs: readonly ExperimentalPanelTab[],
): string | null {
  return (
    tabs.find(
      (tab) =>
        tab.detail.kind === "plugin" &&
        tab.detail.pluginId === GIT_PLUGIN_ID &&
        tab.detail.tab.id === GIT_DIFF_TAB_ID,
    )?.key ?? null
  );
}

export function tabAfterClose(
  chats: readonly PluginSidebarThread[],
  closingId: string,
): PluginSidebarThread | null {
  const index = chats.findIndex((chat) => chat.id === closingId);
  if (index === -1) return null;
  return chats[index + 1] ?? chats[index - 1] ?? null;
}
