import type {
  ThreadTimelineResponse,
  TimelinePaginationCursor,
  TimelineRow,
} from "@bb/server-contract";
import { isOptimisticTimelineRowId } from "./optimistic-timeline-row.js";

type NullableTimelinePaginationCursor = TimelinePaginationCursor | null;

export interface LoadedTimelineState {
  historySnapshot: string | null;
  latestWindowEndSequence: number | null;
  olderCursor: NullableTimelinePaginationCursor;
  rows: TimelineRow[];
  surfaceKey: string;
}

interface BuildLoadedTimelineStateArgs {
  historySnapshot: string | null;
  latestWindowEndSequence: number | null;
  latestRows: TimelineRow[];
  olderCursor: NullableTimelinePaginationCursor;
  surfaceKey: string;
}

interface AreTimelinePaginationCursorsEqualArgs {
  left: NullableTimelinePaginationCursor;
  right: NullableTimelinePaginationCursor;
}

interface MergeRetainedTimelineRowsArgs {
  latestRows: readonly TimelineRow[];
  loadedRowCount: number;
  rowsToRetain: readonly TimelineRow[];
  sharedLoadedRowsById: ReadonlyMap<string, TimelineRow>;
}

interface TimelineRowsMergeResult {
  canMerge: boolean;
  droppedLoadedRows: boolean;
  rows: TimelineRow[];
}

interface PreserveTimelineRowIdentityArgs {
  nextRows: readonly TimelineRow[];
  previousRowsById: ReadonlyMap<string, TimelineRow>;
}

interface AreTimelineRowReferencesEqualArgs {
  left: readonly TimelineRow[];
  right: readonly TimelineRow[];
}

interface PrependOlderTimelineRowsArgs {
  loadedRows: readonly TimelineRow[];
  olderRows: readonly TimelineRow[];
}

interface MergeLoadedTimelineWithLatestArgs {
  current: LoadedTimelineState;
  latestTimeline: ThreadTimelineResponse;
  surfaceKey: string;
}

interface MergeLatestIntoLoadedRowsArgs {
  current: LoadedTimelineState;
  latestRows: readonly TimelineRow[];
  latestTimeline: ThreadTimelineResponse;
}

interface RecoverLoadedTimelineAfterStaleCursorArgs {
  current: LoadedTimelineState;
  latestTimeline: ThreadTimelineResponse;
  surfaceKey: string;
}

export function resolveLoadedTimelineSurfaceKey(
  baseSurfaceKey: string,
  latestTimeline:
    | Pick<
        ThreadTimelineResponse,
        "completedTurnDisplay" | "contextBoundarySeq"
      >
    | undefined,
): string {
  if (latestTimeline === undefined) {
    return baseSurfaceKey;
  }
  const displaySurfaceKey = `${baseSurfaceKey}:completed-turns:${latestTimeline.completedTurnDisplay}`;
  return latestTimeline.contextBoundarySeq === null
    ? displaySurfaceKey
    : `${displaySurfaceKey}:context-boundary:${latestTimeline.contextBoundarySeq}`;
}

export function buildLoadedTimelineState({
  historySnapshot,
  latestWindowEndSequence,
  latestRows,
  olderCursor,
  surfaceKey,
}: BuildLoadedTimelineStateArgs): LoadedTimelineState {
  return {
    historySnapshot,
    latestWindowEndSequence,
    olderCursor,
    rows: latestRows,
    surfaceKey,
  };
}

export function areTimelinePaginationCursorsEqual({
  left,
  right,
}: AreTimelinePaginationCursorsEqualArgs): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.anchorSeq === right.anchorSeq && left.anchorId === right.anchorId;
}

function appendTimelineRowsPreservingOrder(
  target: TimelineRow[],
  rows: readonly TimelineRow[],
): void {
  const seenIds = new Set(target.map((row) => row.id));
  for (const row of rows) {
    if (seenIds.has(row.id)) {
      continue;
    }
    seenIds.add(row.id);
    target.push(row);
  }
}

function timelineRowIdentitySignature(row: TimelineRow): string {
  const turnRequest =
    row.kind === "conversation" && row.role === "user" ? row.turnRequest : null;
  return [
    row.kind,
    row.id,
    row.threadId,
    row.turnId ?? "<null>",
    row.sourceSeqStart,
    row.sourceSeqEnd,
    row.startedAt,
    row.createdAt,
    turnRequest?.isGrouped,
    turnRequest?.kind,
    turnRequest?.status,
  ].join("\u001f");
}

function preserveTimelineRowIdentity({
  nextRows,
  previousRowsById,
}: PreserveTimelineRowIdentityArgs): TimelineRow[] {
  return nextRows.map((row) => {
    const previous = previousRowsById.get(row.id);
    if (previous === row) return row;
    if (
      previous &&
      timelineRowIdentitySignature(previous) ===
        timelineRowIdentitySignature(row) &&
      JSON.stringify(previous) === JSON.stringify(row)
    ) {
      return previous;
    }
    return row;
  });
}

function areTimelineRowReferencesEqual({
  left,
  right,
}: AreTimelineRowReferencesEqualArgs): boolean {
  if (left.length !== right.length) return false;
  return left.every((row, index) => row === right[index]);
}

function joinOlderTimelineRowChildren(
  older: TimelineRow,
  loaded: TimelineRow,
): TimelineRow {
  if (
    older.kind === "turn" &&
    loaded.kind === "turn" &&
    older.children !== null &&
    loaded.children !== null
  ) {
    const children = prependOlderTimelineRows({
      olderRows: older.children,
      loadedRows: loaded.children,
    });
    if (
      areTimelineRowReferencesEqual({ left: children, right: loaded.children })
    ) {
      return loaded;
    }
    return {
      ...loaded,
      children,
    };
  }
  if (
    older.kind === "work" &&
    older.workKind === "delegation" &&
    loaded.kind === "work" &&
    loaded.workKind === "delegation" &&
    older.childRows !== null &&
    loaded.childRows !== null
  ) {
    const childRows = prependOlderTimelineRows({
      olderRows: older.childRows,
      loadedRows: loaded.childRows,
    });
    if (
      areTimelineRowReferencesEqual({
        left: childRows,
        right: loaded.childRows,
      })
    ) {
      return loaded;
    }
    return {
      ...loaded,
      childRows,
    };
  }
  return loaded;
}

export function prependOlderTimelineRows({
  loadedRows,
  olderRows,
}: PrependOlderTimelineRowsArgs): TimelineRow[] {
  const uniqueLoadedRows: TimelineRow[] = [];
  appendTimelineRowsPreservingOrder(uniqueLoadedRows, loadedRows);
  const loadedIds = new Set(uniqueLoadedRows.map((row) => row.id));
  const olderById = new Map<string, TimelineRow>();
  const rows: TimelineRow[] = [];
  for (const row of olderRows) {
    if (olderById.has(row.id)) {
      continue;
    }
    olderById.set(row.id, row);
    if (!loadedIds.has(row.id)) {
      rows.push(row);
    }
  }
  for (const loaded of uniqueLoadedRows) {
    const older = olderById.get(loaded.id);
    rows.push(
      older === undefined
        ? loaded
        : joinOlderTimelineRowChildren(older, loaded),
    );
  }
  return rows;
}

function mergeRetainedTimelineRows({
  latestRows,
  loadedRowCount,
  rowsToRetain,
  sharedLoadedRowsById,
}: MergeRetainedTimelineRowsArgs): TimelineRowsMergeResult {
  const identityPreservedLatestRows = preserveTimelineRowIdentity({
    nextRows: latestRows,
    previousRowsById: sharedLoadedRowsById,
  });
  const latestRowsById = new Map(
    identityPreservedLatestRows.map((row) => [row.id, row]),
  );
  const loadedSharedIds = [...sharedLoadedRowsById.keys()];
  const latestSharedIds = identityPreservedLatestRows.flatMap((row) =>
    sharedLoadedRowsById.has(row.id) ? [row.id] : [],
  );
  if (
    loadedSharedIds.length !== latestSharedIds.length ||
    loadedSharedIds.some((id, index) => id !== latestSharedIds[index])
  ) {
    return {
      canMerge: false,
      droppedLoadedRows: true,
      rows: identityPreservedLatestRows,
    };
  }

  const rowsBeforeSharedId = new Map<string, TimelineRow[]>();
  let pendingRows: TimelineRow[] = [];
  for (const row of identityPreservedLatestRows) {
    if (!sharedLoadedRowsById.has(row.id)) {
      pendingRows.push(row);
      continue;
    }
    if (pendingRows.length > 0) {
      rowsBeforeSharedId.set(row.id, pendingRows);
      pendingRows = [];
    }
  }

  const rows: TimelineRow[] = [];
  for (const row of rowsToRetain) {
    const rowsBefore = rowsBeforeSharedId.get(row.id);
    if (rowsBefore) {
      rows.push(...rowsBefore);
    }
    rows.push(latestRowsById.get(row.id) ?? row);
  }
  rows.push(...pendingRows);
  return {
    canMerge: true,
    droppedLoadedRows: rowsToRetain.length < loadedRowCount,
    rows,
  };
}

function timelineWindowStartSequence(timeline: ThreadTimelineResponse): number {
  return timeline.timelinePage.olderCursor?.anchorSeq ?? 0;
}

function timelineWindowsAreContiguous(
  current: LoadedTimelineState,
  latestTimeline: ThreadTimelineResponse,
): boolean {
  return (
    current.latestWindowEndSequence !== null &&
    latestTimeline.maxSeq >= current.latestWindowEndSequence &&
    timelineWindowStartSequence(latestTimeline) <=
      current.latestWindowEndSequence + 1
  );
}

function mergeLoadedTimelineOlderCursor(
  current: NullableTimelinePaginationCursor,
  latest: NullableTimelinePaginationCursor,
): NullableTimelinePaginationCursor {
  if (current === null || latest === null) {
    return null;
  }
  return latest.anchorSeq < current.anchorSeq ? latest : current;
}

function applyOlderRowUpdates(
  rows: TimelineRow[],
  updates: readonly TimelineRow[] | undefined,
): TimelineRow[] {
  if (updates === undefined) {
    return rows;
  }
  const updatesById = new Map(updates.map((row) => [row.id, row]));
  return rows.map((row) => {
    const update = updatesById.get(row.id);
    return update === undefined
      ? row
      : prependOlderTimelineRows({
          olderRows: [row],
          loadedRows: [update],
        })[0]!;
  });
}

function mergeLatestIntoLoadedRows({
  current,
  latestRows,
  latestTimeline,
}: MergeLatestIntoLoadedRowsArgs): TimelineRowsMergeResult {
  const { olderCursor, olderRowUpdates, olderRowsSourceSeqEnd } =
    latestTimeline.timelinePage;
  const loadedEnd = current.latestWindowEndSequence ?? 0;
  if (olderRowsSourceSeqEnd !== null && olderRowsSourceSeqEnd > loadedEnd) {
    return { canMerge: false, droppedLoadedRows: true, rows: [...latestRows] };
  }
  const loadedRows = applyOlderRowUpdates(current.rows, olderRowUpdates).filter(
    (row) => !isOptimisticTimelineRowId(row.id),
  );
  const windowStart = timelineWindowStartSequence(latestTimeline);
  const latestRowIds = new Set(latestRows.map((row) => row.id));
  const updatedRowIds = new Set(olderRowUpdates?.map((row) => row.id));
  const isOlderThanWindow = (row: TimelineRow) =>
    olderCursor !== null &&
    (row.sourceSeqEnd < windowStart ||
      (olderRowsSourceSeqEnd !== null &&
        row.sourceSeqEnd <= olderRowsSourceSeqEnd) ||
      updatedRowIds.has(row.id));
  const rowsToRetain: TimelineRow[] = [];
  const sharedLoadedRowsById = new Map<string, TimelineRow>();
  for (const row of loadedRows) {
    if (latestRowIds.has(row.id)) {
      sharedLoadedRowsById.set(row.id, row);
      rowsToRetain.push(row);
    } else if (isOlderThanWindow(row)) {
      rowsToRetain.push(row);
    }
  }
  if (sharedLoadedRowsById.size === 0) {
    return windowStart > loadedEnd
      ? {
          canMerge: true,
          droppedLoadedRows: false,
          rows: [...loadedRows, ...latestRows],
        }
      : { canMerge: false, droppedLoadedRows: true, rows: [...latestRows] };
  }
  const merge = mergeRetainedTimelineRows({
    latestRows,
    loadedRowCount: loadedRows.length,
    rowsToRetain,
    sharedLoadedRowsById,
  });
  return merge.canMerge &&
    areTimelineRowReferencesEqual({ left: current.rows, right: merge.rows })
    ? { ...merge, rows: current.rows }
    : merge;
}

function loadedTimelineStateFromLatest(
  latestTimeline: ThreadTimelineResponse,
  surfaceKey: string,
): LoadedTimelineState {
  return {
    historySnapshot: latestTimeline.timelinePage.historySnapshot,
    latestWindowEndSequence: latestTimeline.maxSeq,
    olderCursor: latestTimeline.timelinePage.olderCursor,
    rows: latestTimeline.rows,
    surfaceKey,
  };
}

export function mergeLoadedTimelineWithLatest({
  current,
  latestTimeline,
  surfaceKey,
}: MergeLoadedTimelineWithLatestArgs): LoadedTimelineState {
  const latestHistorySnapshot = latestTimeline.timelinePage.historySnapshot;
  if (
    current.surfaceKey !== surfaceKey ||
    !timelineWindowsAreContiguous(current, latestTimeline)
  ) {
    return loadedTimelineStateFromLatest(latestTimeline, surfaceKey);
  }

  const currentRowsById = new Map(current.rows.map((row) => [row.id, row]));
  const latestRows = latestTimeline.rows.map((row) => {
    const loaded = currentRowsById.get(row.id);
    return loaded === undefined
      ? row
      : prependOlderTimelineRows({
          olderRows: [loaded],
          loadedRows: [row],
        })[0]!;
  });
  const latestMerge = mergeLatestIntoLoadedRows({
    current,
    latestRows,
    latestTimeline,
  });
  if (!latestMerge.canMerge) {
    return loadedTimelineStateFromLatest(latestTimeline, surfaceKey);
  }

  return {
    ...current,
    historySnapshot: latestHistorySnapshot,
    latestWindowEndSequence: latestTimeline.maxSeq,
    olderCursor: latestMerge.droppedLoadedRows
      ? latestTimeline.timelinePage.olderCursor
      : mergeLoadedTimelineOlderCursor(
          current.olderCursor,
          latestTimeline.timelinePage.olderCursor,
        ),
    rows: latestMerge.rows,
  };
}

export function recoverLoadedTimelineAfterStaleCursor({
  current,
  latestTimeline,
  surfaceKey,
}: RecoverLoadedTimelineAfterStaleCursorArgs): LoadedTimelineState {
  if (current.historySnapshot !== latestTimeline.timelinePage.historySnapshot) {
    return loadedTimelineStateFromLatest(latestTimeline, surfaceKey);
  }
  return {
    ...mergeLoadedTimelineWithLatest({ current, latestTimeline, surfaceKey }),
    olderCursor: latestTimeline.timelinePage.olderCursor,
  };
}
