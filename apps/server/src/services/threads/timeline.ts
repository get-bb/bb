import {
  buildThreadTimelineFromEvents,
  THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
  buildThreadTimelineTurnDetailsFromEvents,
  compactThreadTimelineSummaryEvents,
  type AcceptedClientRequestContext,
  type ThreadEventWithMeta,
} from "@bb/thread-view";
import type { ClientTurnRequestId, Thread } from "@bb/domain";
import type {
  TimelinePaginationCursor,
  ThreadTimelineResponse,
  TimelineTurnSummaryDetailsResponse,
} from "@bb/server-contract";
import {
  findTimelineSegmentAnchorSequenceAfter,
  getEnvironment,
  getTimelineSegmentAnchorAtSequence,
  listContextWindowUsageRows,
  listRecentStoredEventRows,
  listStoredClientTurnRequestIdsInRange,
  listStoredEventRowsByParentToolCallIds,
  listStoredEventRowsInRange,
  listLatestBackgroundTaskStateRowsByItemIds,
  listLatestOpenBackgroundTaskStateRowsForThread,
  listStoredTimelineWindowEventRows,
  listStoredToolCallRowsByItemIds,
  listStoredTurnInputAcceptedRowsByClientRequestIds,
  listStoredTurnStartedRowsByTurnIdsUpToSequence,
  listTimelineSegmentAnchorsDescending,
} from "@bb/db";
import type { DbConnection, StoredEventRow } from "@bb/db";
import { ApiError } from "../../errors.js";
import { parseStoredEvent } from "./thread-data.js";
import {
  paginateTimelineRows,
  type ThreadTimelinePageKind,
  type ThreadTimelinePageRequest,
} from "./timeline-pagination.js";

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
  isDevelopment: boolean;
  includeNestedRows?: boolean;
  /** Thread high-water event sequence this window reflects (echoed to clients). */
  maxSeq: number;
  page: ThreadTimelinePageRequest;
  /**
   * When true, the response is built without rows (rows: []). The tail-only
   * fields (`activeThinking`, `activeWorkflow`, `pendingTodos`,
   * `contextWindowUsage`) are still populated. Saves the row-generation work +
   * serialization bytes for
   * consumers that only need tail state (e.g. `bb status` / `bb thread show`).
   */
  summaryOnly?: boolean;
  providerDisplayName?: string;
}

interface BuildTimelineTurnSummaryDetailsOptions extends TimelineTurnSummarySelection {
  isDevelopment: boolean;
  providerDisplayName?: string;
}

export const THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT = 20;
export const THREAD_TIMELINE_SEGMENT_LIMIT_MAX = 100;

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
  responseJsonBytes: number;
  responseRowCount: number;
  returnedSegmentCount: number;
  segmentLimit: number;
  selectionStrategy: ThreadTimelineEventSelectionStrategy;
  stageTimings: ThreadTimelineBuildProfileStageTiming[];
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
  responseJsonBytes: number;
  responseRowCount: number;
  returnedSegmentCount: number;
  selectionStrategy: ThreadTimelineEventSelectionStrategy;
  stageTimings: ThreadTimelineBuildProfileStageTiming[];
}

interface BuildThreadTimelineInternalOptions extends BuildThreadTimelineOptions {
  includeProfile: boolean;
}

interface TimelineEventRowSelection {
  acceptedClientRequestContextRows: StoredEventRow[];
  contextOnlyToolCallIds: Set<string>;
  paginationPage: ThreadTimelinePageRequest;
  responsePageKind: ThreadTimelinePageKind;
  rows: StoredEventRow[];
  strategy: ThreadTimelineEventSelectionStrategy;
}

interface TimelineWindowRowsArgs {
  rows: readonly StoredEventRow[];
  threadId: string;
}

interface TimelineWindowParentedRowsResult {
  contextOnlyToolCallIds: Set<string>;
  rows: StoredEventRow[];
}

interface SelectAcceptedClientRequestContextRowsArgs {
  rows: readonly StoredEventRow[];
  threadId: string;
}

interface CollectSteerClientRequestIdsBeforeCursorArgs {
  beforeCursor: TimelinePaginationCursor;
  rows: readonly StoredEventRow[];
}

interface SplitFutureSteerAcceptedContextRowsArgs {
  beforeCursor: TimelinePaginationCursor;
  rows: readonly StoredEventRow[];
}

interface SplitFutureSteerAcceptedContextRowsResult {
  contextRows: StoredEventRow[];
  rows: StoredEventRow[];
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

function collectSteerClientRequestIdsNeedingAcceptedContext(
  rows: readonly StoredEventRow[],
): ClientTurnRequestId[] {
  const acceptedClientRequestIds = new Set<ClientTurnRequestId>();
  const clientRequestIds = new Set<ClientTurnRequestId>();
  for (const row of rows) {
    if (row.type === "turn/input/accepted") {
      const clientRequestId = parseAcceptedInputClientRequestId(row);
      acceptedClientRequestIds.add(clientRequestId);
      clientRequestIds.delete(clientRequestId);
      continue;
    }
    const clientRequestId = tryReadSteerClientTurnRequestedRequestId(row);
    if (
      clientRequestId === null ||
      acceptedClientRequestIds.has(clientRequestId)
    ) {
      continue;
    }
    clientRequestIds.add(clientRequestId);
  }
  return [...clientRequestIds];
}

function collectSteerClientRequestIdsBeforeCursor(
  args: CollectSteerClientRequestIdsBeforeCursorArgs,
): ReadonlySet<ClientTurnRequestId> {
  const clientRequestIds = new Set<ClientTurnRequestId>();
  for (const row of args.rows) {
    if (row.sequence >= args.beforeCursor.anchorSeq) {
      continue;
    }
    const clientRequestId = tryReadSteerClientTurnRequestedRequestId(row);
    if (clientRequestId !== null) {
      clientRequestIds.add(clientRequestId);
    }
  }
  return clientRequestIds;
}

function splitFutureSteerAcceptedContextRows(
  args: SplitFutureSteerAcceptedContextRowsArgs,
): SplitFutureSteerAcceptedContextRowsResult {
  const steerClientRequestIds = collectSteerClientRequestIdsBeforeCursor(args);
  if (steerClientRequestIds.size === 0) {
    return {
      contextRows: [],
      rows: [...args.rows],
    };
  }

  const contextRows: StoredEventRow[] = [];
  const rows: StoredEventRow[] = [];
  for (const row of args.rows) {
    if (
      row.type !== "turn/input/accepted" ||
      row.sequence <= args.beforeCursor.anchorSeq
    ) {
      rows.push(row);
      continue;
    }

    const clientRequestId = parseAcceptedInputClientRequestId(row);
    if (steerClientRequestIds.has(clientRequestId)) {
      contextRows.push(row);
      continue;
    }
    rows.push(row);
  }

  return {
    contextRows,
    rows,
  };
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function parseStoredEventData(row: StoredEventRow): Record<string, unknown> {
  return asRecord(JSON.parse(row.data)) ?? {};
}

function getStoredEventParentToolCallId(
  row: StoredEventRow,
): string | undefined {
  const data = parseStoredEventData(row);
  const item = asRecord(data.item);
  const itemParentToolCallId = item?.parentToolCallId;
  if (
    typeof itemParentToolCallId === "string" &&
    itemParentToolCallId.length > 0
  ) {
    return itemParentToolCallId;
  }

  const eventParentToolCallId = data.parentToolCallId;
  return typeof eventParentToolCallId === "string" &&
    eventParentToolCallId.length > 0
    ? eventParentToolCallId
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
  args: TimelineWindowRowsArgs,
): TimelineWindowParentedRowsResult {
  let rows = [...args.rows];
  const rowIds = new Set(rows.map((row) => row.id));
  const visibleToolCallIds = new Set(collectStoredToolCallItemIds(rows));
  const fetchedChildToolCallIds = new Set<string>();

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

    const childRows = listStoredEventRowsByParentToolCallIds(db, {
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
      parentToolCallIds: toolCallIdsToFetch,
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

  const contextOnlyToolCallIds = new Set<string>();
  const missingParentToolCallIds = collectStoredParentToolCallIds(rows).filter(
    (parentToolCallId) => !visibleToolCallIds.has(parentToolCallId),
  );
  const parentRows = listStoredToolCallRowsByItemIds(db, {
    itemIds: missingParentToolCallIds,
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

function selectAcceptedClientRequestContextRows(
  db: DbConnection,
  args: SelectAcceptedClientRequestContextRowsArgs,
): StoredEventRow[] {
  const clientRequestIds = collectSteerClientRequestIdsNeedingAcceptedContext(
    args.rows,
  );
  if (clientRequestIds.length === 0) {
    return [];
  }

  return listStoredTurnInputAcceptedRowsByClientRequestIds(db, {
    afterSequence: maxStoredEventSequence(args.rows),
    clientRequestIds,
    threadId: args.threadId,
  });
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
): TimelineEventRowSelection {
  return {
    acceptedClientRequestContextRows: [],
    contextOnlyToolCallIds: new Set(),
    paginationPage: page,
    responsePageKind: page.kind,
    rows: listRecentStoredEventRows(db, {
      threadId: thread.id,
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
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

interface ResolveTimelineSegmentWindowArgs {
  page: ThreadTimelinePageRequest;
  threadId: string;
}

interface ResolvedTimelineSegmentWindow {
  beforeSequence: number | undefined;
  hasAnchors: boolean;
  sequenceStart: number;
}

/**
 * Resolves the event-sequence window for a timeline page from segment anchors,
 * touching only the ~`segmentLimit` anchors around the page rather than every
 * anchor in the thread. `hasAnchors` is false only when the thread has no
 * qualifying anchors at all; a stale cursor (anchors exist but the cursor's
 * anchor is gone) throws, matching the previous behavior.
 */
function resolveTimelineSegmentWindow(
  db: DbConnection,
  args: ResolveTimelineSegmentWindowArgs,
): ResolvedTimelineSegmentWindow {
  const { page, threadId } = args;
  const noAnchors: ResolvedTimelineSegmentWindow = {
    beforeSequence: undefined,
    hasAnchors: false,
    sequenceStart: 0,
  };

  if (page.kind === "older") {
    const cursor = page.beforeCursor;
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
    return {
      beforeSequence: findTimelineSegmentAnchorSequenceAfter(db, {
        sequence: cursor.anchorSeq,
        threadId,
      }),
      hasAnchors: true,
      // The (segmentLimit + 1)-th anchor before the cursor is the window's
      // lower bound; fewer than that means the window reaches the thread start.
      sequenceStart: precedingAnchors[page.segmentLimit]?.sequence ?? 0,
    };
  }

  const newestAnchors = listTimelineSegmentAnchorsDescending(db, {
    limit: page.segmentLimit + 1,
    threadId,
  });
  if (newestAnchors.length === 0) {
    return noAnchors;
  }
  return {
    beforeSequence: undefined,
    hasAnchors: true,
    sequenceStart: newestAnchors[page.segmentLimit]?.sequence ?? 0,
  };
}

function selectStandardTimelineEventRows(
  db: DbConnection,
  thread: Thread,
  page: ThreadTimelinePageRequest,
): TimelineEventRowSelection {
  const window = resolveTimelineSegmentWindow(db, {
    page,
    threadId: thread.id,
  });
  if (!window.hasAnchors) {
    return selectFullTimelineEventRows(db, thread, page);
  }

  const beforeSequence = window.beforeSequence;
  const sequenceStart = window.sequenceStart;

  const selectedRowsWithInWindowTaskState =
    ensureTimelineWindowBackgroundTaskStateRows(db, {
      threadId: thread.id,
      rows: ensureTimelineWindowTurnStartedRows(db, {
        threadId: thread.id,
        rows: listStoredTimelineWindowEventRows(db, {
          beforeSequence,
          excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
          sequenceStart,
          threadId: thread.id,
        }),
      }),
    });
  const selectedRows =
    page.kind === "latest"
      ? ensureLatestTimelineOpenBackgroundTaskStateRows(db, {
          threadId: thread.id,
          rows: selectedRowsWithInWindowTaskState,
        })
      : selectedRowsWithInWindowTaskState;
  const selectedRowsWithContext =
    page.kind === "older"
      ? splitFutureSteerAcceptedContextRows({
          beforeCursor: page.beforeCursor,
          rows: selectedRows,
        })
      : {
          contextRows: [],
          rows: selectedRows,
        };
  const selectedRowsWithParentedContext = ensureTimelineWindowParentedRows(db, {
    threadId: thread.id,
    rows: selectedRowsWithContext.rows,
  });
  const selectedRowsWithParentedTurnStarts = ensureTimelineWindowTurnStartedRows(
    db,
    {
      threadId: thread.id,
      rows: selectedRowsWithParentedContext.rows,
    },
  );

  return {
    acceptedClientRequestContextRows: selectedRowsWithContext.contextRows,
    contextOnlyToolCallIds:
      selectedRowsWithParentedContext.contextOnlyToolCallIds,
    paginationPage:
      page.kind === "older"
        ? page
        : {
            kind: "latest",
            segmentLimit: page.segmentLimit,
          },
    responsePageKind: page.kind,
    rows: selectedRowsWithParentedTurnStarts,
    strategy:
      sequenceStart === 0 && beforeSequence === undefined
        ? "full"
        : "standard-window",
  };
}

function selectTimelineEventRows(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineOptions,
): TimelineEventRowSelection {
  return selectStandardTimelineEventRows(db, thread, options.page);
}

function byteLengthOfStoredEventRows(rows: readonly StoredEventRow[]): number {
  let byteLength = 0;
  for (const row of rows) {
    byteLength += Buffer.byteLength(row.data, "utf8");
  }
  return byteLength;
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
    responseJsonBytes: 0,
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
  options: BuildThreadTimelineOptions,
  response: ThreadTimelineResponse,
): ThreadTimelineBuildProfile {
  accumulator.responseJsonBytes = measureThreadTimelineStage(
    accumulator,
    "response-serialization",
    () => Buffer.byteLength(JSON.stringify(response), "utf8"),
  );
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
  const includeProviderUnhandledOperations = options.isDevelopment;
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
      mergeStoredEventRowsById([
        ...eventSelection.acceptedClientRequestContextRows,
        ...selectAcceptedClientRequestContextRows(db, {
          rows: rawEventRows,
          threadId: thread.id,
        }),
      ]),
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
    acceptedClientRequestEvents: acceptedClientRequestContextRows.map((row) =>
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
  if (profile) {
    profile.projectedRowCount = timeline.rows.length;
  }
  const paginatedTimeline = measureThreadTimelineStage(
    profile,
    "pagination-segmentation",
    () => paginateTimelineRows(timeline.rows, eventSelection.paginationPage),
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
    activeWorkflow:
      options.page.kind === "latest" ? timeline.activeWorkflow : null,
    activeBackgroundCommands:
      options.page.kind === "latest" ? timeline.activeBackgroundCommands : [],
    // pendingTodos is gated inside the projection via `isLatestPage` so the
    // extraction work is skipped on older-page requests entirely; no
    // post-hoc null-out needed here.
    pendingTodos: timeline.pendingTodos,
    goal: timeline.goal,
    contextWindowUsage:
      options.page.kind === "latest"
        ? (timeline.contextWindowUsage ?? undefined)
        : undefined,
    timelinePage: {
      kind: eventSelection.responsePageKind,
      segmentLimit: paginatedTimeline.segmentLimit,
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
  return buildThreadTimelineInternal(db, thread, {
    ...options,
    includeProfile: false,
  }).response;
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

  const includeProviderUnhandledOperations = options.isDevelopment;
  const exactEventRows = listStoredEventRowsInRange(db, {
    threadId: thread.id,
    seqStart: options.sourceSeqStart,
    seqEnd: options.sourceSeqEnd,
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
  const turnStartedRows = hasCurrentStartedRow
    ? []
    : listStoredTurnStartedRowsByTurnIdsUpToSequence(db, {
        threadId: thread.id,
        sequenceCutoff: contextSequenceCutoff,
        turnIds: [options.turnId],
      });
  if (!hasCurrentStartedRow && turnStartedRows.length === 0) {
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
  const eventRowsWithBackgroundTaskState =
    ensureTimelineWindowBackgroundTaskStateRows(db, {
      threadId: thread.id,
      rows: eventRows,
    });
  const children = buildThreadTimelineTurnDetailsFromEvents({
    events: [...turnStartedRows, ...eventRowsWithBackgroundTaskState].map(
      (row) => toThreadEventWithMeta(row),
    ),
    options: {
      includeProviderUnhandledOperations,
      sourceSeqEnd: sourceRange.sourceSeqEnd,
      sourceSeqStart: sourceRange.sourceSeqStart,
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
