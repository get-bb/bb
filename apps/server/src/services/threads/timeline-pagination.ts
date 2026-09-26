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
  rows: TimelineRow[];
  sequenceStart: number;
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
  olderRowUpdates?: TimelineRow[];
  returnedSegmentCount: number;
  rows: TimelineRow[];
}

export interface PaginateTimelineRowsArgs {
  contentCursor?: TimelineContentCursor;
  maxLeaves: number;
  maxBytes: number;
  ownedSequenceStart: number;
  ownedSequenceEnd: number;
  knownHasOlderSegments: boolean | null;
  page: ThreadTimelinePageRequest;
  rows: readonly TimelineRow[];
}

function timelineWindowCursor(sequenceStart: number): TimelinePaginationCursor {
  return {
    anchorSeq: sequenceStart,
    anchorId: `timeline-window:${sequenceStart}`,
  };
}

function buildTimelineLogicalSegments(
  args: PaginateTimelineRowsArgs,
): TimelineLogicalSegment[] {
  const { ownedSequenceStart, ownedSequenceEnd } = args;
  const bounds = [
    ownedSequenceStart,
    ...new Set(
      args.rows.flatMap((row) =>
        row.kind === "conversation" &&
        row.role === "user" &&
        row.sourceSeqStart > ownedSequenceStart &&
        row.sourceSeqStart < ownedSequenceEnd
          ? [row.sourceSeqStart]
          : [],
      ),
    ),
  ].sort((left, right) => left - right);
  const segments = bounds.map((sequenceStart): TimelineLogicalSegment => ({
    rows: [],
    sequenceStart,
  }));
  for (const row of args.rows) {
    if (
      row.sourceSeqStart < ownedSequenceStart ||
      row.sourceSeqStart >= ownedSequenceEnd
    ) {
      continue;
    }
    let start = 0;
    let end = bounds.length;
    while (start + 1 < end) {
      const middle = Math.floor((start + end) / 2);
      if (bounds[middle]! <= row.sourceSeqStart) start = middle;
      else end = middle;
    }
    segments[start]!.rows.push(row);
  }
  const populated = segments.filter((segment) => segment.rows.length > 0);
  if (populated[0] !== undefined)
    populated[0].sequenceStart = ownedSequenceStart;
  return populated;
}

function timelineRowChangesFrom(
  row: TimelineRow,
  sequence: number,
): TimelineRow {
  if (row.kind === "turn" && row.children !== null) {
    return {
      ...row,
      children: timelineRowsChangedFrom(row.children, sequence),
    };
  }
  if (row.kind === "work" && row.workKind === "delegation") {
    return {
      ...row,
      childRows: timelineRowsChangedFrom(row.childRows, sequence),
    };
  }
  return row;
}

function timelineRowsChangedFrom(
  rows: readonly TimelineRow[],
  sequence: number,
): TimelineRow[] {
  const firstChangedIndex = rows.findIndex(
    (row) => row.sourceSeqEnd >= sequence,
  );
  return firstChangedIndex === -1
    ? []
    : rows
        .slice(firstChangedIndex)
        .map((row) => timelineRowChangesFrom(row, sequence));
}

export function paginateTimelineRows(
  args: PaginateTimelineRowsArgs,
): PaginatedTimelineRowsResult {
  const { knownHasOlderSegments, page, rows } = args;
  const segments = buildTimelineLogicalSegments(args);
  const selectedSegments = segments.slice(-page.segmentLimit);
  const returnedRows = new Map<string, TimelineRow>();
  const collectRows = (): TimelineRow[] => {
    const collected = new Set<string>();
    return rows.flatMap((row) => {
      const returned = returnedRows.get(row.id);
      if (returned === undefined || collected.has(row.id)) return [];
      collected.add(row.id);
      return [returned];
    });
  };
  const omittedRows = (
    omittedContentSourceSeqEnd: number | null,
    windowStart: number,
  ): Pick<
    PaginatedTimelineRowsResult,
    "olderRowUpdates" | "olderRowsSourceSeqEnd"
  > => {
    const omitted = rows.filter(
      (row) =>
        row.sourceSeqStart < args.ownedSequenceEnd && !returnedRows.has(row.id),
    );
    const changed =
      page.kind === "latest"
        ? omitted.filter((row) => row.sourceSeqEnd >= windowStart)
        : [];
    const updates = changed.map((row) =>
      timelineRowChangesFrom(row, windowStart),
    );
    const reported =
      Buffer.byteLength(JSON.stringify(updates)) > args.maxBytes ? [] : changed;
    return {
      olderRowsSourceSeqEnd: omitted
        .filter((row) => !reported.includes(row))
        .reduce<number | null>(
          (sourceSeqEnd, row) => Math.max(sourceSeqEnd ?? 0, row.sourceSeqEnd),
          omittedContentSourceSeqEnd,
        ),
      ...(reported.length > 0 ? { olderRowUpdates: updates } : {}),
    };
  };
  if (selectedSegments.length === 0) {
    const hasOlderRows = knownHasOlderSegments ?? false;
    return {
      hasOlderRows,
      olderCursor: hasOlderRows
        ? timelineWindowCursor(args.ownedSequenceStart)
        : null,
      ...omittedRows(null, args.ownedSequenceStart),
      returnedSegmentCount: 0,
      rows: [],
    };
  }
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
    for (const row of contents.rows) returnedRows.set(row.id, row);
    returnedSegmentCount += 1;
    remainingLeaves -= contents.end - contents.start;
    remainingBytes -= Buffer.byteLength(JSON.stringify(contents.rows));
    if (contents.start > 0 || remainingLeaves <= 0 || remainingBytes <= 0) {
      const hasOlderRows =
        contents.start > 0 ||
        index > 0 ||
        (knownHasOlderSegments ?? segments.length > selectedSegments.length);
      return {
        rows: collectRows(),
        returnedSegmentCount,
        hasOlderRows,
        olderCursor: hasOlderRows
          ? timelineWindowCursor(segment.sequenceStart)
          : null,
        ...omittedRows(contents.olderRowsSourceSeqEnd, segment.sequenceStart),
        contentCursor:
          contents.start > 0
            ? {
                beforeLeaf: contents.start,
                beforeSequence:
                  selectedSegments[index + 1]?.sequenceStart ??
                  args.ownedSequenceEnd,
              }
            : undefined,
        contentPage: {
          anchorSeq: segment.sequenceStart,
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
    rows: collectRows(),
    returnedSegmentCount,
    hasOlderRows,
    olderCursor: hasOlderRows
      ? timelineWindowCursor(selectedSegments[0]!.sequenceStart)
      : null,
    ...omittedRows(null, selectedSegments[0]!.sequenceStart),
  };
}
