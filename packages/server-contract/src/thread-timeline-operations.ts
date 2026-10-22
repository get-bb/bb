import type { TimelineRow, TimelineDelta } from "./thread-timeline.js";

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
): TimelineRow[] {
  let changed = false;
  const next = rows.map((row) => {
    const children = timelineRowChildren(row);
    const mappedChildren =
      children === null ? children : mapTimelineRowTree(children, mapRow);
    const mapped = mapRow(
      mappedChildren === children || mappedChildren === null
        ? row
        : withTimelineRowChildren(row, mappedChildren),
    );
    if (mapped !== row) {
      changed = true;
    }
    return mapped;
  });
  return changed ? next : rows;
}

export function computeTimelineRowDelta(
  prevRows: readonly TimelineRow[],
  currentRows: readonly TimelineRow[],
): TimelineDelta {
  const prevById = new Map<string, string>();
  for (const row of prevRows) {
    prevById.set(row.id, JSON.stringify(row));
  }
  const upsertRows: TimelineRow[] = [];
  const rowOrder: string[] = [];
  let orderChanged = prevRows.length !== currentRows.length;
  for (const row of currentRows) {
    rowOrder.push(row.id);
    if (prevRows[rowOrder.length - 1]?.id !== row.id) {
      orderChanged = true;
    }
    if (prevById.get(row.id) !== JSON.stringify(row)) {
      upsertRows.push(row);
    }
  }
  return orderChanged ? { upsertRows, rowOrder } : { upsertRows };
}

export function applyTimelineDelta(
  prevRows: readonly TimelineRow[],
  delta: TimelineDelta,
): TimelineRow[] | null {
  const byId = new Map<string, TimelineRow>();
  for (const row of prevRows) {
    byId.set(row.id, row);
  }
  for (const row of delta.upsertRows) {
    byId.set(row.id, row);
  }
  const result: TimelineRow[] = [];
  const rowOrder = delta.rowOrder ?? prevRows.map((row) => row.id);
  for (const id of rowOrder) {
    const row = byId.get(id);
    if (row === undefined) {
      return null;
    }
    result.push(row);
  }
  return result;
}
