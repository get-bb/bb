import type { TimelinePaginationCursor, TimelineRow } from "@bb/server-contract";

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

export interface TryPaginateTimelineRowsArgs {
  page: ThreadTimelinePageRequest;
  rows: readonly TimelineRow[];
}

export interface PaginateTimelineRowsSuccess {
  kind: "success";
  page: PaginatedTimelineRowsResult;
}

export interface PaginateTimelineRowsMissingCursor {
  kind: "missing-cursor";
}

export type TryPaginateTimelineRowsResult =
  | PaginateTimelineRowsSuccess
  | PaginateTimelineRowsMissingCursor;

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

function findTimelineSegmentCursorIndex(
  segments: readonly TimelineLogicalSegment[],
  cursor: TimelinePaginationCursor,
): number | null {
  const index = segments.findIndex(
    (segment) =>
      segment.cursor.anchorSeq === cursor.anchorSeq &&
      segment.cursor.anchorId === cursor.anchorId,
  );
  return index === -1 ? null : index;
}

export function tryPaginateTimelineRows({
  page,
  rows,
}: TryPaginateTimelineRowsArgs): TryPaginateTimelineRowsResult {
  const segments = buildTimelineLogicalSegments(rows);
  const cursorIndex =
    page.kind === "latest"
      ? null
      : findTimelineSegmentCursorIndex(segments, page.beforeCursor);
  if (page.kind === "older" && cursorIndex === null) {
    return {
      kind: "missing-cursor",
    };
  }

  const candidateSegments =
    page.kind === "latest" ? segments : segments.slice(0, cursorIndex ?? 0);
  const selectedSegments = candidateSegments.slice(-page.segmentLimit);
  const hasOlderRows = candidateSegments.length > selectedSegments.length;
  const oldestSelectedSegment = selectedSegments[0];

  return {
    kind: "success",
    page: {
      hasOlderRows,
      kind: page.kind,
      olderCursor:
        hasOlderRows && oldestSelectedSegment
          ? oldestSelectedSegment.cursor
          : null,
      returnedSegmentCount: selectedSegments.length,
      rows: selectedSegments.flatMap((segment) => segment.rows),
      segmentLimit: page.segmentLimit,
    },
  };
}
