import {
  buildThreadTimelineFromEvents,
  THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
  buildThreadTimelineTurnDetailsFromEvents,
  compactThreadTimelineSummaryEvents,
  type AcceptedClientRequestContext,
  type ThreadEventWithMeta,
} from "@bb/thread-view";
import type {
  ClientTurnRequestId,
  ProviderComposerCommand,
  Thread,
} from "@bb/domain";
import type {
  ThreadConversationOutlineItem,
  ThreadConversationOutlineResponse,
  TimelineConversationAttachments,
  ThreadConversationOutlineAttachmentSummary,
  TimelineRow,
  TimelineSystemRow,
  ThreadTimelineResponse,
  TimelineTurnSummaryDetailsResponse,
} from "@bb/server-contract";
import {
  findStoredTimelineWindowByteBudgetFloor,
  findTimelineWindowBudgetFloorSequence,
  getStoredEventRowsByParentToolCallIdsDataBytes,
  getEnvironment,
  findUnfinishedTurnCoveringSequence,
  hasParentedEventCrossingSequence,
  getTimelineSegmentAnchorAtSequence,
  listContextWindowUsageRows,
  listRecentStoredEventRows,
  listStoredConversationOutlineEventRows,
  listStoredClientTurnRequestIdsInRange,
  listStoredEventRowsByParentToolCallIds,
  isTimelineCursorSequencePresent,
  listItemEventSpansByItems,
  listStoredBufferedTextDeltaRowsByItems,
  listStoredItemLifecycleRowsByItems,
  listLatestBackgroundTaskStateRowsByItemIds,
  listLatestGoalEventRowsByThreadIds,
  listLatestOpenBackgroundTaskStateRowsForThread,
  listStoredTimelineWindowEventRows,
  listTodoSnapshotEventRowsForThread,
  listStoredToolCallRowsByItemIds,
  listStoredTurnCompletedRowsByTurnIds,
  listStoredTurnInputAcceptedRowsByClientRequestIds,
  listStoredTurnRejectedRowsByClientRequestIds,
  listStoredTurnStartedRowsByTurnIdsUpToSequence,
  listTimelineSegmentAnchorsDescending,
  scopedItemRefKey,
} from "@bb/db";
import type {
  DbConnection,
  InlineOutputCharLimit,
  ScopedItemRef,
  StandardTimelineSegmentAnchorRow,
  StoredEventRow,
} from "@bb/db";
import { ApiError } from "../../errors.js";
import { roundDurationMs } from "../lib/duration.js";
import { runEventLoopWorkSync } from "../system/event-loop-work.js";
import { parseStoredEvent } from "./thread-data.js";
import {
  paginateTimelineRows,
  readSequenceCursor,
  type ThreadTimelinePageKind,
  type ThreadTimelinePageRequest,
  type TimelineSequenceWindowStart,
} from "./timeline-pagination.js";
import { DEFAULT_MAX_INLINE_OUTPUT_CHARS } from "./timeline-output-truncation.js";

export type {
  LatestThreadTimelinePageRequest,
  OlderThreadTimelinePageRequest,
  ThreadTimelinePageKind,
  ThreadTimelinePageRequest,
} from "./timeline-pagination.js";

interface TimelineTurnSummarySelection {
  sourceSeqEnd: number;
  sourceSeqStart: number;
  turnId: string;
}

/**
 * The absolute path of the thread's workspace root, or null when the thread has
 * no environment. The projection uses it to relativize the absolute file paths
 * persisted by provider file-edit tool calls into workspace-relative paths.
 */
function resolveThreadWorkspaceRoot(
  db: DbConnection,
  thread: Thread,
): string | null {
  if (thread.environmentId === null) {
    return null;
  }
  return getEnvironment(db, thread.environmentId)?.path ?? null;
}

interface PartitionAcceptedInputRowsByRequestedTurnArgs {
  acceptedInputRows: readonly StoredEventRow[];
  turnId: string;
}

interface PartitionAcceptedInputRowsByRequestedTurnResult {
  acceptedClientRequestIdsForOtherTurns: ReadonlySet<ClientTurnRequestId>;
  requestedTurnRows: StoredEventRow[];
}

interface FilterExactEventRowsForRequestedTurnArgs {
  acceptedClientRequestIdsForOtherTurns: ReadonlySet<ClientTurnRequestId>;
  exactEventRows: readonly StoredEventRow[];
  turnId: string;
}

interface FilterExactEventRowsForRequestedTurnResult {
  removedRows: boolean;
  rows: readonly StoredEventRow[];
}

interface ResolveTurnSummaryDetailsSourceRangeArgs {
  exactEventRows: readonly StoredEventRow[];
  fallbackRange: TimelineTurnSummarySelection;
  useExactEventRowBounds: boolean;
}

interface BuildThreadTimelineOptions {
  /**
   * Max events a page's window may span, on top of the segment (user-message)
   * limit. Operator-tunable via the `timelineWindowEventBudget` feature flag.
   */
  eventBudget: number;
  includeProviderUnhandledOperations: boolean;
  includeNestedRows?: boolean;
  /**
   * Cap on the inline output a window reads out of SQLite, applied during the
   * read rather than to the finished rows. The window renders a preview either
   * way, so reading a 300 KB command output only to shorten it after projection
   * is pure I/O and `JSON.parse` cost. `null` reads payloads as stored.
   */
  maxInlineOutputChars: InlineOutputCharLimit;
  /** Thread high-water event sequence this window reflects (echoed to clients). */
  maxSeq: number;
  page: ThreadTimelinePageRequest;
  /**
   * When true, the response is built without rows (rows: []). The tail-only
   * fields (`activeThinking`, `activeWorkflows`, `pendingTodos`,
   * `contextWindowUsage`) are still populated. Saves the row-generation work +
   * serialization bytes for
   * consumers that only need tail state (e.g. `bb status` / `bb thread show`).
   */
  summaryOnly?: boolean;
  providerDisplayName?: string;
  /**
   * The provider's declared `plan` composer command; null when it declares
   * none. Gates plan-mode extraction — see
   * `services/providers/provider-plan-command.ts`.
   */
  planCommand?: ProviderComposerCommand | null;
}

interface BuildTimelineTurnSummaryDetailsOptions extends TimelineTurnSummarySelection {
  includeProviderUnhandledOperations: boolean;
  providerDisplayName?: string;
}

export const THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT = 20;

export const THREAD_TIMELINE_SEGMENT_LIMIT_MAX = 100;

/**
 * Driver rows and decoded events can use several times their stored JSON size.
 * Bound each page before either representation enters the V8 heap.
 */
export const THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT = 4 * 1024 * 1024;

export type ThreadTimelineBuildProfileStage =
  | "event-query"
  | "accepted-client-request-context-query"
  | "event-json-decode"
  | "summary-compaction"
  | "context-window-query"
  | "context-window-json-decode"
  | "thread-view-projection"
  | "pagination-segmentation"
  | "response-serialization";

export type ThreadTimelineEventSelectionStrategy = "full" | "standard-window";

export interface ThreadTimelineBuildProfileStageTiming {
  durationMs: number;
  stage: ThreadTimelineBuildProfileStage;
}

export interface ThreadTimelineBuildProfile {
  compactedEventCount: number;
  contextWindowEventDataBytes: number;
  contextWindowEventRowCount: number;
  decodedEventCount: number;
  eventDataBytes: number;
  eventRowCount: number;
  pageKind: ThreadTimelinePageKind;
  projectedRowCount: number;
  /**
   * Null unless `measureResponseBytes` was requested. Measuring it means
   * serializing the whole response a second time, which on a large thread is
   * megabytes of `JSON.stringify` — the exact cost this profile exists to
   * diagnose. The slow-build log path leaves it off and relies on the cheap
   * counters instead.
   */
  responseJsonBytes: number | null;
  responseRowCount: number;
  returnedSegmentCount: number;
  segmentLimit: number;
  selectionStrategy: ThreadTimelineEventSelectionStrategy;
  stageTimings: ThreadTimelineBuildProfileStageTiming[];
  totalDurationMs: number;
}

interface BuildThreadTimelineInternalResult {
  profile: ThreadTimelineBuildProfile | null;
  response: ThreadTimelineResponse;
}

interface ThreadTimelineBuildProfileAccumulator {
  compactedEventCount: number;
  contextWindowEventDataBytes: number;
  contextWindowEventRowCount: number;
  decodedEventCount: number;
  eventDataBytes: number;
  eventRowCount: number;
  projectedRowCount: number;
  responseJsonBytes: number | null;
  responseRowCount: number;
  returnedSegmentCount: number;
  selectionStrategy: ThreadTimelineEventSelectionStrategy;
  stageTimings: ThreadTimelineBuildProfileStageTiming[];
}

interface BuildThreadTimelineInternalOptions extends BuildThreadTimelineOptions {
  includeProfile: boolean;
  /** See {@link ThreadTimelineBuildProfile.responseJsonBytes}. */
  measureResponseBytes: boolean;
}

interface TimelineEventRowSelection {
  byteWindowSequenceEnd: number | null;
  byteWindowSequenceStart: number | null;
  contextOnlyToolCallIds: Set<string>;
  /** See {@link paginateTimelineRows}. */
  sequenceWindowStart: TimelineSequenceWindowStart | null;
  /** See {@link paginateTimelineRows}. */
  knownHasOlderSegments: boolean | null;
  paginationPage: ThreadTimelinePageRequest;
  responsePageKind: ThreadTimelinePageKind;
  oversizedEventPlaceholder: TimelineSystemRow | null;
  rows: StoredEventRow[];
  strategy: ThreadTimelineEventSelectionStrategy;
}

interface TimelineWindowRowsArgs {
  rows: readonly StoredEventRow[];
  threadId: string;
}

/**
 * Parent/child backfill reads whole event payloads, so unlike the other window
 * backfills it has to say how much inline output it is willing to read.
 */
interface TimelineWindowParentedRowsArgs extends TimelineWindowRowsArgs {
  includeParentContext?: boolean;
  /** See {@link InlineOutputCharLimit}. */
  maxInlineOutputChars: InlineOutputCharLimit;
  /** Extra byte budget for child rows outside `sequenceBounds`. */
  outOfBoundsChildDataByteLimit?: number;
  sequenceBounds: {
    beforeSequence: number | undefined;
    sequenceStart: number;
  } | null;
}

interface TimelineWindowParentedRowsResult {
  contextOnlyToolCallIds: Set<string>;
  rows: StoredEventRow[];
}

interface SelectClientRequestContextRowsArgs {
  rows: readonly StoredEventRow[];
  threadId: string;
}

interface SelectedClientRequestContextRows {
  acceptedRows: StoredEventRow[];
  rejectedRows: StoredEventRow[];
}

export function toThreadEventWithMeta(
  row: StoredEventRow,
): ThreadEventWithMeta {
  return {
    event: parseStoredEvent(row),
    meta: {
      id: row.id,
      seq: row.sequence,
      createdAt: row.createdAt,
    },
  };
}

function parseAcceptedInputClientRequestId(
  row: StoredEventRow,
): ClientTurnRequestId {
  const event = parseStoredEvent(row);
  switch (event.type) {
    case "turn/input/accepted":
      return event.clientRequestId;
    default:
      throw new Error(`Expected turn/input/accepted row ${row.id}`);
  }
}

function parseRejectedClientRequestId(
  row: StoredEventRow,
): ClientTurnRequestId {
  const event = parseStoredEvent(row);
  if (event.type !== "client/turn/rejected") {
    throw new Error(`Expected client/turn/rejected row ${row.id}`);
  }
  return event.requestId;
}

function tryReadClientTurnRequestedRequestId(
  row: StoredEventRow,
): ClientTurnRequestId | null {
  const event = parseStoredEvent(row);
  if (event.type !== "client/turn/requested") {
    return null;
  }
  return event.requestId;
}

function tryReadSteerClientTurnRequestedRequestId(
  row: StoredEventRow,
): ClientTurnRequestId | null {
  if (row.type !== "client/turn/requested") {
    return null;
  }
  const event = parseStoredEvent(row);
  if (event.type !== "client/turn/requested") {
    return null;
  }

  switch (event.target.kind) {
    case "auto":
    case "steer":
      return event.target.expectedTurnId === null ? null : event.requestId;
    case "new-turn":
    case "thread-start":
      return null;
  }
}

function collectSteerClientRequestIdsNeedingContext(
  rows: readonly StoredEventRow[],
): ClientTurnRequestId[] {
  const terminalClientRequestIds = new Set<ClientTurnRequestId>();
  const clientRequestIds = new Set<ClientTurnRequestId>();
  for (const row of rows) {
    if (row.type === "turn/input/accepted") {
      const clientRequestId = parseAcceptedInputClientRequestId(row);
      terminalClientRequestIds.add(clientRequestId);
      clientRequestIds.delete(clientRequestId);
      continue;
    }
    if (row.type === "client/turn/rejected") {
      const clientRequestId = parseRejectedClientRequestId(row);
      terminalClientRequestIds.add(clientRequestId);
      clientRequestIds.delete(clientRequestId);
      continue;
    }
    const clientRequestId = tryReadSteerClientTurnRequestedRequestId(row);
    if (
      clientRequestId === null ||
      terminalClientRequestIds.has(clientRequestId)
    ) {
      continue;
    }
    clientRequestIds.add(clientRequestId);
  }
  return [...clientRequestIds];
}

function mergeStoredEventRowsById(
  rows: readonly StoredEventRow[],
): StoredEventRow[] {
  const rowsById = new Map<string, StoredEventRow>();
  for (const row of rows) {
    rowsById.set(row.id, row);
  }
  return [...rowsById.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

function getStoredEventParentToolCallId(
  row: StoredEventRow,
): string | undefined {
  return row.parentToolCallId !== null && row.parentToolCallId.length > 0
    ? row.parentToolCallId
    : undefined;
}

function collectStoredToolCallItemIds(
  rows: readonly StoredEventRow[],
): string[] {
  const itemIds = new Set<string>();
  for (const row of rows) {
    if (row.itemKind !== "toolCall" || row.itemId === null) {
      continue;
    }
    itemIds.add(row.itemId);
  }
  return [...itemIds];
}

function collectStoredParentToolCallIds(
  rows: readonly StoredEventRow[],
): string[] {
  const parentToolCallIds = new Set<string>();
  for (const row of rows) {
    const parentToolCallId = getStoredEventParentToolCallId(row);
    if (parentToolCallId) {
      parentToolCallIds.add(parentToolCallId);
    }
  }
  return [...parentToolCallIds];
}

function ensureTimelineWindowParentedRows(
  db: DbConnection,
  args: TimelineWindowParentedRowsArgs,
): TimelineWindowParentedRowsResult {
  let rows = [...args.rows];
  const rowIds = new Set(rows.map((row) => row.id));
  const visibleToolCallIds = new Set(collectStoredToolCallItemIds(rows));
  const fetchedChildToolCallIds = new Set<string>();
  let outOfBoundsChildDataBytesRemaining = args.outOfBoundsChildDataByteLimit;

  while (true) {
    const toolCallIdsToFetch = [...visibleToolCallIds].filter(
      (toolCallId) => !fetchedChildToolCallIds.has(toolCallId),
    );
    if (toolCallIdsToFetch.length === 0) {
      break;
    }
    for (const toolCallId of toolCallIdsToFetch) {
      fetchedChildToolCallIds.add(toolCallId);
    }

    let childSequenceBounds = args.sequenceBounds;
    if (outOfBoundsChildDataBytesRemaining !== undefined) {
      const unboundedChildDataBytes =
        getStoredEventRowsByParentToolCallIdsDataBytes(db, {
          excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
          maxInlineOutputChars: args.maxInlineOutputChars,
          parentToolCallIds: toolCallIdsToFetch,
          threadId: args.threadId,
        });
      if (unboundedChildDataBytes <= outOfBoundsChildDataBytesRemaining) {
        childSequenceBounds = null;
        outOfBoundsChildDataBytesRemaining -= unboundedChildDataBytes;
      }
    }
    const childRows = listStoredEventRowsByParentToolCallIds(db, {
      beforeSequence: childSequenceBounds?.beforeSequence,
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
      maxInlineOutputChars: args.maxInlineOutputChars,
      parentToolCallIds: toolCallIdsToFetch,
      sequenceStart: childSequenceBounds?.sequenceStart,
      threadId: args.threadId,
    });
    const newChildRows = childRows.filter((row) => !rowIds.has(row.id));
    if (newChildRows.length === 0) {
      continue;
    }
    for (const row of newChildRows) {
      rowIds.add(row.id);
      if (row.itemKind === "toolCall" && row.itemId !== null) {
        visibleToolCallIds.add(row.itemId);
      }
    }
    rows = mergeStoredEventRowsById([...rows, ...newChildRows]);
  }

  if (args.includeParentContext === false) {
    return {
      contextOnlyToolCallIds: new Set(),
      rows,
    };
  }

  const contextOnlyToolCallIds = new Set<string>();
  const missingParentToolCallIds = collectStoredParentToolCallIds(rows).filter(
    (parentToolCallId) => !visibleToolCallIds.has(parentToolCallId),
  );
  const parentRows = listStoredToolCallRowsByItemIds(db, {
    itemIds: missingParentToolCallIds,
    maxInlineOutputChars: args.maxInlineOutputChars,
    threadId: args.threadId,
  });
  const newParentRows = parentRows.filter((row) => !rowIds.has(row.id));
  for (const row of parentRows) {
    if (row.itemId !== null && !visibleToolCallIds.has(row.itemId)) {
      contextOnlyToolCallIds.add(row.itemId);
    }
  }

  return {
    contextOnlyToolCallIds,
    rows:
      newParentRows.length > 0
        ? mergeStoredEventRowsById([...newParentRows, ...rows])
        : rows,
  };
}

/**
 * Lowest sequence any of these requests was made at.
 *
 * The accepted row for a request always follows the request itself, so this is
 * the only floor that is guaranteed not to skip one. Searching from the newest
 * row in the window instead looks safe and is not: the window carries rows
 * backfilled from *past* its own upper bound — the latest state of an in-window
 * background task, a tool call's children — and a floor taken from those can
 * sit above an accepted row the window is missing.
 */
function minSequenceOfClientRequests(
  rows: readonly StoredEventRow[],
  clientRequestIds: ReadonlySet<ClientTurnRequestId>,
): number {
  let minSequence = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (row.type !== "client/turn/requested") {
      continue;
    }
    const requestId = tryReadClientTurnRequestedRequestId(row);
    if (requestId !== null && clientRequestIds.has(requestId)) {
      minSequence = Math.min(minSequence, row.sequence);
    }
  }
  return Number.isFinite(minSequence) ? minSequence : 0;
}

function selectClientRequestContextRows(
  db: DbConnection,
  args: SelectClientRequestContextRowsArgs,
): SelectedClientRequestContextRows {
  const clientRequestIds = collectSteerClientRequestIdsNeedingContext(
    args.rows,
  );
  if (clientRequestIds.length === 0) {
    return { acceptedRows: [], rejectedRows: [] };
  }
  const afterSequence = minSequenceOfClientRequests(
    args.rows,
    new Set(clientRequestIds),
  );
  return {
    acceptedRows: listStoredTurnInputAcceptedRowsByClientRequestIds(db, {
      afterSequence,
      clientRequestIds,
      threadId: args.threadId,
    }),
    rejectedRows: listStoredTurnRejectedRowsByClientRequestIds(db, {
      afterSequence,
      clientRequestIds,
      threadId: args.threadId,
    }),
  };
}

function partitionAcceptedInputRowsByRequestedTurn(
  args: PartitionAcceptedInputRowsByRequestedTurnArgs,
): PartitionAcceptedInputRowsByRequestedTurnResult {
  const acceptedClientRequestIdsForOtherTurns = new Set<ClientTurnRequestId>();
  const requestedTurnRows: StoredEventRow[] = [];
  for (const row of args.acceptedInputRows) {
    if (row.scopeKind !== "turn" || row.turnId === null) {
      throw new Error(`Expected turn-scoped turn/input/accepted row ${row.id}`);
    }
    const clientRequestId = parseAcceptedInputClientRequestId(row);
    if (row.turnId === args.turnId) {
      requestedTurnRows.push(row);
      continue;
    }
    acceptedClientRequestIdsForOtherTurns.add(clientRequestId);
  }

  return {
    acceptedClientRequestIdsForOtherTurns,
    requestedTurnRows,
  };
}

function filterExactEventRowsForRequestedTurn(
  args: FilterExactEventRowsForRequestedTurnArgs,
): FilterExactEventRowsForRequestedTurnResult {
  const rows: StoredEventRow[] = [];
  let removedRows = false;
  for (const row of args.exactEventRows) {
    if (row.scopeKind === "turn" && row.turnId !== args.turnId) {
      removedRows = true;
      continue;
    }

    const requestId = tryReadClientTurnRequestedRequestId(row);
    if (
      requestId !== null &&
      args.acceptedClientRequestIdsForOtherTurns.has(requestId)
    ) {
      removedRows = true;
      continue;
    }
    rows.push(row);
  }

  return {
    removedRows,
    rows,
  };
}

function resolveTurnSummaryDetailsSourceRange(
  args: ResolveTurnSummaryDetailsSourceRangeArgs,
): TimelineTurnSummarySelection {
  const fallbackRange = args.fallbackRange;
  if (!args.useExactEventRowBounds) {
    return fallbackRange;
  }

  const firstRow = args.exactEventRows[0];
  const lastRow = args.exactEventRows.at(-1);
  if (!firstRow || !lastRow) {
    return fallbackRange;
  }

  return {
    sourceSeqEnd: lastRow.sequence,
    sourceSeqStart: firstRow.sequence,
    turnId: fallbackRange.turnId,
  };
}

function selectFullTimelineEventRows(
  db: DbConnection,
  thread: Thread,
  page: ThreadTimelinePageRequest,
  maxInlineOutputChars: InlineOutputCharLimit,
): TimelineEventRowSelection {
  return {
    byteWindowSequenceEnd: null,
    byteWindowSequenceStart: null,
    contextOnlyToolCallIds: new Set(),
    sequenceWindowStart: null,
    knownHasOlderSegments: null,
    paginationPage: page,
    responsePageKind: page.kind,
    oversizedEventPlaceholder: null,
    rows: listRecentStoredEventRows(db, {
      threadId: thread.id,
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
      maxInlineOutputChars,
    }),
    strategy: "full",
  };
}

function collectTurnIdsMissingStartedRows(
  rows: readonly StoredEventRow[],
): string[] {
  const startedTurnIds = new Set<string>();
  const turnScopedIds = new Set<string>();

  for (const row of rows) {
    if (row.scopeKind !== "turn" || row.turnId === null) {
      continue;
    }

    if (row.type === "turn/started") {
      startedTurnIds.add(row.turnId);
      continue;
    }

    turnScopedIds.add(row.turnId);
  }

  return [...turnScopedIds].filter((turnId) => !startedTurnIds.has(turnId));
}

function maxStoredEventSequence(rows: readonly StoredEventRow[]): number {
  return rows.reduce(
    (maxSequence, row) => Math.max(maxSequence, row.sequence),
    0,
  );
}

function ensureTimelineWindowTurnStartedRows(
  db: DbConnection,
  args: TimelineWindowRowsArgs,
): StoredEventRow[] {
  // Standard windows are selected by message anchors, while projection groups
  // by turn roots. Add only the real lifecycle rows needed by selected events.
  const missingTurnIds = collectTurnIdsMissingStartedRows(args.rows);
  if (missingTurnIds.length === 0) {
    return [...args.rows];
  }

  const turnStartedRows = listStoredTurnStartedRowsByTurnIdsUpToSequence(db, {
    threadId: args.threadId,
    sequenceCutoff: maxStoredEventSequence(args.rows),
    turnIds: missingTurnIds,
  });
  if (turnStartedRows.length === 0) {
    return [...args.rows];
  }

  return mergeStoredEventRowsById([...turnStartedRows, ...args.rows]);
}

function ensureSequenceWindowTurnCompletedRows(
  db: DbConnection,
  args: TimelineWindowRowsArgs,
): StoredEventRow[] {
  const completedTurnIds = new Set<string>();
  const selectedTurnIds = new Set<string>();
  for (const row of args.rows) {
    if (row.scopeKind !== "turn" || row.turnId === null) {
      continue;
    }
    selectedTurnIds.add(row.turnId);
    if (row.type === "turn/completed") {
      completedTurnIds.add(row.turnId);
    }
  }
  const missingTurnIds = [...selectedTurnIds].filter(
    (turnId) => !completedTurnIds.has(turnId),
  );
  if (missingTurnIds.length === 0) {
    return [...args.rows];
  }

  const completedRows = listStoredTurnCompletedRowsByTurnIds(db, {
    threadId: args.threadId,
    turnIds: missingTurnIds,
  });
  return completedRows.length === 0
    ? [...args.rows]
    : mergeStoredEventRowsById([...args.rows, ...completedRows]);
}

/**
 * The scoped identity of the item a row belongs to. Callers must have checked
 * that the row carries an item id.
 */
function storedEventRowItemRef(row: StoredEventRow): ScopedItemRef {
  return {
    itemId: row.itemId ?? "",
    scopeKind: row.scopeKind,
    turnId: row.turnId,
  };
}

interface SequenceWindowItemRowsArgs extends TimelineWindowRowsArgs {
  /** Exclusive upper bound of the window, or undefined for the latest page. */
  beforeSequence: number | undefined;
  /** See {@link InlineOutputCharLimit}. */
  maxInlineOutputChars: InlineOutputCharLimit;
  /** Inclusive lower bound of the window. */
  sequenceStart: number;
}

function rowIdentifiesBufferedTextItem(row: StoredEventRow): boolean {
  if (row.type === "item/started") {
    return (
      row.itemKind === "agentMessage" ||
      row.itemKind === "plan" ||
      row.itemKind === "reasoning"
    );
  }
  return (
    row.type === "item/agentMessage/delta" ||
    row.type === "item/plan/delta" ||
    row.type === "item/reasoning/summaryTextDelta" ||
    row.type === "item/reasoning/textDelta"
  );
}

/**
 * Makes a sequence-cut window own whole items rather than halves of them.
 *
 * A cut on a user message never lands inside an item. A cut on the event budget
 * does: an `npm run dev` that starts at sequence 2,706 and fails at 5,450
 * straddles any cut in between, and each side then projects its own row under
 * the same row id — one of them permanently "pending", and whichever the client
 * merges last wins.
 *
 * The rule is that an item belongs to the newest window holding any of its real
 * rows. So this window drops the items that a newer window will also show, and
 * backfills the earlier lifecycle rows of the ones it keeps. Background-task
 * items are left alone: they deliberately outlive their window and
 * {@link ensureTimelineWindowBackgroundTaskStateRows} already carries their
 * current state forward.
 */
function ensureSequenceWindowWholeItemRows(
  db: DbConnection,
  args: SequenceWindowItemRowsArgs,
): StoredEventRow[] {
  // Keyed by scoped identity, not by item id: providers reuse item ids across
  // turns (a resumed ACP session restarts its synthetic id counter), and a
  // thread-wide span for such an id makes every window disown the item.
  const windowItems = new Map<string, ScopedItemRef>();
  for (const row of args.rows) {
    if (
      row.itemId !== null &&
      row.itemKind !== "backgroundTask" &&
      row.sequence >= args.sequenceStart
    ) {
      const ref = storedEventRowItemRef(row);
      windowItems.set(scopedItemRefKey(ref), ref);
    }
  }
  if (windowItems.size === 0) {
    return [...args.rows];
  }

  // Spans, not lifecycle rows. An item emits between its start and its end —
  // output deltas, reasoning text, tool progress — and an unfinished item has
  // no end at all, so "does this item reach past the cut" cannot be answered
  // from `item/started` and `item/completed`.
  const spans = listItemEventSpansByItems(db, {
    items: [...windowItems.values()],
    threadId: args.threadId,
  });
  const itemKeysOwnedByNewerWindow = new Set<string>();
  const itemsStartingBeforeWindow = new Map<string, ScopedItemRef>();
  for (const span of spans) {
    const key = scopedItemRefKey(span);
    if (
      args.beforeSequence !== undefined &&
      span.maxSequence >= args.beforeSequence
    ) {
      itemKeysOwnedByNewerWindow.add(key);
      continue;
    }
    if (span.minSequence < args.sequenceStart) {
      itemsStartingBeforeWindow.set(key, {
        itemId: span.itemId,
        scopeKind: span.scopeKind,
        turnId: span.turnId,
      });
    }
  }

  const rows = args.rows.filter(
    (row) =>
      row.itemId === null ||
      !itemKeysOwnedByNewerWindow.has(
        scopedItemRefKey(storedEventRowItemRef(row)),
      ),
  );
  if (itemsStartingBeforeWindow.size === 0) {
    return rows;
  }

  // This window owns these items, so it needs the lifecycle rows that fell
  // below the cut — without them a finished command renders "pending" and
  // carries neither its command line nor its start time. Only the two lifecycle
  // types are fetched for ordinary items: the rest of what an item emitted
  // below the cut is the older page's content, and pulling all of it back would
  // restore exactly the unbounded read this window exists to avoid.
  //
  // Unfinished buffered text is the exception. Its deltas are the only current
  // snapshot of the message, so dropping the prefix would make text disappear
  // as the event-budget floor advances. Carry that one item's prefix into the
  // owning page until item/completed supplies the canonical final text.
  const backfillRows = listStoredItemLifecycleRowsByItems(db, {
    items: [...itemsStartingBeforeWindow.values()],
    maxInlineOutputChars: args.maxInlineOutputChars,
    threadId: args.threadId,
  }).filter((row) => row.sequence < args.sequenceStart);

  const completedItemKeys = new Set<string>();
  for (const row of [...rows, ...backfillRows]) {
    if (row.type === "item/completed" && row.itemId !== null) {
      completedItemKeys.add(scopedItemRefKey(storedEventRowItemRef(row)));
    }
  }
  // Delta rows are stored with a null itemKind, and providers may begin an
  // assistant, plan, or reasoning item with its first delta rather than an
  // item/started event. Classify from either the backfilled lifecycle row or
  // the in-window delta type so those delta-only items keep their prefix too.
  const bufferedTextItems = new Map<string, ScopedItemRef>();
  for (const row of [...backfillRows, ...rows]) {
    if (row.itemId === null || !rowIdentifiesBufferedTextItem(row)) {
      continue;
    }
    const ref = storedEventRowItemRef(row);
    const key = scopedItemRefKey(ref);
    if (!completedItemKeys.has(key) && itemsStartingBeforeWindow.has(key)) {
      bufferedTextItems.set(key, ref);
    }
  }
  const bufferedTextRows = listStoredBufferedTextDeltaRowsByItems(db, {
    beforeSequence: args.sequenceStart,
    items: [...bufferedTextItems.values()],
    threadId: args.threadId,
  });
  const prefixRows = [...backfillRows, ...bufferedTextRows];
  return prefixRows.length === 0
    ? rows
    : mergeStoredEventRowsById([...prefixRows, ...rows]);
}

/**
 * Background tasks outlive their spawning turn: a window containing an
 * in-flight task's item/started may end long before the task's thread-scoped
 * progress/completed rows. Backfill the latest state row per in-window item so
 * the page renders the task's current (possibly terminal) state instead of
 * pinning it "running" forever.
 */
function ensureTimelineWindowBackgroundTaskStateRows(
  db: DbConnection,
  args: TimelineWindowRowsArgs,
): StoredEventRow[] {
  const itemIds = new Set<string>();
  for (const row of args.rows) {
    if (row.itemKind === "backgroundTask" && row.itemId !== null) {
      itemIds.add(row.itemId);
    }
  }
  if (itemIds.size === 0) {
    return [...args.rows];
  }

  const stateRows = listLatestBackgroundTaskStateRowsByItemIds(db, {
    threadId: args.threadId,
    itemIds: [...itemIds],
  });
  if (stateRows.length === 0) {
    return [...args.rows];
  }

  return mergeStoredEventRowsById([...args.rows, ...stateRows]);
}

function ensureLatestTimelineOpenBackgroundTaskStateRows(
  db: DbConnection,
  args: TimelineWindowRowsArgs,
): StoredEventRow[] {
  const stateRows = listLatestOpenBackgroundTaskStateRowsForThread(db, {
    threadId: args.threadId,
  });
  if (stateRows.length === 0) {
    return [...args.rows];
  }

  return mergeStoredEventRowsById([...args.rows, ...stateRows]);
}

/**
 * Merges the rows that establish head-state banners into the latest window.
 *
 * The timeline response carries tail state (`pendingTodos`, `goal`) that
 * describes the head of the thread but is extracted by scanning whatever events
 * the window happens to contain. That is fine when the window reaches the start
 * of the thread, which is what an unbudgeted window does on the threads where
 * this matters — but an event-budgeted window can begin *after* the turn that
 * set the goal or wrote the todos, silently dropping the banner mid-session.
 *
 * Background tasks (and therefore the workflow banner, since local workflows
 * are stored as background-task items) already avoid this via
 * `ensureLatestTimelineOpenBackgroundTaskStateRows`. `modelFallback` is
 * self-limiting: it resets on every `client/turn/requested`, and the newest
 * anchor is always inside the window. `contextWindowUsage` has its own
 * thread-scoped query. These two were the remaining gaps.
 */
function ensureLatestTimelineHeadStateRows(
  db: DbConnection,
  args: TimelineWindowRowsArgs,
): StoredEventRow[] {
  const headStateRows = [
    ...listLatestGoalEventRowsByThreadIds(db, { threadIds: [args.threadId] }),
    ...listTodoSnapshotEventRowsForThread(db, { threadId: args.threadId }),
  ];
  if (headStateRows.length === 0) {
    return [...args.rows];
  }

  return mergeStoredEventRowsById([...args.rows, ...headStateRows]);
}

interface ResolveTimelineSegmentWindowArgs {
  /** Max events the window may span. */
  eventBudget: number;
  page: ThreadTimelinePageRequest;
  threadId: string;
}

interface ResolvedTimelineSegmentWindow {
  beforeSequence: number | undefined;
  byteWindowSequenceStart: number | null;
  /**
   * Whether the window boundary needs whole-item lifecycle closure.
   * See {@link ensureSequenceWindowWholeItemRows}.
   */
  requiresWholeItemClosure: boolean;
  /** Segments this page will actually return; ≤ `page.segmentLimit`. */
  effectiveSegmentLimit: number;
  hasAnchors: boolean;
  /** See {@link paginateTimelineRows}; non-null for a sequence-cut window. */
  sequenceWindowStart: TimelineSequenceWindowStart | null;
  /** See {@link paginateTimelineRows}; null when the sentinel infers it. */
  knownHasOlderSegments: boolean | null;
  oversizedEventPlaceholder: TimelineSystemRow | null;
  sequenceStart: number;
}

function applyTimelineWindowByteBudget(
  db: DbConnection,
  args: {
    maxInlineOutputChars: InlineOutputCharLimit;
    threadId: string;
    window: ResolvedTimelineSegmentWindow;
  },
): ResolvedTimelineSegmentWindow {
  const windowArgs = {
    beforeSequence: args.window.beforeSequence,
    excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    maxInlineOutputChars: args.maxInlineOutputChars,
    sequenceStart: args.window.sequenceStart,
    threadId: args.threadId,
  };
  const floor = findStoredTimelineWindowByteBudgetFloor(db, {
    ...windowArgs,
    maxDataBytes: THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT,
  });
  if (floor.kind === "single-event-too-large") {
    const hasOlderRows =
      floor.hasOlderRows || args.window.knownHasOlderSegments === true;
    return {
      ...args.window,
      byteWindowSequenceStart: floor.sequenceStart,
      knownHasOlderSegments: hasOlderRows,
      oversizedEventPlaceholder: {
        id: `${args.threadId}:oversized-event:${floor.sequenceStart}`,
        threadId: args.threadId,
        turnId: floor.turnId,
        sourceSeqStart: floor.sequenceStart,
        sourceSeqEnd: floor.sequenceStart,
        startedAt: floor.createdAt,
        createdAt: floor.createdAt,
        kind: "system",
        systemKind: "error",
        title: "Timeline event is too large to display",
        detail: `Event ${floor.sequenceStart} contains ${floor.eventDataBytes} bytes. BB omitted its content to keep this thread available.`,
        status: "error",
      },
      sequenceStart: floor.sequenceStart + 1,
      sequenceWindowStart: hasOlderRows
        ? {
            kind: "byte",
            sequenceStart: floor.sequenceStart,
            threadId: args.threadId,
          }
        : null,
    };
  }
  if (floor.kind === "fits") {
    return args.window;
  }

  return {
    ...args.window,
    byteWindowSequenceStart: floor.sequenceStart,
    requiresWholeItemClosure: true,
    sequenceWindowStart: {
      kind: "byte",
      sequenceStart: floor.sequenceStart,
      threadId: args.threadId,
    },
    knownHasOlderSegments: true,
    sequenceStart: floor.sequenceStart,
  };
}

interface ResolveTimelineWindowBoundsArgs {
  anchors: readonly StandardTimelineSegmentAnchorRow[];
  budgetFloorSequence: number | undefined;
  segmentLimit: number;
  threadId: string;
}

/**
 * Number of leading (newest) anchors whose segments fit inside the event
 * budget. Zero means the newest turn on its own is larger than the whole
 * budget, which can force a sequence-cut window below.
 */
function countAffordableAnchors(
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

/**
 * Where a page's window starts, given the anchors available to it.
 *
 * Normally that is an anchor: the oldest user message whose segment fits the
 * budget. When not one anchor fits, the newest turn alone is bigger than the
 * budget, and cutting on anchors bounds nothing — an agent working through a
 * 3,900-event turn re-reads and re-projects all of it on every update, and the
 * page reports no older rows, so nothing else can shrink it either. Such a
 * window starts at the budget floor instead, mid-turn, and pages backwards from
 * there.
 *
 * This event-count pass cuts only an unfinished turn. A finished turn collapses
 * into one summary row. The later byte-budget pass can cut either turn state.
 * The memory limit must take priority over the summary boundary.
 *
 * One row is still turn-scoped rather than per-item across an unfinished turn:
 * the context-compaction banner is keyed by turn id, deliberately, so a
 * `thread/compacted` event with no item id can join its lifecycle rows. A turn
 * that compacts twice on opposite sides of the cut therefore emits the banner
 * from both pages instead of once. The client keys rows by id and renders one,
 * so the effect is which of the two compactions it is dated from.
 *
 * Delegation children are another aggregate, but one that cannot tolerate the
 * same duplicate-id merge: each page would hold a different `childRows` subset
 * under the same parent row and the client would discard one. Parent closure
 * also follows every descendant without sequence bounds, so pretending to cut
 * there would silently restore the unbounded read. A cut crossed by a parented
 * event therefore keeps the whole turn, just like a finished turn, until
 * nested delegation rows have their own pagination contract.
 */
function resolveTimelineWindowBounds(
  db: DbConnection,
  args: ResolveTimelineWindowBoundsArgs,
): Pick<
  ResolvedTimelineSegmentWindow,
  "effectiveSegmentLimit" | "sequenceStart" | "sequenceWindowStart"
> & { affordableAnchorCount: number } {
  const { anchors, budgetFloorSequence, segmentLimit, threadId } = args;
  const affordable = countAffordableAnchors(
    anchors,
    budgetFloorSequence,
    segmentLimit,
  );
  const unfinishedTurnId =
    affordable === 0 && budgetFloorSequence !== undefined
      ? findUnfinishedTurnCoveringSequence(db, {
          sequence: budgetFloorSequence,
          threadId,
        })
      : null;
  if (
    affordable === 0 &&
    budgetFloorSequence !== undefined &&
    unfinishedTurnId !== null &&
    !hasParentedEventCrossingSequence(db, {
      sequence: budgetFloorSequence,
      threadId,
    })
  ) {
    return {
      affordableAnchorCount: 0,
      effectiveSegmentLimit: segmentLimit,
      sequenceWindowStart: {
        kind: "event",
        sequenceStart: budgetFloorSequence,
        threadId,
      },
      sequenceStart: budgetFloorSequence,
    };
  }

  // At least one segment always comes back: returning zero would present an
  // empty thread rather than a slow one.
  const segmentCount = Math.max(1, affordable);
  return {
    affordableAnchorCount: segmentCount,
    effectiveSegmentLimit: segmentCount,
    sequenceWindowStart: null,
    sequenceStart: anchors[segmentCount - 1]?.sequence ?? 0,
  };
}

/**
 * Resolves the event-sequence window for a timeline page from segment anchors,
 * touching only the ~`segmentLimit` anchors around the page rather than every
 * anchor in the thread. `hasAnchors` is false only when the thread has no
 * qualifying anchors at all; a stale cursor (anchors exist but the cursor's
 * anchor is gone) throws, matching the previous behavior.
 *
 * Segment count alone is a weak bound on work: anchors are user messages, and
 * an agentic turn can be thousands of events, so "the last 20 turns" routinely
 * means "the entire thread". When `eventBudget` is set the window is
 * additionally clamped to that many events, and the page returns however many
 * whole segments fit.
 */
function resolveTimelineSegmentWindow(
  db: DbConnection,
  args: ResolveTimelineSegmentWindowArgs,
): ResolvedTimelineSegmentWindow {
  const { eventBudget, page, threadId } = args;
  const noAnchors: ResolvedTimelineSegmentWindow = {
    beforeSequence: undefined,
    byteWindowSequenceStart: null,
    requiresWholeItemClosure: false,
    effectiveSegmentLimit: page.segmentLimit,
    hasAnchors: false,
    sequenceWindowStart: null,
    knownHasOlderSegments: null,
    oversizedEventPlaceholder: null,
    sequenceStart: 0,
  };

  if (page.kind === "older") {
    const cursor = page.beforeCursor;
    const sequenceCursor = readSequenceCursor(cursor, threadId);
    if (sequenceCursor === null) {
      const cursorAnchor = getTimelineSegmentAnchorAtSequence(db, {
        sequence: cursor.anchorSeq,
        threadId,
      });
      if (!cursorAnchor || cursorAnchor.rowId !== cursor.anchorId) {
        const anyAnchor = listTimelineSegmentAnchorsDescending(db, {
          limit: 1,
          threadId,
        });
        if (anyAnchor.length === 0) {
          return noAnchors;
        }
        // A cursor whose sequence still exists is one this server issued from a
        // page it built; only the *anchor* predicate no longer agrees that the
        // row there starts a segment. That disagreement is possible because the
        // predicate is SQL and the projection is not — a steer accepted into a
        // turn other than the one it named is a user message to the projection
        // and not an anchor here — and refusing the cursor over it strands
        // every older page behind it. The window is defined by the sequence, so
        // honour it. A cursor naming no event at all is genuinely stale.
        if (
          !isTimelineCursorSequencePresent(db, {
            sequence: cursor.anchorSeq,
            threadId,
          })
        ) {
          throw new ApiError(
            400,
            "invalid_request",
            "Timeline pagination cursor is no longer available",
          );
        }
      }
    } else if (
      !isTimelineCursorSequencePresent(db, {
        sequence: sequenceCursor.sequenceStart,
        threadId,
      })
    ) {
      // A sequence cursor names no stored row, so this is the only check that it
      // came from a page rather than from a client picking a number.
      throw new ApiError(
        400,
        "invalid_request",
        "Timeline pagination cursor is no longer available",
      );
    }
    const precedingAnchors = listTimelineSegmentAnchorsDescending(db, {
      beforeSequence: cursor.anchorSeq,
      limit: page.segmentLimit + 1,
      threadId,
    });
    const bounds = resolveTimelineWindowBounds(db, {
      anchors: precedingAnchors,
      budgetFloorSequence: findTimelineWindowBudgetFloorSequence(db, {
        beforeSequence: cursor.anchorSeq,
        eventBudget,
        excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
        threadId,
      }),
      segmentLimit: page.segmentLimit,
      threadId,
    });
    return {
      // Every cursor names the first sequence the page that issued it covered,
      // so this page ends exactly there. Reading up to the *next anchor* past
      // the cursor instead — and trimming that segment off after projecting it
      // — meant an older page read one whole extra segment beyond its budget:
      // on a thread with a 3,900-event turn, 5,513 events against a budget of
      // 1,500, all to discard the surplus.
      beforeSequence: cursor.anchorSeq,
      byteWindowSequenceStart:
        sequenceCursor?.kind === "byte" ? bounds.sequenceStart : null,
      requiresWholeItemClosure:
        sequenceCursor !== null || bounds.sequenceWindowStart !== null,
      effectiveSegmentLimit: bounds.effectiveSegmentLimit,
      hasAnchors: true,
      sequenceWindowStart: bounds.sequenceWindowStart,
      knownHasOlderSegments:
        precedingAnchors.length > bounds.affordableAnchorCount,
      oversizedEventPlaceholder: null,
      sequenceStart: bounds.sequenceStart,
    };
  }

  const newestAnchors = listTimelineSegmentAnchorsDescending(db, {
    limit: page.segmentLimit + 1,
    threadId,
  });
  if (newestAnchors.length === 0) {
    return noAnchors;
  }
  const bounds = resolveTimelineWindowBounds(db, {
    anchors: newestAnchors,
    budgetFloorSequence: findTimelineWindowBudgetFloorSequence(db, {
      eventBudget,
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
      threadId,
    }),
    segmentLimit: page.segmentLimit,
    threadId,
  });
  return {
    beforeSequence: undefined,
    byteWindowSequenceStart: null,
    requiresWholeItemClosure: bounds.sequenceWindowStart !== null,
    effectiveSegmentLimit: bounds.effectiveSegmentLimit,
    hasAnchors: true,
    sequenceWindowStart: bounds.sequenceWindowStart,
    // Budgeted windows read exactly the segments they return, so "is there
    // more" comes from the anchor list rather than an over-read segment.
    knownHasOlderSegments: newestAnchors.length > bounds.affordableAnchorCount,
    oversizedEventPlaceholder: null,
    sequenceStart: bounds.sequenceStart,
  };
}

function selectStandardTimelineEventRows(
  db: DbConnection,
  thread: Thread,
  page: ThreadTimelinePageRequest,
  eventBudget: number,
  maxInlineOutputChars: InlineOutputCharLimit,
): TimelineEventRowSelection {
  const window = applyTimelineWindowByteBudget(db, {
    maxInlineOutputChars,
    threadId: thread.id,
    window: resolveTimelineSegmentWindow(db, {
      eventBudget,
      page,
      threadId: thread.id,
    }),
  });
  if (
    !window.hasAnchors &&
    window.sequenceWindowStart === null &&
    window.byteWindowSequenceStart === null
  ) {
    return selectFullTimelineEventRows(db, thread, page, maxInlineOutputChars);
  }

  const beforeSequence = window.beforeSequence;
  const sequenceStart = window.sequenceStart;

  const windowArgs = {
    beforeSequence,
    excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    maxInlineOutputChars,
    sequenceStart,
    threadId: thread.id,
  };
  const windowRows = listStoredTimelineWindowEventRows(db, windowArgs);
  const wholeItemWindowRows = window.requiresWholeItemClosure
    ? ensureSequenceWindowWholeItemRows(db, {
        beforeSequence,
        maxInlineOutputChars,
        rows: windowRows,
        sequenceStart,
        threadId: thread.id,
      })
    : windowRows;
  const selectedRowsWithTurnStarts = ensureTimelineWindowTurnStartedRows(db, {
    threadId: thread.id,
    rows: wholeItemWindowRows,
  });
  const selectedRowsWithTurnLifecycle =
    window.byteWindowSequenceStart === null
      ? selectedRowsWithTurnStarts
      : ensureSequenceWindowTurnCompletedRows(db, {
          threadId: thread.id,
          rows: selectedRowsWithTurnStarts,
        });
  const selectedRowsWithInWindowTaskState =
    ensureTimelineWindowBackgroundTaskStateRows(db, {
      threadId: thread.id,
      rows: selectedRowsWithTurnLifecycle,
    });
  const selectedRows =
    page.kind === "latest"
      ? ensureLatestTimelineHeadStateRows(db, {
          threadId: thread.id,
          rows: ensureLatestTimelineOpenBackgroundTaskStateRows(db, {
            threadId: thread.id,
            rows: selectedRowsWithInWindowTaskState,
          }),
        })
      : selectedRowsWithInWindowTaskState;
  const selectedRowsWithParentedContext = ensureTimelineWindowParentedRows(db, {
    maxInlineOutputChars,
    sequenceBounds:
      window.byteWindowSequenceStart === null
        ? null
        : { beforeSequence, sequenceStart },
    threadId: thread.id,
    rows: selectedRows,
  });
  const selectedRowsWithParentedTurnStarts =
    ensureTimelineWindowTurnStartedRows(db, {
      threadId: thread.id,
      rows: selectedRowsWithParentedContext.rows,
    });
  const selectedRowsWithParentedTurnLifecycle =
    window.byteWindowSequenceStart === null
      ? selectedRowsWithParentedTurnStarts
      : ensureSequenceWindowTurnCompletedRows(db, {
          threadId: thread.id,
          rows: selectedRowsWithParentedTurnStarts,
        });

  return {
    byteWindowSequenceEnd:
      window.byteWindowSequenceStart === null
        ? null
        : (wholeItemWindowRows.at(-1)?.sequence ??
          window.byteWindowSequenceStart),
    byteWindowSequenceStart: window.byteWindowSequenceStart,
    contextOnlyToolCallIds:
      window.byteWindowSequenceStart === null
        ? selectedRowsWithParentedContext.contextOnlyToolCallIds
        : new Set(),
    sequenceWindowStart: window.sequenceWindowStart,
    knownHasOlderSegments: window.knownHasOlderSegments,
    paginationPage:
      page.kind === "older"
        ? { ...page, segmentLimit: window.effectiveSegmentLimit }
        : {
            kind: "latest",
            segmentLimit: window.effectiveSegmentLimit,
          },
    responsePageKind: page.kind,
    oversizedEventPlaceholder: window.oversizedEventPlaceholder,
    rows: selectedRowsWithParentedTurnLifecycle,
    strategy:
      sequenceStart === 0 && beforeSequence === undefined
        ? "full"
        : "standard-window",
  };
}

function selectTimelineEventRows(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineInternalOptions,
): TimelineEventRowSelection {
  return selectStandardTimelineEventRows(
    db,
    thread,
    options.page,
    options.eventBudget,
    options.maxInlineOutputChars,
  );
}

function byteLengthOfStoredEventRows(rows: readonly StoredEventRow[]): number {
  let byteLength = 0;
  for (const row of rows) {
    byteLength += Buffer.byteLength(row.data, "utf8");
  }
  return byteLength;
}

function buildSequencePageTimelineRows(
  rows: readonly TimelineRow[],
  selection: TimelineEventRowSelection,
): TimelineRow[] {
  const rowsWithPlaceholder = selection.oversizedEventPlaceholder
    ? [...rows, selection.oversizedEventPlaceholder].sort(
        (left, right) => left.sourceSeqStart - right.sourceSeqStart,
      )
    : [...rows];
  if (selection.byteWindowSequenceStart === null) {
    return rowsWithPlaceholder;
  }

  const suffix =
    selection.responsePageKind === "latest"
      ? ""
      : `:sequence-page:${selection.byteWindowSequenceStart}`;
  return rowsWithPlaceholder.flatMap((row): TimelineRow[] => {
    if (
      row.kind !== "turn" ||
      selection.byteWindowSequenceEnd === null ||
      selection.byteWindowSequenceStart === null
    ) {
      return [{ ...row, id: `${row.id}${suffix}` }];
    }
    const sourceSeqStart = Math.max(
      row.sourceSeqStart,
      selection.byteWindowSequenceStart,
    );
    const sourceSeqEnd = Math.min(
      row.sourceSeqEnd,
      selection.byteWindowSequenceEnd,
    );
    if (sourceSeqStart > sourceSeqEnd) {
      // A finished turn with no event inside this byte window is closure
      // context, not page content: the window's rows carried a
      // `parentToolCallId` (a workflow's progress snapshots name the Workflow
      // call in the turn that started it), parent closure pulled that tool
      // call in, and turn lifecycle closure completed the turn around it. The
      // page that holds the turn's own events renders its summary; emitting
      // it here too gives every byte page another "Worked for" row under a
      // page-unique id.
      return [];
    }
    return [
      {
        ...row,
        id: `${row.id}${suffix}`,
        sourceSeqEnd,
        sourceSeqStart,
      },
    ];
  });
}

function createThreadTimelineBuildProfileAccumulator(): ThreadTimelineBuildProfileAccumulator {
  return {
    compactedEventCount: 0,
    contextWindowEventDataBytes: 0,
    contextWindowEventRowCount: 0,
    decodedEventCount: 0,
    eventDataBytes: 0,
    eventRowCount: 0,
    projectedRowCount: 0,
    responseJsonBytes: null,
    responseRowCount: 0,
    returnedSegmentCount: 0,
    selectionStrategy: "full",
    stageTimings: [],
  };
}

function measureThreadTimelineStage<TResult>(
  profile: ThreadTimelineBuildProfileAccumulator | null,
  stage: ThreadTimelineBuildProfileStage,
  fn: () => TResult,
): TResult {
  if (!profile) {
    return fn();
  }

  const startTime = performance.now();
  const result = fn();
  profile.stageTimings.push({
    durationMs: performance.now() - startTime,
    stage,
  });
  return result;
}

function completeThreadTimelineBuildProfile(
  accumulator: ThreadTimelineBuildProfileAccumulator,
  options: BuildThreadTimelineInternalOptions,
  response: ThreadTimelineResponse,
): ThreadTimelineBuildProfile {
  if (options.measureResponseBytes) {
    accumulator.responseJsonBytes = measureThreadTimelineStage(
      accumulator,
      "response-serialization",
      () => Buffer.byteLength(JSON.stringify(response), "utf8"),
    );
  }
  return {
    compactedEventCount: accumulator.compactedEventCount,
    contextWindowEventDataBytes: accumulator.contextWindowEventDataBytes,
    contextWindowEventRowCount: accumulator.contextWindowEventRowCount,
    decodedEventCount: accumulator.decodedEventCount,
    eventDataBytes: accumulator.eventDataBytes,
    eventRowCount: accumulator.eventRowCount,
    pageKind: options.page.kind,
    projectedRowCount: accumulator.projectedRowCount,
    responseJsonBytes: accumulator.responseJsonBytes,
    responseRowCount: accumulator.responseRowCount,
    returnedSegmentCount: accumulator.returnedSegmentCount,
    segmentLimit: options.page.segmentLimit,
    selectionStrategy: accumulator.selectionStrategy,
    stageTimings: accumulator.stageTimings,
    totalDurationMs: roundDurationMs(
      accumulator.stageTimings.reduce(
        (total, timing) => total + timing.durationMs,
        0,
      ),
    ),
  };
}

function buildThreadTimelineInternal(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineInternalOptions,
): BuildThreadTimelineInternalResult {
  const profile = options.includeProfile
    ? createThreadTimelineBuildProfileAccumulator()
    : null;
  const includeNestedRows = options.includeNestedRows ?? false;
  const includeProviderUnhandledOperations =
    options.includeProviderUnhandledOperations;
  const eventSelection = measureThreadTimelineStage(
    profile,
    "event-query",
    () => selectTimelineEventRows(db, thread, options),
  );
  const rawEventRows = eventSelection.rows;
  if (profile) {
    profile.eventDataBytes = byteLengthOfStoredEventRows(rawEventRows);
    profile.eventRowCount = rawEventRows.length;
    profile.selectionStrategy = eventSelection.strategy;
  }
  const acceptedClientRequestContextRows = measureThreadTimelineStage(
    profile,
    "accepted-client-request-context-query",
    () =>
      selectClientRequestContextRows(db, {
        rows: rawEventRows,
        threadId: thread.id,
      }),
  );
  const decodedRawEvents = measureThreadTimelineStage(
    profile,
    "event-json-decode",
    () => rawEventRows.map((row) => toThreadEventWithMeta(row)),
  );
  if (profile) {
    profile.decodedEventCount = decodedRawEvents.length;
  }
  const decodedEvents = measureThreadTimelineStage(
    profile,
    "summary-compaction",
    () => compactThreadTimelineSummaryEvents(decodedRawEvents),
  );
  if (profile) {
    profile.compactedEventCount = decodedEvents.length;
  }
  const contextWindowUsageRows = measureThreadTimelineStage(
    profile,
    "context-window-query",
    () =>
      listContextWindowUsageRows(db, {
        threadId: thread.id,
      }),
  );
  if (profile) {
    profile.contextWindowEventDataBytes = byteLengthOfStoredEventRows(
      contextWindowUsageRows,
    );
    profile.contextWindowEventRowCount = contextWindowUsageRows.length;
  }
  const commonProjectionOptions = {
    includeDebugRawEvents: false,
    includeProviderUnhandledOperations,
    isLatestPage: options.page.kind === "latest",
    providerDisplayName: options.providerDisplayName,
    planCommand: options.planCommand,
    threadStatus: thread.status,
    threadName: thread.title ?? thread.titleFallback ?? "",
    workspaceRoot: resolveThreadWorkspaceRoot(db, thread),
  };
  const contextWindowEvents = measureThreadTimelineStage(
    profile,
    "context-window-json-decode",
    () => contextWindowUsageRows.map((row) => toThreadEventWithMeta(row)),
  );
  const acceptedClientRequestContext: AcceptedClientRequestContext = {
    acceptedClientRequestEvents:
      acceptedClientRequestContextRows.acceptedRows.map((row) =>
        toThreadEventWithMeta(row),
      ),
    rejectedClientRequestEvents:
      acceptedClientRequestContextRows.rejectedRows.map((row) =>
        toThreadEventWithMeta(row),
      ),
  };
  const timeline = measureThreadTimelineStage(
    profile,
    "thread-view-projection",
    () =>
      buildThreadTimelineFromEvents({
        acceptedClientRequestContext,
        contextWindowEvents,
        events: decodedEvents,
        options: {
          ...commonProjectionOptions,
          contextOnlyToolCallIds: eventSelection.contextOnlyToolCallIds,
          includeNestedRows,
          providerId: thread.providerId,
          turnMessageDetail: includeNestedRows ? "full" : "summary",
        },
      }),
  );
  const projectedTimelineRows = buildSequencePageTimelineRows(
    timeline.rows,
    eventSelection,
  );
  if (profile) {
    profile.projectedRowCount = projectedTimelineRows.length;
  }
  const paginatedTimeline = measureThreadTimelineStage(
    profile,
    "pagination-segmentation",
    () =>
      paginateTimelineRows({
        sequenceWindowStart: eventSelection.sequenceWindowStart,
        knownHasOlderSegments: eventSelection.knownHasOlderSegments,
        page: eventSelection.paginationPage,
        rows: projectedTimelineRows,
      }),
  );
  if (profile) {
    profile.responseRowCount = paginatedTimeline.rows.length;
    profile.returnedSegmentCount = paginatedTimeline.returnedSegmentCount;
  }

  const response: ThreadTimelineResponse = {
    maxSeq: options.maxSeq,
    rows: options.summaryOnly ? [] : paginatedTimeline.rows,
    activePromptMode:
      options.page.kind === "latest" ? timeline.activePromptMode : null,
    activeThinking:
      options.page.kind === "latest" ? timeline.activeThinking : null,
    activeWorkflows:
      options.page.kind === "latest" ? timeline.activeWorkflows : [],
    activeBackgroundCommands:
      options.page.kind === "latest" ? timeline.activeBackgroundCommands : [],
    // pendingTodos is gated inside the projection via `isLatestPage` so the
    // extraction work is skipped on older-page requests entirely; no
    // post-hoc null-out needed here.
    pendingTodos: timeline.pendingTodos,
    goal: timeline.goal,
    modelFallback:
      options.page.kind === "latest" ? timeline.modelFallback : null,
    contextWindowUsage:
      options.page.kind === "latest"
        ? (timeline.contextWindowUsage ?? undefined)
        : undefined,
    timelinePage: {
      kind: eventSelection.responsePageKind,
      // Echo what the client asked for, not the budget-reduced limit actually
      // applied. `segmentLimit` is the request's page size; reporting a
      // shrunken value would make an unchanged request look like it changed
      // and invites clients to re-request with the reduced number.
      // `returnedSegmentCount` already reports what came back.
      segmentLimit: options.page.segmentLimit,
      returnedSegmentCount: paginatedTimeline.returnedSegmentCount,
      hasOlderRows: paginatedTimeline.hasOlderRows,
      olderCursor: paginatedTimeline.olderCursor,
    },
  };
  return {
    response,
    profile:
      profile === null
        ? null
        : completeThreadTimelineBuildProfile(profile, options, response),
  };
}

export function buildThreadTimeline(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineOptions,
): ThreadTimelineResponse {
  return runEventLoopWorkSync(
    `timeline-build ${thread.id}`,
    () =>
      buildThreadTimelineInternal(db, thread, {
        ...options,
        includeProfile: false,
        measureResponseBytes: false,
      }).response,
  );
}

/**
 * Slower than {@link buildThreadTimeline} only by the cost of ~9
 * `performance.now()` pairs, so callers on the request path can always profile
 * and decide afterwards whether the result is worth logging.
 */
export function buildThreadTimelineWithProfile(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineOptions,
): { profile: ThreadTimelineBuildProfile; response: ThreadTimelineResponse } {
  return runEventLoopWorkSync(`timeline-build ${thread.id}`, () => {
    const result = buildThreadTimelineInternal(db, thread, {
      ...options,
      includeProfile: true,
      measureResponseBytes: false,
    });
    if (result.profile === null) {
      throw new Error("Profiled timeline build returned no profile");
    }
    return { profile: result.profile, response: result.response };
  });
}

export interface BuildThreadConversationOutlineOptions {
  /** Thread high-water event sequence this outline reflects (echoed to clients). */
  maxSeq: number;
  providerDisplayName?: string;
}

const CONVERSATION_OUTLINE_PREVIEW_MAX_LENGTH = 200;

function toConversationOutlinePreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= CONVERSATION_OUTLINE_PREVIEW_MAX_LENGTH) {
    return normalized;
  }
  return normalized.slice(0, CONVERSATION_OUTLINE_PREVIEW_MAX_LENGTH).trimEnd();
}

function toConversationOutlineAttachmentSummary(
  attachments: TimelineConversationAttachments | null,
): ThreadConversationOutlineAttachmentSummary | null {
  if (!attachments) {
    return null;
  }
  const imageCount = attachments.webImages + attachments.localImages;
  const fileCount = attachments.localFiles;
  if (imageCount === 0 && fileCount === 0) {
    return null;
  }
  return { imageCount, fileCount };
}

/**
 * Projects the entire thread into a lightweight conversation outline for the
 * table-of-contents minimap. Unlike {@link buildThreadTimeline}, this is not
 * paginated: it reads every outline-relevant event across the full history,
 * reusing the same {@link buildThreadTimelineFromEvents} projection so each
 * outline item's `id` is identical to the timeline row it represents. That
 * identity is what lets the minimap scroll-spy the loaded window and jump to a
 * message once it is paginated in. Only conversation rows survive, and each is
 * reduced to the few fields the minimap renders.
 */
export function buildThreadConversationOutline(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadConversationOutlineOptions,
): ThreadConversationOutlineResponse {
  return runEventLoopWorkSync(`conversation-outline ${thread.id}`, () => {
    const rawEventRows = listStoredConversationOutlineEventRows(db, {
      threadId: thread.id,
    });
    const decodedRawEvents = rawEventRows.map((row) =>
      toThreadEventWithMeta(row),
    );
    const decodedEvents = compactThreadTimelineSummaryEvents(decodedRawEvents);
    const clientRequestContextRows = selectClientRequestContextRows(db, {
      rows: rawEventRows,
      threadId: thread.id,
    });
    const acceptedClientRequestContext: AcceptedClientRequestContext = {
      acceptedClientRequestEvents: clientRequestContextRows.acceptedRows.map(
        (row) => toThreadEventWithMeta(row),
      ),
      rejectedClientRequestEvents: clientRequestContextRows.rejectedRows.map(
        (row) => toThreadEventWithMeta(row),
      ),
    };
    const timeline = buildThreadTimelineFromEvents({
      acceptedClientRequestContext,
      contextWindowEvents: [],
      events: decodedEvents,
      options: {
        includeDebugRawEvents: false,
        includeNestedRows: false,
        includeProviderUnhandledOperations: false,
        isLatestPage: true,
        providerDisplayName: options.providerDisplayName,
        providerId: thread.providerId,
        threadName: thread.title ?? thread.titleFallback ?? "",
        threadStatus: thread.status,
        turnMessageDetail: "summary",
        workspaceRoot: resolveThreadWorkspaceRoot(db, thread),
      },
    });
    const items: ThreadConversationOutlineItem[] = [];
    for (const row of timeline.rows) {
      if (row.kind !== "conversation") {
        continue;
      }
      items.push({
        id: row.id,
        role: row.role,
        preview: toConversationOutlinePreview(row.text),
        attachmentSummary: toConversationOutlineAttachmentSummary(
          row.attachments,
        ),
      });
    }
    return { items, maxSeq: options.maxSeq };
  });
}

export function buildTimelineTurnSummaryDetails(
  db: DbConnection,
  thread: Thread,
  options: BuildTimelineTurnSummaryDetailsOptions,
): TimelineTurnSummaryDetailsResponse {
  if (options.sourceSeqStart > options.sourceSeqEnd) {
    throw new ApiError(
      400,
      "invalid_request",
      "sourceSeqStart must be less than or equal to sourceSeqEnd",
    );
  }

  const includeProviderUnhandledOperations =
    options.includeProviderUnhandledOperations;
  const detailsWindow = {
    beforeSequence: options.sourceSeqEnd + 1,
    excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    sequenceStart: options.sourceSeqStart,
    threadId: thread.id,
  };
  const fullDetailsFloor = findStoredTimelineWindowByteBudgetFloor(db, {
    ...detailsWindow,
    maxDataBytes: THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT,
    maxInlineOutputChars: null,
  });
  let detailsInlineOutputLimit: InlineOutputCharLimit = null;
  if (fullDetailsFloor.kind !== "fits") {
    detailsInlineOutputLimit = DEFAULT_MAX_INLINE_OUTPUT_CHARS;
    const cappedDetailsFloor = findStoredTimelineWindowByteBudgetFloor(db, {
      ...detailsWindow,
      maxDataBytes: THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT,
      maxInlineOutputChars: detailsInlineOutputLimit,
    });
    if (cappedDetailsFloor.kind !== "fits") {
      throw new ApiError(
        413,
        "timeline_window_too_large",
        "Timeline turn details exceed the safe response limit",
      );
    }
  }
  const exactEventRows = listStoredTimelineWindowEventRows(db, {
    ...detailsWindow,
    maxInlineOutputChars: detailsInlineOutputLimit,
  });
  const clientRequestIds = listStoredClientTurnRequestIdsInRange(db, {
    threadId: thread.id,
    seqStart: options.sourceSeqStart,
    seqEnd: options.sourceSeqEnd,
  });
  const exactAcceptedInputRows = exactEventRows.filter(
    (row) => row.type === "turn/input/accepted",
  );
  const futureAcceptedInputRows =
    listStoredTurnInputAcceptedRowsByClientRequestIds(db, {
      threadId: thread.id,
      afterSequence: options.sourceSeqEnd,
      clientRequestIds,
    });
  const acceptedInputRowsByTurn = partitionAcceptedInputRowsByRequestedTurn({
    acceptedInputRows: [...exactAcceptedInputRows, ...futureAcceptedInputRows],
    turnId: options.turnId,
  });
  const exactEventRowsForRequestedTurn = filterExactEventRowsForRequestedTurn({
    acceptedClientRequestIdsForOtherTurns:
      acceptedInputRowsByTurn.acceptedClientRequestIdsForOtherTurns,
    exactEventRows,
    turnId: options.turnId,
  });
  const eventRows = mergeStoredEventRowsById([
    ...exactEventRowsForRequestedTurn.rows,
    ...acceptedInputRowsByTurn.requestedTurnRows,
  ]);

  const hasTurnScopedRowsForRequestedTurn = eventRows.some(
    (row) => row.scopeKind === "turn" && row.turnId === options.turnId,
  );
  if (!hasTurnScopedRowsForRequestedTurn) {
    throw new ApiError(
      400,
      "invalid_request",
      `Timeline turn summary details range ${options.sourceSeqStart}-${options.sourceSeqEnd} does not include turn ${options.turnId}`,
    );
  }

  const hasCurrentStartedRow = eventRows.some(
    (row) => row.type === "turn/started" && row.turnId === options.turnId,
  );
  const contextSequenceCutoff = eventRows.reduce(
    (maxSequence, row) => Math.max(maxSequence, row.sequence),
    options.sourceSeqEnd,
  );
  // Summary rows can cover a segment inside a turn. Once the selected rows are
  // validated against the requested turn, that turn's start must be at or
  // before the latest selected turn row. Accepted input rows may sit after
  // sourceSeqEnd, so the lifecycle lookup uses the widened context cutoff.
  const requestedTurnStartedRows = hasCurrentStartedRow
    ? []
    : listStoredTurnStartedRowsByTurnIdsUpToSequence(db, {
        threadId: thread.id,
        sequenceCutoff: contextSequenceCutoff,
        turnIds: [options.turnId],
      });
  if (!hasCurrentStartedRow && requestedTurnStartedRows.length === 0) {
    throw new ApiError(
      400,
      "invalid_request",
      `Timeline turn summary details range ${options.sourceSeqStart}-${options.sourceSeqEnd} cannot resolve turn/started for ${options.turnId}`,
    );
  }
  const sourceRange = resolveTurnSummaryDetailsSourceRange({
    exactEventRows: exactEventRowsForRequestedTurn.rows,
    fallbackRange: {
      sourceSeqEnd: options.sourceSeqEnd,
      sourceSeqStart: options.sourceSeqStart,
      turnId: options.turnId,
    },
    useExactEventRowBounds: exactEventRowsForRequestedTurn.removedRows,
  });
  // The same whole-item ownership rule the timeline window applies, for the
  // same reason. A byte cut can fall between an item's `item/started` and its
  // `item/completed`, and the timeline gives such an item to the newest slice.
  // Without the rule here, the older slice's details project the item from its
  // `item/started` row alone and render it "pending" after the turn finished.
  const wholeItemEventRows = ensureSequenceWindowWholeItemRows(db, {
    beforeSequence: detailsWindow.beforeSequence,
    maxInlineOutputChars: detailsInlineOutputLimit,
    rows: mergeStoredEventRowsById([...requestedTurnStartedRows, ...eventRows]),
    sequenceStart: detailsWindow.sequenceStart,
    threadId: thread.id,
  });
  // The floor queries measured the slice before closure, and closure backfills
  // the earlier lifecycle rows of the items this slice owns. Measure what the
  // route actually holds, so the parent expansion spends what is left rather
  // than a pre-closure estimate of it. The subtraction may go negative, which
  // is the safe direction: the parent fetch then stays inside its bounds.
  const detailsEventDataBytes =
    byteLengthOfStoredEventRows(wholeItemEventRows);
  const eventRowsWithParentedChildren = ensureTimelineWindowParentedRows(db, {
    maxInlineOutputChars: detailsInlineOutputLimit,
    outOfBoundsChildDataByteLimit:
      THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT - detailsEventDataBytes,
    sequenceBounds: {
      beforeSequence: detailsWindow.beforeSequence,
      sequenceStart: detailsWindow.sequenceStart,
    },
    threadId: thread.id,
    rows: wholeItemEventRows,
  }).rows;
  const eventRowsWithTurnStarts = ensureTimelineWindowTurnStartedRows(db, {
    threadId: thread.id,
    rows: eventRowsWithParentedChildren,
  });
  const eventRowsWithBackgroundTaskState =
    ensureTimelineWindowBackgroundTaskStateRows(db, {
      threadId: thread.id,
      rows: eventRowsWithTurnStarts,
    });
  const projectionSourceSeqStart = eventRowsWithTurnStarts.reduce(
    (sourceSeqStart, row) =>
      row.type === "turn/started" && row.turnId === options.turnId
        ? Math.min(sourceSeqStart, row.sequence)
        : sourceSeqStart,
    sourceRange.sourceSeqStart,
  );
  const children = buildThreadTimelineTurnDetailsFromEvents({
    events: eventRowsWithBackgroundTaskState.map((row) =>
      toThreadEventWithMeta(row),
    ),
    options: {
      includeProviderUnhandledOperations,
      sourceSeqEnd: sourceRange.sourceSeqEnd,
      sourceSeqStart: projectionSourceSeqStart,
      providerDisplayName: options.providerDisplayName,
      threadStatus: thread.status,
      threadName: thread.title ?? thread.titleFallback ?? "",
      workspaceRoot: resolveThreadWorkspaceRoot(db, thread),
    },
  });

  if (children.kind !== "missing-match") {
    return {
      rows: children.rows,
    };
  }

  throw new Error(
    `Timeline turn summary details could not match range ${options.sourceSeqStart}-${options.sourceSeqEnd}`,
  );
}
