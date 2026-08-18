import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ThreadTimelineResponse,
  TimelinePaginationCursor,
  TimelineRow,
} from "@bb/server-contract";
import { useConnectionAwareQueryState } from "@/hooks/queries/connection-aware-query-state";
import { isTransientReadError } from "@/hooks/queries/query-helpers";
import { useThreadTimeline } from "@/hooks/queries/thread-queries";
import { isOptimisticTimelineRowId } from "@/lib/optimistic-timeline-row";
import { BbHttpError, sdk } from "@/lib/sdk";

export type ThreadTimelineRowFilter = (row: TimelineRow) => boolean;

export interface UseThreadTimelineControllerArgs {
  enabled?: boolean;
  rowFilter?: ThreadTimelineRowFilter;
  surfaceKey?: string;
  threadId: string;
}

export interface UseThreadTimelineControllerResult {
  activePromptMode: ThreadTimelineResponse["activePromptMode"];
  activeThinking: ThreadTimelineResponse["activeThinking"];
  activeWorkflows: ThreadTimelineResponse["activeWorkflows"];
  activeBackgroundCommands: ThreadTimelineResponse["activeBackgroundCommands"];
  contextWindowUsage: ThreadTimelineResponse["contextWindowUsage"];
  goal: ThreadTimelineResponse["goal"];
  modelFallback: ThreadTimelineResponse["modelFallback"];
  hasOlderTimelineRows: boolean;
  isLoadingOlderTimelineRows: boolean;
  loadOlderTimelineRows: () => Promise<void>;
  pendingTodos: ThreadTimelineResponse["pendingTodos"];
  timelineError: Error | null;
  timelineLoading: boolean;
  timelineRows: TimelineRow[];
}

type NullableTimelinePaginationCursor = TimelinePaginationCursor | null;

export interface LoadedTimelineState {
  /** Inclusive end of the latest server window already merged into `rows`. */
  latestWindowEndSequence: number | null;
  olderCursor: NullableTimelinePaginationCursor;
  rows: TimelineRow[];
  surfaceKey: string;
}

interface BuildLoadedTimelineStateArgs {
  latestWindowEndSequence: number | null;
  latestRows: TimelineRow[];
  olderCursor: NullableTimelinePaginationCursor;
  surfaceKey: string;
}

interface AreTimelinePaginationCursorsEqualArgs {
  left: NullableTimelinePaginationCursor;
  right: NullableTimelinePaginationCursor;
}

export interface MergeLatestTimelineRowsArgs {
  latestRows: readonly TimelineRow[];
  latestWindowStartSequence: number;
  loadedRows: TimelineRow[];
}

interface MergeLatestTimelineRowsResult {
  canMerge: boolean;
  rows: TimelineRow[];
}

interface TimelineRowIdentityEntry {
  row: TimelineRow;
  signature: string;
}

interface PreserveTimelineRowIdentityArgs {
  nextRows: readonly TimelineRow[];
  previousRows: readonly TimelineRow[];
}

interface AreTimelineRowReferencesEqualArgs {
  left: readonly TimelineRow[];
  right: readonly TimelineRow[];
}

export interface PrependOlderTimelineRowsArgs {
  loadedRows: readonly TimelineRow[];
  olderRows: readonly TimelineRow[];
}

export interface MergeLoadedTimelineWithLatestArgs {
  current: LoadedTimelineState;
  latestTimeline: ThreadTimelineResponse;
  surfaceKey: string;
}

export interface RecoverLoadedTimelineAfterStaleCursorArgs {
  current: LoadedTimelineState;
  latestTimeline: ThreadTimelineResponse;
  surfaceKey: string;
}

interface BuildSurfaceKeyArgs {
  rowFilter: ThreadTimelineRowFilter | undefined;
  surfaceKey: string | undefined;
  threadId: string;
}

function buildSurfaceKey({
  rowFilter,
  surfaceKey,
  threadId,
}: BuildSurfaceKeyArgs): string {
  if (surfaceKey !== undefined) {
    return surfaceKey;
  }
  return rowFilter === undefined ? threadId : `${threadId}:filtered`;
}

function filterTimelineRows({
  rowFilter,
  rows,
}: {
  rowFilter: ThreadTimelineRowFilter | undefined;
  rows: readonly TimelineRow[];
}): TimelineRow[] {
  return rowFilter === undefined ? [...rows] : rows.filter(rowFilter);
}

function filterThreadTimelineResponse({
  response,
  rowFilter,
}: {
  response: ThreadTimelineResponse;
  rowFilter: ThreadTimelineRowFilter | undefined;
}): ThreadTimelineResponse {
  if (rowFilter === undefined) {
    return response;
  }
  return {
    ...response,
    rows: response.rows.filter(rowFilter),
  };
}

function buildLoadedTimelineState({
  latestWindowEndSequence,
  latestRows,
  olderCursor,
  surfaceKey,
}: BuildLoadedTimelineStateArgs): LoadedTimelineState {
  return {
    latestWindowEndSequence,
    olderCursor,
    rows: latestRows,
    surfaceKey,
  };
}

function areTimelinePaginationCursorsEqual({
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
  return [
    row.kind,
    row.id,
    row.threadId,
    row.turnId ?? "<null>",
    row.sourceSeqStart,
    row.sourceSeqEnd,
    row.startedAt,
    row.createdAt,
  ].join("\u001f");
}

function buildTimelineRowIdentityMap(
  rows: readonly TimelineRow[],
): ReadonlyMap<string, TimelineRowIdentityEntry> {
  const rowsById = new Map<string, TimelineRowIdentityEntry>();
  for (const row of rows) {
    rowsById.set(row.id, {
      row,
      signature: timelineRowIdentitySignature(row),
    });
  }
  return rowsById;
}

function preserveTimelineRowIdentity({
  nextRows,
  previousRows,
}: PreserveTimelineRowIdentityArgs): TimelineRow[] {
  const previousRowsById = buildTimelineRowIdentityMap(previousRows);
  return nextRows.map((row) => {
    const previous = previousRowsById.get(row.id);
    if (previous && previous.signature === timelineRowIdentitySignature(row)) {
      return previous.row;
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

export function prependOlderTimelineRows({
  loadedRows,
  olderRows,
}: PrependOlderTimelineRowsArgs): TimelineRow[] {
  const rows: TimelineRow[] = [];
  appendTimelineRowsPreservingOrder(rows, olderRows);
  appendTimelineRowsPreservingOrder(rows, loadedRows);
  return rows;
}

export function mergeLatestTimelineRows({
  latestRows,
  latestWindowStartSequence,
  loadedRows: retainedRows,
}: MergeLatestTimelineRowsArgs): MergeLatestTimelineRowsResult {
  // Optimistic rows are carried by `latestRows` (they are written into the
  // timeline cache) and disappear from it once the server's real row lands.
  // Retaining a copy here would survive that swap: an id minted client-side
  // never overlaps a server id, so the no-overlap branch below would append
  // the server row *after* the stale optimistic one and the message would
  // render twice. This is only observable when nothing else overlaps — a
  // thread whose first message is being sent, e.g. a fresh side chat.
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
  // The latest response is authoritative only from its raw sequence boundary
  // onward. Keep every older row regardless of its kind. A row crossing the
  // boundary is kept only when the new projection carries the same identity,
  // in which case its value is replaced in place below.
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
    // The two projections disagree about row order. There is no unambiguous
    // splice, so the caller must rebuild from the authoritative latest page.
    return { canMerge: false, rows: identityPreservedLatestRows };
  }

  // New latest rows belong immediately before their next shared row. This
  // preserves the old position of a straddling row (and therefore older rows
  // around it), while still honoring server order for newly projected rows.
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

/**
 * First event sequence a window covers. Every pagination cursor names the first
 * sequence the page that issued it covered — that is what makes older pages
 * chain — so the cursor is the exact lower bound of the window it arrived with.
 * No cursor means the page reached the start of the thread.
 */
function timelineWindowStartSequence(timeline: ThreadTimelineResponse): number {
  return timeline.timelinePage.olderCursor?.anchorSeq ?? 0;
}

/**
 * Whether the fresh window continues the loaded one, in raw event sequences.
 *
 * Rows cannot answer this, in three separate ways:
 *
 * - Most events never become a row — `turn/completed`, token-usage and
 *   rate-limit updates — so the distance from the last loaded row to the next
 *   window is routinely non-zero while the history is in fact continuous. A
 *   follow-up submitted on a budgeted thread lands exactly here: the prompt
 *   opens the next window one sequence past a `turn/completed` that is not a
 *   row.
 * - Rows are ordered by where they start, not where they end, so the last row
 *   is not the one that reaches furthest. A turn summary spans its whole turn
 *   while shorter rows that begin later sort after it.
 * - A window's first row can start *below* the window, because the projection
 *   backfills a turn's `turn/started` row from under the cut.
 *
 * Each shape reports a break that is not there, and the caller answers a break
 * by dropping every loaded page — the timeline visibly truncates to the newest
 * window and refills as auto-load pages it back. The sequences the server
 * states outright have none of these failure modes.
 */
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
  return latest.anchorSeq <= current.anchorSeq ? latest : current;
}

export function mergeLoadedTimelineWithLatest({
  current,
  latestTimeline,
  surfaceKey,
}: MergeLoadedTimelineWithLatestArgs): LoadedTimelineState {
  if (
    current.surfaceKey !== surfaceKey ||
    !timelineWindowsAreContiguous(current, latestTimeline)
  ) {
    return buildLoadedTimelineState({
      latestWindowEndSequence: latestTimeline.maxSeq,
      latestRows: latestTimeline.rows,
      olderCursor: latestTimeline.timelinePage.olderCursor,
      surfaceKey,
    });
  }

  const latestMerge = mergeLatestTimelineRows({
    latestRows: latestTimeline.rows,
    latestWindowStartSequence: timelineWindowStartSequence(latestTimeline),
    loadedRows: current.rows,
  });
  if (!latestMerge.canMerge) {
    return buildLoadedTimelineState({
      latestWindowEndSequence: latestTimeline.maxSeq,
      latestRows: latestTimeline.rows,
      olderCursor: latestTimeline.timelinePage.olderCursor,
      surfaceKey,
    });
  }

  return {
    ...current,
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
  if (current.surfaceKey !== surfaceKey) {
    return buildLoadedTimelineState({
      latestWindowEndSequence: latestTimeline.maxSeq,
      latestRows: latestTimeline.rows,
      olderCursor: latestTimeline.timelinePage.olderCursor,
      surfaceKey,
    });
  }

  const latestMerge = mergeLatestTimelineRows({
    latestRows: latestTimeline.rows,
    latestWindowStartSequence: timelineWindowStartSequence(latestTimeline),
    loadedRows: current.rows,
  });
  if (!latestMerge.canMerge) {
    return buildLoadedTimelineState({
      latestWindowEndSequence: latestTimeline.maxSeq,
      latestRows: latestTimeline.rows,
      olderCursor: latestTimeline.timelinePage.olderCursor,
      surfaceKey,
    });
  }

  return {
    latestWindowEndSequence: latestTimeline.maxSeq,
    olderCursor: latestTimeline.timelinePage.olderCursor,
    rows: latestMerge.rows,
    surfaceKey,
  };
}

export function isStaleTimelinePaginationCursorError(error: Error): boolean {
  return (
    error instanceof BbHttpError &&
    error.status === 400 &&
    error.code === "invalid_request"
  );
}

export function useThreadTimelineController({
  enabled = true,
  rowFilter,
  surfaceKey: explicitSurfaceKey,
  threadId,
}: UseThreadTimelineControllerArgs): UseThreadTimelineControllerResult {
  // Inherit the query's normal staleTime so remount/refocus can refresh a
  // timeline that changed while this surface was unmounted.
  const latestTimelineQuery = useThreadTimeline(threadId, {
    enabled,
    refetchOnMount: true,
  });
  const surfaceKey = buildSurfaceKey({
    rowFilter,
    surfaceKey: explicitSurfaceKey,
    threadId,
  });
  const [loadedTimeline, setLoadedTimeline] = useState<LoadedTimelineState>(
    () =>
      buildLoadedTimelineState({
        latestWindowEndSequence: null,
        latestRows: [],
        olderCursor: null,
        surfaceKey,
      }),
  );
  const [isLoadingOlderTimelineRows, setIsLoadingOlderTimelineRows] =
    useState(false);
  const latestTimeline = useMemo(() => {
    if (!latestTimelineQuery.data) {
      return undefined;
    }
    return filterThreadTimelineResponse({
      response: latestTimelineQuery.data,
      rowFilter,
    });
  }, [latestTimelineQuery.data, rowFilter]);

  useEffect(() => {
    if (!latestTimeline) {
      setLoadedTimeline((current) =>
        current.surfaceKey === surfaceKey
          ? current
          : buildLoadedTimelineState({
              latestWindowEndSequence: null,
              latestRows: [],
              olderCursor: null,
              surfaceKey,
            }),
      );
      return;
    }

    setLoadedTimeline((current) =>
      mergeLoadedTimelineWithLatest({
        current,
        latestTimeline,
        surfaceKey,
      }),
    );
  }, [latestTimeline, surfaceKey]);
  const refetchLatestTimeline = latestTimelineQuery.refetch;

  const nextOlderCursor =
    loadedTimeline.surfaceKey === surfaceKey
      ? loadedTimeline.olderCursor
      : null;
  const hasOlderTimelineRows = nextOlderCursor !== null;
  const loadOlderTimelineRows = useCallback(async (): Promise<void> => {
    if (
      !enabled ||
      !nextOlderCursor ||
      !threadId ||
      isLoadingOlderTimelineRows
    ) {
      return;
    }

    setIsLoadingOlderTimelineRows(true);
    try {
      const response = await sdk.threads.timeline({
        beforeAnchorId: nextOlderCursor.anchorId,
        beforeAnchorSeq: String(nextOlderCursor.anchorSeq),
        threadId,
      });
      const olderRows = filterTimelineRows({
        rowFilter,
        rows: response.rows,
      });
      setLoadedTimeline((current) => {
        if (current.surfaceKey !== surfaceKey) {
          return current;
        }
        return {
          ...current,
          olderCursor: areTimelinePaginationCursorsEqual({
            left: current.olderCursor,
            right: nextOlderCursor,
          })
            ? response.timelinePage.olderCursor
            : current.olderCursor,
          rows: prependOlderTimelineRows({
            loadedRows: current.rows,
            olderRows,
          }),
        };
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !isStaleTimelinePaginationCursorError(error)
      ) {
        throw error;
      }

      const latestTimelineResult = await refetchLatestTimeline();
      const recoveredLatestTimeline = latestTimelineResult.data
        ? filterThreadTimelineResponse({
            response: latestTimelineResult.data,
            rowFilter,
          })
        : latestTimeline;
      setLoadedTimeline((current) => {
        if (current.surfaceKey !== surfaceKey) {
          return current;
        }
        if (!recoveredLatestTimeline) {
          return {
            ...current,
            olderCursor: null,
          };
        }
        return recoverLoadedTimelineAfterStaleCursor({
          current,
          latestTimeline: recoveredLatestTimeline,
          surfaceKey,
        });
      });
    } finally {
      setIsLoadingOlderTimelineRows(false);
    }
  }, [
    enabled,
    isLoadingOlderTimelineRows,
    latestTimeline,
    nextOlderCursor,
    refetchLatestTimeline,
    rowFilter,
    surfaceKey,
    threadId,
  ]);
  const timelineRows =
    loadedTimeline.surfaceKey === surfaceKey && loadedTimeline.rows.length > 0
      ? loadedTimeline.rows
      : (latestTimeline?.rows ?? []);
  const timelineQueryState = useConnectionAwareQueryState({
    hasResolvedData:
      latestTimelineQuery.data !== undefined || timelineRows.length > 0,
    isFetching: latestTimelineQuery.isFetching,
    isLoadingError: latestTimelineQuery.isLoadingError,
    isRecoverableLoadingError: isTransientReadError(latestTimelineQuery.error),
  });
  const timelineLoading =
    latestTimelineQuery.isLoading ||
    (timelineQueryState.status === "loading" && timelineRows.length === 0) ||
    (latestTimelineQuery.isFetching && timelineRows.length === 0);
  const timelineError =
    timelineLoading || timelineQueryState.status !== "unavailable"
      ? null
      : latestTimelineQuery.error;

  return {
    activePromptMode: latestTimeline?.activePromptMode ?? null,
    activeThinking: latestTimeline?.activeThinking ?? null,
    activeWorkflows: latestTimeline?.activeWorkflows ?? [],
    activeBackgroundCommands: latestTimeline?.activeBackgroundCommands ?? [],
    contextWindowUsage: latestTimeline?.contextWindowUsage,
    goal: latestTimeline?.goal ?? null,
    modelFallback: latestTimeline?.modelFallback ?? null,
    hasOlderTimelineRows,
    isLoadingOlderTimelineRows,
    loadOlderTimelineRows,
    pendingTodos: latestTimeline?.pendingTodos ?? null,
    timelineError,
    timelineLoading,
    timelineRows,
  };
}
