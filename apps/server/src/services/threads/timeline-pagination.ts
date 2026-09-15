import { paginateTimelineContents } from "./timeline-content-pagination.js";
import type { TimelineContentCursor } from "./timeline-snapshot.js";
import type {
  TimelinePaginationCursor,
  TimelineRow,
} from "@bb/server-contract";

export type ThreadTimelinePageKind = "latest" | "older";

interface LatestThreadTimelinePageRequest {
  kind: "latest";
  segmentLimit: number;
}

interface OlderThreadTimelinePageRequest {
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

interface PaginatedTimelineRowsResult {
  contentCursor?: TimelineContentCursor;
  contentPage?: {
    anchorSeq: number;
    start: number;
    end: number;
    total: number;
  };
  hasOlderRows: boolean;
  olderCursor: TimelinePaginationCursor | null;
  olderRowsSourceSeqEnd: number | null;
  returnedSegmentCount: number;
  rows: TimelineRow[];
}

function isTimelineSegmentAnchorRow(
  row: TimelineRow,
  contextBoundarySeq: number | null,
): boolean {
  return (
    row.sourceSeqStart === contextBoundarySeq ||
    (row.kind === "conversation" &&
      row.role === "user" &&
      row.turnRequest.kind === "message")
  );
}

function buildTimelineLogicalSegment(
  anchorRow: TimelineRow | null,
  rows: TimelineRow[],
): TimelineLogicalSegment {
  const cursorRow = anchorRow ?? rows[0];
  if (!cursorRow) {
    throw new Error("Cannot build a timeline segment without rows");
  }

  return {
    cursor: {
      anchorSeq: cursorRow.sourceSeqStart,
      anchorId: cursorRow.id,
    },
    rows,
  };
}

function buildTimelineLogicalSegments(
  rows: readonly TimelineRow[],
  contextBoundarySeq: number | null,
): TimelineLogicalSegment[] {
  const segments: TimelineLogicalSegment[] = [];
  let currentRows: TimelineRow[] = [];
  let anchorRow: TimelineRow | null = null;

  for (const row of rows) {
    if (isTimelineSegmentAnchorRow(row, contextBoundarySeq)) {
      if (
        anchorRow === null &&
        currentRows.every(
          (current) => current.sourceSeqStart > row.sourceSeqStart,
        )
      ) {
        anchorRow = row;
        currentRows.push(row);
        continue;
      }
      const currentAnchorRow = anchorRow ?? currentRows[0];
      if (currentAnchorRow?.sourceSeqStart !== row.sourceSeqStart) {
        segments.push(buildTimelineLogicalSegment(anchorRow, currentRows));
        currentRows = [row];
        anchorRow = row;
        continue;
      }
    }

    currentRows.push(row);
  }

  if (currentRows.length > 0) {
    segments.push(buildTimelineLogicalSegment(anchorRow, currentRows));
  }

  return segments;
}

interface PaginateTimelineRowsArgs {
  contentCursor?: TimelineContentCursor;
  maxLeaves: number;
  maxBytes: number;
  ownedSequenceStart: number;
  ownedSequenceEnd: number;
  contextBoundarySeq: number | null;
  knownHasOlderSegments: boolean | null;
  page: ThreadTimelinePageRequest;
  rows: readonly TimelineRow[];
}

export function paginateTimelineRows(
  args: PaginateTimelineRowsArgs,
): PaginatedTimelineRowsResult {
  const { contextBoundarySeq, knownHasOlderSegments, page, rows } = args;
  const logicalSegments = buildTimelineLogicalSegments(
    rows,
    contextBoundarySeq,
  );
  const returnedSegments = new Set<TimelineLogicalSegment>();
  const olderRowsSourceSeqEnd = (
    omittedContentSourceSeqEnd: number | null,
  ): number | null =>
    logicalSegments
      .filter(
        (segment) =>
          !returnedSegments.has(segment) &&
          segment.cursor.anchorSeq < args.ownedSequenceEnd,
      )
      .flatMap((segment) => segment.rows)
      .reduce<number | null>(
        (sourceSeqEnd, row) => Math.max(sourceSeqEnd ?? 0, row.sourceSeqEnd),
        omittedContentSourceSeqEnd,
      );
  const segments = logicalSegments.filter(
    (segment) =>
      segment.cursor.anchorSeq >= args.ownedSequenceStart &&
      segment.cursor.anchorSeq < args.ownedSequenceEnd,
  );
  const selectedSegments = segments.slice(-page.segmentLimit);
  if (selectedSegments.length === 0) {
    return {
      hasOlderRows:
        knownHasOlderSegments ?? segments.length > selectedSegments.length,
      olderCursor: null,
      olderRowsSourceSeqEnd: olderRowsSourceSeqEnd(null),
      returnedSegmentCount: 0,
      rows: [],
    };
  }
  const resultRows: TimelineRow[] = [];
  let remainingLeaves = args.maxLeaves;
  let remainingBytes = args.maxBytes;
  let returnedSegmentCount = 0;
  for (let index = selectedSegments.length - 1; index >= 0; index -= 1) {
    const segment = selectedSegments[index]!;
    const contents = paginateTimelineContents(
      segment.rows,
      args.contentCursor?.beforeLeaf,
      remainingLeaves,
      remainingBytes,
    );
    resultRows.unshift(...contents.rows);
    returnedSegments.add(segment);
    returnedSegmentCount += 1;
    remainingLeaves -= contents.end - contents.start;
    remainingBytes -= Buffer.byteLength(JSON.stringify(contents.rows));
    if (contents.start > 0 || remainingLeaves <= 0 || remainingBytes <= 0) {
      const hasOlderRows =
        contents.start > 0 ||
        index > 0 ||
        (knownHasOlderSegments ?? segments.length > selectedSegments.length);
      return {
        rows: resultRows,
        returnedSegmentCount,
        hasOlderRows,
        olderCursor: hasOlderRows ? segment.cursor : null,
        olderRowsSourceSeqEnd: olderRowsSourceSeqEnd(
          contents.olderRowsSourceSeqEnd,
        ),
        contentCursor:
          contents.start > 0
            ? {
                beforeLeaf: contents.start,
                beforeSequence:
                  selectedSegments[index + 1]?.cursor.anchorSeq ??
                  args.ownedSequenceEnd,
              }
            : undefined,
        contentPage: {
          anchorSeq: segment.cursor.anchorSeq,
          start: contents.start,
          end: contents.end,
          total: contents.total,
        },
      };
    }
  }
  const hasOlderRows =
    knownHasOlderSegments ?? segments.length > selectedSegments.length;
  return {
    rows: resultRows,
    returnedSegmentCount,
    hasOlderRows,
    olderCursor: hasOlderRows ? selectedSegments[0]!.cursor : null,
    olderRowsSourceSeqEnd: olderRowsSourceSeqEnd(null),
  };
}
