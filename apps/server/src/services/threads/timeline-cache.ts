import type { ThreadTimelineResponse } from "@bb/server-contract";
import type { ThreadStatus } from "@bb/domain";
import type { ThreadTimelinePageRequest } from "./timeline-pagination.js";

const DEFAULT_MAX_ENTRIES = 128;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

interface ThreadTimelineCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
}

interface ThreadTimelineCache {
  getOrBuild(
    threadId: string,
    key: string,
    build: () => ThreadTimelineResponse,
  ): ThreadTimelineResponse;
  invalidateThread(threadId: string): void;
  readonly size: number;
}

interface ThreadTimelineCacheEntry {
  bytes: number;
  response: ThreadTimelineResponse;
  threadId: string;
}

export function createThreadTimelineCache(
  options: ThreadTimelineCacheOptions = {},
): ThreadTimelineCache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const entries = new Map<string, ThreadTimelineCacheEntry>();
  let totalBytes = 0;

  function deleteEntry(key: string): void {
    const entry = entries.get(key);
    if (entry === undefined) return;
    totalBytes -= entry.bytes;
    entries.delete(key);
  }

  return {
    getOrBuild(threadId, key, build) {
      const cached = entries.get(key);
      if (cached !== undefined) {
        entries.delete(key);
        entries.set(key, cached);
        return cached.response;
      }

      const value = build();
      const bytes = Buffer.byteLength(JSON.stringify(value));
      if (bytes <= maxBytes) {
        entries.set(key, { bytes, response: value, threadId });
        totalBytes += bytes;
        while (entries.size > maxEntries || totalBytes > maxBytes) {
          const oldest = entries.keys().next().value;
          if (oldest === undefined) {
            break;
          }
          deleteEntry(oldest);
        }
      }
      return value;
    },
    invalidateThread(threadId) {
      for (const [key, entry] of entries) {
        if (entry.threadId === threadId) {
          deleteEntry(key);
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
  maxSeq: number;
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

export function buildThreadTimelineParamsKey(
  args: Omit<ThreadTimelineCacheKeyArgs, "maxSeq">,
): string {
  return [
    args.threadId,
    args.status,
    args.surface,
    pageKeyPart(args.page),
    args.summaryOnly ? "1" : "0",
  ].join("|");
}

export function buildThreadTimelineCacheKey(
  args: ThreadTimelineCacheKeyArgs,
): string {
  return `${args.maxSeq}|${buildThreadTimelineParamsKey(args)}`;
}
