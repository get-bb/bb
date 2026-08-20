import type { PendingInteraction, ThreadListEntry } from "@bb/domain";
import { getLatestPendingInteraction } from "../thread-detail/pending-interactions";

/**
 * Child threads whose latest pending interaction the parent surfaces above
 * its own composer (mirrors
 * apps/app/src/hooks/queries/child-thread-pending-interactions.ts).
 */

export interface ChildThreadPendingAttentionSource {
  hasPendingInteraction: boolean;
  id: string;
  title: string;
}

export interface ChildThreadPendingAttention {
  childThreadId: string;
  childTitle: string;
  interaction: PendingInteraction;
}

export function childThreadAttentionSource(
  entry: ThreadListEntry,
  displayTitle: string,
): ChildThreadPendingAttentionSource {
  return {
    hasPendingInteraction: entry.hasPendingInteraction,
    id: entry.id,
    title: displayTitle,
  };
}

/** Ids whose interactions must be fetched (list realtime keeps the flag fresh). */
export function pendingChildThreadIds(
  children: readonly ChildThreadPendingAttentionSource[],
): string[] {
  return children
    .filter((child) => child.hasPendingInteraction)
    .map((child) => child.id);
}

export function collectChildThreadPendingAttention(
  children: readonly ChildThreadPendingAttentionSource[],
  interactionsByThreadId: ReadonlyMap<
    string,
    readonly PendingInteraction[] | undefined
  >,
): ChildThreadPendingAttention[] {
  const items: ChildThreadPendingAttention[] = [];
  for (const child of children) {
    if (!child.hasPendingInteraction) continue;
    const interaction = getLatestPendingInteraction(
      interactionsByThreadId.get(child.id),
    );
    if (!interaction) continue;
    items.push({
      childThreadId: child.id,
      childTitle: child.title,
      interaction,
    });
  }
  return items;
}
