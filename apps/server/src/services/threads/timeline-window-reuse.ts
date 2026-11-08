import {
  THREAD_TIMELINE_WINDOW_FIELD_KEYS,
  timelineRowChildren,
  withTimelineRowChildren,
  type TimelineRow,
} from "@bb/server-contract";
import type { ThreadTimelineWindow } from "./timeline.js";

const REUSABLE_WINDOW_FIELD_KEYS = [
  ...THREAD_TIMELINE_WINDOW_FIELD_KEYS,
  "contextWindowUsage",
  "timelinePage",
] as const;

function objectField(value: object, key: string): unknown {
  return (value as Record<string, unknown>)[key];
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (
    typeof left !== "object" ||
    typeof right !== "object" ||
    left === null ||
    right === null
  ) {
    return false;
  }
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!sameJsonValue(left[index], right[index])) return false;
    }
    return true;
  }
  if (Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index]!;
    if (
      key !== rightKeys[index] ||
      !sameJsonValue(objectField(left, key), objectField(right, key))
    ) {
      return false;
    }
  }
  return true;
}

export function reuseUnchangedTimelineRows(
  rows: TimelineRow[],
  previousRows: readonly TimelineRow[],
): TimelineRow[] {
  if (previousRows.length === 0) return rows;
  const previousById = new Map(previousRows.map((row) => [row.id, row]));
  let reused = false;
  const next = rows.map((row) => {
    const previous = previousById.get(row.id);
    if (previous === undefined || previous === row) return row;
    if (sameJsonValue(previous, row)) {
      reused = true;
      return previous;
    }
    const children = timelineRowChildren(row);
    const previousChildren = timelineRowChildren(previous);
    if (children === null || previousChildren === null) return row;
    const reusedChildren = reuseUnchangedTimelineRows(
      children,
      previousChildren,
    );
    if (reusedChildren === children) return row;
    reused = true;
    return withTimelineRowChildren(row, reusedChildren);
  });
  return reused ? next : rows;
}

function reuseUnchangedField<Key extends keyof ThreadTimelineWindow>(
  window: ThreadTimelineWindow,
  previous: ThreadTimelineWindow,
  key: Key,
): void {
  const value = window[key];
  const previousValue = previous[key];
  if (previousValue !== value && sameJsonValue(previousValue, value)) {
    window[key] = previousValue;
  }
}

export function reuseUnchangedTimelineWindowParts(
  window: ThreadTimelineWindow,
  previous: ThreadTimelineWindow | undefined,
): ThreadTimelineWindow {
  if (previous === undefined) return window;
  const reused: ThreadTimelineWindow = {
    ...window,
    rows: reuseUnchangedTimelineRows(window.rows, previous.rows),
  };
  for (const key of REUSABLE_WINDOW_FIELD_KEYS) {
    if (key in reused) reuseUnchangedField(reused, previous, key);
  }
  return reused;
}
