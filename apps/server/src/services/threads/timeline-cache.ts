import type { CompletedTurnDisplay, ThreadStatus } from "@bb/domain";
import type { ThreadTimelinePageRequest } from "./timeline-pagination.js";

const DEFAULT_MAX_ENTRIES = 128;
const DEFAULT_MAX_CACHEABLE_ROWS = 2_000;
const DEFAULT_MAX_TOTAL_ROWS = 12_000;

interface ThreadTimelineCacheOptions {
  maxEntries?: number;
  maxCacheableRows?: number;
  maxTotalRows?: number;
}

interface CacheableTimelineResponse {
  rows: readonly unknown[];
}

interface ThreadTimelineCache<T extends CacheableTimelineResponse> {
  getOrBuild(threadId: string, key: string, build: () => T): T;
  invalidateThread(threadId: string): void;
  readonly size: number;
}

interface ThreadTimelineCacheEntry<T> {
  response: T;
  rowCount: number;
  threadId: string;
}

export function createThreadTimelineCache<
  T extends CacheableTimelineResponse,
>(options: ThreadTimelineCacheOptions = {}): ThreadTimelineCache<T> {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxCacheableRows =
    options.maxCacheableRows ?? DEFAULT_MAX_CACHEABLE_ROWS;
  const maxTotalRows = options.maxTotalRows ?? DEFAULT_MAX_TOTAL_ROWS;
  const entries = new Map<string, ThreadTimelineCacheEntry<T>>();
  let totalRows = 0;

  const remove = (key: string): void => {
    const entry = entries.get(key);
    if (entry === undefined) return;
    entries.delete(key);
    totalRows -= entry.rowCount;
  };

  return {
    getOrBuild(threadId, key, build) {
      const cached = entries.get(key);
      if (cached !== undefined) {
        entries.delete(key);
        entries.set(key, cached);
        return cached.response;
      }

      const value = build();
      const rowCount = value.rows.length;
      if (rowCount <= maxCacheableRows) {
        entries.set(key, { response: value, rowCount, threadId });
        totalRows += rowCount;
        while (entries.size > maxEntries || totalRows > maxTotalRows) {
          const oldest = entries.keys().next().value;
          if (oldest === undefined || oldest === key) {
            break;
          }
          remove(oldest);
        }
      }
      return value;
    },
    invalidateThread(threadId) {
      for (const [key, entry] of entries) {
        if (entry.threadId === threadId) {
          remove(key);
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
  environmentId: string | null;
  providerDisplayName?: string;
  page: ThreadTimelinePageRequest;
  includeNestedRows: boolean;
  summaryOnly: boolean;
  includeDiagnosticOperations: boolean;
  completedTurnDisplay: CompletedTurnDisplay;
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
    args.environmentId ?? "-",
    args.providerDisplayName ?? "-",
    pageKeyPart(args.page),
    args.includeNestedRows ? "1" : "0",
    args.summaryOnly ? "1" : "0",
    args.includeDiagnosticOperations ? "1" : "0",
    args.completedTurnDisplay,
  ].join("|");
}

export function buildThreadTimelineCacheKey(
  args: ThreadTimelineCacheKeyArgs,
): string {
  return `${args.maxSeq}|${buildThreadTimelineParamsKey(args)}`;
}
