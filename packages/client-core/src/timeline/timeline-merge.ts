import type {
  ThreadTimelineResponse,
  TimelinePaginationCursor,
  TimelineRow,
} from "@bb/server-contract";
import { isOptimisticTimelineRowId } from "./optimistic-timeline-row.js";

type NullableTimelinePaginationCursor = TimelinePaginationCursor | null;

export interface LoadedTimelineState {
  historySnapshot?: string;
  latestWindowEndSequence: number | null;
  olderCursor: NullableTimelinePaginationCursor;
  rows: TimelineRow[];
  surfaceKey: string;
}

interface BuildLoadedTimelineStateArgs {
  historySnapshot?: string;
  latestWindowEndSequence: number | null;
  latestRows: TimelineRow[];
  olderCursor: NullableTimelinePaginationCursor;
  surfaceKey: string;
}

interface AreTimelinePaginationCursorsEqualArgs {
  left: NullableTimelinePaginationCursor;
  right: NullableTimelinePaginationCursor;
}

interface MergeLatestTimelineRowsArgs {
  latestRows: readonly TimelineRow[];
  latestWindowStartSequence: number;
  loadedRows: TimelineRow[];
}

interface MergeLatestTimelineRowsResult {
  canMerge: boolean;
  rows: TimelineRow[];
}

interface PreserveTimelineRowIdentityArgs {
  nextRows: readonly TimelineRow[];
  previousRows: readonly TimelineRow[];
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

interface MergeAdvancedSnapshotTimelineRowsArgs {
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
  previousRows,
}: PreserveTimelineRowIdentityArgs): TimelineRow[] {
  const previousRowsById = new Map(previousRows.map((row) => [row.id, row]));
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
    loaded.workKind === "delegation"
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

export function mergeLatestTimelineRows({
  latestRows,
  latestWindowStartSequence,
  loadedRows: retainedRows,
}: MergeLatestTimelineRowsArgs): MergeLatestTimelineRowsResult {
  const loadedRows = retainedRows.some((row) =>
    isOptimisticTimelineRowId(row.id),
  )
    ? retainedRows.filter((row) => !isOptimisticTimelineRowId(row.id))
    : retainedRows;

  const identityPreservedLatestRows = preserveTimelineRowIdentity({
    nextRows: latestRows,
    previousRows: loadedRows,
  });

  if (loadedRows.length === 0) {
    return {
      canMerge: true,
      rows: identityPreservedLatestRows,
    };
  }

  const latestRowsById = new Map(
    identityPreservedLatestRows.map((row) => [row.id, row]),
  );
  const rowsToRetain = loadedRows.filter(
    (row) =>
      row.sourceSeqEnd < latestWindowStartSequence ||
      latestRowsById.has(row.id),
  );
  const retainedRowIds = new Set(rowsToRetain.map((row) => row.id));
  const loadedCommonIds = rowsToRetain.flatMap((row) =>
    latestRowsById.has(row.id) ? [row.id] : [],
  );
  const latestCommonIds = identityPreservedLatestRows.flatMap((row) =>
    retainedRowIds.has(row.id) ? [row.id] : [],
  );
  if (
    loadedCommonIds.length !== latestCommonIds.length ||
    loadedCommonIds.some((id, index) => id !== latestCommonIds[index])
  ) {
    return { canMerge: false, rows: identityPreservedLatestRows };
  }

  const rowsBeforeSharedId = new Map<string, TimelineRow[]>();
  let pendingRows: TimelineRow[] = [];
  for (const row of identityPreservedLatestRows) {
    if (!retainedRowIds.has(row.id)) {
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
  if (areTimelineRowReferencesEqual({ left: loadedRows, right: rows })) {
    return {
      canMerge: true,
      rows: loadedRows,
    };
  }

  return {
    canMerge: true,
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

function mergeAdvancedSnapshotTimelineRows({
  current,
  latestRows,
  latestTimeline,
}: MergeAdvancedSnapshotTimelineRowsArgs): MergeLatestTimelineRowsResult {
  const latestWindowStartSequence = timelineWindowStartSequence(latestTimeline);
  const { olderRowsSourceSeqEnd } = latestTimeline.timelinePage;
  if (
    olderRowsSourceSeqEnd === undefined ||
    (olderRowsSourceSeqEnd !== null &&
      olderRowsSourceSeqEnd > (current.latestWindowEndSequence ?? 0))
  ) {
    return { canMerge: false, rows: [...latestRows] };
  }
  if (latestTimeline.timelinePage.olderCursor === null) {
    return mergeLatestTimelineRows({
      latestRows,
      latestWindowStartSequence,
      loadedRows: current.rows,
    });
  }
  const loadedRows = current.rows.filter(
    (row) => !isOptimisticTimelineRowId(row.id),
  );
  const latestRowIds = new Set(latestRows.map((row) => row.id));
  const firstCoveredIndex = loadedRows.findIndex((row) =>
    latestRowIds.has(row.id),
  );
  if (firstCoveredIndex === -1) {
    return latestWindowStartSequence > (current.latestWindowEndSequence ?? 0)
      ? { canMerge: true, rows: [...loadedRows, ...latestRows] }
      : { canMerge: false, rows: [...latestRows] };
  }
  const coveredMerge = mergeLatestTimelineRows({
    latestRows,
    latestWindowStartSequence: 0,
    loadedRows: loadedRows.slice(firstCoveredIndex),
  });
  if (!coveredMerge.canMerge) {
    return coveredMerge;
  }
  const rows = [
    ...loadedRows.slice(0, firstCoveredIndex),
    ...coveredMerge.rows,
  ];
  return {
    canMerge: true,
    rows: areTimelineRowReferencesEqual({ left: current.rows, right: rows })
      ? current.rows
      : rows,
  };
}

function loadedTimelineStateFromLatest(
  latestTimeline: ThreadTimelineResponse,
  surfaceKey: string,
  rows: TimelineRow[] = latestTimeline.rows,
): LoadedTimelineState {
  return {
    historySnapshot: latestTimeline.timelinePage.historySnapshot,
    latestWindowEndSequence: latestTimeline.maxSeq,
    olderCursor: latestTimeline.timelinePage.olderCursor,
    rows,
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
    (current.historySnapshot === undefined) !==
      (latestHistorySnapshot === undefined) ||
    !timelineWindowsAreContiguous(current, latestTimeline)
  ) {
    return loadedTimelineStateFromLatest(latestTimeline, surfaceKey);
  }

  const currentRowsById = new Map(current.rows.map((row) => [row.id, row]));
  const latestRows =
    current.historySnapshot === undefined
      ? latestTimeline.rows
      : latestTimeline.rows.map((row) => {
          const loaded = currentRowsById.get(row.id);
          return loaded === undefined
            ? row
            : prependOlderTimelineRows({
                olderRows: [loaded],
                loadedRows: [row],
              })[0]!;
        });
  const latestMerge =
    current.historySnapshot === latestHistorySnapshot
      ? mergeLatestTimelineRows({
          latestRows,
          latestWindowStartSequence:
            timelineWindowStartSequence(latestTimeline),
          loadedRows: current.rows,
        })
      : mergeAdvancedSnapshotTimelineRows({
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
    olderCursor: mergeLoadedTimelineOlderCursor(
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
  if (
    current.surfaceKey !== surfaceKey ||
    current.historySnapshot !== latestTimeline.timelinePage.historySnapshot
  ) {
    return loadedTimelineStateFromLatest(latestTimeline, surfaceKey);
  }

  const latestMerge = mergeLatestTimelineRows({
    latestRows: latestTimeline.rows,
    latestWindowStartSequence: timelineWindowStartSequence(latestTimeline),
    loadedRows: current.rows,
  });
  if (!latestMerge.canMerge) {
    return loadedTimelineStateFromLatest(latestTimeline, surfaceKey);
  }

  return loadedTimelineStateFromLatest(
    latestTimeline,
    surfaceKey,
    latestMerge.rows,
  );
}
