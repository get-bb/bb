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
 * Keying on the thread high-water `maxSeq` makes invalidation implicit: any
 * appended event bumps `maxSeq`, producing a new key and a cold rebuild. The
 * key MUST also include every other input the projection depends on:
 * `thread.status` (interrupt flips earlier rows), `environmentId` (workspace
 * root relativizes file paths), provider display name (labels dynamic-provider
 * diagnostic rows), and the row-shape request flags. Event pruning
 * (`pruneResolvedItemDeltas`, background-task progress) is output-preserving
 * and never lowers `maxSeq`, so it cannot stale a cached entry.
 *
 * Entries with many rows are not stored in the LRU: an expanded active turn
 * (the streaming case) produces hundreds of rows AND a `maxSeq` that changes on
 * every event, so retaining it only thrashes the LRU and pins large objects for
 * no reuse. Idle windows collapse completed turns to a handful of rows
 * regardless of thread size, so the cap excludes exactly the entries that would
 * never be reused.
 *
 * Those uncached streaming windows are instead shared through a short-lived
 * last-build slot per params key (the key minus `maxSeq`). Several clients
 * watch the same streaming thread (desktop, browser, phone, plugin panes), each
 * on its own refetch pacing, so one appended event fans out into several
 * back-to-back synchronous rebuilds of near-identical windows — they serialize
 * on the event loop and stall every other request. The slot serves them all
 * from one build:
 *
 * - Same key inside {@link DEFAULT_SHARE_WINDOW_MS}: the build is shared
 *   whatever its row count. Identical key means identical output (the build is
 *   deterministic), so this is invisible except in build count. The build is
 *   synchronous, so it completes before the next request can start; sharing the
 *   completed result is what coalesces loop-serialized concurrent requests.
 * - New `maxSeq` inside the window: the prior window is returned as-is — a
 *   rebuild floor. The response carries its own `maxSeq`, so the client simply
 *   sees the thread as of ≤{@link DEFAULT_SHARE_WINDOW_MS} ago, below client
 *   refetch pacing. The floor applies ONLY to responses over the LRU row cap:
 *   LRU-cacheable windows already coalesce same-key storms via the LRU, and
 *   keeping their rebuilds eager preserves per-request freshness for every
 *   window the LRU can serve. `thread.status` lives in the params key, so a
 *   status flip (interrupt, completion) is never floored.
 */

const DEFAULT_MAX_ENTRIES = 128;
const DEFAULT_MAX_CACHEABLE_ROWS = 200;
const DEFAULT_SHARE_WINDOW_MS = 250;

interface ThreadTimelineCacheOptions {
  maxEntries?: number;
  /** Responses with more rows than this are returned but not LRU-stored. */
  maxCacheableRows?: number;
  /** How long one build is shared across requests of the same params key. */
  shareWindowMs?: number;
  /** Clock override for tests; defaults to Date.now. */
  now?: () => number;
}

interface ThreadTimelineCacheKeys {
  /** Full cache key including `maxSeq` ({@link buildThreadTimelineCacheKey}). */
  key: string;
  /** The key minus `maxSeq` ({@link buildThreadTimelineParamsKey}). */
  paramsKey: string;
}

interface ThreadTimelineCache {
  getOrBuild(
    keys: ThreadTimelineCacheKeys,
    build: () => ThreadTimelineResponse,
  ): ThreadTimelineResponse;
  /** Number of currently cached LRU entries (for tests/metrics). */
  readonly size: number;
}

interface RecentBuild {
  key: string;
  value: ThreadTimelineResponse;
  builtAt: number;
}

export function createThreadTimelineCache(
  options: ThreadTimelineCacheOptions = {},
): ThreadTimelineCache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxCacheableRows =
    options.maxCacheableRows ?? DEFAULT_MAX_CACHEABLE_ROWS;
  const shareWindowMs = options.shareWindowMs ?? DEFAULT_SHARE_WINDOW_MS;
  const now = options.now ?? Date.now;
  const entries = new Map<string, ThreadTimelineResponse>();
  // Requests within a params key arrive with monotonic `maxSeq` (the route
  // reads the current high-water mark), so one slot per params key holding the
  // newest build is enough — no request can want an older revision. Expired
  // slots are swept on every store, so the map holds at most the few windows
  // built in the last share window.
  const recentBuilds = new Map<string, RecentBuild>();

  return {
    getOrBuild(keys, build) {
      const cached = entries.get(keys.key);
      if (cached !== undefined) {
        // Re-insert to mark most-recently-used.
        entries.delete(keys.key);
        entries.set(keys.key, cached);
        return cached;
      }

      const at = now();
      const recent = recentBuilds.get(keys.paramsKey);
      if (recent !== undefined && at - recent.builtAt <= shareWindowMs) {
        if (
          recent.key === keys.key ||
          recent.value.rows.length > maxCacheableRows
        ) {
          return recent.value;
        }
      }

      const value = build();
      if (value.rows.length <= maxCacheableRows) {
        entries.set(keys.key, value);
        while (entries.size > maxEntries) {
          const oldest = entries.keys().next().value;
          if (oldest === undefined) {
            break;
          }
          entries.delete(oldest);
        }
      }
      const builtAt = now();
      recentBuilds.set(keys.paramsKey, { key: keys.key, value, builtAt });
      for (const [paramsKey, slot] of recentBuilds) {
        if (builtAt - slot.builtAt > shareWindowMs) {
          recentBuilds.delete(paramsKey);
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
