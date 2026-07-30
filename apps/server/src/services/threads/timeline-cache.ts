import type { ThreadTimelineResponse } from "@bb/server-contract";
import type { ThreadStatus } from "@bb/domain";
import type { ThreadTimelinePageRequest } from "./timeline-pagination.js";

/**
 * Idle/warm-repeat cache for built timeline responses.
 *
 * `buildThreadTimeline` is a pure, deterministic projection of a thread's
 * events. The build (event JSON-decode + projection) is the dominant cost of a
 * timeline request (~130-260ms on large threads) and is recomputed from scratch
 * on every request — there is no other caching. The same window is rebuilt
 * verbatim whenever a thread is refetched without new events: double-mounts
 * (detail view + side-chat tabs), debounced realtime invalidations that fire
 * after the tail already settled, and re-opening a thread.
 *
 * The thread high-water `maxSeq` makes invalidation implicit: any appended
 * event bumps `maxSeq`, producing a cold rebuild. Each request shape retains
 * only its newest revision because the endpoint always resolves the current
 * high-water sequence; client deltas use a separate latest-rows cache. The
 * request shape MUST also include every other input the projection depends on:
 * `thread.status` (interrupt flips earlier rows), `environmentId` (workspace
 * root relativizes file paths), provider display name (labels dynamic-provider
 * diagnostic rows), and the row-shape request flags. Event pruning
 * (`pruneResolvedItemDeltas`, background-task progress) is output-preserving
 * and never lowers `maxSeq`, so it cannot stale a cached entry.
 *
 * Entries with many rows are not cached: an expanded active turn (the streaming
 * case) can produce hundreds of rows and a `maxSeq` that changes on every
 * event, so caching it only pins large objects for no reuse. Smaller active
 * windows can still fall below the row cap; replacing their prior revision
 * prevents streaming updates from filling the LRU with unreachable responses.
 */

const DEFAULT_MAX_ENTRIES = 128;
const DEFAULT_MAX_CACHEABLE_ROWS = 200;

export interface ThreadTimelineCacheOptions {
  maxEntries?: number;
  /** Responses with more rows than this are returned but not stored. */
  maxCacheableRows?: number;
}

export interface ThreadTimelineCache {
  getOrBuild(
    keyArgs: ThreadTimelineCacheKeyArgs,
    build: () => ThreadTimelineResponse,
  ): ThreadTimelineResponse;
  /** Number of currently cached entries (for tests/metrics). */
  readonly size: number;
}

export function createThreadTimelineCache(
  options: ThreadTimelineCacheOptions = {},
): ThreadTimelineCache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxCacheableRows =
    options.maxCacheableRows ?? DEFAULT_MAX_CACHEABLE_ROWS;
  const entries = new Map<
    string,
    { revisionKey: string; response: ThreadTimelineResponse }
  >();

  return {
    getOrBuild(keyArgs, build) {
      const paramsKey = buildThreadTimelineParamsKey(keyArgs);
      const revisionKey = buildThreadTimelineCacheKey(keyArgs);
      const cached = entries.get(paramsKey);
      if (cached?.revisionKey === revisionKey) {
        // Re-insert to mark most-recently-used.
        entries.delete(paramsKey);
        entries.set(paramsKey, cached);
        return cached.response;
      }

      const value = build();
      // A successful build supersedes the unreachable prior revision even when
      // the new response is too large to cache.
      entries.delete(paramsKey);
      if (value.rows.length <= maxCacheableRows) {
        entries.set(paramsKey, { revisionKey, response: value });
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
    get size() {
      return entries.size;
    },
  };
}

export interface ThreadTimelineCacheKeyArgs {
  threadId: string;
  /** Thread high-water event sequence; bumps on every appended event. */
  maxSeq: number;
  status: ThreadStatus;
  environmentId: string | null;
  providerDisplayName?: string;
  page: ThreadTimelinePageRequest;
  includeNestedRows: boolean;
  summaryOnly: boolean;
  includeProviderUnhandledOperations: boolean;
}

function pageKeyPart(page: ThreadTimelinePageRequest): string {
  return page.kind === "older"
    ? `older:${page.segmentLimit}:${page.beforeCursor.anchorSeq}:${page.beforeCursor.anchorId}`
    : `latest:${page.segmentLimit}`;
}

/**
 * The cache identity *excluding* `maxSeq` — i.e. everything that selects which
 * window is being requested, but not which revision of it. Used to track the
 * latest-sent rows per request shape for delta computation.
 */
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
    args.includeProviderUnhandledOperations ? "1" : "0",
  ].join("|");
}

export function buildThreadTimelineCacheKey(
  args: ThreadTimelineCacheKeyArgs,
): string {
  return `${args.maxSeq}|${buildThreadTimelineParamsKey(args)}`;
}
