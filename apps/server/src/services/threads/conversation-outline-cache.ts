import type { ThreadConversationOutlineResponse } from "@bb/server-contract";

/**
 * Server-lifetime cache for full-thread conversation outlines.
 *
 * A thread's outline has one reachable revision: every request resolves the
 * current event high-water mark before consulting this cache. Retaining older
 * `maxSeq` revisions only pins projections that no caller can request again.
 */

const DEFAULT_MAX_ENTRIES = 128;

export interface ThreadConversationOutlineCacheOptions {
  maxEntries?: number;
}

export interface ThreadConversationOutlineCacheKey {
  threadId: string;
  maxSeq: number;
}

export interface ThreadConversationOutlineCache {
  getOrBuild(
    key: ThreadConversationOutlineCacheKey,
    build: () => ThreadConversationOutlineResponse,
  ): ThreadConversationOutlineResponse;
  /** Number of cached threads (for tests/metrics). */
  readonly size: number;
}

interface ThreadConversationOutlineCacheEntry {
  maxSeq: number;
  response: ThreadConversationOutlineResponse;
}

export function createThreadConversationOutlineCache(
  options: ThreadConversationOutlineCacheOptions = {},
): ThreadConversationOutlineCache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const entries = new Map<string, ThreadConversationOutlineCacheEntry>();

  return {
    getOrBuild(key, build) {
      const cached = entries.get(key.threadId);
      if (cached?.maxSeq === key.maxSeq) {
        entries.delete(key.threadId);
        entries.set(key.threadId, cached);
        return cached.response;
      }

      const response = build();
      entries.delete(key.threadId);
      entries.set(key.threadId, { maxSeq: key.maxSeq, response });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        entries.delete(oldest);
      }
      return response;
    },
    get size() {
      return entries.size;
    },
  };
}
