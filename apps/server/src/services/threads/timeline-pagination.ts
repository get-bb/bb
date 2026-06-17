import type { TimelinePaginationCursor, TimelineRow } from "@bb/server-contract";
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
    if (isTimelineSegmentAnchorRow(row) && currentRows.length > 0) {
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

export function paginateTimelineRows(
  rows: readonly TimelineRow[],
  page: ThreadTimelinePageRequest,
): PaginatedTimelineRowsResult {
  const segments = buildTimelineLogicalSegments(rows);
  const candidateSegments =
    page.kind === "latest"
      ? segments
      : segments.slice(
          0,
          requireTimelineSegmentCursorIndex(segments, page.beforeCursor),
        );
  const selectedSegments = candidateSegments.slice(-page.segmentLimit);
  const hasOlderRows = candidateSegments.length > selectedSegments.length;
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
