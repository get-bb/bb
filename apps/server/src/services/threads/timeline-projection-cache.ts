import type { StoredEventRow } from "@bb/db";
import type { TimelineRow } from "@bb/server-contract";
import type {
  buildThreadTimelineFromProjection,
  EventProjection,
} from "@bb/thread-view";

export interface TimelineProjection {
  compactedEventCount: number;
  rows: TimelineRow[];
  summary: Omit<ReturnType<typeof buildThreadTimelineFromProjection>, "rows">;
}

export interface TimelineProjectionCacheArgs {
  includeNestedRows: boolean;
  projectionKey: string;
  rows: readonly StoredEventRow[];
}

export interface BuiltTimelineProjection {
  eventProjection: EventProjection;
  projection: TimelineProjection;
}

interface TimelineProjectionCacheEntry {
  eventProjection: EventProjection;
  projectionKey: string;
  projections: Map<boolean, TimelineProjection>;
}

export const TIMELINE_PROJECTION_CACHE_MAX_ENTRIES_PER_SELECTION = 4;

const projectionsBySelectedRows = new WeakMap<
  readonly StoredEventRow[],
  TimelineProjectionCacheEntry[]
>();

export function keepTimelineProjection(
  args: TimelineProjectionCacheArgs,
  build: (cached: EventProjection | null) => BuiltTimelineProjection,
): TimelineProjection {
  const entries = projectionsBySelectedRows.get(args.rows) ?? [];
  const entry = entries.find(
    (candidate) => candidate.projectionKey === args.projectionKey,
  );
  const cached = entry?.projections.get(args.includeNestedRows);
  if (cached !== undefined) return cached;
  const built = build(entry?.eventProjection ?? null);
  if (entry !== undefined) {
    entry.projections.set(args.includeNestedRows, built.projection);
    return built.projection;
  }
  projectionsBySelectedRows.set(
    args.rows,
    [
      {
        eventProjection: built.eventProjection,
        projectionKey: args.projectionKey,
        projections: new Map([[args.includeNestedRows, built.projection]]),
      },
      ...entries,
    ].slice(0, TIMELINE_PROJECTION_CACHE_MAX_ENTRIES_PER_SELECTION),
  );
  return built.projection;
}
