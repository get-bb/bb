import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { parseMessageLink } from "@bb/client-core";
import { appToast } from "@/components/ui/app-toast";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body.js";

interface SeqAnchoredRow {
  id: string;
  messageSeq?: number;
  sourceSeqStart: number;
  sourceSeqEnd: number;
  childRows?: readonly SeqAnchoredRow[];
  children?: readonly SeqAnchoredRow[] | null;
}

interface SearchMessageTarget {
  match: "message" | "sequence";
  seq: number;
  threadId: string | null;
}

export interface SearchMessageLocationTarget extends SearchMessageTarget {
  locationKey: string;
}

interface SearchMessageLocation {
  target: SearchMessageLocationTarget | null;
  readLocationKey: () => string;
}

interface SearchMessageLocationProviderProps {
  threadId: string | undefined;
  children: ReactNode;
}

interface SearchMessagePaginationOptions {
  hasOlderRows?: boolean;
  isLoadingOlderRows?: boolean;
  onLoadOlderRows?: () => Promise<void> | void;
  reportsMissingTarget?: boolean;
}

interface SeqRange {
  min: number;
  max: number;
}

const FLASH_CLASS_NAME = "bb-search-flash";
const FLASH_DURATION_MS = 1700;
const POST_WINDOW_SETTLE_REVEAL_MS = 800;

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

function findMessageSeqRowPath(
  rows: readonly SeqAnchoredRow[],
  seq: number,
): SeqAnchoredRow[] | null {
  for (const row of rows) {
    if (row.messageSeq === seq) {
      return [row];
    }
    const nestedRows = getNestedRows(row);
    const nestedPath =
      nestedRows === null ? null : findMessageSeqRowPath(nestedRows, seq);
    if (nestedPath !== null) {
      return [row, ...nestedPath];
    }
  }
  return null;
}

function findDeepestSeqAnchoredRow(
  rows: readonly SeqAnchoredRow[],
  seq: number,
): SeqAnchoredRow | null {
  return (
    findMessageSeqRowPath(rows, seq)?.at(-1) ??
    findDeepestContainingRow(rows, seq)
  );
}

function findSearchTargetRow(
  rows: readonly SeqAnchoredRow[],
  seq: number,
  match: SearchMessageTarget["match"],
): SeqAnchoredRow | null {
  return match === "message"
    ? (findMessageSeqRowPath(rows, seq)?.at(-1) ?? null)
    : findDeepestSeqAnchoredRow(rows, seq);
}

function findDeepestContainingRow(
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
    return findDeepestContainingRow(nestedRows, seq) ?? row;
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
    if (nestedRows === null || nestedRows.length === 0) {
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
  match: SearchMessageTarget["match"],
): ReadonlySet<string> {
  const messagePath = findMessageSeqRowPath(rows, seq);
  if (messagePath !== null) {
    return new Set(messagePath.map((row) => row.id));
  }
  if (match === "message") {
    return new Set();
  }
  const ancestorIds = new Set<string>();
  collectSearchedMessageAncestorRowIdsInRows({ ancestorIds, rows, seq });
  return ancestorIds;
}

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
      match: "sequence",
      seq: value,
      threadId: typeof threadIdValue === "string" ? threadIdValue : null,
    };
  }
  return null;
}

const SearchMessageLocationContext =
  createContext<SearchMessageLocation | null>(null);

function searchTargetAppliesToThread(
  target: SearchMessageTarget,
  threadId: string | undefined,
): boolean {
  return (
    threadId === undefined ||
    target.threadId === null ||
    target.threadId === threadId
  );
}

export function SearchMessageLocationProvider({
  threadId,
  children,
}: SearchMessageLocationProviderProps) {
  const location = useLocation();
  const locationKeyRef = useRef(location.key);
  useLayoutEffect(() => {
    locationKeyRef.current = location.key;
  }, [location.key]);
  const readLocationKey = useCallback(() => locationKeyRef.current, []);
  const searchTarget = readSearchMessageTarget(location.state);
  const messageLinkTarget = parseMessageLink(
    `${location.pathname}${location.search}`,
  );
  const target =
    searchTarget ??
    (messageLinkTarget === null
      ? null
      : { ...messageLinkTarget, match: "message" as const });
  const applies =
    target !== null && searchTargetAppliesToThread(target, threadId);
  const targetLocationKey = applies ? location.key : null;
  const targetMatch = applies ? target.match : null;
  const targetSeq = applies ? target.seq : null;
  const targetThreadId = applies ? target.threadId : null;
  const value = useMemo<SearchMessageLocation>(
    () => ({
      target:
        targetLocationKey === null || targetSeq === null
          ? null
          : {
              locationKey: targetLocationKey,
              match: targetMatch,
              seq: targetSeq,
              threadId: targetThreadId,
            },
      readLocationKey,
    }),
    [
      readLocationKey,
      targetLocationKey,
      targetMatch,
      targetSeq,
      targetThreadId,
    ],
  );
  return createElement(
    SearchMessageLocationContext.Provider,
    { value },
    children,
  );
}

export function useSearchMessageLocation(): SearchMessageLocation {
  const value = useContext(SearchMessageLocationContext);
  if (value === null) {
    throw new Error(
      "useSearchMessageLocation: no <SearchMessageLocationProvider> above the caller",
    );
  }
  return value;
}

export function useScrollToSearchedMessage(
  rows: readonly SeqAnchoredRow[],
  threadId: string | undefined,
  {
    hasOlderRows = false,
    isLoadingOlderRows = false,
    onLoadOlderRows,
    reportsMissingTarget = false,
  }: SearchMessagePaginationOptions = {},
): void {
  const { target, readLocationKey } = useSearchMessageLocation();
  const bottomAnchor = useBottomAnchoredScroll();
  const handledKeyRef = useRef<string | null>(null);
  const olderLoadAttemptKeyRef = useRef<string | null>(null);
  const pendingRevealTimersRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const pendingRevealTimers = pendingRevealTimersRef.current;
    return () => {
      for (const timer of pendingRevealTimers) {
        window.clearTimeout(timer);
      }
      pendingRevealTimers.clear();
      handledKeyRef.current = null;
    };
  }, []);
  const targetLocationKey = target?.locationKey ?? null;
  const targetMatch = target?.match ?? null;
  const targetSeq = target?.seq ?? null;
  const targetThreadId = target?.threadId ?? null;

  useEffect(() => {
    if (
      targetLocationKey === null ||
      targetMatch === null ||
      targetSeq === null ||
      handledKeyRef.current === targetLocationKey
    ) {
      return;
    }
    if (threadId !== undefined && targetThreadId !== null) {
      if (threadId !== targetThreadId) {
        return;
      }
    }
    const targetLeafRow = findSearchTargetRow(rows, targetSeq, targetMatch);
    if (targetLeafRow === null) {
      const loadedRange = getRowsSeqRange(rows);
      const targetIsOlderThanLoadedRows =
        loadedRange !== null && targetSeq < loadedRange.max;
      const targetIsMissing =
        loadedRange !== null &&
        (targetMatch === "message" || targetIsOlderThanLoadedRows);
      const canLoadOlderTarget = targetIsOlderThanLoadedRows && hasOlderRows;
      const olderLoadAttemptKey =
        loadedRange === null
          ? null
          : [
              targetLocationKey,
              targetMatch,
              targetThreadId ?? "",
              targetSeq,
              loadedRange.min,
              loadedRange.max,
              getRowsSeqWindowKey(rows),
            ].join("::");
      if (
        canLoadOlderTarget &&
        !isLoadingOlderRows &&
        onLoadOlderRows !== undefined &&
        olderLoadAttemptKey !== null &&
        olderLoadAttemptKeyRef.current !== olderLoadAttemptKey
      ) {
        olderLoadAttemptKeyRef.current = olderLoadAttemptKey;
        void Promise.resolve(onLoadOlderRows()).catch(() => undefined);
        return;
      }
      if (
        reportsMissingTarget &&
        targetIsMissing &&
        !canLoadOlderTarget &&
        !isLoadingOlderRows
      ) {
        handledKeyRef.current = targetLocationKey;
        appToast.message("Message not found", {
          description:
            "It may have been removed by an edit or hidden by a context clear.",
        });
      }
      return;
    }
    const selector = `[data-timeline-row-id="${escapeTimelineRowId(targetLeafRow.id)}"]`;
    const renderedTarget = document.querySelector<HTMLElement>(selector);
    if (
      renderedTarget === null ||
      renderedTarget.dataset.timelineWindowedRealized === "false"
    ) {
      return;
    }
    handledKeyRef.current = targetLocationKey;

    let flashed = false;
    const revealTarget = () => {
      if (readLocationKey() !== targetLocationKey) {
        return;
      }
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null) {
        return;
      }
      if (bottomAnchor !== null) {
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

    const scheduleReveal = (delayMs: number) => {
      const timer = window.setTimeout(() => {
        pendingRevealTimersRef.current.delete(timer);
        revealTarget();
      }, delayMs);
      pendingRevealTimersRef.current.add(timer);
    };

    const frame = requestAnimationFrame(revealTarget);
    scheduleReveal(320);
    scheduleReveal(POST_WINDOW_SETTLE_REVEAL_MS);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [
    bottomAnchor,
    hasOlderRows,
    isLoadingOlderRows,
    onLoadOlderRows,
    readLocationKey,
    reportsMissingTarget,
    rows,
    targetLocationKey,
    targetMatch,
    targetSeq,
    targetThreadId,
    threadId,
  ]);
}
