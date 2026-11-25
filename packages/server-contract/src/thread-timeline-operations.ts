import type { TimelineRow } from "./thread-timeline.js";

export function timelineRowChildren(row: TimelineRow): TimelineRow[] | null {
  if (row.kind === "turn") return row.children;
  if (row.kind === "work" && row.workKind === "delegation")
    return row.childRows;
  return null;
}

export function withTimelineRowChildren(
  row: TimelineRow,
  children: TimelineRow[],
): TimelineRow {
  if (row.kind === "turn") return { ...row, children };
  if (row.kind === "work" && row.workKind === "delegation") {
    return { ...row, childRows: children };
  }
  return row;
}

export function mapTimelineRowTree(
  rows: TimelineRow[],
  mapRow: (row: TimelineRow) => TimelineRow,
  mappedRows?: WeakMap<TimelineRow, TimelineRow>,
): TimelineRow[] {
  let changed = false;
  const next = rows.map((row) => {
    const cached = mappedRows?.get(row);
    if (cached !== undefined) {
      if (cached !== row) changed = true;
      return cached;
    }
    const children = timelineRowChildren(row);
    const mappedChildren =
      children === null
        ? children
        : mapTimelineRowTree(children, mapRow, mappedRows);
    const mapped = mapRow(
      mappedChildren === children || mappedChildren === null
        ? row
        : withTimelineRowChildren(row, mappedChildren),
    );
    mappedRows?.set(row, mapped);
    if (mapped !== row) {
      changed = true;
    }
    return mapped;
  });
  return changed ? next : rows;
}
