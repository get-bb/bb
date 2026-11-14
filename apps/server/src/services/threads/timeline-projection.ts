import {
  THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
  resumeEventProjectionFold,
  type buildThreadTimelineFromProjection,
  type EventProjection,
  type EventProjectionFold,
  type ThreadEventWithMeta,
} from "@bb/thread-view";
import type {
  ThreadHeadStateResponse,
  ThreadTimelineResponse,
  TimelineRow,
} from "@bb/server-contract";
import type { ThreadEventItemType, ThreadEventType } from "@bb/domain";
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
  type StoredEventRow,
  type TimelineWindowHint,
} from "@bb/db";
import { parseStoredEvent } from "./thread-data.js";
import {
  advanceTimelineOrderingContextLog,
  createTimelineOrderingContextLog,
  extendTimelineOrderingContextLog,
  readTimelineGroupingContext,
  type TimelineGroupingContext,
  type TimelineOrderingContextLog,
} from "./timeline-context-order.js";
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
  strategy: ThreadTimelineEventSelectionStrategy;
}

export interface StandardTimelineEventRowSelection {
  budgetFloorSequence: number | undefined;
  hints: readonly TimelineWindowHint[];
  fetchedTurnIds: ReadonlySet<string>;
  selection: TimelineEventRowSelection;
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

export interface TimelineProjectionScope {
  epochSequenceStart: number;
  eventBudget: number;
  excludeDiagnosticEvents: boolean;
  maxInlineOutputChars: number;
  threadId: string;
}

export interface TimelineProjectionSelect {
  (
    segmentLimit: number,
    groupingContext: TimelineGroupingContext,
    source: TimelineSelectionRowSource | undefined,
  ): StandardTimelineEventRowSelection;
}

class TimelineProjectionTrimFallback extends Error {}

interface TimelineProjectionContext {
  appendableTurnIds: Set<string>;
  delegatingItemIds: Set<string>;
  missingParentToolCallIds: Set<string>;
}

interface TimelineProjectionFoldState {
  fold: EventProjectionFold;
  key: string;
}

export interface ProjectedTimeline {
  compactedEventCount: number;
  rows: TimelineRow[];
  summary: Omit<ReturnType<typeof buildThreadTimelineFromProjection>, "rows">;
}

export interface ProjectedPageableRows {
  expiresAt: number | null;
  rows: TimelineRow[];
}

export interface ReleasedEvent {
  bytes: number;
  event: ThreadEventWithMeta;
}

export interface ProjectedGroupingContext {
  context: TimelineGroupingContext;
  maxSeq: number;
}

export interface ProjectedWindow {
  expiresAt: number | null;
  response: ThreadTimelineResponse;
}

export interface ThreadTimelineProjectionDerived {
  readonly eventProjections: Map<string, EventProjection>;
  readonly headStates: Map<string, ThreadHeadStateResponse>;
  readonly pageableRows: Map<string, ProjectedPageableRows>;
  readonly timelines: Map<string, ProjectedTimeline>;
  readonly windows: Map<string, ProjectedWindow>;
}

export interface ThreadTimelineProjection {
  budgetFloorSequence: number | undefined;
  readonly context: TimelineProjectionContext;
  coverageSegmentLimit: number;
  active: boolean;
  readonly id: number;
  readonly servedSegmentLimits: Set<number>;
  dataBytes: number;
  readonly dataVersion: number;
  derived: ThreadTimelineProjectionDerived;
  events: ThreadEventWithMeta[];
  readonly eventsById: Map<string, ThreadEventWithMeta>;
  readonly releasedEvents: Map<string, ReleasedEvent>;
  releasedBytes: number;
  fold: TimelineProjectionFoldState | null;
  foldedEventCount: number;
  readonly generation: number;
  groupingContext: ProjectedGroupingContext | null;
  readonly headStateEvents: Map<string, ThreadEventWithMeta>;
  hints: TimelineWindowHint[];
  maxSeq: number;
  readonly orderingLog: TimelineOrderingContextLog;
  previousDerived: ThreadTimelineProjectionDerived;
  readonly scope: TimelineProjectionScope;
  readonly scopeKey: string;
  selection: TimelineEventRowSelection;
}

export const MAX_TIMELINE_PROJECTIONS = 16;
export const MAX_IDLE_TIMELINE_PROJECTIONS = 4;
const MAX_RELEASED_EVENT_BYTES = 4_000_000;
export const MAX_TIMELINE_PROJECTION_DATA_BYTES = 16_000_000;
const MAX_APPENDED_ROWS_PER_CATCH_UP = 512;

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

const ORDERING_CONTEXT_EVENT_TYPES: ReadonlySet<ThreadEventType> = new Set([
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

const projectionsByDb = new WeakMap<
  DbConnection,
  Map<number, ThreadTimelineProjection>
>();

function registryOf(db: DbConnection): Map<number, ThreadTimelineProjection> {
  let registry = projectionsByDb.get(db);
  if (registry === undefined) {
    registry = new Map();
    projectionsByDb.set(db, registry);
  }
  return registry;
}

let nextProjectionId = 0;

function projectionsOfThread(
  db: DbConnection,
  threadId: string,
): ThreadTimelineProjection[] {
  return [...(projectionsByDb.get(db)?.values() ?? [])].filter(
    (projection) => projection.scope.threadId === threadId,
  );
}

export function clearTimelineProjections(db: DbConnection): void {
  projectionsByDb.delete(db);
}

export function forgetTimelineProjection(
  db: DbConnection,
  threadId: string,
): void {
  const registry = projectionsByDb.get(db);
  if (registry === undefined) return;
  for (const projection of projectionsOfThread(db, threadId)) {
    registry.delete(projection.id);
  }
}

export function peekTimelineProjection(
  db: DbConnection,
  threadId: string,
): ThreadTimelineProjection | undefined {
  return projectionsOfThread(db, threadId)
    .reverse()
    .find((projection) => isProjectionCurrent(db, projection));
}

export interface ServingProjectionArgs {
  eventBudget: number;
  excludeDiagnosticEvents: boolean;
  maxInlineOutputChars: number;
  maxSeq: number;
  segmentLimit: number;
  threadId: string;
}

export function findServingTimelineProjection(
  db: DbConnection,
  args: ServingProjectionArgs,
): ThreadTimelineProjection | undefined {
  return projectionsOfThread(db, args.threadId).find(
    (projection) =>
      projection.servedSegmentLimits.has(args.segmentLimit) &&
      projection.maxSeq === args.maxSeq &&
      projection.scope.eventBudget === args.eventBudget &&
      projection.scope.excludeDiagnosticEvents ===
        args.excludeDiagnosticEvents &&
      projection.scope.maxInlineOutputChars === args.maxInlineOutputChars &&
      isProjectionCurrent(db, projection),
  );
}

export function decodeRowWithProjection(
  db: DbConnection,
  threadId: string,
  maxInlineOutputChars: number,
): (row: StoredEventRow) => ThreadEventWithMeta {
  const projection = peekTimelineProjection(db, threadId);
  if (
    projection === undefined ||
    projection.scope.maxInlineOutputChars !== maxInlineOutputChars
  ) {
    return decodeStoredEventRow;
  }
  const byId = projectionEventsById(projection);
  return (row) =>
    byId.get(row.id) ??
    projection.releasedEvents.get(row.id)?.event ??
    decodeStoredEventRow(row);
}

function projectionEventsById(
  projection: ThreadTimelineProjection,
): ReadonlyMap<string, ThreadEventWithMeta> {
  if (projection.eventsById.size !== projection.events.length) {
    projection.eventsById.clear();
    for (const event of projection.events) {
      projection.eventsById.set(event.meta.id, event);
    }
  }
  return projection.eventsById;
}

export function decodeHeadStateRow(
  projection: ThreadTimelineProjection,
  row: StoredEventRow,
): ThreadEventWithMeta {
  const kept = projection.headStateEvents.get(row.id);
  if (kept !== undefined && kept.meta.seq === row.sequence) return kept;
  const decoded = decodeStoredEventRow(row);
  projection.headStateEvents.set(row.id, decoded);
  return decoded;
}

export function listTimelineProjections(
  db: DbConnection,
): readonly ThreadTimelineProjection[] {
  return [...(projectionsByDb.get(db)?.values() ?? [])];
}

function scopeKeyOf(scope: TimelineProjectionScope): string {
  return JSON.stringify([
    scope.epochSequenceStart,
    scope.eventBudget,
    scope.excludeDiagnosticEvents,
    scope.maxInlineOutputChars,
  ]);
}

function isProjectionCurrent(
  db: DbConnection,
  projection: ThreadTimelineProjection,
): boolean {
  return (
    projection.generation ===
      getThreadEventRewriteGeneration(projection.scope.threadId) &&
    projection.dataVersion === getDatabaseDataVersion(db)
  );
}

function dataBytesOfRows(rows: readonly StoredEventRow[]): number {
  let bytes = 0;
  for (const row of rows) bytes += Buffer.byteLength(row.data, "utf8");
  return bytes;
}

let freezeDecodedEvents = false;

export function setTimelineProjectionFreezeForTesting(enabled: boolean): void {
  freezeDecodedEvents = enabled;
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
}

export function decodeStoredEventRow(row: StoredEventRow): ThreadEventWithMeta {
  const event = parseStoredEvent(row);
  if (freezeDecodedEvents) deepFreeze(event);
  return {
    event,
    meta: { id: row.id, seq: row.sequence, createdAt: row.createdAt },
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

function windowQueryArgs(
  scope: TimelineProjectionScope,
  sequenceStart: number,
  beforeSequence: number,
) {
  return {
    beforeSequence,
    excludeDiagnosticEvents: scope.excludeDiagnosticEvents,
    excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    maxInlineOutputChars: scope.maxInlineOutputChars,
    sequenceStart,
    threadId: scope.threadId,
  };
}

interface CatchUp {
  context: TimelineProjectionContext;
  db: DbConnection;
  groupingContext: TimelineGroupingContext | null;
  maxSeq: number;
  projection: ThreadTimelineProjection;
}

function groupingContextOf(catchUp: CatchUp): TimelineGroupingContext {
  catchUp.groupingContext ??= readTimelineGroupingContext(
    catchUp.db,
    catchUp.projection.orderingLog,
    catchUp.maxSeq,
  );
  return catchUp.groupingContext;
}

function acceptsParent(catchUp: CatchUp, row: StoredEventRow): boolean {
  const parent = parentToolCallIdOf(row);
  const { context } = catchUp;
  if (
    parent === null ||
    context.delegatingItemIds.has(parent) ||
    context.missingParentToolCallIds.has(parent)
  ) {
    return true;
  }
  const parentRows = listStoredDelegatingItemRowsByItemIds(catchUp.db, {
    itemIds: [parent],
    maxInlineOutputChars: catchUp.projection.scope.maxInlineOutputChars,
    threadId: catchUp.projection.scope.threadId,
  });
  if (parentRows.some((parentRow) => parentRow.sequence <= catchUp.maxSeq)) {
    return false;
  }
  context.missingParentToolCallIds.add(parent);
  return true;
}

function acceptsDelegatingItem(catchUp: CatchUp, row: StoredEventRow): boolean {
  if (!isDelegatingRow(row)) return true;
  const itemId = row.itemId!;
  const { context, projection } = catchUp;
  if (context.delegatingItemIds.has(itemId)) return true;
  if (context.missingParentToolCallIds.has(itemId)) return false;
  const childRows = listStoredEventRowsByParentToolCallIds(catchUp.db, {
    ...windowQueryArgs(
      projection.scope,
      projection.scope.epochSequenceStart,
      projection.maxSeq + 1,
    ),
    parentToolCallIds: [itemId],
  });
  if (childRows.length > 0) return false;
  context.delegatingItemIds.add(itemId);
  return true;
}

function isAcceptedInputForWindowRequest(
  catchUp: CatchUp,
  row: StoredEventRow,
): boolean {
  if (row.type !== "turn/input/accepted") return false;
  const grouping = groupingContextOf(catchUp);
  const requestId = grouping.clientRequestIdsBySequence.get(row.sequence);
  const request =
    requestId === undefined
      ? undefined
      : grouping.clientRequests.get(requestId);
  return (
    request?.requestedSequences.some(
      (sequence) =>
        sequence >= catchUp.projection.selection.ownedSequenceStart &&
        sequence <= catchUp.maxSeq,
    ) ?? false
  );
}

function acceptsTurn(catchUp: CatchUp, row: StoredEventRow): boolean {
  if (row.scopeKind !== "turn") return true;
  const turnId = row.turnId;
  if (turnId === null) return false;
  const { context, projection } = catchUp;
  if (context.appendableTurnIds.has(turnId)) return true;
  const startedRows = listStoredTurnStartedRowsByTurnIdsUpToSequence(
    catchUp.db,
    {
      sequenceCutoff: Number.MAX_SAFE_INTEGER,
      threadId: projection.scope.threadId,
      turnIds: [turnId],
    },
  );
  if (
    !startedRows.every(
      (started) =>
        started.sequence > projection.maxSeq ||
        selectionHasRow(projection.selection.rows, started),
    )
  ) {
    return false;
  }
  const parent = parentToolCallIdOf(row);
  const fetched =
    (parent !== null && context.delegatingItemIds.has(parent)) ||
    (row.parentToolCallId === null &&
      startedRows.some((started) => started.parentToolCallId === null)) ||
    isAcceptedInputForWindowRequest(catchUp, row);
  if (!fetched) return TURN_CONTEXT_EVENT_TYPES.has(row.type);
  const turnRows = listStoredTimelineTurnEventRows(catchUp.db, {
    ...windowQueryArgs(
      projection.scope,
      projection.scope.epochSequenceStart,
      projection.maxSeq + 1,
    ),
    turnIds: [turnId],
  });
  if (turnRows.length > 0) return false;
  context.appendableTurnIds.add(turnId);
  return true;
}

function acceptsAcceptedInput(catchUp: CatchUp, row: StoredEventRow): boolean {
  if (row.type !== "turn/input/accepted") return true;
  const grouping = groupingContextOf(catchUp);
  const requestId = grouping.clientRequestIdsBySequence.get(row.sequence);
  const request =
    requestId === undefined
      ? undefined
      : grouping.clientRequests.get(requestId);
  const { rows } = catchUp.projection.selection;
  return (
    request !== undefined &&
    request.acceptedSequences.length === 1 &&
    request.requestedSequences.every(
      (sequence) =>
        sequence > catchUp.projection.maxSeq ||
        selectionIndexOfSequence(rows, sequence) >= 0,
    )
  );
}

function acceptsClientRequest(catchUp: CatchUp, row: StoredEventRow): boolean {
  if (row.type !== "client/turn/requested") return true;
  const grouping = groupingContextOf(catchUp);
  const requestId = grouping.clientRequestIdsBySequence.get(row.sequence);
  if (requestId === undefined) return false;
  const request = grouping.clientRequests.get(requestId)!;
  return (
    request.requestedSequences.length === 1 &&
    request.acceptedSequences.every(
      (sequence) => sequence > catchUp.projection.maxSeq,
    ) &&
    listStoredTurnRejectedRowsByClientRequestIds(catchUp.db, {
      afterSequence: -1,
      clientRequestIds: [requestId],
      threadId: catchUp.projection.scope.threadId,
    }).every((rejected) => rejected.sequence > catchUp.projection.maxSeq)
  );
}

function isKeptByWindowTurnOrParent(
  catchUp: CatchUp,
  row: StoredEventRow,
): boolean {
  const parent = parentToolCallIdOf(row);
  if (parent !== null && catchUp.context.delegatingItemIds.has(parent)) {
    return true;
  }
  return row.turnId === null
    ? row.sequence >= catchUp.projection.selection.ownedSequenceStart
    : catchUp.context.appendableTurnIds.has(row.turnId);
}

function acceptsBackgroundTask(catchUp: CatchUp, row: StoredEventRow): boolean {
  if (row.itemKind !== "backgroundTask") return true;
  const itemId = row.itemId;
  if (itemId === null) return false;
  const { rows } = catchUp.projection.selection;
  if (row.type === "item/started") {
    return listLatestBackgroundTaskStateRowsByItemIds(catchUp.db, {
      beforeSequence: catchUp.projection.maxSeq + 1,
      itemIds: [itemId],
      threadId: catchUp.projection.scope.threadId,
    }).every((stateRow) => selectionHasRow(rows, stateRow));
  }
  if (row.type !== "item/backgroundTask/completed") return false;
  return rows.every(
    (selected) =>
      selected.itemKind !== "backgroundTask" ||
      selected.itemId !== itemId ||
      (selected.type !== "item/backgroundTask/progress" &&
        isKeptByWindowTurnOrParent(catchUp, selected)),
  );
}

function acceptsAppendedRow(catchUp: CatchUp, row: StoredEventRow): boolean {
  return (
    acceptsParent(catchUp, row) &&
    acceptsDelegatingItem(catchUp, row) &&
    acceptsTurn(catchUp, row) &&
    acceptsAcceptedInput(catchUp, row) &&
    acceptsClientRequest(catchUp, row) &&
    acceptsBackgroundTask(catchUp, row)
  );
}

function createDerived(): ThreadTimelineProjectionDerived {
  return {
    eventProjections: new Map(),
    headStates: new Map(),
    pageableRows: new Map(),
    timelines: new Map(),
    windows: new Map(),
  };
}

function startNextVersion(projection: ThreadTimelineProjection): void {
  if (projection.derived.pageableRows.size > 0) {
    projection.previousDerived = projection.derived;
  }
  projection.derived = createDerived();
}

function appendToProjection(
  db: DbConnection,
  projection: ThreadTimelineProjection,
  maxSeq: number,
  maxSeqIsHead = false,
): boolean {
  if (maxSeq === projection.maxSeq) return true;
  if (
    maxSeq < projection.maxSeq ||
    maxSeq - projection.maxSeq > MAX_APPENDED_ROWS_PER_CATCH_UP ||
    (!maxSeqIsHead &&
      getLatestThreadSequence(db, { threadId: projection.scope.threadId }) !==
        maxSeq)
  ) {
    return false;
  }
  const { scope } = projection;
  const appendedRows = listAppendedEventRows(db, {
    afterSequence: projection.maxSeq,
    limit: MAX_APPENDED_ROWS_PER_CATCH_UP + 1,
    maxInlineOutputChars: scope.maxInlineOutputChars,
    threadId: scope.threadId,
    throughSequence: maxSeq,
  });
  if (
    appendedRows.length > MAX_APPENDED_ROWS_PER_CATCH_UP ||
    appendedRows.some(changesSelection)
  ) {
    return false;
  }
  const orderingRowsAppended = appendedRows.some((row) =>
    ORDERING_CONTEXT_EVENT_TYPES.has(row.type),
  );
  const orderingChanged =
    orderingRowsAppended ||
    appendedRows.some((row) => parentToolCallIdOf(row) !== null);
  if (orderingRowsAppended) {
    extendTimelineOrderingContextLog(db, projection.orderingLog, maxSeq);
  } else {
    advanceTimelineOrderingContextLog(
      projection.orderingLog,
      projection.maxSeq,
      maxSeq,
    );
  }
  const catchUp: CatchUp = {
    context: {
      appendableTurnIds: new Set(projection.context.appendableTurnIds),
      delegatingItemIds: new Set(projection.context.delegatingItemIds),
      missingParentToolCallIds: new Set(
        projection.context.missingParentToolCallIds,
      ),
    },
    db,
    groupingContext: null,
    maxSeq,
    projection,
  };
  const rows =
    selectAppendedTimelineWindowRows(appendedRows, {
      excludeDiagnosticEvents: scope.excludeDiagnosticEvents,
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    }) ??
    listStoredTimelineWindowEventRows(
      db,
      windowQueryArgs(scope, projection.maxSeq + 1, maxSeq + 1),
    );
  if (!rows.every((row) => acceptsAppendedRow(catchUp, row))) {
    return false;
  }
  for (const turnId of catchUp.context.appendableTurnIds) {
    projection.context.appendableTurnIds.add(turnId);
  }
  for (const itemId of catchUp.context.delegatingItemIds) {
    projection.context.delegatingItemIds.add(itemId);
  }
  for (const itemId of catchUp.context.missingParentToolCallIds) {
    projection.context.missingParentToolCallIds.add(itemId);
  }
  if (projection.budgetFloorSequence === undefined) {
    projection.budgetFloorSequence = findTimelineWindowBudgetFloorSequence(db, {
      threadId: scope.threadId,
      sequenceStart: scope.epochSequenceStart,
      beforeSequence: maxSeq + 1,
      eventBudget: scope.eventBudget,
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
      excludeDiagnosticEvents: scope.excludeDiagnosticEvents,
    });
  } else {
    projection.budgetFloorSequence = advanceTimelineWindowBudgetFloorSequence(
      db,
      {
        appendedEventCount: rows.length,
        excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
        excludeDiagnosticEvents: scope.excludeDiagnosticEvents,
        floorSequence: projection.budgetFloorSequence,
        threadId: scope.threadId,
      },
    );
  }
  const appendedHints = rows
    .filter((row) => row.type === "client/turn/requested")
    .map((row) => ({ sequence: row.sequence }))
    .reverse();
  if (appendedHints.length > 0) {
    projection.hints = [...appendedHints, ...projection.hints];
  }
  const decoded = rows.map(decodeStoredEventRow);
  if (projection.fold !== null) {
    if (resumeEventProjectionFold(projection.fold.fold, decoded)) {
      projection.foldedEventCount += decoded.length;
    } else {
      projection.fold = null;
    }
  }
  if (orderingChanged) {
    projection.groupingContext = {
      context: groupingContextOf(catchUp),
      maxSeq,
    };
  } else if (projection.groupingContext?.maxSeq === projection.maxSeq) {
    projection.groupingContext.maxSeq = maxSeq;
  }
  projection.selection = {
    ...projection.selection,
    orderingBoundarySequence: orderingChanged
      ? projection.groupingContext!.context.orderingBoundarySequence
      : projection.selection.orderingBoundarySequence,
    ownedSequenceEnd: maxSeq + 1,
    rows:
      rows.length === 0
        ? projection.selection.rows
        : projection.selection.rows.concat(rows),
  };
  projection.events =
    decoded.length === 0
      ? projection.events
      : projection.events.concat(decoded);
  projection.dataBytes += dataBytesOfRows(rows);
  projection.maxSeq = maxSeq;
  startNextVersion(projection);
  return true;
}

interface ProjectionBuild {
  db: DbConnection;
  hintSource?: ThreadTimelineProjection;
  maxSeq: number;
  previous: ThreadTimelineProjection | null;
  scope: TimelineProjectionScope;
  segmentLimit: number;
  select: TimelineProjectionSelect;
  source: TimelineSelectionRowSource | undefined;
}

function buildProjection(build: ProjectionBuild): ThreadTimelineProjection {
  const { db, maxSeq, previous, scope } = build;
  const orderingLog =
    previous?.orderingLog ??
    createTimelineOrderingContextLog(scope.threadId, scope.epochSequenceStart);
  const groupingContext = readTimelineGroupingContext(db, orderingLog, maxSeq);
  const result = build.select(
    build.segmentLimit,
    groupingContext,
    build.source,
  );
  const rows = result.selection.rows;
  const decodedById = new Map(
    previous?.events.map((event) => [event.meta.id, event]) ?? [],
  );
  const released = releaseDroppedEvents(previous, rows);
  return {
    budgetFloorSequence: result.budgetFloorSequence,
    context: {
      appendableTurnIds: new Set(result.fetchedTurnIds),
      delegatingItemIds: collectDelegatingItemIds(rows),
      missingParentToolCallIds: new Set(),
    },
    coverageSegmentLimit: Math.max(
      build.segmentLimit,
      build.hintSource?.coverageSegmentLimit ?? 0,
    ),
    active: false,
    id: nextProjectionId++,
    servedSegmentLimits: new Set(),
    dataBytes: dataBytesOfRows(rows),
    dataVersion: getDatabaseDataVersion(db),
    derived: createDerived(),
    events: rows.map(
      (row) => decodedById.get(row.id) ?? decodeStoredEventRow(row),
    ),
    eventsById: new Map(),
    releasedBytes: released.bytes,
    releasedEvents: released.events,
    fold: null,
    foldedEventCount: 0,
    generation: getThreadEventRewriteGeneration(scope.threadId),
    groupingContext: { context: groupingContext, maxSeq },
    headStateEvents: previous?.headStateEvents ?? new Map(),
    hints:
      build.hintSource !== undefined &&
      build.hintSource.hints.length > result.hints.length
        ? [...build.hintSource.hints]
        : [...result.hints],
    maxSeq,
    orderingLog,
    previousDerived: previous?.derived ?? createDerived(),
    scope,
    scopeKey: scopeKeyOf(scope),
    selection: result.selection,
  };
}

function releaseDroppedEvents(
  previous: ThreadTimelineProjection | null,
  rows: readonly StoredEventRow[],
): { bytes: number; events: Map<string, ReleasedEvent> } {
  const events = new Map(previous?.releasedEvents ?? []);
  let bytes = previous?.releasedBytes ?? 0;
  if (previous === null) return { bytes, events };
  const kept = new Set(rows.map((row) => row.id));
  for (const [index, row] of previous.selection.rows.entries()) {
    const event = previous.events[index];
    if (kept.has(row.id) || event === undefined || events.has(row.id)) {
      continue;
    }
    events.set(row.id, { bytes: row.data.length, event });
    bytes += row.data.length;
  }
  for (const id of kept) {
    const entry = events.get(id);
    if (entry === undefined) continue;
    events.delete(id);
    bytes -= entry.bytes;
  }
  for (const [id, entry] of events) {
    if (bytes <= MAX_RELEASED_EVENT_BYTES) break;
    events.delete(id);
    bytes -= entry.bytes;
  }
  return { bytes, events };
}

function trimFallback(reason: string): never {
  throw new TimelineProjectionTrimFallback(reason);
}

function projectionRowSource(
  db: DbConnection,
  projection: ThreadTimelineProjection,
): TimelineSelectionRowSource {
  const { context, maxSeq, scope } = projection;
  const rows = projection.selection.rows;
  let rowsById: Map<string, StoredEventRow> | null = null;
  const expectLatestBounds = (bounds: {
    beforeSequence?: number;
    sequenceStart?: number;
  }) => {
    if (bounds.beforeSequence !== maxSeq + 1) {
      trimFallback("before-sequence");
    }
    return bounds.sequenceStart ?? 0;
  };
  const expectEpochBounds = (bounds: {
    beforeSequence?: number;
    sequenceStart?: number;
  }) => {
    if (expectLatestBounds(bounds) !== scope.epochSequenceStart) {
      trimFallback("sequence-start");
    }
  };
  return {
    listChildRows(query) {
      expectEpochBounds(query);
      const parents = new Set(query.parentToolCallIds);
      for (const parent of parents) {
        if (!context.delegatingItemIds.has(parent)) {
          trimFallback("unfetched-children");
        }
      }
      const excludedTurnIds = new Set(query.excludedTurnIds);
      return rows.filter(
        (row) =>
          row.parentToolCallId !== null &&
          parents.has(row.parentToolCallId) &&
          row.sequence >= scope.epochSequenceStart &&
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
        if (row.sequence > maxSeq) return row;
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
        if (!context.appendableTurnIds.has(turnId)) {
          trimFallback("unfetched-turn");
        }
      }
      return rows.filter(
        (row) =>
          row.turnId !== null &&
          turnIds.has(row.turnId) &&
          row.sequence >= scope.epochSequenceStart,
      );
    },
  };
}

function storeProjection(
  db: DbConnection,
  projection: ThreadTimelineProjection,
): void {
  const registry = registryOf(db);
  const key = projection.id;
  registry.delete(key);
  if (projection.dataBytes > MAX_TIMELINE_PROJECTION_DATA_BYTES) return;
  registry.set(key, projection);
  if (!projection.active) {
    let idle = 0;
    for (const kept of registry.values()) if (!kept.active) idle += 1;
    for (const [keptKey, kept] of registry) {
      if (idle <= MAX_IDLE_TIMELINE_PROJECTIONS) break;
      if (kept.active) continue;
      registry.delete(keptKey);
      idle -= 1;
    }
  }
  let dataBytes = 0;
  for (const kept of registry.values()) {
    dataBytes += kept.dataBytes + kept.releasedBytes;
  }
  while (
    registry.size > MAX_TIMELINE_PROJECTIONS ||
    (dataBytes > MAX_TIMELINE_PROJECTION_DATA_BYTES && registry.size > 1)
  ) {
    const [oldestKey, oldest] = registry.entries().next().value!;
    registry.delete(oldestKey);
    dataBytes -= oldest.dataBytes + oldest.releasedBytes;
  }
}

function latestWindowStart(
  db: DbConnection,
  projection: ThreadTimelineProjection,
  segmentLimit: number,
): number {
  return selectTimelineWindowStart(db, {
    beforeSequence: projection.maxSeq + 1,
    budgetFloorSequence: projection.budgetFloorSequence,
    epochSequenceStart: projection.scope.epochSequenceStart,
    hints: projection.hints.slice(0, segmentLimit + 1),
    segmentLimit,
    threadId: projection.scope.threadId,
  });
}

function trimProjection(
  build: Omit<ProjectionBuild, "source">,
  previous: ThreadTimelineProjection,
): ThreadTimelineProjection | null {
  try {
    return buildProjection({
      ...build,
      source: projectionRowSource(build.db, previous),
    });
  } catch (error) {
    if (!(error instanceof TimelineProjectionTrimFallback)) throw error;
    return null;
  }
}

export interface ReadTimelineProjectionArgs {
  active: boolean;
  maxSeq: number;
  scope: TimelineProjectionScope;
  segmentLimit: number;
  select: TimelineProjectionSelect;
}

function serve(
  db: DbConnection,
  projection: ThreadTimelineProjection,
  args: ReadTimelineProjectionArgs,
  siblings: readonly ThreadTimelineProjection[],
): ThreadTimelineProjection {
  const { segmentLimit } = args;
  projection.active = args.active;
  const registry = registryOf(db);
  for (const sibling of siblings) {
    if (sibling === projection) continue;
    sibling.servedSegmentLimits.delete(segmentLimit);
    const sameWindow =
      sibling.scopeKey === projection.scopeKey &&
      sibling.selection.ownedSequenceStart ===
        projection.selection.ownedSequenceStart;
    if (sameWindow) {
      for (const limit of sibling.servedSegmentLimits) {
        projection.servedSegmentLimits.add(limit);
      }
    }
    if (sameWindow || sibling.servedSegmentLimits.size === 0) {
      registry.delete(sibling.id);
    }
  }
  projection.servedSegmentLimits.add(segmentLimit);
  storeProjection(db, projection);
  return projection;
}

export function readTimelineProjection(
  db: DbConnection,
  args: ReadTimelineProjectionArgs,
): ThreadTimelineProjection {
  const scopeKey = scopeKeyOf(args.scope);
  const siblings = projectionsOfThread(db, args.scope.threadId);
  const valid = siblings.filter(
    (projection) =>
      projection.scopeKey === scopeKey && isProjectionCurrent(db, projection),
  );
  const current = valid.filter((projection) =>
    appendToProjection(db, projection, args.maxSeq),
  );
  const build = {
    db,
    maxSeq: args.maxSeq,
    scope: args.scope,
    segmentLimit: args.segmentLimit,
    select: args.select,
  };
  const reference = current.find(
    (projection) => projection.coverageSegmentLimit >= args.segmentLimit,
  );
  if (reference !== undefined) {
    const sequenceStart = latestWindowStart(db, reference, args.segmentLimit);
    const exact = current.find(
      (projection) => projection.selection.ownedSequenceStart === sequenceStart,
    );
    if (exact !== undefined) {
      if (exact.coverageSegmentLimit < reference.coverageSegmentLimit) {
        exact.coverageSegmentLimit = reference.coverageSegmentLimit;
        exact.hints = [...reference.hints];
      }
      return serve(db, exact, args, siblings);
    }
    const sources = current
      .filter(
        (projection) =>
          projection.selection.ownedSequenceStart <= sequenceStart,
      )
      .sort(
        (left, right) =>
          right.selection.ownedSequenceStart -
          left.selection.ownedSequenceStart,
      );
    for (const source of sources) {
      const trimmed = trimProjection(
        { ...build, hintSource: reference, previous: source },
        source,
      );
      if (trimmed !== null) {
        return serve(db, trimmed, args, siblings);
      }
    }
  }
  const projection = buildProjection({
    ...build,
    previous: current[0] ?? valid[0] ?? null,
    source: undefined,
  });
  return serve(db, projection, args, siblings);
}

export function catchUpTimelineProjection(
  db: DbConnection,
  threadId: string,
): void {
  const projections = projectionsOfThread(db, threadId);
  if (projections.length === 0) return;
  db.transaction(() => {
    const maxSeq = getLatestThreadSequence(db, { threadId });
    for (const projection of projections) {
      if (!isProjectionCurrent(db, projection)) {
        registryOf(db).delete(projection.id);
      } else {
        appendToProjection(db, projection, maxSeq, true);
      }
    }
  });
}

export function projectionFold(
  projection: ThreadTimelineProjection,
  key: string,
  start: () => EventProjectionFold,
): EventProjectionFold {
  if (projection.fold?.key === key) return projection.fold.fold;
  const fold = start();
  projection.fold = { fold, key };
  projection.foldedEventCount = fold.events.length;
  return fold;
}

export function takeFoldedEventCount(
  projection: ThreadTimelineProjection,
): number {
  const count = projection.foldedEventCount;
  projection.foldedEventCount = 0;
  return count;
}
