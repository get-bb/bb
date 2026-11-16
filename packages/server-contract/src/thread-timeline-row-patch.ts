import type {
  ThreadTimelineDeltaResponse,
  ThreadTimelineResponse,
  TimelineRowPatchOperation,
} from "./api/threads.js";
import { applyThreadTimelineDeltaWithRowPatcher } from "./thread-timeline-delta.js";
import { timelineRowSchema, type TimelineRow } from "./thread-timeline.js";

interface JsonObject {
  [key: string]: unknown;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function applyThreadTimelineDelta(
  previous: ThreadTimelineResponse,
  response: ThreadTimelineDeltaResponse,
): ThreadTimelineResponse | null {
  return applyThreadTimelineDeltaWithRowPatcher(
    previous,
    response,
    patchTimelineRow,
  );
}

const INVALID_PATCH = Symbol("invalid timeline row patch");

export function patchTimelineRow(
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
  return isTimelineRow(patched) && patched.id === row.id ? patched : null;
}

function isTimelineRow(value: unknown): value is TimelineRow {
  return timelineRowSchema.safeParse(value).success;
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
