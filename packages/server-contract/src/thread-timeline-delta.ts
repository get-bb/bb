import {
  THREAD_TIMELINE_WINDOW_FIELD_KEYS,
  TIMELINE_PAGE_FIELD_KEYS,
  type ThreadTimelineDeltaResponse,
  type ThreadTimelineReadResponse,
  type ThreadTimelineResponse,
  type TimelineDelta,
  type TimelineDeltaFields,
  type TimelinePageMetadata,
  type TimelinePagePatch,
  type TimelineRowOrder,
} from "./api/threads.js";
import type { TimelineRow } from "./thread-timeline.js";

export function isThreadTimelineDelta(
  response: ThreadTimelineReadResponse,
): response is ThreadTimelineDeltaResponse {
  return "delta" in response;
}

export function computeThreadTimelineDelta(
  previous: ThreadTimelineResponse,
  current: ThreadTimelineResponse,
  rowKey: (row: TimelineRow) => string = JSON.stringify,
): ThreadTimelineDeltaResponse {
  const previousIndexes = new Map<string, number>();
  previous.rows.forEach((row, index) => {
    previousIndexes.set(row.id, index);
  });
  const upsertRows: TimelineRow[] = [];
  for (const row of current.rows) {
    const index = previousIndexes.get(row.id);
    const before = index === undefined ? undefined : previous.rows[index];
    if (
      before !== row &&
      (before === undefined || rowKey(before) !== rowKey(row))
    ) {
      upsertRows.push(row);
    }
  }
  const rowOrder = encodeRowOrder(previous.rows, current.rows, previousIndexes);
  return {
    maxSeq: current.maxSeq,
    tag: current.tag,
    delta: {
      afterTag: previous.tag,
      upsertRows,
      ...(rowOrder === null ? {} : { rowOrder }),
      fields: diffFields(previous, current),
    },
  };
}

export function applyThreadTimelineDelta(
  previous: ThreadTimelineResponse,
  response: ThreadTimelineDeltaResponse,
): ThreadTimelineResponse | null {
  const { delta } = response;
  if (delta.afterTag !== previous.tag) {
    return null;
  }
  const rows = applyRowDelta(previous.rows, delta);
  if (rows === null) {
    return null;
  }
  const { contextWindowUsage, timelinePage, ...fields } = delta.fields;
  const { contextWindowUsage: previousUsage, ...base } = previous;
  const usage =
    contextWindowUsage === undefined
      ? previousUsage
      : (contextWindowUsage ?? undefined);
  return {
    ...base,
    ...fields,
    ...(usage === undefined ? {} : { contextWindowUsage: usage }),
    timelinePage: applyTimelinePagePatch(previous.timelinePage, timelinePage),
    rows,
    maxSeq: response.maxSeq,
    tag: response.tag,
  };
}

function applyTimelinePagePatch(
  previous: TimelinePageMetadata,
  patch: TimelinePagePatch | undefined,
): TimelinePageMetadata {
  if (patch === undefined) {
    return previous;
  }
  const { olderRowUpdates, ...fields } = patch;
  const { olderRowUpdates: previousUpdates, ...base } = previous;
  const updates =
    olderRowUpdates === undefined
      ? previousUpdates
      : (olderRowUpdates ?? undefined);
  return {
    ...base,
    ...fields,
    ...(updates === undefined ? {} : { olderRowUpdates: updates }),
  };
}

function encodeRowOrder(
  previousRows: readonly TimelineRow[],
  currentRows: readonly TimelineRow[],
  previousIndexes: ReadonlyMap<string, number>,
): TimelineRowOrder | null {
  const order: TimelineRowOrder = [];
  let unchanged = previousRows.length === currentRows.length;
  let run: [number, number] | null = null;
  for (const [position, row] of currentRows.entries()) {
    const index = previousIndexes.get(row.id);
    if (index !== position) {
      unchanged = false;
    }
    if (index === undefined) {
      run = null;
      order.push(row.id);
    } else if (run !== null && run[0] + run[1] === index) {
      run[1] += 1;
    } else {
      run = [index, 1];
      order.push(run);
    }
  }
  return unchanged ? null : order;
}

function applyRowDelta(
  previousRows: readonly TimelineRow[],
  delta: TimelineDelta,
): TimelineRow[] | null {
  const upserts = new Map(delta.upsertRows.map((row) => [row.id, row]));
  let appliedUpserts = 0;
  const resolve = (row: TimelineRow): TimelineRow => {
    const next = upserts.get(row.id);
    if (next === undefined) {
      return row;
    }
    appliedUpserts += 1;
    return next;
  };
  if (delta.rowOrder === undefined) {
    const rows = previousRows.map(resolve);
    return appliedUpserts === upserts.size ? rows : null;
  }
  const rows: TimelineRow[] = [];
  for (const part of delta.rowOrder) {
    if (typeof part === "string") {
      const row = upserts.get(part);
      if (row === undefined) {
        return null;
      }
      appliedUpserts += 1;
      rows.push(row);
      continue;
    }
    const [start, length] = part;
    for (let index = start; index < start + length; index += 1) {
      const row = previousRows[index];
      if (row === undefined) {
        return null;
      }
      rows.push(resolve(row));
    }
  }
  return appliedUpserts === upserts.size ? rows : null;
}

function diffFields(
  previous: ThreadTimelineResponse,
  current: ThreadTimelineResponse,
): TimelineDeltaFields {
  const fields: TimelineDeltaFields = {};
  for (const key of THREAD_TIMELINE_WINDOW_FIELD_KEYS) {
    if (!sameJson(previous[key], current[key])) {
      setField(fields, key, current[key]);
    }
  }
  if (!sameJson(previous.contextWindowUsage, current.contextWindowUsage)) {
    fields.contextWindowUsage = current.contextWindowUsage ?? null;
  }
  const timelinePage = diffTimelinePage(
    previous.timelinePage,
    current.timelinePage,
  );
  if (Object.keys(timelinePage).length > 0) {
    fields.timelinePage = timelinePage;
  }
  return fields;
}

function diffTimelinePage(
  previous: TimelinePageMetadata,
  current: TimelinePageMetadata,
): TimelinePagePatch {
  const patch: TimelinePagePatch = {};
  for (const key of TIMELINE_PAGE_FIELD_KEYS) {
    if (!sameJson(previous[key], current[key])) {
      setField(patch, key, current[key]);
    }
  }
  if (!sameJson(previous.olderRowUpdates, current.olderRowUpdates)) {
    patch.olderRowUpdates = current.olderRowUpdates ?? null;
  }
  return patch;
}

function setField<Target extends object, Key extends keyof Target>(
  target: Target,
  key: Key,
  value: Target[Key],
): void {
  target[key] = value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}
