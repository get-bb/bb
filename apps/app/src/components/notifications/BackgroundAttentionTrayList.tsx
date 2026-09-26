import type { ThreadPendingInteractionAttentionEntry } from "@bb/server-contract";
import { ThreadPendingInteractionBanner } from "@/components/thread/pending-interactions/ThreadPendingInteractionBanner";
import { getThreadRoutePath } from "@/lib/route-paths";

interface BackgroundAttentionTrayListProps {
  entries: readonly ThreadPendingInteractionAttentionEntry[];
}

export function backgroundAttentionSourceTitle(
  entry: ThreadPendingInteractionAttentionEntry,
): string {
  const thread =
    entry.thread.title ?? entry.thread.titleFallback ?? "Background thread";
  const owner = entry.owner?.title ?? entry.owner?.titleFallback ?? null;
  return owner === null ? thread : `${thread} · ${owner}`;
}

export function BackgroundAttentionTrayList({
  entries,
}: BackgroundAttentionTrayListProps) {
  return entries.map((entry) => (
    <ThreadPendingInteractionBanner
      key={entry.interaction.id}
      initiallyExpanded
      interaction={entry.interaction}
      threadId={entry.thread.id}
      sourceThread={{
        href: getThreadRoutePath({
          projectId: entry.thread.projectId,
          threadId: entry.thread.id,
        }),
        title: backgroundAttentionSourceTitle(entry),
      }}
    />
  ));
}
