import type { TimelineRow } from "@bb/server-contract";

/**
 * Tracks the most recent full window rows the server sent for a given request
 * shape (params key — everything except `maxSeq`). A delta request supplies the
 * `maxSeq` it last received; when this cache still holds exactly that revision,
 * the server diffs the current window against it to produce a row patch. When
 * the cache has moved on (it was evicted, or the revision fell out of the ring)
 * the server falls back to a full response, so this is purely an optimization
 * and never affects correctness.
 *
 * Each params key keeps a small ring of recent revisions rather than only the
 * latest one. Two viewers of the same streaming thread (a desktop and a phone,
 * say) poll out of phase: the faster one advances the snapshot, and with a
 * single slot the slower one never finds its own revision and receives the
 * full window on every batch. A ring of a few revisions lets both interleave
 * and still get deltas.
 *
 * Bounded by params-key entry count and by ring depth. Entries can be large
 * (an expanded active turn is hundreds of rows), so both bounds are small —
 * only actively-viewed threads need a live entry.
 */
const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_RING_SIZE = 4;

export interface TimelineLatestRows {
  maxSeq: number;
  rows: readonly TimelineRow[];
}

export interface TimelineLatestRowsCache {
  /** The snapshot sent for `paramsKey` at exactly `maxSeq`, if still held. */
  get(paramsKey: string, maxSeq: number): TimelineLatestRows | undefined;
  set(paramsKey: string, value: TimelineLatestRows): void;
  readonly size: number;
}

export function createTimelineLatestRowsCache(
  options: { maxEntries?: number; ringSize?: number } = {},
): TimelineLatestRowsCache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const ringSize = options.ringSize ?? DEFAULT_RING_SIZE;
  // Per params key: newest revision last.
  const entries = new Map<string, TimelineLatestRows[]>();

  function touch(paramsKey: string, ring: TimelineLatestRows[]): void {
    entries.delete(paramsKey);
    entries.set(paramsKey, ring);
  }

  return {
    get(paramsKey, maxSeq) {
      const ring = entries.get(paramsKey);
      if (ring === undefined) {
        return undefined;
      }
      touch(paramsKey, ring);
      return ring.find((entry) => entry.maxSeq === maxSeq);
    },
    set(paramsKey, value) {
      const ring = entries.get(paramsKey) ?? [];
      // A revision is immutable for a params key: the same maxSeq names the
      // same rows, so a repeat set (two clients polling the same revision)
      // only refreshes recency.
      const existingIndex = ring.findIndex(
        (entry) => entry.maxSeq === value.maxSeq,
      );
      if (existingIndex !== -1) {
        ring.splice(existingIndex, 1);
      }
      ring.push(value);
      while (ring.length > ringSize) {
        ring.shift();
      }
      touch(paramsKey, ring);
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
