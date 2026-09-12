import { THREAD_TIMELINE_EXCLUDED_EVENT_TYPES } from "@bb/thread-view";
import type { ThreadEventType } from "@bb/domain";
import {
  findTimelineWindowBudgetFloorSequence,
  getDatabaseDataVersion,
  getLatestThreadSequence,
  getThreadEventRewriteGeneration,
  listStoredEventRowsInSequenceRange,
  type DbConnection,
  type StandardTimelineSegmentAnchorRow,
  type StoredEventRow,
} from "@bb/db";
import type {
  ThreadTimelinePageKind,
  ThreadTimelinePageRequest,
} from "./timeline-pagination.js";

export type ThreadTimelineEventSelectionStrategy = "full" | "standard-window";

export interface TimelineEventRowSelection {
  contextOnlyInterruptionSequences: ReadonlySet<number>;
  orderingBoundarySequence: number | null;
  ownedSequenceStart: number;
  ownedSequenceEnd: number;
  knownHasOlderSegments: boolean | null;
  paginationPage: ThreadTimelinePageRequest;
  responsePageKind: ThreadTimelinePageKind;
  rows: StoredEventRow[];
  strategy: ThreadTimelineEventSelectionStrategy;
}

export interface StandardTimelineEventRowSelection {
  anchors: readonly StandardTimelineSegmentAnchorRow[];
  budgetFloorDefined: boolean;
  count: number;
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
  anchors: readonly StandardTimelineSegmentAnchorRow[];
  appendableTurnIds: ReadonlySet<string>;
  budgetFloorDefined: boolean;
  count: number;
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
export const TIMELINE_SELECTION_MEMO_MAX_DATA_CHARS = 16_000_000;
const TIMELINE_SELECTION_MEMO_MAX_APPENDED_ROWS = 512;

const APPENDABLE_EVENT_TYPES: ReadonlySet<ThreadEventType> = new Set([
  "item/agentMessage/delta",
  "item/reasoning/textDelta",
  "item/reasoning/summaryTextDelta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/plan/delta",
  "item/toolCall/progress",
  "item/mcpToolCall/progress",
]);

const IGNORABLE_EVENT_TYPES: ReadonlySet<ThreadEventType> = new Set(
  THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
);

const selectionMemos = new WeakMap<DbConnection, TimelineSelectionMemo>();

export function clearTimelineSelectionMemo(db: DbConnection): void {
  selectionMemos.delete(db);
}

export function readTimelineSelectionMemoSize(db: DbConnection): {
  dataChars: number;
  entryCount: number;
} {
  const memo = selectionMemos.get(db);
  return {
    dataChars: memo?.dataChars ?? 0,
    entryCount: memo?.entries.size ?? 0,
  };
}

export function countAffordableAnchors(
  anchors: readonly { sequence: number }[],
  budgetFloorSequence: number | undefined,
  segmentLimit: number,
): number {
  const maxSegments = Math.min(segmentLimit, anchors.length);
  if (budgetFloorSequence === undefined) {
    return maxSegments;
  }
  const affordable = anchors.filter(
    (anchor) => anchor.sequence >= budgetFloorSequence,
  ).length;
  return Math.min(maxSegments, affordable);
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

function isAppendableRow(
  row: StoredEventRow,
  appendableTurnIds: ReadonlySet<string>,
): boolean {
  return (
    APPENDABLE_EVENT_TYPES.has(row.type) &&
    row.scopeKind === "turn" &&
    row.turnId !== null &&
    appendableTurnIds.has(row.turnId) &&
    row.parentToolCallId === null &&
    row.itemKind === null
  );
}

function isIgnorableRow(row: StoredEventRow): boolean {
  return IGNORABLE_EVENT_TYPES.has(row.type) && row.parentToolCallId === null;
}

function listAppendableRows(
  db: DbConnection,
  args: LatestTimelineSelectionMemoArgs,
  entry: TimelineSelectionMemoEntry,
): StoredEventRow[] | null {
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
  if (appendedRows.length > TIMELINE_SELECTION_MEMO_MAX_APPENDED_ROWS) {
    return null;
  }
  const appendableRows: StoredEventRow[] = [];
  for (const row of appendedRows) {
    if (isAppendableRow(row, entry.appendableTurnIds)) {
      appendableRows.push(row);
    } else if (!isIgnorableRow(row)) {
      return null;
    }
  }
  return appendableRows;
}

function budgetFloorKeepsWindow(
  args: LatestTimelineSelectionMemoArgs,
  entry: TimelineSelectionMemoEntry,
  budgetFloor: TimelineBudgetFloor,
): boolean {
  return (
    (budgetFloor.sequence !== undefined) === entry.budgetFloorDefined &&
    Math.max(
      1,
      countAffordableAnchors(
        entry.anchors,
        budgetFloor.sequence,
        args.page.segmentLimit,
      ),
    ) === entry.count
  );
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
  const appendableRows = listAppendableRows(db, args, entry);
  if (appendableRows === null) {
    return miss;
  }
  const budgetFloor: TimelineBudgetFloor = {
    sequence: findTimelineWindowBudgetFloorSequence(db, {
      threadId: args.threadId,
      sequenceStart: args.epochSequenceStart,
      beforeSequence: args.maxSeq + 1,
      eventBudget: args.eventBudget,
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
      excludeDiagnosticEvents: args.excludeDiagnosticEvents,
    }),
  };
  if (!budgetFloorKeepsWindow(args, entry, budgetFloor)) {
    return { ...miss, budgetFloor };
  }
  const selection: TimelineEventRowSelection = {
    ...entry.selection,
    ownedSequenceEnd: args.maxSeq + 1,
    paginationPage: args.page,
    rows: entry.selection.rows.concat(appendableRows),
  };
  storeMemoEntry(memo, key, {
    ...entry,
    dataChars: entry.dataChars + dataCharsOfRows(appendableRows),
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
    anchors: result.anchors,
    appendableTurnIds: result.fetchedTurnIds,
    budgetFloorDefined: result.budgetFloorDefined,
    count: result.count,
    dataChars: dataCharsOfRows(result.selection.rows),
    dataVersion: lookup.dataVersion,
    epochSequenceStart: args.epochSequenceStart,
    generation: lookup.generation,
    maxSeq: args.maxSeq,
    selection: result.selection,
    threadId: args.threadId,
  });
}
