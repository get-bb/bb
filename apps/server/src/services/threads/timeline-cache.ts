import type { ThreadTimelineResponse } from "@bb/server-contract";
import type { ThreadStatus } from "@bb/domain";
import type { ThreadTimelinePageRequest } from "./timeline-pagination.js";

const DEFAULT_MAX_ENTRIES = 128;
const DEFAULT_MAX_CACHEABLE_ROWS = 200;

interface ThreadTimelineCacheOptions {
  maxEntries?: number;
  maxCacheableRows?: number;
}

interface ThreadTimelineCache {
  getOrBuild(
    threadId: string,
    key: string,
    maxSeq: number,
    build: () => ThreadTimelineResponse,
  ): ThreadTimelineResponse;
  invalidateThread(threadId: string): void;
  readonly size: number;
}

interface ThreadTimelineCacheEntry {
  maxSeq: number;
  response: ThreadTimelineResponse;
  threadId: string;
}

export function createThreadTimelineCache(
  options: ThreadTimelineCacheOptions = {},
): ThreadTimelineCache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxCacheableRows =
    options.maxCacheableRows ?? DEFAULT_MAX_CACHEABLE_ROWS;
  const entries = new Map<string, ThreadTimelineCacheEntry>();

  return {
    getOrBuild(threadId, key, maxSeq, build) {
      const cached = entries.get(key);
      if (cached !== undefined) {
        entries.delete(key);
        if (cached.maxSeq === maxSeq) {
          entries.set(key, cached);
          return cached.response;
        }
      }

      const value = build();
      if (value.rows.length <= maxCacheableRows) {
        entries.set(key, { maxSeq, response: value, threadId });
        while (entries.size > maxEntries) {
          const oldest = entries.keys().next().value;
          if (oldest === undefined) {
            break;
          }
          entries.delete(oldest);
        }
      }
      return value;
    },
    invalidateThread(threadId) {
      for (const [key, entry] of entries) {
        if (entry.threadId === threadId) {
          entries.delete(key);
        }
      }
    },
    get size() {
      return entries.size;
    },
  };
}

export interface ThreadTimelineCacheKeyArgs {
  threadId: string;
  status: ThreadStatus;
  surface: string;
  page: ThreadTimelinePageRequest;
  summaryOnly: boolean;
}

function pageKeyPart(page: ThreadTimelinePageRequest): string {
  return page.kind === "older"
    ? `older:${page.segmentLimit}:${page.beforeCursor.anchorSeq}:${page.beforeCursor.anchorId}`
    : `latest:${page.segmentLimit}`;
}

export function buildThreadTimelineCacheKey(
  args: ThreadTimelineCacheKeyArgs,
): string {
  return [
    args.threadId,
    args.status,
    args.surface,
    pageKeyPart(args.page),
    args.summaryOnly ? "1" : "0",
  ].join("|");
}
