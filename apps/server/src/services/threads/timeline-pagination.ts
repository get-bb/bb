import type {
  TimelinePaginationCursor,
  TimelineRow,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";

export type ThreadTimelinePageKind = "latest" | "older";

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

const TIMELINE_ROW_WINDOW_CURSOR_PREFIX = "timeline-row-window:";

/**
 * A conversation segment is a useful UX boundary, but it is not a safe
 * resource boundary: one active turn can contain thousands of work rows. Keep
 * the initial response comfortably below the timeline cache's 200-row cutoff
 * and below the point where mounting the rows dominates a thread switch.
 */
export const THREAD_TIMELINE_PAGE_ROW_LIMIT = 160;
export const THREAD_TIMELINE_PAGE_JSON_BYTE_TARGET = 512_000;

export interface PaginatedTimelineRowsResult {
  hasOlderRows: boolean;
  kind: ThreadTimelinePageKind;
  olderCursor: TimelinePaginationCursor | null;
  returnedSegmentCount: number;
  rows: TimelineRow[];
  segmentLimit: number;
}

export interface PaginateTimelineRowsOptions {
  /** Older raw events exist before the projected event window. */
  eventWindowOlderCursor: TimelinePaginationCursor | null;
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

function requireTimelineSegmentCursorIndex(
  segments: readonly TimelineLogicalSegment[],
  cursor: TimelinePaginationCursor,
): number {
  const index = segments.findIndex(
    (segment) =>
      segment.cursor.anchorSeq === cursor.anchorSeq &&
      segment.cursor.anchorId === cursor.anchorId,
  );
  if (index !== -1) {
    return index;
  }

  throw new ApiError(
    400,
    "invalid_request",
    "Timeline pagination cursor is no longer available",
  );
}

export function isTimelineRowWindowCursor(
  cursor: TimelinePaginationCursor,
): boolean {
  return cursor.anchorId.startsWith(TIMELINE_ROW_WINDOW_CURSOR_PREFIX);
}

function timelineRowWindowCursor(row: TimelineRow): TimelinePaginationCursor {
  return {
    anchorSeq: row.sourceSeqStart,
    anchorId: `${TIMELINE_ROW_WINDOW_CURSOR_PREFIX}${row.id}`,
  };
}

export function createTimelineEventWindowCursor(args: {
  eventId: string;
  sequence: number;
}): TimelinePaginationCursor {
  return {
    anchorSeq: args.sequence,
    anchorId: `${TIMELINE_ROW_WINDOW_CURSOR_PREFIX}event:${args.eventId}`,
  };
}

interface BoundedTimelineRows {
  rows: TimelineRow[];
  truncated: boolean;
}

function selectBoundedTimelineSuffix(
  rows: readonly TimelineRow[],
): BoundedTimelineRows {
  let jsonBytes = 0;
  let startIndex = rows.length;

  while (startIndex > 0) {
    const candidate = rows[startIndex - 1];
    if (!candidate) break;
    const candidateBytes = Buffer.byteLength(JSON.stringify(candidate), "utf8");
    const selectedRowCount = rows.length - startIndex;
    const exceedsRowLimit = selectedRowCount >= THREAD_TIMELINE_PAGE_ROW_LIMIT;
    const exceedsByteTarget =
      selectedRowCount > 0 &&
      jsonBytes + candidateBytes > THREAD_TIMELINE_PAGE_JSON_BYTE_TARGET;
    if (exceedsRowLimit || exceedsByteTarget) {
      break;
    }
    jsonBytes += candidateBytes;
    startIndex--;
  }

  // Rows derived from one source event are an atomic group (for example, one
  // prompt containing text plus attachments). Never strand part of that group
  // on the other side of a cursor, even if doing so slightly exceeds a target.
  const firstSelectedSequence = rows[startIndex]?.sourceSeqStart;
  while (
    startIndex > 0 &&
    firstSelectedSequence !== undefined &&
    rows[startIndex - 1]?.sourceSeqStart === firstSelectedSequence
  ) {
    startIndex--;
  }

  return {
    rows: rows.slice(startIndex),
    truncated: startIndex > 0,
  };
}

export function paginateTimelineRows(
  rows: readonly TimelineRow[],
  page: ThreadTimelinePageRequest,
  options: PaginateTimelineRowsOptions,
): PaginatedTimelineRowsResult {
  const segments = buildTimelineLogicalSegments(rows);
  const candidateSegments =
    page.kind === "latest"
      ? segments
      : isTimelineRowWindowCursor(page.beforeCursor)
        ? segments
        : segments.slice(
            0,
            requireTimelineSegmentCursorIndex(segments, page.beforeCursor),
          );
  const selectedSegments = candidateSegments.slice(-page.segmentLimit);
  const boundedRows = selectBoundedTimelineSuffix(
    selectedSegments.flatMap((segment) => segment.rows),
  );
  const hasOlderSegments = candidateSegments.length > selectedSegments.length;
  const hasOlderRows =
    hasOlderSegments ||
    boundedRows.truncated ||
    options.eventWindowOlderCursor !== null;
  const oldestSelectedSegment = selectedSegments[0];
  const oldestSelectedRow = boundedRows.rows[0];
  const selectedRowIds = new Set(boundedRows.rows.map((row) => row.id));
  const returnedSegmentCount = selectedSegments.filter((segment) =>
    segment.rows.some((row) => selectedRowIds.has(row.id)),
  ).length;

  return {
    hasOlderRows,
    kind: page.kind,
    olderCursor:
      !hasOlderRows || !oldestSelectedRow
        ? null
        : boundedRows.truncated
          ? timelineRowWindowCursor(oldestSelectedRow)
          : hasOlderSegments
            ? (oldestSelectedSegment?.cursor ?? null)
            : options.eventWindowOlderCursor,
    returnedSegmentCount,
    rows: boundedRows.rows,
    segmentLimit: page.segmentLimit,
  };
}
