import type { PluginThreadTitleProps } from "@get-bb/plugin-sdk";
import { ThreadTitle } from "@/components/thread/ThreadTitleMentions";
import { useSidebarThreadEntry } from "@/lib/plugin-sidebar-hooks";
import { getThreadDisplayTitle } from "@/lib/thread-title";

export function PluginThreadTitle({ threadId }: PluginThreadTitleProps) {
  const entry = useSidebarThreadEntry(threadId);
  if (entry === null) return null;
  return <ThreadTitle title={getThreadDisplayTitle(entry)} panOverflow />;
}
