import { THREAD_TIMELINE_EXCLUDED_EVENT_TYPES } from "@bb/thread-view";
import type { ThreadEventItemType, ThreadEventType } from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";
import {
  advanceTimelineWindowBudgetFloorSequence,
  findTimelineWindowBudgetFloorSequence,
  findUnprunableThreadEventSequence,
  getDatabaseDataVersion,
  getLatestThreadSequence,
  getThreadEventRewriteGeneration,
  listLatestBackgroundTaskStateRowsByItemIds,
  listStoredDelegatingItemRowsByItemIds,
  listStoredEventRowsByParentToolCallIds,
  listAppendedEventRows,
  listStoredTimelineTurnEventRows,
  listStoredTimelineWindowEventRows,
  listStoredTurnRejectedRowsByClientRequestIds,
  listStoredTurnStartedRowsByTurnIdsUpToSequence,
  selectAppendedTimelineWindowRows,
  type DbConnection,
  type TimelineWindowHint,
  type StoredEventRow,
} from "@bb/db";
import {
  getTimelineGroupingContext,
  type TimelineGroupingContext,
} from "./timeline-context-order.js";
import { measuredTimelineRowJsonBytes } from "./timeline-content-pagination.js";
import type { ThreadTimelinePageRequest } from "./timeline-pagination.js";
import type { DecodedTimelineRows } from "./timeline-selection-decode.js";
import { reuseUnchangedTimelineRows } from "./timeline-window-reuse.js";

export type ThreadTimelineEventSelectionStrategy = "full" | "standard-window";

export interface TimelineEventRowSelection {
  contextOnlyInterruptionSequences: ReadonlySet<number>;
  orderingBoundarySequence: number | null;
  ownedSequenceStart: number;
  ownedSequenceEnd: number;
  hasOlderSegments: boolean;
  paginationPage: ThreadTimelinePageRequest;
  rows: StoredEventRow[];
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
  active: boolean;
  epochSequenceStart: number;
  eventBudget: number;
  excludeDiagnosticEvents: boolean;
  maxInlineOutputChars: number;
  maxSeq: number;
  page: ThreadTimelinePageRequest;
  threadId: string;
}

export interface TimelineSelectionRowSource {
  listChildRows(
    args: Parameters<typeof listStoredEventRowsByParentToolCallIds>[1],
  ): StoredEventRow[];
  listContextRows(args: {
    afterSequence: number;
    beforeSequence: number;
    threadId: string;
    types: readonly ThreadEventType[];
  }): StoredEventRow[];
  listParentRows(
    args: Parameters<typeof listStoredDelegatingItemRowsByItemIds>[1],
  ): StoredEventRow[];
  listRootWindowTurnIds(
    args: Parameters<typeof listStoredTimelineWindowEventRows>[1],
  ): string[];
  listThreadWindowRows(
    args: Parameters<typeof listStoredTimelineWindowEventRows>[1],
  ): StoredEventRow[];
  listTurnRows(
    args: Parameters<typeof listStoredTimelineTurnEventRows>[1],
  ): StoredEventRow[];
}

export class TimelineSelectionTrimFallback extends Error {}

export interface LatestTimelineSelectionLookup {
  budgetFloor: TimelineBudgetFloor | null;
  dataVersion: number;
  decodedPrefix: DecodedTimelineRows | null;
  generation: number;
  selection: TimelineEventRowSelection | null;
  trimSource: TimelineSelectionRowSource | null;
}

interface KeptPageableRows {
  bytes: number;
  rows: readonly TimelineRow[];
}

interface TimelineSelectionMemoEntry {
  active: boolean;
  budgetFloorSequence: number | undefined;
  hints: readonly TimelineWindowHint[];
  appendableTurnIds: ReadonlySet<string>;
  delegatingItemIds: ReadonlySet<string>;
  missingParentToolCallIds: ReadonlySet<string>;
  dataChars: number;
  dataVersion: number;
  decoded: DecodedTimelineRows | null;
  epochSequenceStart: number;
  familyKey: string;
  generation: number;
  keptPageableRowBytes: number;
  keptPageableRows: Map<string, KeptPageableRows>;
  maxSeq: number;
  selection: TimelineEventRowSelection;
  threadId: string;
}

interface TimelineSelectionMemo {
  entries: Map<string, TimelineSelectionMemoEntry>;
  retainedSize: number;
  rowReferences: Map<readonly StoredEventRow[], number>;
}

export const TIMELINE_SELECTION_MEMO_MAX_ENTRIES = 16;
export const TIMELINE_SELECTION_MEMO_MAX_IDLE_ENTRIES = 4;
export const TIMELINE_SELECTION_MEMO_MAX_DATA_CHARS = 16_000_000;
const TIMELINE_SELECTION_MEMO_MAX_APPENDED_ROWS = 512;

const SELECTION_CHANGING_EVENT_TYPES: ReadonlySet<ThreadEventType> = new Set([
  "client/turn/rejected",
  "turn/plan/updated",
  "system/thread/interrupted",
  "thread/goal/updated",
  "thread/goal/cleared",
  "thread/extensionState/updated",
  "item/backgroundTask/progress",
]);

const SELECTION_CHANGING_ITEM_KINDS: ReadonlySet<ThreadEventItemType> = new Set(
  ["delegation", "planSteps"],
);

const GROUPING_CONTEXT_EVENT_TYPES: ReadonlySet<ThreadEventType> = new Set([
  "client/turn/requested",
  "turn/input/accepted",
  "turn/started",
  "turn/completed",
]);

const TURN_CONTEXT_EVENT_TYPES: ReadonlySet<ThreadEventType> = new Set([
  "turn/input/accepted",
  "turn/started",
  "turn/completed",
]);

const selectionMemos = new WeakMap<DbConnection, TimelineSelectionMemo>();

export function clearTimelineSelectionMemo(db: DbConnection): void {
  selectionMemos.delete(db);
}

export function countTimelineSelectionMemoEntries(db: DbConnection): number {
  return selectionMemos.get(db)?.entries.size ?? 0;
}

export function readKeptLatestTimelinePageableRows(db: DbConnection): {
  bytes: number;
  rows: readonly TimelineRow[];
  threadId: string;
}[] {
  const entries = [...(selectionMemos.get(db)?.entries.values() ?? [])];
  return entries.flatMap(({ keptPageableRows, threadId }) =>
    [...keptPageableRows.values()].map(({ bytes, rows }) => ({
      bytes,
      rows,
      threadId,
    })),
  );
}

export function readDecodedLatestTimelineSelections(db: DbConnection): {
  dataChars: number;
  decoded: DecodedTimelineRows;
  threadId: string;
}[] {
  const entries = [...(selectionMemos.get(db)?.entries.values() ?? [])];
  return entries.flatMap(({ dataChars, decoded, threadId }) =>
    decoded === null ? [] : [{ dataChars, decoded, threadId }],
  );
}

export interface TimelineWindowStartArgs {
  beforeSequence: number;
  budgetFloorSequence: number | undefined;
  epochSequenceStart: number;
  hints: readonly TimelineWindowHint[];
  segmentLimit: number;
  threadId: string;
}

export function selectTimelineWindowStart(
  db: DbConnection,
  args: TimelineWindowStartArgs,
): number {
  const { budgetFloorSequence, hints, segmentLimit } = args;
  if (budgetFloorSequence === undefined && hints.length <= segmentLimit) {
    return args.epochSequenceStart;
  }
  const affordable = hints.filter(
    (hint) =>
      budgetFloorSequence === undefined || hint.sequence >= budgetFloorSequence,
  );
  const hintStart =
    affordable[Math.min(segmentLimit, affordable.length) - 1]?.sequence ??
    hints[0]?.sequence;
  if (hintStart !== undefined) return hintStart;
  if (budgetFloorSequence === undefined) return args.epochSequenceStart;
  return (
    findUnprunableThreadEventSequence(db, {
      beforeSequence: args.beforeSequence,
      sequenceStart: budgetFloorSequence,
      threadId: args.threadId,
    }) ?? budgetFloorSequence
  );
}

function getSelectionMemo(db: DbConnection): TimelineSelectionMemo {
  let memo = selectionMemos.get(db);
  if (memo === undefined) {
    memo = { entries: new Map(), retainedSize: 0, rowReferences: new Map() };
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

function retainedSizeOf(entry: TimelineSelectionMemoEntry): number {
  return entry.dataChars + entry.keptPageableRowBytes;
}

function deleteMemoEntry(memo: TimelineSelectionMemo, key: string): void {
  const entry = memo.entries.get(key);
  if (entry === undefined) return;
  memo.entries.delete(key);
  memo.retainedSize -= entry.keptPageableRowBytes;
  const rows = entry.selection.rows;
  const references = (memo.rowReferences.get(rows) ?? 1) - 1;
  if (references > 0) {
    memo.rowReferences.set(rows, references);
    return;
  }
  memo.rowReferences.delete(rows);
  memo.retainedSize -= entry.dataChars;
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

function deleteOldestIdleEntries(memo: TimelineSelectionMemo): void {
  let idleEntries = 0;
  for (const entry of memo.entries.values()) {
    if (!entry.active) idleEntries += 1;
  }
  for (const [key, entry] of memo.entries) {
    if (idleEntries <= TIMELINE_SELECTION_MEMO_MAX_IDLE_ENTRIES) return;
    if (entry.active) continue;
    deleteMemoEntry(memo, key);
    idleEntries -= 1;
  }
}

function storeMemoEntry(
  memo: TimelineSelectionMemo,
  key: string,
  entry: TimelineSelectionMemoEntry,
): void {
  deleteMemoEntry(memo, key);
  if (entry.dataChars > TIMELINE_SELECTION_MEMO_MAX_DATA_CHARS) return;
  const stored =
    retainedSizeOf(entry) > TIMELINE_SELECTION_MEMO_MAX_DATA_CHARS
      ? { ...entry, keptPageableRowBytes: 0, keptPageableRows: new Map() }
      : entry;
  memo.entries.set(key, stored);
  memo.retainedSize += stored.keptPageableRowBytes;
  const rows = stored.selection.rows;
  const references = memo.rowReferences.get(rows) ?? 0;
  memo.rowReferences.set(rows, references + 1);
  if (references === 0) memo.retainedSize += stored.dataChars;
  if (!stored.active) deleteOldestIdleEntries(memo);
  deleteOldestEntriesOverBudget(memo);
}

function deleteOldestEntriesOverBudget(memo: TimelineSelectionMemo): void {
  while (
    memo.entries.size > TIMELINE_SELECTION_MEMO_MAX_ENTRIES ||
    memo.retainedSize > TIMELINE_SELECTION_MEMO_MAX_DATA_CHARS
  ) {
    const oldest = memo.entries.keys().next().value;
    if (oldest === undefined) break;
    deleteMemoEntry(memo, oldest);
  }
}

function selectionMemoFamilyKey(args: LatestTimelineSelectionMemoArgs): string {
  return JSON.stringify([
    args.threadId,
    args.eventBudget,
    args.maxInlineOutputChars,
    args.excludeDiagnosticEvents,
    args.epochSequenceStart,
  ]);
}

function selectionMemoKey(args: LatestTimelineSelectionMemoArgs): string {
  return JSON.stringify([selectionMemoFamilyKey(args), args.page.segmentLimit]);
}

function findCurrentSibling(
  memo: TimelineSelectionMemo,
  args: LatestTimelineSelectionMemoArgs,
  lookup: LatestTimelineSelectionLookup,
  matches: (entry: TimelineSelectionMemoEntry) => boolean,
): TimelineSelectionMemoEntry | undefined {
  const key = selectionMemoKey(args);
  const familyKey = selectionMemoFamilyKey(args);
  for (const [entryKey, entry] of memo.entries) {
    if (
      entryKey !== key &&
      entry.familyKey === familyKey &&
      entry.maxSeq === args.maxSeq &&
      entry.generation === lookup.generation &&
      entry.dataVersion === lookup.dataVersion &&
      matches(entry)
    ) {
      return entry;
    }
  }
  return undefined;
}

function adoptSiblingSelection(
  memo: TimelineSelectionMemo,
  args: LatestTimelineSelectionMemoArgs,
  lookup: LatestTimelineSelectionLookup,
  sibling: TimelineSelectionMemoEntry,
  budgetFloor: TimelineBudgetFloor,
  hints: readonly TimelineWindowHint[],
): LatestTimelineSelectionLookup {
  const selection: TimelineEventRowSelection = {
    ...sibling.selection,
    paginationPage: args.page,
  };
  storeMemoEntry(memo, selectionMemoKey(args), {
    ...sibling,
    active: args.active,
    budgetFloorSequence: budgetFloor.sequence,
    hints,
    keptPageableRowBytes: 0,
    keptPageableRows: new Map(),
    selection,
  });
  return { ...lookup, budgetFloor, selection };
}

function lookupFromWiderSibling(
  db: DbConnection,
  memo: TimelineSelectionMemo,
  args: LatestTimelineSelectionMemoArgs,
  miss: LatestTimelineSelectionLookup,
  ownEntryIsCurrent: boolean,
): LatestTimelineSelectionLookup | null {
  const wider = findCurrentSibling(
    memo,
    args,
    miss,
    (entry) =>
      entry.selection.paginationPage.segmentLimit >= args.page.segmentLimit,
  );
  if (
    wider === undefined ||
    getLatestThreadSequence(db, { threadId: args.threadId }) !== args.maxSeq
  ) {
    return null;
  }
  const budgetFloor: TimelineBudgetFloor = {
    sequence: wider.budgetFloorSequence,
  };
  const hints = wider.hints.slice(0, args.page.segmentLimit + 1);
  const sequenceStart = selectTimelineWindowStart(db, {
    beforeSequence: args.maxSeq + 1,
    budgetFloorSequence: budgetFloor.sequence,
    epochSequenceStart: args.epochSequenceStart,
    hints,
    segmentLimit: args.page.segmentLimit,
    threadId: args.threadId,
  });
  if (sequenceStart === wider.selection.ownedSequenceStart) {
    return adoptSiblingSelection(memo, args, miss, wider, budgetFloor, hints);
  }
  if (ownEntryIsCurrent || sequenceStart < wider.selection.ownedSequenceStart) {
    return null;
  }
  return {
    ...miss,
    budgetFloor,
    trimSource: createTrimmedSelectionRowSource(
      db,
      args,
      {
        appendableTurnIds: new Set(wider.appendableTurnIds),
        delegatingItemIds: new Set(wider.delegatingItemIds),
        groupingContext: null,
        missingParentToolCallIds: new Set(wider.missingParentToolCallIds),
      },
      wider.selection.rows,
    ),
  };
}

function isDelegatingRow(row: StoredEventRow): boolean {
  return (
    (row.itemKind === "toolCall" || row.itemKind === "delegation") &&
    row.itemId !== null
  );
}

function collectDelegatingItemIds(
  rows: readonly StoredEventRow[],
): Set<string> {
  const itemIds = new Set<string>();
  for (const row of rows) {
    if (isDelegatingRow(row)) itemIds.add(row.itemId!);
  }
  return itemIds;
}

function changesSelection(row: StoredEventRow): boolean {
  return (
    SELECTION_CHANGING_EVENT_TYPES.has(row.type) ||
    (row.itemKind !== null && SELECTION_CHANGING_ITEM_KINDS.has(row.itemKind))
  );
}

function parentToolCallIdOf(row: StoredEventRow): string | null {
  return row.parentToolCallId !== null && row.parentToolCallId.length > 0
    ? row.parentToolCallId
    : null;
}

function selectionIndexOfSequence(
  rows: readonly StoredEventRow[],
  sequence: number,
): number {
  let low = 0;
  let high = rows.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const middleSequence = rows[middle]!.sequence;
    if (middleSequence === sequence) return middle;
    if (middleSequence < sequence) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

function selectionHasRow(
  rows: readonly StoredEventRow[],
  row: StoredEventRow,
): boolean {
  const index = selectionIndexOfSequence(rows, row.sequence);
  return index >= 0 && rows[index]!.id === row.id;
}

interface SelectionExtension {
  appendableTurnIds: Set<string>;
  delegatingItemIds: Set<string>;
  groupingContext: TimelineGroupingContext | null;
  missingParentToolCallIds: Set<string>;
}

interface SelectionExtensionScope {
  args: LatestTimelineSelectionMemoArgs;
  db: DbConnection;
  entry: TimelineSelectionMemoEntry;
  extension: SelectionExtension;
}

function windowQueryArgs(
  args: LatestTimelineSelectionMemoArgs,
  sequenceStart: number,
  beforeSequence: number,
) {
  return {
    beforeSequence,
    excludeDiagnosticEvents: args.excludeDiagnosticEvents,
    excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    maxInlineOutputChars: args.maxInlineOutputChars,
    sequenceStart,
    threadId: args.threadId,
  };
}

function groupingContextOf(
  scope: SelectionExtensionScope,
): TimelineGroupingContext {
  scope.extension.groupingContext ??= getTimelineGroupingContext(scope.db, {
    maxSeq: scope.args.maxSeq,
    sequenceStart: scope.args.epochSequenceStart,
    threadId: scope.args.threadId,
  });
  return scope.extension.groupingContext;
}

function acceptsParent(
  scope: SelectionExtensionScope,
  row: StoredEventRow,
): boolean {
  const parent = parentToolCallIdOf(row);
  const { extension } = scope;
  if (
    parent === null ||
    extension.delegatingItemIds.has(parent) ||
    extension.missingParentToolCallIds.has(parent)
  ) {
    return true;
  }
  const parentRows = listStoredDelegatingItemRowsByItemIds(scope.db, {
    itemIds: [parent],
    maxInlineOutputChars: scope.args.maxInlineOutputChars,
    threadId: scope.args.threadId,
  });
  if (parentRows.some((parentRow) => parentRow.sequence <= scope.args.maxSeq)) {
    return false;
  }
  extension.missingParentToolCallIds.add(parent);
  return true;
}

function acceptsDelegatingItem(
  scope: SelectionExtensionScope,
  row: StoredEventRow,
): boolean {
  if (!isDelegatingRow(row)) return true;
  const itemId = row.itemId!;
  const { extension } = scope;
  if (extension.delegatingItemIds.has(itemId)) return true;
  if (extension.missingParentToolCallIds.has(itemId)) return false;
  const childRows = listStoredEventRowsByParentToolCallIds(scope.db, {
    ...windowQueryArgs(
      scope.args,
      scope.args.epochSequenceStart,
      scope.entry.maxSeq + 1,
    ),
    parentToolCallIds: [itemId],
  });
  if (childRows.length > 0) return false;
  extension.delegatingItemIds.add(itemId);
  return true;
}

function isAcceptedInputForWindowRequest(
  scope: SelectionExtensionScope,
  row: StoredEventRow,
): boolean {
  if (row.type !== "turn/input/accepted") return false;
  const context = groupingContextOf(scope);
  const requestId = context.clientRequestIdsBySequence.get(row.sequence);
  const request =
    requestId === undefined ? undefined : context.clientRequests.get(requestId);
  return (
    request?.requestedSequences.some(
      (sequence) =>
        sequence >= scope.entry.selection.ownedSequenceStart &&
        sequence <= scope.args.maxSeq,
    ) ?? false
  );
}

function acceptsTurn(
  scope: SelectionExtensionScope,
  row: StoredEventRow,
): boolean {
  if (row.scopeKind !== "turn") return true;
  const turnId = row.turnId;
  if (turnId === null) return false;
  const { args, entry, extension } = scope;
  if (extension.appendableTurnIds.has(turnId)) return true;
  const startedRows = listStoredTurnStartedRowsByTurnIdsUpToSequence(scope.db, {
    sequenceCutoff: Number.MAX_SAFE_INTEGER,
    threadId: args.threadId,
    turnIds: [turnId],
  });
  if (
    !startedRows.every(
      (started) =>
        started.sequence > entry.maxSeq ||
        selectionHasRow(entry.selection.rows, started),
    )
  ) {
    return false;
  }
  const parent = parentToolCallIdOf(row);
  const fetched =
    (parent !== null && extension.delegatingItemIds.has(parent)) ||
    (row.parentToolCallId === null &&
      startedRows.some((started) => started.parentToolCallId === null)) ||
    isAcceptedInputForWindowRequest(scope, row);
  if (!fetched) return TURN_CONTEXT_EVENT_TYPES.has(row.type);
  const turnRows = listStoredTimelineTurnEventRows(scope.db, {
    ...windowQueryArgs(args, args.epochSequenceStart, entry.maxSeq + 1),
    turnIds: [turnId],
  });
  if (turnRows.length > 0) return false;
  extension.appendableTurnIds.add(turnId);
  return true;
}

function acceptsAcceptedInput(
  scope: SelectionExtensionScope,
  row: StoredEventRow,
): boolean {
  if (row.type !== "turn/input/accepted") return true;
  const context = groupingContextOf(scope);
  const requestId = context.clientRequestIdsBySequence.get(row.sequence);
  const request =
    requestId === undefined ? undefined : context.clientRequests.get(requestId);
  const { rows } = scope.entry.selection;
  return (
    request !== undefined &&
    request.acceptedSequences.length === 1 &&
    request.requestedSequences.every(
      (sequence) =>
        sequence > scope.entry.maxSeq ||
        selectionIndexOfSequence(rows, sequence) >= 0,
    )
  );
}

function acceptsClientRequest(
  scope: SelectionExtensionScope,
  row: StoredEventRow,
): boolean {
  if (row.type !== "client/turn/requested") return true;
  const context = groupingContextOf(scope);
  const requestId = context.clientRequestIdsBySequence.get(row.sequence);
  if (requestId === undefined) return false;
  const request = context.clientRequests.get(requestId)!;
  return (
    request.requestedSequences.length === 1 &&
    request.acceptedSequences.every(
      (sequence) => sequence > scope.entry.maxSeq,
    ) &&
    listStoredTurnRejectedRowsByClientRequestIds(scope.db, {
      afterSequence: -1,
      clientRequestIds: [requestId],
      threadId: scope.args.threadId,
    }).every((rejected) => rejected.sequence > scope.entry.maxSeq)
  );
}

function isKeptByWindowTurnOrParent(
  scope: SelectionExtensionScope,
  row: StoredEventRow,
): boolean {
  const parent = parentToolCallIdOf(row);
  if (parent !== null && scope.extension.delegatingItemIds.has(parent)) {
    return true;
  }
  return row.turnId === null
    ? row.sequence >= scope.entry.selection.ownedSequenceStart
    : scope.extension.appendableTurnIds.has(row.turnId);
}

function acceptsBackgroundTask(
  scope: SelectionExtensionScope,
  row: StoredEventRow,
): boolean {
  if (row.itemKind !== "backgroundTask") return true;
  const itemId = row.itemId;
  if (itemId === null) return false;
  const { rows } = scope.entry.selection;
  if (row.type === "item/started") {
    return listLatestBackgroundTaskStateRowsByItemIds(scope.db, {
      beforeSequence: scope.entry.maxSeq + 1,
      itemIds: [itemId],
      threadId: scope.args.threadId,
    }).every((stateRow) => selectionHasRow(rows, stateRow));
  }
  if (row.type !== "item/backgroundTask/completed") return false;
  return rows.every(
    (selected) =>
      selected.itemKind !== "backgroundTask" ||
      selected.itemId !== itemId ||
      (selected.type !== "item/backgroundTask/progress" &&
        isKeptByWindowTurnOrParent(scope, selected)),
  );
}

function acceptsAppendedRow(
  scope: SelectionExtensionScope,
  row: StoredEventRow,
): boolean {
  return (
    acceptsParent(scope, row) &&
    acceptsDelegatingItem(scope, row) &&
    acceptsTurn(scope, row) &&
    acceptsAcceptedInput(scope, row) &&
    acceptsClientRequest(scope, row) &&
    acceptsBackgroundTask(scope, row)
  );
}

interface AppendedSelectionRows {
  extension: SelectionExtension;
  groupingContextChanged: boolean;
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
  const appendedRows = listAppendedEventRows(db, {
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
  const scope: SelectionExtensionScope = {
    args,
    db,
    entry,
    extension: {
      appendableTurnIds: new Set(entry.appendableTurnIds),
      delegatingItemIds: new Set(entry.delegatingItemIds),
      groupingContext: null,
      missingParentToolCallIds: new Set(entry.missingParentToolCallIds),
    },
  };
  const rows =
    selectAppendedTimelineWindowRows(appendedRows, {
      excludeDiagnosticEvents: args.excludeDiagnosticEvents,
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    }) ??
    listStoredTimelineWindowEventRows(
      db,
      windowQueryArgs(args, entry.maxSeq + 1, args.maxSeq + 1),
    );
  if (!rows.every((row) => acceptsAppendedRow(scope, row))) {
    return null;
  }
  return {
    extension: scope.extension,
    groupingContextChanged: appendedRows.some(
      (row) =>
        parentToolCallIdOf(row) !== null ||
        GROUPING_CONTEXT_EVENT_TYPES.has(row.type),
    ),
    rows,
  };
}

function trimFallback(reason: string): never {
  throw new TimelineSelectionTrimFallback(reason);
}

function createTrimmedSelectionRowSource(
  db: DbConnection,
  args: LatestTimelineSelectionMemoArgs,
  extension: SelectionExtension,
  rows: readonly StoredEventRow[],
): TimelineSelectionRowSource {
  let rowsById: Map<string, StoredEventRow> | null = null;
  const expectLatestBounds = (bounds: {
    beforeSequence?: number;
    sequenceStart?: number;
  }) => {
    if (bounds.beforeSequence !== args.maxSeq + 1) {
      trimFallback("before-sequence");
    }
    return bounds.sequenceStart ?? 0;
  };
  const expectEpochBounds = (bounds: {
    beforeSequence?: number;
    sequenceStart?: number;
  }) => {
    if (expectLatestBounds(bounds) !== args.epochSequenceStart) {
      trimFallback("sequence-start");
    }
  };
  return {
    listChildRows(query) {
      expectEpochBounds(query);
      const parents = new Set(query.parentToolCallIds);
      for (const parent of parents) {
        if (!extension.delegatingItemIds.has(parent)) {
          trimFallback("unfetched-children");
        }
      }
      const excludedTurnIds = new Set(query.excludedTurnIds);
      return rows.filter(
        (row) =>
          row.parentToolCallId !== null &&
          parents.has(row.parentToolCallId) &&
          row.sequence >= args.epochSequenceStart &&
          (row.turnId === null || !excludedTurnIds.has(row.turnId)),
      );
    },
    listContextRows(query) {
      const types = new Set(query.types);
      return rows.filter(
        (row) =>
          types.has(row.type) &&
          row.sequence > query.afterSequence &&
          row.sequence < query.beforeSequence,
      );
    },
    listParentRows(query) {
      rowsById ??= new Map(rows.map((row) => [row.id, row]));
      return listStoredDelegatingItemRowsByItemIds(db, query).map((row) => {
        if (row.sequence > args.maxSeq) return row;
        return rowsById!.get(row.id) ?? trimFallback("unselected-parent");
      });
    },
    listRootWindowTurnIds(query) {
      const sequenceStart = expectLatestBounds(query);
      const rootStartedTurnIds = new Set<string>();
      for (const row of rows) {
        if (
          row.type === "turn/started" &&
          row.turnId !== null &&
          row.parentToolCallId === null
        ) {
          rootStartedTurnIds.add(row.turnId);
        }
      }
      const turnIds = new Set<string>();
      for (const row of rows) {
        if (
          row.turnId !== null &&
          row.parentToolCallId === null &&
          row.sequence >= sequenceStart &&
          rootStartedTurnIds.has(row.turnId)
        ) {
          turnIds.add(row.turnId);
        }
      }
      return [...turnIds];
    },
    listThreadWindowRows(query) {
      const sequenceStart = expectLatestBounds(query);
      return rows.filter(
        (row) => row.turnId === null && row.sequence >= sequenceStart,
      );
    },
    listTurnRows(query) {
      expectEpochBounds(query);
      const turnIds = new Set(query.turnIds);
      for (const turnId of turnIds) {
        if (!extension.appendableTurnIds.has(turnId)) {
          trimFallback("unfetched-turn");
        }
      }
      return rows.filter(
        (row) =>
          row.turnId !== null &&
          turnIds.has(row.turnId) &&
          row.sequence >= args.epochSequenceStart,
      );
    },
  };
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
    decodedPrefix: null,
    generation,
    selection: null,
    trimSource: null,
  };
  const memo = selectionMemos.get(db);
  if (memo === undefined) return miss;
  const key = selectionMemoKey(args);
  const entry = memo.entries.get(key);
  const entryIsCurrent =
    entry !== undefined &&
    entry.generation === generation &&
    entry.dataVersion === dataVersion;
  const fromSibling = lookupFromWiderSibling(
    db,
    memo,
    args,
    miss,
    entryIsCurrent,
  );
  if (fromSibling !== null) return fromSibling;
  if (entry === undefined || !entryIsCurrent) {
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
  const appendedHints = appended.rows
    .filter((row) => row.type === "client/turn/requested")
    .map((row) => ({ sequence: row.sequence }))
    .reverse();
  const hints =
    appendedHints.length === 0
      ? entry.hints
      : [...appendedHints, ...entry.hints].slice(0, args.page.segmentLimit + 1);
  const sequenceStart = selectTimelineWindowStart(db, {
    beforeSequence: args.maxSeq + 1,
    budgetFloorSequence: budgetFloor.sequence,
    epochSequenceStart: args.epochSequenceStart,
    hints,
    segmentLimit: args.page.segmentLimit,
    threadId: args.threadId,
  });
  if (sequenceStart < entry.selection.ownedSequenceStart) {
    return { ...miss, budgetFloor };
  }
  if (sequenceStart > entry.selection.ownedSequenceStart) {
    return {
      ...miss,
      budgetFloor,
      trimSource: createTrimmedSelectionRowSource(
        db,
        args,
        appended.extension,
        entry.selection.rows.concat(appended.rows),
      ),
    };
  }
  const sameWindow = findCurrentSibling(
    memo,
    args,
    miss,
    (sibling) => sibling.selection.ownedSequenceStart === sequenceStart,
  );
  if (sameWindow !== undefined) {
    return adoptSiblingSelection(
      memo,
      args,
      miss,
      sameWindow,
      budgetFloor,
      hints,
    );
  }
  const selection: TimelineEventRowSelection = {
    ...entry.selection,
    orderingBoundarySequence: appended.groupingContextChanged
      ? (
          appended.extension.groupingContext ??
          getTimelineGroupingContext(db, {
            maxSeq: args.maxSeq,
            sequenceStart: args.epochSequenceStart,
            threadId: args.threadId,
          })
        ).orderingBoundarySequence
      : entry.selection.orderingBoundarySequence,
    ownedSequenceEnd: args.maxSeq + 1,
    paginationPage: args.page,
    rows:
      appended.rows.length === 0
        ? entry.selection.rows
        : entry.selection.rows.concat(appended.rows),
  };
  storeMemoEntry(memo, key, {
    ...entry,
    active: args.active,
    appendableTurnIds: appended.extension.appendableTurnIds,
    budgetFloorSequence: budgetFloor.sequence,
    delegatingItemIds: appended.extension.delegatingItemIds,
    missingParentToolCallIds: appended.extension.missingParentToolCallIds,
    dataChars: entry.dataChars + dataCharsOfRows(appended.rows),
    decoded: null,
    hints,
    maxSeq: args.maxSeq,
    selection,
  });
  return { ...miss, budgetFloor, decodedPrefix: entry.decoded, selection };
}

export function rememberDecodedLatestTimelineSelection(
  db: DbConnection,
  args: LatestTimelineSelectionMemoArgs,
  rows: readonly StoredEventRow[],
  decoded: DecodedTimelineRows,
): void {
  const entry = selectionMemos.get(db)?.entries.get(selectionMemoKey(args));
  if (entry?.selection.rows === rows) entry.decoded = decoded;
}

export function reuseKeptLatestTimelinePageableRows(
  db: DbConnection,
  args: LatestTimelineSelectionMemoArgs,
  variant: string,
  rows: TimelineRow[],
): TimelineRow[] {
  const previous = selectionMemos
    .get(db)
    ?.entries.get(selectionMemoKey(args))
    ?.keptPageableRows.get(variant);
  return previous === undefined
    ? rows
    : reuseUnchangedTimelineRows(rows, previous.rows);
}

export function keepLatestTimelinePageableRows(
  db: DbConnection,
  args: LatestTimelineSelectionMemoArgs,
  variant: string,
  rows: readonly TimelineRow[],
): void {
  const memo = selectionMemos.get(db);
  const entry = memo?.entries.get(selectionMemoKey(args));
  if (memo === undefined || entry === undefined) return;
  const measuredRows: TimelineRow[] = [];
  let bytes = 0;
  for (const row of rows) {
    const rowBytes = measuredTimelineRowJsonBytes(row);
    if (rowBytes === null) continue;
    measuredRows.push(row);
    bytes += rowBytes;
  }
  const previousBytes = entry.keptPageableRows.get(variant)?.bytes ?? 0;
  entry.keptPageableRowBytes -= previousBytes;
  memo.retainedSize -= previousBytes;
  if (
    measuredRows.length === 0 ||
    retainedSizeOf(entry) + bytes > TIMELINE_SELECTION_MEMO_MAX_DATA_CHARS
  ) {
    entry.keptPageableRows.delete(variant);
  } else {
    entry.keptPageableRows.set(variant, { bytes, rows: measuredRows });
    entry.keptPageableRowBytes += bytes;
    memo.retainedSize += bytes;
  }
  deleteOldestEntriesOverBudget(memo);
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
  const key = selectionMemoKey(args);
  const previous = memo.entries.get(key);
  const kept =
    previous !== undefined && previous.generation === lookup.generation
      ? previous
      : null;
  storeMemoEntry(memo, key, {
    active: args.active,
    budgetFloorSequence: result.budgetFloorSequence,
    hints: result.hints,
    appendableTurnIds: result.fetchedTurnIds,
    delegatingItemIds: collectDelegatingItemIds(result.selection.rows),
    missingParentToolCallIds: new Set(),
    dataChars: dataCharsOfRows(result.selection.rows),
    dataVersion: lookup.dataVersion,
    decoded: null,
    epochSequenceStart: args.epochSequenceStart,
    familyKey: selectionMemoFamilyKey(args),
    generation: lookup.generation,
    keptPageableRowBytes: kept?.keptPageableRowBytes ?? 0,
    keptPageableRows: kept?.keptPageableRows ?? new Map(),
    maxSeq: args.maxSeq,
    selection: result.selection,
    threadId: args.threadId,
  });
}
