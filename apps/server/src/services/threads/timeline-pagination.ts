import {
  paginateTimelineContents,
  timelineRowsJsonBytes,
} from "./timeline-content-pagination.js";
import type { TimelineContentCursor } from "./timeline-snapshot.js";
import {
  timelineRowChildren,
  withTimelineRowChildren,
  type TimelinePaginationCursor,
  type TimelineRow,
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
  ownershipSequenceOf: (row: TimelineRow) => number;
  changedThroughSequenceOf: (row: TimelineRow) => number;
  orderChangedThroughSequence: (windowStart: number) => number | null;
  reportsOlderRowChanges: boolean;
  hasOlderSegments: boolean;
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
  const { ownedSequenceStart, ownedSequenceEnd, ownershipSequenceOf } = args;
  const bounds = [
    ownedSequenceStart,
    ...new Set(
      args.rows.flatMap((row) => {
        const sequence = ownershipSequenceOf(row);
        return row.kind === "conversation" &&
          row.role === "user" &&
          sequence > ownedSequenceStart &&
          sequence < ownedSequenceEnd
          ? [sequence]
          : [];
      }),
    ),
  ].sort((left, right) => left - right);
  const segments = bounds.map((sequenceStart): TimelineLogicalSegment => ({
    rows: [],
    sequenceStart,
  }));
  for (const row of args.rows) {
    const sequence = ownershipSequenceOf(row);
    if (sequence < ownedSequenceStart || sequence >= ownedSequenceEnd) {
      continue;
    }
    let start = 0;
    let end = bounds.length;
    while (start + 1 < end) {
      const middle = Math.floor((start + end) / 2);
      if (bounds[middle]! <= sequence) start = middle;
      else end = middle;
    }
    segments[start]!.rows.push(row);
  }
  const populated = segments.filter((segment) => segment.rows.length > 0);
  if (populated[0] !== undefined)
    populated[0].sequenceStart = ownedSequenceStart;
  return populated;
}

function firstLeafSourceSeqStart(rows: readonly TimelineRow[]): number | null {
  let row = rows[0];
  if (row === undefined) return null;
  for (;;) {
    const first = timelineRowChildren(row)?.[0];
    if (first === undefined) return row.sourceSeqStart;
    row = first;
  }
}

function timelineRowChangesFrom(
  row: TimelineRow,
  sequence: number,
  changedThroughSequenceOf: (row: TimelineRow) => number,
): TimelineRow {
  const children = timelineRowChildren(row);
  return children === null
    ? row
    : withTimelineRowChildren(
        row,
        timelineRowsChangedFrom(children, sequence, changedThroughSequenceOf),
      );
}

function timelineRowsChangedFrom(
  rows: readonly TimelineRow[],
  sequence: number,
  changedThroughSequenceOf: (row: TimelineRow) => number,
): TimelineRow[] {
  const firstChangedIndex = rows.findIndex(
    (row) => changedThroughSequenceOf(row) >= sequence,
  );
  return firstChangedIndex === -1
    ? []
    : rows
        .slice(firstChangedIndex)
        .map((row) =>
          timelineRowChangesFrom(row, sequence, changedThroughSequenceOf),
        );
}

export function paginateTimelineRows(
  args: PaginateTimelineRowsArgs,
): PaginatedTimelineRowsResult {
  const { hasOlderSegments, page, rows } = args;
  const segments = buildTimelineLogicalSegments(args);
  const selectedSegments = segments.slice(-page.segmentLimit);
  const returnedRows = new Map<string, TimelineRow>();
  let remainingBytes = args.maxBytes;
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
    segmentStart: number,
  ): Pick<
    PaginatedTimelineRowsResult,
    "olderRowUpdates" | "olderRowsSourceSeqEnd"
  > => {
    const omitted = rows.filter(
      (row) =>
        args.ownershipSequenceOf(row) < args.ownedSequenceEnd &&
        !returnedRows.has(row.id),
    );
    const changedSince = (row: TimelineRow) =>
      args.ownershipSequenceOf(row) < segmentStart ? segmentStart : windowStart;
    const changedRows = args.reportsOlderRowChanges
      ? omitted.filter(
          (row) => args.changedThroughSequenceOf(row) >= changedSince(row),
        )
      : [];
    const turnsWithChangedTurnRows = new Set(
      changedRows.flatMap((row) =>
        row.kind === "turn" && row.turnId !== null ? [row.turnId] : [],
      ),
    );
    const changedRowSet = new Set(changedRows);
    const changed = omitted.filter(
      (row) =>
        changedRowSet.has(row) ||
        (row.kind === "turn" &&
          row.turnId !== null &&
          turnsWithChangedTurnRows.has(row.turnId)),
    );
    const updates = changed.map((row) =>
      timelineRowChangesFrom(
        row,
        changedSince(row),
        args.changedThroughSequenceOf,
      ),
    );
    const reported =
      timelineRowsJsonBytes(updates) > remainingBytes ? [] : changed;
    const orderChangedThrough = args.reportsOlderRowChanges
      ? args.orderChangedThroughSequence(segmentStart)
      : null;
    return {
      olderRowsSourceSeqEnd: omitted
        .filter((row) => !reported.includes(row))
        .reduce<number | null>(
          (sourceSeqEnd, row) =>
            Math.max(sourceSeqEnd ?? 0, args.changedThroughSequenceOf(row)),
          orderChangedThrough === null
            ? omittedContentSourceSeqEnd
            : Math.max(omittedContentSourceSeqEnd ?? 0, orderChangedThrough),
        ),
      ...(reported.length > 0 ? { olderRowUpdates: updates } : {}),
    };
  };
  if (selectedSegments.length === 0) {
    return {
      olderCursor: hasOlderSegments
        ? timelineWindowCursor(args.ownedSequenceStart)
        : null,
      ...omittedRows(null, args.ownedSequenceStart, args.ownedSequenceStart),
      returnedSegmentCount: 0,
      rows: [],
    };
  }
  let remainingLeaves = args.maxLeaves;
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
    remainingBytes -= timelineRowsJsonBytes(contents.rows);
    if (contents.start > 0 || remainingLeaves <= 0 || remainingBytes <= 0) {
      const hasOlderRows =
        contents.start > 0 ||
        index > 0 ||
        hasOlderSegments ||
        segments.length > selectedSegments.length;
      return {
        rows: collectRows(),
        returnedSegmentCount,
        olderCursor: hasOlderRows
          ? timelineWindowCursor(segment.sequenceStart)
          : null,
        ...omittedRows(
          contents.partialRowsSourceSeqEnd,
          contents.start > 0
            ? (firstLeafSourceSeqStart(contents.rows) ?? segment.sequenceStart)
            : segment.sequenceStart,
          segment.sequenceStart,
        ),
        contentCursor:
          contents.start > 0
            ? {
                beforeLeaf: contents.start,
                beforeSequence:
                  selectedSegments[index + 1]?.sequenceStart ??
                  args.ownedSequenceEnd,
              }
            : undefined,
      };
    }
  }
  const hasOlderRows =
    hasOlderSegments || segments.length > selectedSegments.length;
  return {
    rows: collectRows(),
    returnedSegmentCount,
    olderCursor: hasOlderRows
      ? timelineWindowCursor(selectedSegments[0]!.sequenceStart)
      : null,
    ...omittedRows(
      null,
      selectedSegments[0]!.sequenceStart,
      selectedSegments[0]!.sequenceStart,
    ),
  };
}
