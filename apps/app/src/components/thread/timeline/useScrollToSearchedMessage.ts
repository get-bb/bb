import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body.js";

// Structural subset of a timeline view row — every row carries an event-sequence
// range, which is how we map a searched message's sequence to its rendered row.
interface SeqAnchoredRow {
  id: string;
  sourceSeqStart: number;
  sourceSeqEnd: number;
  childRows?: readonly SeqAnchoredRow[];
  children?: readonly SeqAnchoredRow[] | null;
}

interface SearchMessageTarget {
  seq: number;
  threadId: string | null;
}

interface SearchMessagePaginationOptions {
  hasOlderRows?: boolean;
  isLoadingOlderRows?: boolean;
  onLoadOlderRows?: () => Promise<void> | void;
}

interface SeqRange {
  min: number;
  max: number;
}

const FLASH_CLASS_NAME = "bb-search-flash";
const FLASH_DURATION_MS = 1700;

function escapeTimelineRowId(rowId: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(rowId);
  }
  return rowId.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function containsSeq(row: SeqAnchoredRow, seq: number): boolean {
  return row.sourceSeqStart <= seq && seq <= row.sourceSeqEnd;
}

function getNestedRows(row: SeqAnchoredRow): readonly SeqAnchoredRow[] | null {
  if (row.childRows) {
    return row.childRows;
  }
  if ("children" in row) {
    return row.children ?? null;
  }
  return [];
}

function findDeepestSeqAnchoredRow(
  rows: readonly SeqAnchoredRow[],
  seq: number,
): SeqAnchoredRow | null {
  for (const row of rows) {
    if (!containsSeq(row, seq)) {
      continue;
    }
    const nestedRows = getNestedRows(row);
    if (nestedRows === null) {
      return null;
    }
    return findDeepestSeqAnchoredRow(nestedRows, seq) ?? row;
  }
  return null;
}

function mergeSeqRange(left: SeqRange | null, right: SeqRange): SeqRange {
  if (left === null) {
    return right;
  }
  return {
    min: Math.min(left.min, right.min),
    max: Math.max(left.max, right.max),
  };
}

function getRowsSeqRange(rows: readonly SeqAnchoredRow[]): SeqRange | null {
  let range: SeqRange | null = null;
  for (const row of rows) {
    range = mergeSeqRange(range, {
      min: row.sourceSeqStart,
      max: row.sourceSeqEnd,
    });
    const nestedRows = getNestedRows(row);
    if (nestedRows !== null) {
      const nestedRange = getRowsSeqRange(nestedRows);
      if (nestedRange !== null) {
        range = mergeSeqRange(range, nestedRange);
      }
    }
  }
  return range;
}

function getRowsSeqWindowKey(rows: readonly SeqAnchoredRow[]): string {
  return rows
    .map((row) => {
      const nestedRows = getNestedRows(row);
      return [
        row.id,
        row.sourceSeqStart,
        row.sourceSeqEnd,
        nestedRows === null ? "collapsed" : getRowsSeqWindowKey(nestedRows),
      ].join(":");
    })
    .join("|");
}

function rowsContainSeq(rows: readonly SeqAnchoredRow[], seq: number): boolean {
  return rows.some((row) => containsSeq(row, seq));
}

function collectSearchedMessageAncestorRowIdsInRows({
  ancestorIds,
  rows,
  seq,
}: {
  ancestorIds: Set<string>;
  rows: readonly SeqAnchoredRow[];
  seq: number;
}): boolean {
  for (const row of rows) {
    if (!containsSeq(row, seq)) {
      continue;
    }
    const nestedRows = getNestedRows(row);
    if (nestedRows === null) {
      ancestorIds.add(row.id);
      return true;
    }
    if (
      collectSearchedMessageAncestorRowIdsInRows({
        ancestorIds,
        rows: nestedRows,
        seq,
      })
    ) {
      ancestorIds.add(row.id);
    }
    return true;
  }
  return false;
}

export function collectSearchedMessageAncestorRowIds(
  rows: readonly SeqAnchoredRow[],
  seq: number,
): ReadonlySet<string> {
  const ancestorIds = new Set<string>();
  collectSearchedMessageAncestorRowIdsInRows({ ancestorIds, rows, seq });
  return ancestorIds;
}

// Sidebar search hands the matched message's event sequence to the thread route
// via `navigate(path, { state: { searchMessageSeq, searchThreadId } })`.
export function readSearchMessageTarget(
  state: unknown,
): SearchMessageTarget | null {
  if (
    state !== null &&
    typeof state === "object" &&
    "searchMessageSeq" in state
  ) {
    const value = (state as { searchMessageSeq: unknown }).searchMessageSeq;
    if (typeof value !== "number") {
      return null;
    }
    const threadIdValue = (state as { searchThreadId?: unknown })
      .searchThreadId;
    return {
      seq: value,
      threadId: typeof threadIdValue === "string" ? threadIdValue : null,
    };
  }
  return null;
}

/**
 * When the thread was opened from a sidebar search result whose match was in a
 * message body, scroll that message into view and briefly highlight it.
 *
 * Keyed off `location.key` so it fires once per navigation (not on every render
 * or row update). The effect also depends on `rows`, so if the timeline hasn't
 * hydrated the target row yet it simply retries once the rows arrive.
 */
export function useScrollToSearchedMessage(
  rows: readonly SeqAnchoredRow[],
  threadId: string | undefined,
  {
    hasOlderRows = false,
    isLoadingOlderRows = false,
    onLoadOlderRows,
  }: SearchMessagePaginationOptions = {},
): void {
  const location = useLocation();
  const bottomAnchor = useBottomAnchoredScroll();
  const handledKeyRef = useRef<string | null>(null);
  const olderLoadAttemptKeyRef = useRef<string | null>(null);
  const target = readSearchMessageTarget(location.state);
  const targetSeq = target?.seq ?? null;
  const targetThreadId = target?.threadId ?? null;

  useEffect(() => {
    if (targetSeq === null || handledKeyRef.current === location.key) {
      return;
    }
    if (threadId !== undefined && targetThreadId !== null) {
      if (threadId !== targetThreadId) {
        return;
      }
    }
    const targetLeafRow = findDeepestSeqAnchoredRow(rows, targetSeq);
    if (targetLeafRow === null) {
      // Target row not rendered yet (still loading, or inside a collapsed
      // group). Leave the key unhandled so a later rows change can retry.
      const loadedRange = getRowsSeqRange(rows);
      const targetIsOlderThanLoadedRows =
        loadedRange !== null && targetSeq < loadedRange.max;
      const olderLoadAttemptKey =
        loadedRange === null
          ? null
          : [
              location.key,
              targetThreadId ?? "",
              targetSeq,
              loadedRange.min,
              loadedRange.max,
              getRowsSeqWindowKey(rows),
            ].join("::");
      if (
        targetIsOlderThanLoadedRows &&
        !rowsContainSeq(rows, targetSeq) &&
        hasOlderRows &&
        !isLoadingOlderRows &&
        onLoadOlderRows !== undefined &&
        olderLoadAttemptKey !== null &&
        olderLoadAttemptKeyRef.current !== olderLoadAttemptKey
      ) {
        olderLoadAttemptKeyRef.current = olderLoadAttemptKey;
        void Promise.resolve(onLoadOlderRows()).catch(() => undefined);
      }
      return;
    }
    const selector = `[data-timeline-row-id="${escapeTimelineRowId(targetLeafRow.id)}"]`;
    if (document.querySelector(selector) === null) {
      return;
    }
    handledKeyRef.current = location.key;

    let flashed = false;
    const revealTarget = () => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null) {
        return;
      }
      if (bottomAnchor !== null) {
        // scrollElementIntoView suppresses stick-to-bottom so this wins over the
        // default open-at-bottom behavior.
        bottomAnchor.scrollElementIntoView({
          element,
          options: { block: "center" },
        });
      } else {
        element.scrollIntoView({ block: "center" });
      }
      if (!flashed) {
        flashed = true;
        element.classList.add(FLASH_CLASS_NAME);
        window.setTimeout(() => {
          element.classList.remove(FLASH_CLASS_NAME);
        }, FLASH_DURATION_MS);
      }
    };

    // Reveal on the next frame, then once more after layout settles, so a late
    // scroll-anchor restore can't leave the target off-screen.
    const frame = requestAnimationFrame(revealTarget);
    const settle = window.setTimeout(revealTarget, 320);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [
    bottomAnchor,
    hasOlderRows,
    isLoadingOlderRows,
    location.key,
    onLoadOlderRows,
    rows,
    targetSeq,
    targetThreadId,
    threadId,
  ]);
}
