import type { DbConnection } from "@bb/db";
import type { TimelineRow } from "@bb/server-contract";
import { measureTimelineContentLeafBytes } from "./timeline-content-pagination.js";

export interface TimelineTurnDetailsProjection {
  expiresAt: number | null;
  leafBytes: readonly number[];
  rows: TimelineRow[];
}

interface TimelineTurnDetailsCacheEntry extends TimelineTurnDetailsProjection {
  bytes: number;
  revision: string;
}

interface TimelineTurnDetailsCache {
  bytes: number;
  entries: Map<string, TimelineTurnDetailsCacheEntry>;
}

const MAX_ENTRIES = 32;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

const caches = new WeakMap<DbConnection, TimelineTurnDetailsCache>();

function getCache(db: DbConnection): TimelineTurnDetailsCache {
  let cache = caches.get(db);
  if (cache === undefined) {
    cache = { bytes: 0, entries: new Map() };
    caches.set(db, cache);
  }
  return cache;
}

function deleteEntry(cache: TimelineTurnDetailsCache, slot: string): void {
  const entry = cache.entries.get(slot);
  if (entry === undefined) {
    return;
  }
  cache.entries.delete(slot);
  cache.bytes -= entry.bytes;
}

export function getOrProjectTimelineTurnDetails(
  db: DbConnection,
  args: {
    now: number;
    project: () => Pick<TimelineTurnDetailsProjection, "expiresAt" | "rows">;
    revision: string;
    slot: string;
  },
): TimelineTurnDetailsProjection {
  const cache = getCache(db);
  const cached = cache.entries.get(args.slot);
  if (cached !== undefined) {
    deleteEntry(cache, args.slot);
    if (
      cached.revision === args.revision &&
      (cached.expiresAt === null || args.now < cached.expiresAt)
    ) {
      cache.entries.set(args.slot, cached);
      cache.bytes += cached.bytes;
      return cached;
    }
  }
  const projected = args.project();
  const leafBytes = measureTimelineContentLeafBytes(projected.rows);
  const bytes = leafBytes.reduce((sum, cost) => sum + cost, 0);
  const entry: TimelineTurnDetailsCacheEntry = {
    ...projected,
    bytes,
    leafBytes,
    revision: args.revision,
  };
  if (bytes <= MAX_ENTRY_BYTES) {
    cache.entries.set(args.slot, entry);
    cache.bytes += bytes;
    while (cache.entries.size > MAX_ENTRIES || cache.bytes > MAX_BYTES) {
      const oldest = cache.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      deleteEntry(cache, oldest);
    }
  }
  return entry;
}
