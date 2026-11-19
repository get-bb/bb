import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export type ConversationGroupLabel =
  | "Today"
  | "Yesterday"
  | "Previous 7 days"
  | "Older";

export interface ConversationGroup {
  label: ConversationGroupLabel;
  conversations: PluginSidebarThread[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function groupLabel(updatedAt: number, now: number): ConversationGroupLabel {
  const today = startOfDay(now);
  if (updatedAt >= today) return "Today";
  if (updatedAt >= today - DAY_MS) return "Yesterday";
  if (updatedAt >= today - 7 * DAY_MS) return "Previous 7 days";
  return "Older";
}

export function listConversations(
  threads: readonly PluginSidebarThread[],
  query: string,
): PluginSidebarThread[] {
  const needle = query.trim().toLocaleLowerCase();
  return threads
    .filter(
      (thread) =>
        !thread.isHidden &&
        !thread.isArchived &&
        thread.parentThreadId === null &&
        (needle.length === 0 ||
          thread.displayTitle.toLocaleLowerCase().includes(needle)),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function groupConversations(
  conversations: readonly PluginSidebarThread[],
  now: number,
): ConversationGroup[] {
  const groups: ConversationGroup[] = [];
  for (const conversation of conversations) {
    const label = groupLabel(conversation.updatedAt, now);
    const last = groups.at(-1);
    if (last?.label === label) {
      last.conversations.push(conversation);
    } else {
      groups.push({ label, conversations: [conversation] });
    }
  }
  return groups;
}
