import type {
  TimelinePaginationCursor,
  TimelineRow,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";

export type ThreadTimelinePageKind = "latest" | "older";

/**
 * Marks a window that had to start inside a turn rather than on a user message,
 * because that one turn is larger than the whole event budget.
 *
 * A window is normally identified by the user message it begins at, and the
 * pagination cursor names that anchor. Inside a turn there is no anchor to
 * name, so the cursor names the event sequence the window was cut at instead —
 * and the row-derived cursor cannot be used, because the projection backfills a
 * turn's `turn/started` row from far below the cut and the first row's
 * `sourceSeqStart` would send the next page past everything in between.
 */
export interface TimelineInTurnWindowStart {
  /** First event sequence this window covers. */
  sequenceStart: number;
  threadId: string;
}

const IN_TURN_CURSOR_ANCHOR_ID_SEPARATOR = ":in-turn:";

export function buildInTurnCursorAnchorId(
  args: TimelineInTurnWindowStart,
): string {
  return `${args.threadId}${IN_TURN_CURSOR_ANCHOR_ID_SEPARATOR}${args.sequenceStart}`;
}

/**
 * The sequence an in-turn cursor points at, or null when the cursor names a
 * user-message anchor instead. Rejects a cursor whose id and sequence disagree,
 * which is the only self-consistency check available for a cursor that names no
 * stored row.
 */
export function readInTurnCursorSequence(
  cursor: TimelinePaginationCursor,
  threadId: string,
): number | null {
  const prefix = `${threadId}${IN_TURN_CURSOR_ANCHOR_ID_SEPARATOR}`;
  if (!cursor.anchorId.startsWith(prefix)) {
    return null;
  }
  if (
    cursor.anchorId.slice(prefix.length) !== String(cursor.anchorSeq) ||
    !Number.isInteger(cursor.anchorSeq)
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      "Timeline pagination cursor is no longer available",
    );
  }
  return cursor.anchorSeq;
}

export interface LatestThreadTimelinePageRequest {
  kind: "latest";
  segmentLimit: number;
}

export interface OlderThreadTimelinePageRequest {
  beforeCursor: TimelinePaginationCursor;
  kind: "older";
  segmentLimit: number;
}

export type ThreadTimelinePageRequest =
  | LatestThreadTimelinePageRequest
  | OlderThreadTimelinePageRequest;

interface TimelineLogicalSegment {
  cursor: TimelinePaginationCursor;
  rows: TimelineRow[];
}

export interface PaginatedTimelineRowsResult {
  hasOlderRows: boolean;
  kind: ThreadTimelinePageKind;
  olderCursor: TimelinePaginationCursor | null;
  returnedSegmentCount: number;
  rows: TimelineRow[];
  segmentLimit: number;
}

function isTimelineSegmentAnchorRow(row: TimelineRow): boolean {
  return (
    row.kind === "conversation" &&
    row.role === "user" &&
    row.turnRequest.kind === "message"
  );
}

function buildTimelineLogicalSegment(
  rows: TimelineRow[],
): TimelineLogicalSegment {
  const anchorRow = rows[0];
  if (!anchorRow) {
    throw new Error("Cannot build a timeline segment without rows");
  }

  return {
    cursor: {
      anchorSeq: anchorRow.sourceSeqStart,
      anchorId: anchorRow.id,
    },
    rows,
  };
}

function buildTimelineLogicalSegments(
  rows: readonly TimelineRow[],
): TimelineLogicalSegment[] {
  const segments: TimelineLogicalSegment[] = [];
  let currentRows: TimelineRow[] = [];

  for (const row of rows) {
    if (
      isTimelineSegmentAnchorRow(row) &&
      currentRows.length > 0 &&
      currentRows[0]?.sourceSeqStart !== row.sourceSeqStart
    ) {
      segments.push(buildTimelineLogicalSegment(currentRows));
      currentRows = [row];
      continue;
    }

    currentRows.push(row);
  }

  if (currentRows.length > 0) {
    segments.push(buildTimelineLogicalSegment(currentRows));
  }

  return segments;
}

export interface PaginateTimelineRowsArgs {
  /**
   * Non-null only for a window cut inside a turn. Such a window is already
   * bounded by event sequence, so segment trimming would only discard rows the
   * read already paid for, and the older cursor has to name the cut rather than
   * be derived from the oldest row. There is always more to load before it: at
   * minimum the start of the turn it sits inside.
   */
  inTurnWindowStart: TimelineInTurnWindowStart | null;
  /**
   * `hasOlderRows` is normally inferred by over-reading one segment past the
   * page and noticing it was dropped. An event-budgeted window cannot afford
   * that sentinel segment — it is unbounded work purely to answer a boolean —
   * so the caller that already knows the answer from the anchor list passes it
   * here. `null` keeps the sentinel inference.
   */
  knownHasOlderSegments: boolean | null;
  page: ThreadTimelinePageRequest;
  rows: readonly TimelineRow[];
}

export function paginateTimelineRows(
  args: PaginateTimelineRowsArgs,
): PaginatedTimelineRowsResult {
  const { inTurnWindowStart, knownHasOlderSegments, page, rows } = args;
  const segments = buildTimelineLogicalSegments(rows);
  if (inTurnWindowStart !== null) {
    return {
      hasOlderRows: true,
      kind: page.kind,
      olderCursor: {
        anchorSeq: inTurnWindowStart.sequenceStart,
        anchorId: buildInTurnCursorAnchorId(inTurnWindowStart),
      },
      returnedSegmentCount: segments.length,
      rows: [...rows],
      segmentLimit: page.segmentLimit,
    };
  }
  // Every window ends strictly before its cursor, so no segment at or past the
  // cursor was read and none has to be trimmed off here.
  const selectedSegments = segments.slice(-page.segmentLimit);
  const hasOlderRows =
    knownHasOlderSegments ?? segments.length > selectedSegments.length;
  const oldestSelectedSegment = selectedSegments[0];

  return {
    hasOlderRows,
    kind: page.kind,
    olderCursor:
      hasOlderRows && oldestSelectedSegment
        ? oldestSelectedSegment.cursor
        : null,
    returnedSegmentCount: selectedSegments.length,
    rows: selectedSegments.flatMap((segment) => segment.rows),
    segmentLimit: page.segmentLimit,
  };
}
