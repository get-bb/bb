import type { TimelineRow } from "@bb/server-contract";

export interface TimelineContentPage {
  olderRowsSourceSeqEnd: number | null;
  rows: TimelineRow[];
  start: number;
  end: number;
  total: number;
}

function children(row: TimelineRow): readonly TimelineRow[] | null {
  if (row.kind === "turn" && row.children?.length) return row.children;
  if (
    row.kind === "work" &&
    row.workKind === "delegation" &&
    row.childRows.length
  )
    return row.childRows;
  return null;
}

function withChildren(row: TimelineRow, rows: TimelineRow[]): TimelineRow {
  if (row.kind === "turn") return { ...row, children: rows };
  if (row.kind === "work" && row.workKind === "delegation")
    return { ...row, childRows: rows };
  return row;
}

export function paginateTimelineContents(
  rows: readonly TimelineRow[],
  before: number | undefined,
  maxLeaves: number,
  maxBytes: number,
): TimelineContentPage {
  const costs: number[] = [];
  const measure = (
    items: readonly TimelineRow[],
    ancestorBytes: number,
  ): void => {
    for (const row of items) {
      const nested = children(row);
      if (nested === null)
        costs.push(Buffer.byteLength(JSON.stringify(row)) + ancestorBytes);
      else
        measure(
          nested,
          ancestorBytes +
            Buffer.byteLength(JSON.stringify(withChildren(row, []))),
        );
    }
  };
  measure(rows, 0);
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
      return selected.length === 0 ? [] : [withChildren(row, selected)];
    });
  const selectedRows = select(rows);
  return {
    olderRowsSourceSeqEnd,
    rows: selectedRows,
    start,
    end,
    total: costs.length,
  };
}
