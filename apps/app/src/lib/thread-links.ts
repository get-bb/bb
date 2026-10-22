import {
  GENERATED_ID_ALPHABET,
  GENERATED_ID_SUFFIX_LENGTH,
  isRawThreadId,
  PERSONAL_PROJECT_ID,
} from "@bb/domain";
import {
  THREAD_MENTION_RESOLVE_MAX_IDS,
  type ResolveThreadMentionsResponse,
} from "@bb/server-contract";

export interface ThreadLinkTarget {
  threadId: string;
  projectId: string;
}

const threadPathPattern = new RegExp(
  `^/(?:projects/(proj_[${GENERATED_ID_ALPHABET}]{${GENERATED_ID_SUFFIX_LENGTH}})/)?threads/([^/]+)/?$`,
  "u",
);

export function parseThreadLink(
  url: string,
  origin: string,
): ThreadLinkTarget | null {
  const parts = /^https?:\/\/([^/]+)(\/[^?#]*)$/iu.exec(url);
  if (parts === null || /[@\\]/u.test(parts[1]!)) return null;
  const path = threadPathPattern.exec(parts[2]!);
  if (path === null || !isRawThreadId(path[2]!)) return null;

  try {
    if (new URL(url).origin !== origin) return null;
  } catch {
    return null;
  }

  return { threadId: path[2]!, projectId: path[1] ?? PERSONAL_PROJECT_ID };
}

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
