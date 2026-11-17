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
  type TimelineRowPatch,
  type TimelineRowPatchOperation,
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
  const patchRows: TimelineRowPatch[] = [];
  for (const row of current.rows) {
    const index = previousIndexes.get(row.id);
    const before = index === undefined ? undefined : previous.rows[index];
    if (before === row) {
      continue;
    }
    if (before === undefined) {
      upsertRows.push(row);
    } else if (rowKey(before) !== rowKey(row)) {
      const ops: TimelineRowPatchOperation[] = [];
      diffJsonValue(before, row, [], ops);
      if (ops.length > 0) {
        patchRows.push({ id: row.id, ops });
      }
    }
  }
  const rowOrder = encodeRowOrder(previous.rows, current.rows, previousIndexes);
  return {
    maxSeq: current.maxSeq,
    tag: current.tag,
    delta: {
      afterTag: previous.tag,
      upsertRows,
      ...(patchRows.length === 0 ? {} : { patchRows }),
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
  const patches = new Map(
    (delta.patchRows ?? []).map((patch) => [patch.id, patch.ops]),
  );
  let appliedUpserts = 0;
  let appliedPatches = 0;
  let invalidPatch = false;
  const resolve = (row: TimelineRow): TimelineRow => {
    const next = upserts.get(row.id);
    if (next !== undefined) {
      appliedUpserts += 1;
      return next;
    }
    const ops = patches.get(row.id);
    if (ops === undefined) {
      return row;
    }
    appliedPatches += 1;
    const patched = patchTimelineRow(row, ops);
    if (patched === null) {
      invalidPatch = true;
      return row;
    }
    return patched;
  };
  const fits = () =>
    !invalidPatch &&
    appliedUpserts === upserts.size &&
    appliedPatches === patches.size;
  if (delta.rowOrder === undefined) {
    const rows = previousRows.map(resolve);
    return fits() ? rows : null;
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
  return fits() ? rows : null;
}

type JsonPath = (string | number)[];

interface JsonObject {
  [key: string]: unknown;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const INVALID_PATCH = Symbol("invalid timeline row patch");

function patchTimelineRow(
  row: TimelineRow,
  ops: readonly TimelineRowPatchOperation[],
): TimelineRow | null {
  let patched: unknown = row;
  for (const op of ops) {
    const next = applyPatchOperation(patched, op, 0);
    if (next === INVALID_PATCH) {
      return null;
    }
    patched = next;
  }
  return isPatchOfRow(patched, row) ? patched : null;
}

function isPatchOfRow(value: unknown, row: TimelineRow): value is TimelineRow {
  return isJsonObject(value) && value.id === row.id && value.kind === row.kind;
}

function applyPatchOperation(
  node: unknown,
  op: TimelineRowPatchOperation,
  depth: number,
): unknown {
  const path = op[1];
  const key = path[depth]!;
  const leaf = depth === path.length - 1;
  if (Array.isArray(node)) {
    if (typeof key !== "number" || key > node.length) {
      return INVALID_PATCH;
    }
    const copy = [...node];
    if (leaf) {
      if (op[0] === "delete") {
        return INVALID_PATCH;
      }
      const value = patchLeafValue(node[key], op);
      if (value === INVALID_PATCH) {
        return INVALID_PATCH;
      }
      copy[key] = value;
      return copy;
    }
    const child = applyPatchOperation(node[key], op, depth + 1);
    if (child === INVALID_PATCH) {
      return INVALID_PATCH;
    }
    copy[key] = child;
    return copy;
  }
  if (!isJsonObject(node) || typeof key !== "string") {
    return INVALID_PATCH;
  }
  const copy: JsonObject = { ...node };
  if (leaf && op[0] === "delete") {
    if (node[key] === undefined) {
      return INVALID_PATCH;
    }
    delete copy[key];
    return copy;
  }
  const value = leaf
    ? patchLeafValue(node[key], op)
    : applyPatchOperation(node[key], op, depth + 1);
  if (value === INVALID_PATCH) {
    return INVALID_PATCH;
  }
  Object.defineProperty(copy, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
  return copy;
}

function patchLeafValue(
  current: unknown,
  op: TimelineRowPatchOperation,
): unknown {
  if (op[0] === "set") {
    return op[2];
  }
  if (op[0] === "append" && typeof current === "string") {
    return current + op[2];
  }
  return INVALID_PATCH;
}

function diffJsonValue(
  before: unknown,
  after: unknown,
  path: JsonPath,
  ops: TimelineRowPatchOperation[],
): void {
  if (before === after) {
    return;
  }
  if (typeof before === "string" && typeof after === "string") {
    ops.push(
      before.length > 0 && after.startsWith(before)
        ? ["append", path, after.slice(before.length)]
        : ["set", path, after],
    );
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    if (after.length < before.length) {
      ops.push(["set", path, after]);
      return;
    }
    after.forEach((value, index) => {
      if (index < before.length) {
        diffJsonValue(before[index], value, [...path, index], ops);
      } else {
        ops.push(["set", [...path, index], value]);
      }
    });
    return;
  }
  if (isJsonObject(before) && isJsonObject(after)) {
    for (const [key, value] of Object.entries(before)) {
      if (value !== undefined && after[key] === undefined) {
        ops.push(["delete", [...path, key]]);
      }
    }
    for (const [key, value] of Object.entries(after)) {
      if (value === undefined) {
        continue;
      }
      if (before[key] === undefined) {
        ops.push(["set", [...path, key], value]);
      } else {
        diffJsonValue(before[key], value, [...path, key], ops);
      }
    }
    return;
  }
  ops.push(["set", path, after]);
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
