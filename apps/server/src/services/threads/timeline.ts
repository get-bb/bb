import {
  buildThreadTimelineFromEvents,
  MANAGER_CONVERSATION_TIMELINE_EVENT_SELECTION,
  THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
  buildThreadTimelineTurnDetailsFromEvents,
  compactThreadTimelineSummaryEvents,
  type AcceptedClientRequestContext,
  type SystemClientRequestVisibility,
  type ThreadEventWithMeta,
} from "@bb/thread-view";
import type { ClientTurnRequestId, Thread } from "@bb/domain";
import type {
  ManagerTimelineView,
  TimelinePaginationCursor,
  ThreadTimelineResponse,
  TimelineTurnSummaryDetailsResponse,
} from "@bb/server-contract";
import {
  findTimelineSegmentAnchorSequenceAfter,
  getEnvironment,
  getTimelineSegmentAnchorAtSequence,
  listContextWindowUsageRows,
  listFilteredStoredTimelineWindowEventRows,
  listRecentStoredEventRows,
  listStoredClientTurnRequestIdsInRange,
  listStoredEventRowsInRange,
  listLatestBackgroundTaskStateRowsByItemIds,
  listStoredTimelineWindowEventRows,
  listStoredTurnInputAcceptedRowsByClientRequestIds,
  listStoredTurnStartedRowsByTurnIdsUpToSequence,
  listTimelineSegmentAnchorsDescending,
} from "@bb/db";
import type {
  DbConnection,
  StoredEventRow,
  TimelineSegmentAnchorAudience,
} from "@bb/db";
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
  page: ThreadTimelinePageRequest;
  /**
   * When true, the response is built without rows (rows: []). The tail-only
   * fields (`activeThinking`, `pendingTodos`, `contextWindowUsage`) are still
   * populated. Saves the row-generation work + serialization bytes for
   * consumers that only need tail state (e.g. `bb status` / `bb thread show`).
   */
  summaryOnly?: boolean;
  timelineViewMode: ThreadTimelineServiceViewMode;
}

interface BuildTimelineTurnSummaryDetailsOptions extends TimelineTurnSummarySelection {
  isDevelopment: boolean;
  timelineViewMode: ThreadTimelineServiceViewMode;
}

export type ThreadTimelineServiceViewMode = "manager-conversation" | "standard";

export const THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT = 20;
export const THREAD_TIMELINE_SEGMENT_LIMIT_MAX = 100;

interface TimelineEventRowSelection {
  acceptedClientRequestContextRows: StoredEventRow[];
  paginationPage: ThreadTimelinePageRequest;
  responsePageKind: ThreadTimelinePageKind;
  rows: StoredEventRow[];
}

interface EnsureTimelineWindowTurnStartedRowsArgs {
  rows: readonly StoredEventRow[];
  threadId: string;
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

export interface ResolveThreadTimelineServiceViewModeArgs {
  managerTimelineView: ManagerTimelineView | undefined;
  thread: Thread;
}

export function resolveThreadTimelineServiceViewMode({
  managerTimelineView,
  thread,
}: ResolveThreadTimelineServiceViewModeArgs): ThreadTimelineServiceViewMode {
  if (thread.type === "manager" && managerTimelineView !== "standard") {
    return "manager-conversation";
  }
  return "standard";
}

function resolveSystemClientRequestVisibility(
  thread: Thread,
  timelineViewMode: ThreadTimelineServiceViewMode,
): SystemClientRequestVisibility {
  return thread.type === "manager" && timelineViewMode === "standard"
    ? "visible"
    : "hidden";
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

function collectVisibleAcceptedClientRequestIds(
  rows: readonly StoredEventRow[],
): ReadonlySet<ClientTurnRequestId> {
  const acceptedClientRequestIds = new Set<ClientTurnRequestId>();
  for (const row of rows) {
    if (row.type !== "turn/input/accepted") {
      continue;
    }
    acceptedClientRequestIds.add(parseAcceptedInputClientRequestId(row));
  }
  return acceptedClientRequestIds;
}

function collectSteerClientRequestIdsNeedingAcceptedContext(
  rows: readonly StoredEventRow[],
): ClientTurnRequestId[] {
  const visibleAcceptedClientRequestIds =
    collectVisibleAcceptedClientRequestIds(rows);
  const clientRequestIds = new Set<ClientTurnRequestId>();
  for (const row of rows) {
    const clientRequestId = tryReadSteerClientTurnRequestedRequestId(row);
    if (
      clientRequestId === null ||
      visibleAcceptedClientRequestIds.has(clientRequestId)
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
    if (row.turnId === args.turnId) {
      requestedTurnRows.push(row);
      continue;
    }
    acceptedClientRequestIdsForOtherTurns.add(
      parseAcceptedInputClientRequestId(row),
    );
  }

  return {
    acceptedClientRequestIdsForOtherTurns,
    requestedTurnRows,
  };
}

function filterExactEventRowsForRequestedTurn(
  args: FilterExactEventRowsForRequestedTurnArgs,
): FilterExactEventRowsForRequestedTurnResult {
  if (args.acceptedClientRequestIdsForOtherTurns.size === 0) {
    return {
      removedRows: false,
      rows: args.exactEventRows,
    };
  }

  const rows: StoredEventRow[] = [];
  let removedRows = false;
  for (const row of args.exactEventRows) {
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
    paginationPage: page,
    responsePageKind: page.kind,
    rows: listRecentStoredEventRows(db, {
      threadId: thread.id,
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    }),
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
  args: EnsureTimelineWindowTurnStartedRowsArgs,
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
  args: EnsureTimelineWindowTurnStartedRowsArgs,
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

  const rowsById = new Map<string, StoredEventRow>();
  for (const row of [...args.rows, ...stateRows]) {
    rowsById.set(row.id, row);
  }

  return [...rowsById.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

interface ResolveTimelineSegmentWindowArgs {
  audience: TimelineSegmentAnchorAudience;
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
  const { audience, page, threadId } = args;
  const noAnchors: ResolvedTimelineSegmentWindow = {
    beforeSequence: undefined,
    hasAnchors: false,
    sequenceStart: 0,
  };

  if (page.kind === "older") {
    const cursor = page.beforeCursor;
    const cursorAnchor = getTimelineSegmentAnchorAtSequence(db, {
      audience,
      sequence: cursor.anchorSeq,
      threadId,
    });
    if (!cursorAnchor || cursorAnchor.rowId !== cursor.anchorId) {
      const anyAnchor = listTimelineSegmentAnchorsDescending(db, {
        audience,
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
      audience,
      beforeSequence: cursor.anchorSeq,
      limit: page.segmentLimit + 1,
      threadId,
    });
    return {
      beforeSequence: findTimelineSegmentAnchorSequenceAfter(db, {
        audience,
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
    audience,
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
  systemClientRequestVisibility: SystemClientRequestVisibility,
): TimelineEventRowSelection {
  const window = resolveTimelineSegmentWindow(db, {
    audience:
      systemClientRequestVisibility === "visible" ? "all" : "non-system",
    page,
    threadId: thread.id,
  });
  if (!window.hasAnchors) {
    return selectFullTimelineEventRows(db, thread, page);
  }

  const beforeSequence = window.beforeSequence;
  const sequenceStart = window.sequenceStart;

  const selectedRows = ensureTimelineWindowBackgroundTaskStateRows(db, {
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

  return {
    acceptedClientRequestContextRows: selectedRowsWithContext.contextRows,
    paginationPage:
      page.kind === "older"
        ? page
        : {
            kind: "latest",
            segmentLimit: page.segmentLimit,
          },
    responsePageKind: page.kind,
    rows: selectedRowsWithContext.rows,
  };
}

function selectManagerConversationTimelineEventRows(
  db: DbConnection,
  thread: Thread,
  page: ThreadTimelinePageRequest,
): TimelineEventRowSelection {
  const window = resolveTimelineSegmentWindow(db, {
    audience: "user",
    page,
    threadId: thread.id,
  });
  // The manager conversation has no full-timeline fallback: an older page must
  // resolve against a live cursor, while a latest page with no anchors selects
  // from the thread start (sequenceStart 0).
  if (!window.hasAnchors && page.kind === "older") {
    throw new ApiError(
      400,
      "invalid_request",
      "Timeline pagination cursor is no longer available",
    );
  }

  return {
    acceptedClientRequestContextRows: [],
    paginationPage:
      page.kind === "older"
        ? page
        : {
            kind: "latest",
            segmentLimit: page.segmentLimit,
          },
    responsePageKind: page.kind,
    rows: ensureTimelineWindowTurnStartedRows(db, {
      threadId: thread.id,
      rows: listFilteredStoredTimelineWindowEventRows(db, {
        beforeSequence: window.beforeSequence,
        filter: MANAGER_CONVERSATION_TIMELINE_EVENT_SELECTION,
        sequenceStart: window.sequenceStart,
        threadId: thread.id,
      }),
    }),
  };
}

function selectTimelineEventRows(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineOptions,
  systemClientRequestVisibility: SystemClientRequestVisibility,
): TimelineEventRowSelection {
  if (options.timelineViewMode === "manager-conversation") {
    return selectManagerConversationTimelineEventRows(db, thread, options.page);
  }

  return selectStandardTimelineEventRows(
    db,
    thread,
    options.page,
    systemClientRequestVisibility,
  );
}

export function buildThreadTimeline(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineOptions,
): ThreadTimelineResponse {
  const includeNestedRows = options.includeNestedRows ?? false;
  const includeProviderUnhandledOperations = options.isDevelopment;
  const viewMode = options.timelineViewMode;
  const systemClientRequestVisibility = resolveSystemClientRequestVisibility(
    thread,
    viewMode,
  );
  const eventSelection = selectTimelineEventRows(
    db,
    thread,
    options,
    systemClientRequestVisibility,
  );
  const rawEventRows = eventSelection.rows;
  const acceptedClientRequestContextRows =
    viewMode === "standard"
      ? mergeStoredEventRowsById([
          ...eventSelection.acceptedClientRequestContextRows,
          ...selectAcceptedClientRequestContextRows(db, {
            rows: rawEventRows,
            threadId: thread.id,
          }),
        ])
      : [];
  const decodedEvents = compactThreadTimelineSummaryEvents(
    rawEventRows.map((row) => toThreadEventWithMeta(row)),
  );
  const contextWindowUsageRows = listContextWindowUsageRows(db, {
    threadId: thread.id,
  });
  const commonProjectionOptions = {
    includeDebugRawEvents: false,
    includeProviderUnhandledOperations,
    isLatestPage: options.page.kind === "latest",
    systemClientRequestVisibility,
    threadStatus: thread.status,
    workspaceRoot: resolveThreadWorkspaceRoot(db, thread),
  };
  const contextWindowEvents = contextWindowUsageRows.map((row) =>
    toThreadEventWithMeta(row),
  );
  const acceptedClientRequestContext: AcceptedClientRequestContext = {
    acceptedClientRequestEvents: acceptedClientRequestContextRows.map((row) =>
      toThreadEventWithMeta(row),
    ),
  };
  const timeline = buildThreadTimelineFromEvents({
    acceptedClientRequestContext,
    contextWindowEvents,
    events: decodedEvents,
    options:
      viewMode === "manager-conversation"
        ? {
            ...commonProjectionOptions,
            viewMode,
          }
        : {
            ...commonProjectionOptions,
            includeNestedRows,
            turnMessageDetail: includeNestedRows ? "full" : "summary",
            viewMode,
          },
  });
  const paginatedTimeline = paginateTimelineRows(
    timeline.rows,
    eventSelection.paginationPage,
  );

  return {
    rows: options.summaryOnly ? [] : paginatedTimeline.rows,
    activeThinking:
      options.page.kind === "latest" ? timeline.activeThinking : null,
    // pendingTodos is gated inside the projection via `isLatestPage` so the
    // extraction work is skipped on older-page requests entirely; no
    // post-hoc null-out needed here.
    pendingTodos: timeline.pendingTodos,
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
  const acceptedInputRows = listStoredTurnInputAcceptedRowsByClientRequestIds(
    db,
    {
      threadId: thread.id,
      afterSequence: options.sourceSeqEnd,
      clientRequestIds,
    },
  );
  const acceptedInputRowsByTurn = partitionAcceptedInputRowsByRequestedTurn({
    acceptedInputRows,
    turnId: options.turnId,
  });
  const exactEventRowsForRequestedTurn = filterExactEventRowsForRequestedTurn({
    acceptedClientRequestIdsForOtherTurns:
      acceptedInputRowsByTurn.acceptedClientRequestIdsForOtherTurns,
    exactEventRows,
  });
  const eventRows = [
    ...exactEventRowsForRequestedTurn.rows,
    ...acceptedInputRowsByTurn.requestedTurnRows,
  ];
  const mismatchedTurnRow = eventRows.find(
    (row) => row.scopeKind === "turn" && row.turnId !== options.turnId,
  );
  if (mismatchedTurnRow) {
    throw new ApiError(
      400,
      "invalid_request",
      `Timeline turn summary details range ${options.sourceSeqStart}-${options.sourceSeqEnd} includes turn ${mismatchedTurnRow.turnId ?? "unknown"} instead of ${options.turnId}`,
    );
  }

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
  const viewMode = options.timelineViewMode;
  const systemClientRequestVisibility = resolveSystemClientRequestVisibility(
    thread,
    viewMode,
  );
  const sourceRange = resolveTurnSummaryDetailsSourceRange({
    exactEventRows: exactEventRowsForRequestedTurn.rows,
    fallbackRange: {
      sourceSeqEnd: options.sourceSeqEnd,
      sourceSeqStart: options.sourceSeqStart,
      turnId: options.turnId,
    },
    useExactEventRowBounds: exactEventRowsForRequestedTurn.removedRows,
  });
  const children = buildThreadTimelineTurnDetailsFromEvents({
    events: [...turnStartedRows, ...eventRows].map((row) =>
      toThreadEventWithMeta(row),
    ),
    options: {
      includeProviderUnhandledOperations,
      systemClientRequestVisibility,
      sourceSeqEnd: sourceRange.sourceSeqEnd,
      sourceSeqStart: sourceRange.sourceSeqStart,
      threadStatus: thread.status,
      viewMode,
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
