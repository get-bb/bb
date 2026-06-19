import type { TimelineRow } from "@bb/server-contract";

/**
 * Tracks the most recent full window rows the server sent for a given request
 * shape (params key — everything except `maxSeq`). A delta request supplies the
 * `maxSeq` it last received; when this cache still holds exactly that revision,
 * the server diffs the current window against it to produce a row patch. When
 * the cache has moved on (another client advanced it, or it was evicted) the
 * server falls back to a full response, so this is purely an optimization and
 * never affects correctness.
 *
 * Bounded by entry count. Entries can be large (an expanded active turn is
 * hundreds of rows), so the bound is small — only actively-viewed threads need
 * a live entry.
 */
const DEFAULT_MAX_ENTRIES = 64;

export interface TimelineLatestRows {
  maxSeq: number;
  rows: readonly TimelineRow[];
}

export interface TimelineLatestRowsCache {
  get(paramsKey: string): TimelineLatestRows | undefined;
  set(paramsKey: string, value: TimelineLatestRows): void;
  readonly size: number;
}

export function createTimelineLatestRowsCache(
  options: { maxEntries?: number } = {},
): TimelineLatestRowsCache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const entries = new Map<string, TimelineLatestRows>();

  return {
    get(paramsKey) {
      const value = entries.get(paramsKey);
      if (value !== undefined) {
        entries.delete(paramsKey);
        entries.set(paramsKey, value);
      }
      return value;
    },
    set(paramsKey, value) {
      entries.delete(paramsKey);
      entries.set(paramsKey, value);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        entries.delete(oldest);
      }
    },
    get size() {
      return entries.size;
    },
  };
}
