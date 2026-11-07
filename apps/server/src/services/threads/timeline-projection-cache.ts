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
  contextWindowRows: readonly StoredEventRow[];
  headStateRows: readonly StoredEventRow[];
  includeNestedRows: boolean;
  omitSettledDelegationChildRows: boolean;
  projectionKey: string;
  rows: readonly StoredEventRow[];
}

export interface BuiltTimelineProjection {
  eventProjection: EventProjection;
  projection: TimelineProjection;
}

interface TimelineProjectionCacheEntry {
  contextWindowRows: readonly StoredEventRow[];
  eventProjection: EventProjection;
  headStateRows: readonly StoredEventRow[];
  projectionKey: string;
  projections: Map<string, TimelineProjection>;
}

export const TIMELINE_PROJECTION_CACHE_MAX_ENTRIES_PER_SELECTION = 4;

const projectionsBySelectedRows = new WeakMap<
  readonly StoredEventRow[],
  TimelineProjectionCacheEntry[]
>();

function sameStoredRows(
  left: readonly StoredEventRow[],
  right: readonly StoredEventRow[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (row, index) =>
        row.id === right[index]!.id && row.data === right[index]!.data,
    )
  );
}

export function keepTimelineProjection(
  args: TimelineProjectionCacheArgs,
  build: (cached: EventProjection | null) => BuiltTimelineProjection,
): TimelineProjection {
  const entries = projectionsBySelectedRows.get(args.rows) ?? [];
  const entry = entries.find(
    (candidate) =>
      candidate.projectionKey === args.projectionKey &&
      candidate.headStateRows === args.headStateRows &&
      sameStoredRows(candidate.contextWindowRows, args.contextWindowRows),
  );
  const rowsKey = `${args.includeNestedRows}:${args.omitSettledDelegationChildRows}`;
  const cached = entry?.projections.get(rowsKey);
  if (cached !== undefined) return cached;
  const built = build(entry?.eventProjection ?? null);
  if (entry !== undefined) {
    entry.projections.set(rowsKey, built.projection);
    return built.projection;
  }
  projectionsBySelectedRows.set(
    args.rows,
    [
      {
        contextWindowRows: args.contextWindowRows,
        eventProjection: built.eventProjection,
        headStateRows: args.headStateRows,
        projectionKey: args.projectionKey,
        projections: new Map([[rowsKey, built.projection]]),
      },
      ...entries,
    ].slice(0, TIMELINE_PROJECTION_CACHE_MAX_ENTRIES_PER_SELECTION),
  );
  return built.projection;
}
