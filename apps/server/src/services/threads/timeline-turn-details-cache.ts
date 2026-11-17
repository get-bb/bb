import type { DbConnection } from "@bb/db";
import type { TimelineRow } from "@bb/server-contract";
import { measureTimelineContentLeafBytes } from "./timeline-content-pagination.js";
import {
  createThreadDerivedCache,
  type ThreadDerivedCache,
} from "./thread-derived-cache.js";

export interface TimelineTurnDetailsProjection {
  leafBytes: readonly number[];
  rows: TimelineRow[];
}

const caches = new WeakMap<
  DbConnection,
  ThreadDerivedCache<TimelineTurnDetailsProjection>
>();

function getCache(
  db: DbConnection,
): ThreadDerivedCache<TimelineTurnDetailsProjection> {
  let cache = caches.get(db);
  if (cache === undefined) {
    cache = createThreadDerivedCache({
      maxEntries: 32,
      bytes: {
        maxBytes: 32 * 1024 * 1024,
        maxEntryBytes: 8 * 1024 * 1024,
        measure: ({ leafBytes }) =>
          leafBytes.reduce((sum, cost) => sum + cost, 0),
      },
    });
    caches.set(db, cache);
  }
  return cache;
}

export function getOrProjectTimelineTurnDetails(
  db: DbConnection,
  args: {
    project: () => { expiresAt: number | null; rows: TimelineRow[] };
    revision: string;
    slot: string;
    threadId: string;
  },
): TimelineTurnDetailsProjection {
  return getCache(db).getOrBuild({
    revision: args.revision,
    slot: args.slot,
    threadId: args.threadId,
    build: () => {
      const { expiresAt, rows } = args.project();
      return {
        expiresAt,
        value: { leafBytes: measureTimelineContentLeafBytes(rows), rows },
      };
    },
  });
}
