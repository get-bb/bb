import type { ThreadTimelineResponse } from "@bb/server-contract";
import type { CompletedTurnDisplay, ThreadStatus } from "@bb/domain";
import type { ThreadTimelinePageRequest } from "./timeline-pagination.js";

const DEFAULT_MAX_ENTRIES = 128;
const DEFAULT_MAX_CACHEABLE_ROWS = 200;

interface ThreadTimelineCacheOptions {
  maxEntries?: number;
  maxCacheableRows?: number;
  maxDataBytes?: number;
}

interface ThreadTimelineCache {
  getOrBuild(
    threadId: string,
    key: string,
    build: () => ThreadTimelineResponse,
  ): ThreadTimelineResponse;
  getOrBuildAsync(
    threadId: string,
    key: string,
    build: () => Promise<ThreadTimelineResponse>,
  ): Promise<ThreadTimelineResponse>;
  invalidateThread(threadId: string): void;
  readonly size: number;
}

interface ThreadTimelineCacheEntry {
  response: ThreadTimelineResponse;
  threadId: string;
  dataBytes: number;
}

export function createThreadTimelineCache(
  options: ThreadTimelineCacheOptions = {},
): ThreadTimelineCache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxCacheableRows =
    options.maxCacheableRows ?? DEFAULT_MAX_CACHEABLE_ROWS;
  const maxDataBytes = options.maxDataBytes ?? 32 * 1024 * 1024;
  const entries = new Map<string, ThreadTimelineCacheEntry>();
  const pending = new Map<
    string,
    { threadId: string; result: Promise<ThreadTimelineResponse> }
  >();
  let dataBytes = 0;

  function lookup(key: string) {
    const cached = entries.get(key);
    if (cached !== undefined) {
      entries.delete(key);
      entries.set(key, cached);
    }
    return cached?.response;
  }

  function store(
    threadId: string,
    key: string,
    response: ThreadTimelineResponse,
  ) {
    if (response.rows.length > maxCacheableRows) return;
    const size = Buffer.byteLength(JSON.stringify(response));
    if (size > maxDataBytes) return;
    const previous = entries.get(key);
    if (previous) dataBytes -= previous.dataBytes;
    entries.delete(key);
    entries.set(key, { response, threadId, dataBytes: size });
    dataBytes += size;
    while (entries.size > maxEntries || dataBytes > maxDataBytes) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      dataBytes -= entries.get(oldest)!.dataBytes;
      entries.delete(oldest);
    }
  }

  return {
    getOrBuild(threadId, key, build) {
      const cached = lookup(key);
      if (cached !== undefined) return cached;
      const value = build();
      store(threadId, key, value);
      return value;
    },
    getOrBuildAsync(threadId, key, build) {
      const cached = lookup(key);
      if (cached !== undefined) return Promise.resolve(cached);
      const existing = pending.get(key);
      if (existing !== undefined) return existing.result;
      const result = Promise.resolve()
        .then(build)
        .then((value) => {
          if (pending.get(key)?.result === result) store(threadId, key, value);
          return value;
        })
        .finally(() => {
          if (pending.get(key)?.result === result) pending.delete(key);
        });
      pending.set(key, { threadId, result });
      return result;
    },
    invalidateThread(threadId) {
      for (const [key, entry] of entries) {
        if (entry.threadId === threadId) {
          dataBytes -= entry.dataBytes;
          entries.delete(key);
        }
      }
      for (const [key, entry] of pending) {
        if (entry.threadId === threadId) pending.delete(key);
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
