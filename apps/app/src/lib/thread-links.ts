import {
  THREAD_MENTION_RESOLVE_MAX_IDS,
  type ResolveThreadMentionsResponse,
} from "@bb/server-contract";

export type ThreadMentionResolution = ResolveThreadMentionsResponse[number];

export type ResolveThreadMentionBatch = (
  threadIds: string[],
  signal: AbortSignal,
) => Promise<readonly ThreadMentionResolution[]>;

export interface ResolvedThreadMentionBatch {
  threadIds: readonly string[];
  threads: readonly ThreadMentionResolution[];
}

export async function resolveThreadMentionsInBatches(
  threadIds: readonly string[],
  resolveBatch: ResolveThreadMentionBatch,
  signal: AbortSignal,
  onBatch: (batch: ResolvedThreadMentionBatch) => void,
): Promise<void> {
  const ids = [...new Set(threadIds)];
  const batches: Promise<void>[] = [];
  for (
    let offset = 0;
    offset < ids.length;
    offset += THREAD_MENTION_RESOLVE_MAX_IDS
  ) {
    const batch = ids.slice(offset, offset + THREAD_MENTION_RESOLVE_MAX_IDS);
    batches.push(
      resolveBatch(batch, signal).then((resolved) => {
        if (signal.aborted) return;
        onBatch({
          threadIds: batch,
          threads: resolved.filter((thread) => batch.includes(thread.threadId)),
        });
      }),
    );
  }
  await Promise.allSettled(batches);
}
