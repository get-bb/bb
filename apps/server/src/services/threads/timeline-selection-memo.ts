import { THREAD_TIMELINE_EXCLUDED_EVENT_TYPES } from "@bb/thread-view";
import type { ThreadEventItemType, ThreadEventType } from "@bb/domain";
import {
  advanceTimelineWindowBudgetFloorSequence,
  findTimelineWindowBudgetFloorSequence,
  getDatabaseDataVersion,
  getLatestThreadSequence,
  getThreadEventRewriteGeneration,
  listStoredEventRowsInSequenceRange,
  listStoredTimelineWindowEventRows,
  type DbConnection,
  type TimelineWindowHint,
  type StoredEventRow,
} from "@bb/db";
import { getTimelineGroupingContext } from "./timeline-context-order.js";
import type { ThreadTimelinePageRequest } from "./timeline-pagination.js";

export type ThreadTimelineEventSelectionStrategy = "full" | "standard-window";

export interface TimelineEventRowSelection {
  contextOnlyInterruptionSequences: ReadonlySet<number>;
  orderingBoundarySequence: number | null;
  ownedSequenceStart: number;
  ownedSequenceEnd: number;
  hasOlderSegments: boolean;
  paginationPage: ThreadTimelinePageRequest;
  rows: StoredEventRow[];
  headStateRows: StoredEventRow[];
  strategy: ThreadTimelineEventSelectionStrategy;
}

export interface StandardTimelineEventRowSelection {
  budgetFloorSequence: number | undefined;
  hints: readonly TimelineWindowHint[];
  fetchedTurnIds: ReadonlySet<string>;
  selection: TimelineEventRowSelection;
}

export interface TimelineBudgetFloor {
  sequence: number | undefined;
}

export interface LatestTimelineSelectionMemoArgs {
  epochSequenceStart: number;
  eventBudget: number;
  excludeDiagnosticEvents: boolean;
  maxInlineOutputChars: number;
  maxSeq: number;
  page: ThreadTimelinePageRequest;
  threadId: string;
}

export interface LatestTimelineSelectionLookup {
  budgetFloor: TimelineBudgetFloor | null;
  dataVersion: number;
  generation: number;
  selection: TimelineEventRowSelection | null;
}

interface TimelineSelectionMemoEntry {
  budgetFloorSequence: number | undefined;
  hints: readonly TimelineWindowHint[];
  appendableTurnIds: ReadonlySet<string>;
  delegatingItemIds: ReadonlySet<string>;
  dataChars: number;
  dataVersion: number;
  epochSequenceStart: number;
  generation: number;
  maxSeq: number;
  selection: TimelineEventRowSelection;
  threadId: string;
}

interface TimelineSelectionMemo {
  dataChars: number;
  entries: Map<string, TimelineSelectionMemoEntry>;
}

export const TIMELINE_SELECTION_MEMO_MAX_ENTRIES = 16;
const TIMELINE_SELECTION_MEMO_MAX_DATA_CHARS = 16_000_000;
const TIMELINE_SELECTION_MEMO_MAX_APPENDED_ROWS = 512;

const SELECTION_CHANGING_EVENT_TYPES: ReadonlySet<ThreadEventType> = new Set([
  "client/turn/requested",
  "client/turn/rejected",
  "turn/input/accepted",
  "turn/started",
  "turn/completed",
  "turn/plan/updated",
  "system/thread/interrupted",
  "thread/goal/updated",
  "thread/goal/cleared",
  "thread/extensionState/updated",
  "item/backgroundTask/progress",
  "item/backgroundTask/completed",
]);

const SELECTION_CHANGING_ITEM_KINDS: ReadonlySet<ThreadEventItemType> = new Set(
  ["backgroundTask", "delegation", "planSteps"],
);

const selectionMemos = new WeakMap<DbConnection, TimelineSelectionMemo>();

export function clearTimelineSelectionMemo(db: DbConnection): void {
  selectionMemos.delete(db);
}

export function countTimelineSelectionMemoEntries(db: DbConnection): number {
  return selectionMemos.get(db)?.entries.size ?? 0;
}

export function selectTimelineWindowStart(
  hints: readonly TimelineWindowHint[],
  budgetFloorSequence: number | undefined,
  segmentLimit: number,
  epochSequenceStart: number,
): number {
  if (budgetFloorSequence === undefined && hints.length <= segmentLimit) {
    return epochSequenceStart;
  }
  const affordable = hints.filter(
    (hint) =>
      budgetFloorSequence === undefined || hint.sequence >= budgetFloorSequence,
  );
  return (
    affordable[Math.min(segmentLimit, affordable.length) - 1]?.sequence ??
    hints[0]?.sequence ??
    budgetFloorSequence ??
    epochSequenceStart
  );
}

function getSelectionMemo(db: DbConnection): TimelineSelectionMemo {
  let memo = selectionMemos.get(db);
  if (memo === undefined) {
    memo = { dataChars: 0, entries: new Map() };
    selectionMemos.set(db, memo);
  }
  return memo;
}

function dataCharsOfRows(rows: readonly StoredEventRow[]): number {
  let chars = 0;
  for (const row of rows) {
    chars += row.data.length;
  }
  return chars;
}

function deleteMemoEntry(memo: TimelineSelectionMemo, key: string): void {
  const entry = memo.entries.get(key);
  if (entry === undefined) return;
  memo.entries.delete(key);
  memo.dataChars -= entry.dataChars;
}

function deleteThreadMemoEntries(
  memo: TimelineSelectionMemo,
  threadId: string,
  keep: (entry: TimelineSelectionMemoEntry) => boolean,
): void {
  for (const [key, entry] of memo.entries) {
    if (entry.threadId === threadId && !keep(entry)) {
      deleteMemoEntry(memo, key);
    }
  }
}

function storeMemoEntry(
  memo: TimelineSelectionMemo,
  key: string,
  entry: TimelineSelectionMemoEntry,
): void {
  deleteMemoEntry(memo, key);
  if (entry.dataChars > TIMELINE_SELECTION_MEMO_MAX_DATA_CHARS) return;
  memo.entries.set(key, entry);
  memo.dataChars += entry.dataChars;
  while (
    memo.entries.size > TIMELINE_SELECTION_MEMO_MAX_ENTRIES ||
    memo.dataChars > TIMELINE_SELECTION_MEMO_MAX_DATA_CHARS
  ) {
    const oldest = memo.entries.keys().next().value;
    if (oldest === undefined) break;
    deleteMemoEntry(memo, oldest);
  }
}

function selectionMemoKey(args: LatestTimelineSelectionMemoArgs): string {
  return JSON.stringify([
    args.threadId,
    args.page.segmentLimit,
    args.eventBudget,
    args.maxInlineOutputChars,
    args.excludeDiagnosticEvents,
    args.epochSequenceStart,
  ]);
}

function collectDelegatingItemIds(
  rows: readonly StoredEventRow[],
): Set<string> {
  const itemIds = new Set<string>();
  for (const row of rows) {
    if (
      (row.itemKind === "toolCall" || row.itemKind === "delegation") &&
      row.itemId !== null
    ) {
      itemIds.add(row.itemId);
    }
  }
  return itemIds;
}

function changesSelection(row: StoredEventRow): boolean {
  return (
    SELECTION_CHANGING_EVENT_TYPES.has(row.type) ||
    (row.itemKind !== null && SELECTION_CHANGING_ITEM_KINDS.has(row.itemKind))
  );
}

function hasParentToolCall(row: StoredEventRow): boolean {
  return row.parentToolCallId !== null && row.parentToolCallId.length > 0;
}

function extendsSelection(
  row: StoredEventRow,
  entry: TimelineSelectionMemoEntry,
): boolean {
  if (
    row.scopeKind === "turn" &&
    (row.turnId === null || !entry.appendableTurnIds.has(row.turnId))
  ) {
    return false;
  }
  if (
    hasParentToolCall(row) &&
    !entry.delegatingItemIds.has(row.parentToolCallId ?? "")
  ) {
    return false;
  }
  return (
    row.itemKind !== "toolCall" ||
    (row.itemId !== null && entry.delegatingItemIds.has(row.itemId))
  );
}

interface AppendedSelectionRows {
  parented: boolean;
  rows: StoredEventRow[];
}

function listAppendableRows(
  db: DbConnection,
  args: LatestTimelineSelectionMemoArgs,
  entry: TimelineSelectionMemoEntry,
): AppendedSelectionRows | null {
  if (
    args.maxSeq < entry.maxSeq ||
    args.maxSeq - entry.maxSeq > TIMELINE_SELECTION_MEMO_MAX_APPENDED_ROWS ||
    getLatestThreadSequence(db, { threadId: args.threadId }) !== args.maxSeq
  ) {
    return null;
  }
  const appendedRows = listStoredEventRowsInSequenceRange(db, {
    afterSequence: entry.maxSeq,
    limit: TIMELINE_SELECTION_MEMO_MAX_APPENDED_ROWS + 1,
    maxInlineOutputChars: args.maxInlineOutputChars,
    threadId: args.threadId,
    throughSequence: args.maxSeq,
  });
  if (
    appendedRows.length > TIMELINE_SELECTION_MEMO_MAX_APPENDED_ROWS ||
    appendedRows.some(changesSelection)
  ) {
    return null;
  }
  const rows =
    appendedRows.length === 0
      ? []
      : listStoredTimelineWindowEventRows(db, {
          beforeSequence: args.maxSeq + 1,
          excludeDiagnosticEvents: args.excludeDiagnosticEvents,
          excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
          maxInlineOutputChars: args.maxInlineOutputChars,
          sequenceStart: entry.maxSeq + 1,
          threadId: args.threadId,
        });
  if (!rows.every((row) => extendsSelection(row, entry))) {
    return null;
  }
  return { parented: appendedRows.some(hasParentToolCall), rows };
}

export function forgetLatestTimelineSelections(
  db: DbConnection,
  threadId: string,
): void {
  const memo = selectionMemos.get(db);
  if (memo === undefined) return;
  deleteThreadMemoEntries(memo, threadId, () => false);
}

export function lookupLatestTimelineSelection(
  db: DbConnection,
  args: LatestTimelineSelectionMemoArgs,
): LatestTimelineSelectionLookup {
  const generation = getThreadEventRewriteGeneration(args.threadId);
  const dataVersion = getDatabaseDataVersion(db);
  const miss: LatestTimelineSelectionLookup = {
    budgetFloor: null,
    dataVersion,
    generation,
    selection: null,
  };
  const memo = selectionMemos.get(db);
  const key = selectionMemoKey(args);
  const entry = memo?.entries.get(key);
  if (
    memo === undefined ||
    entry === undefined ||
    entry.generation !== generation ||
    entry.dataVersion !== dataVersion
  ) {
    return miss;
  }
  const appended = listAppendableRows(db, args, entry);
  if (appended === null) {
    return miss;
  }
  const budgetFloor: TimelineBudgetFloor = {
    sequence:
      entry.budgetFloorSequence === undefined
        ? findTimelineWindowBudgetFloorSequence(db, {
            threadId: args.threadId,
            sequenceStart: args.epochSequenceStart,
            beforeSequence: args.maxSeq + 1,
            eventBudget: args.eventBudget,
            excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
            excludeDiagnosticEvents: args.excludeDiagnosticEvents,
          })
        : advanceTimelineWindowBudgetFloorSequence(db, {
            appendedEventCount: appended.rows.length,
            excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
            excludeDiagnosticEvents: args.excludeDiagnosticEvents,
            floorSequence: entry.budgetFloorSequence,
            threadId: args.threadId,
          }),
  };
  const sequenceStart = selectTimelineWindowStart(
    entry.hints,
    budgetFloor.sequence,
    args.page.segmentLimit,
    args.epochSequenceStart,
  );
  if (sequenceStart !== entry.selection.ownedSequenceStart) {
    return { ...miss, budgetFloor };
  }
  const selection: TimelineEventRowSelection = {
    ...entry.selection,
    orderingBoundarySequence: appended.parented
      ? getTimelineGroupingContext(db, {
          maxSeq: args.maxSeq,
          sequenceStart: args.epochSequenceStart,
          threadId: args.threadId,
        }).orderingBoundarySequence
      : entry.selection.orderingBoundarySequence,
    ownedSequenceEnd: args.maxSeq + 1,
    paginationPage: args.page,
    rows: entry.selection.rows.concat(appended.rows),
  };
  storeMemoEntry(memo, key, {
    ...entry,
    budgetFloorSequence: budgetFloor.sequence,
    dataChars: entry.dataChars + dataCharsOfRows(appended.rows),
    maxSeq: args.maxSeq,
    selection,
  });
  return { ...miss, budgetFloor, selection };
}

export function rememberLatestTimelineSelection(
  db: DbConnection,
  args: LatestTimelineSelectionMemoArgs,
  lookup: LatestTimelineSelectionLookup,
  result: StandardTimelineEventRowSelection,
): void {
  const memo = getSelectionMemo(db);
  deleteThreadMemoEntries(
    memo,
    args.threadId,
    (entry) => entry.epochSequenceStart === args.epochSequenceStart,
  );
  storeMemoEntry(memo, selectionMemoKey(args), {
    budgetFloorSequence: result.budgetFloorSequence,
    hints: result.hints,
    appendableTurnIds: result.fetchedTurnIds,
    delegatingItemIds: collectDelegatingItemIds(result.selection.rows),
    dataChars:
      dataCharsOfRows(result.selection.rows) +
      dataCharsOfRows(result.selection.headStateRows),
    dataVersion: lookup.dataVersion,
    epochSequenceStart: args.epochSequenceStart,
    generation: lookup.generation,
    maxSeq: args.maxSeq,
    selection: result.selection,
    threadId: args.threadId,
  });
}
