import type { ThreadTimelineResponse } from "@bb/server-contract";
import type { ThreadStatus } from "@bb/domain";
import type { ThreadTimelinePageRequest } from "./timeline-pagination.js";
import { timelineWindowJsonLength } from "./timeline-window-tag.js";

const DEFAULT_MAX_ENTRIES = 512;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_BYTES = 2 * 1024 * 1024;

interface ThreadTimelineCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
  maxEntryBytes?: number;
}

interface ThreadTimelineCache {
  getOrBuild(
    threadId: string,
    key: string,
    revision: string,
    build: () => ThreadTimelineResponse,
  ): ThreadTimelineResponse;
  invalidateThread(threadId: string): void;
  readonly size: number;
}

interface ThreadTimelineCacheEntry {
  bytes: number;
  response: ThreadTimelineResponse;
  revision: string;
  threadId: string;
}

export function createThreadTimelineCache(
  options: ThreadTimelineCacheOptions = {},
): ThreadTimelineCache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxEntryBytes = Math.min(
    options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES,
    maxBytes,
  );
  const entries = new Map<string, ThreadTimelineCacheEntry>();
  let totalBytes = 0;

  function deleteEntry(key: string): void {
    const entry = entries.get(key);
    if (entry === undefined) {
      return;
    }
    entries.delete(key);
    totalBytes -= entry.bytes;
  }

  return {
    getOrBuild(threadId, key, revision, build) {
      const cached = entries.get(key);
      if (cached !== undefined) {
        deleteEntry(key);
        if (cached.revision === revision) {
          entries.set(key, cached);
          totalBytes += cached.bytes;
          return cached.response;
        }
      }

      const value = build();
      const bytes = timelineWindowJsonLength(value);
      if (bytes <= maxEntryBytes) {
        entries.set(key, { bytes, response: value, revision, threadId });
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
  page: ThreadTimelinePageRequest;
  summaryOnly: boolean;
  deferContent: boolean;
  includeNestedRows: boolean;
}

export interface ThreadTimelineCacheRevisionArgs {
  maxSeq: number;
  status: ThreadStatus;
  surface: string;
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
    pageKeyPart(args.page),
    args.summaryOnly ? "1" : "0",
    args.deferContent ? "1" : "0",
    args.includeNestedRows ? "1" : "0",
  ].join("|");
}

export function buildThreadTimelineCacheRevision(
  args: ThreadTimelineCacheRevisionArgs,
): string {
  return JSON.stringify([args.maxSeq, args.status, args.surface]);
}
