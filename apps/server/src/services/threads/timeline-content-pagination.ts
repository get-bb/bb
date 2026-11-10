import {
  timelineRowChildren,
  withTimelineRowChildren,
  type TimelineRow,
} from "@bb/server-contract";

export interface TimelineContentPage {
  partialRowsSourceSeqEnd: number | null;
  rows: TimelineRow[];
  start: number;
  end: number;
  total: number;
}

function children(row: TimelineRow): readonly TimelineRow[] | null {
  const nested = timelineRowChildren(row);
  return nested?.length ? nested : null;
}

const rowJsonBytes = new WeakMap<TimelineRow, number>();
const rowShellJsonBytes = new WeakMap<TimelineRow, number>();

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function timelineRowShellJsonBytes(row: TimelineRow): number {
  let bytes = rowShellJsonBytes.get(row);
  if (bytes === undefined) {
    bytes = jsonBytes(withTimelineRowChildren(row, []));
    rowShellJsonBytes.set(row, bytes);
  }
  return bytes;
}

function timelineRowJsonBytes(row: TimelineRow): number {
  let bytes = rowJsonBytes.get(row);
  if (bytes === undefined) {
    const nested = children(row);
    bytes =
      nested === null
        ? jsonBytes(row)
        : timelineRowShellJsonBytes(row) + timelineRowsJsonBytes(nested) - 2;
    rowJsonBytes.set(row, bytes);
  }
  return bytes;
}

export function measuredTimelineRowJsonBytes(row: TimelineRow): number | null {
  const cached = rowJsonBytes.get(row);
  if (cached !== undefined) return cached;
  const nested = children(row);
  const shell = rowShellJsonBytes.get(row);
  if (nested === null || shell === undefined) return null;
  let bytes = shell + nested.length - 1;
  for (const child of nested) {
    const childBytes = measuredTimelineRowJsonBytes(child);
    if (childBytes === null) return null;
    bytes += childBytes;
  }
  rowJsonBytes.set(row, bytes);
  return bytes;
}

export function timelineRowsJsonBytes(rows: readonly TimelineRow[]): number {
  let bytes = 2 + Math.max(0, rows.length - 1);
  for (const row of rows) bytes += timelineRowJsonBytes(row);
  return bytes;
}

export function measureTimelineContentLeafBytes(
  rows: readonly TimelineRow[],
): number[] {
  const costs: number[] = [];
  const measure = (
    items: readonly TimelineRow[],
    ancestorBytes: number,
  ): void => {
    for (const row of items) {
      const nested = children(row);
      if (nested === null)
        costs.push(timelineRowJsonBytes(row) + ancestorBytes);
      else measure(nested, ancestorBytes + timelineRowShellJsonBytes(row));
    }
  };
  measure(rows, 0);
  return costs;
}

export function paginateTimelineContents(
  rows: readonly TimelineRow[],
  before: number | undefined,
  maxLeaves: number,
  maxBytes: number,
  costs: readonly number[] = measureTimelineContentLeafBytes(rows),
): TimelineContentPage {
  const end = Math.min(before ?? costs.length, costs.length);
  let start = end;
  let bytes = 0;
  while (start > 0 && end - start < Math.max(1, maxLeaves)) {
    const cost = costs[start - 1]!;
    if (start < end && bytes + cost > maxBytes) break;
    bytes += cost;
    start -= 1;
  }
  let index = 0;
  let olderRowsSourceSeqEnd: number | null = null;
  const recordOlderRow = (row: TimelineRow): void => {
    olderRowsSourceSeqEnd = Math.max(
      olderRowsSourceSeqEnd ?? 0,
      row.sourceSeqEnd,
    );
  };
  const select = (items: readonly TimelineRow[]): TimelineRow[] =>
    items.flatMap((row) => {
      const nested = children(row);
      if (nested === null) {
        const position = index++;
        if (position < start) recordOlderRow(row);
        return position >= start && position < end ? [row] : [];
      }
      const selected = select(nested);
      if (selected.length === 0 && index <= start) recordOlderRow(row);
      return selected.length === 0
        ? []
        : [withTimelineRowChildren(row, selected)];
    });
  let partialRowsSourceSeqEnd: number | null = null;
  const selectedRows = rows.flatMap((row) => {
    olderRowsSourceSeqEnd = null;
    const selected = select([row]);
    if (selected.length > 0 && olderRowsSourceSeqEnd !== null) {
      partialRowsSourceSeqEnd = Math.max(
        partialRowsSourceSeqEnd ?? 0,
        olderRowsSourceSeqEnd,
      );
    }
    return selected;
  });
  return {
    partialRowsSourceSeqEnd,
    rows: selectedRows,
    start,
    end,
    total: costs.length,
  };
}
