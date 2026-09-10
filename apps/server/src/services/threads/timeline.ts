import { paginateTimelineContents } from "./timeline-content-pagination.js";
import {
  getTimelineGroupingContext,
  orderTimelineRowsUsingContext,
} from "./timeline-context-order.js";
import {
  bindTimelineCursor,
  readTimelineContentCursor,
  resolveTimelineSnapshot,
  timelineSnapshotKey,
  type TimelineContentCursor,
} from "./timeline-snapshot.js";
import {
  buildThreadTimelineFromEvents,
  THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
  buildThreadTimelineTurnDetailsFromEvents,
  compactThreadTimelineSummaryEvents,
  type AcceptedClientRequestContext,
  type ThreadEventWithMeta,
} from "@bb/thread-view";
import { LEGACY_CODEX_GOAL_EXTENSION_KIND } from "@bb/domain";
import type {
  ClientTurnRequestId,
  ProviderComposerCommand,
  Thread,
  ThreadEventItemType,
} from "@bb/domain";
import type {
  ThreadConversationOutlineItem,
  ThreadConversationOutlineResponse,
  TimelineConversationAttachments,
  ThreadConversationOutlineAttachmentSummary,
  TimelineRow,
  TimelineOutputPreview,
  ThreadTimelineResponse,
  TimelineTurnSummaryDetailsResponse,
} from "@bb/server-contract";
import { threadConversationOutlineItemSchema } from "@bb/server-contract";
import {
  findStoredTimelineWindowByteBudgetFloor,
  findTimelineWindowBudgetFloorSequence,
  hydrateRetainedEventOutputRows,
  hydrateRetainedEventOutputRowsWithinDataByteLimit,
  getEnvironment,
  getLatestCompletedThreadContextClearSequence,
  getThreadConversationOutlineRecord,
  listContextWindowUsageRows,
  isTimelineCursorSequencePresent,
  listStoredConversationOutlineEventRows,
  listStoredClientTurnRequestIdsInRange,
  listStoredEventRows,
  listTimelineInterruptionRows,
  listStoredClientTurnRequestRowsByKeys,
  listStoredEventRowsByParentToolCallIds,
  listItemEventSpansByItems,
  listStoredBufferedTextDeltaRowsByItems,
  listStoredItemLifecycleRowsByItems,
  listLatestBackgroundTaskStateRowsByItemIds,
  listLatestThreadStateEventRowsByThreadIds,
  listLatestOpenBackgroundTaskStateRowsForThread,
  listStoredTimelineWindowEventRows,
  listStoredTimelineTurnEventRows,
  listStoredTimelineThreadWindowEventRows,
  listTimelineRootWindowTurnIds,
  listTodoSnapshotEventRowsForThread,
  listStoredDelegatingItemRowsByItemIds,
  listStoredTurnInputAcceptedRowsByClientRequestIds,
  listStoredTurnRejectedRowsByClientRequestIds,
  listStoredTurnStartedRowsByTurnIdsUpToSequence,
  listTimelineSegmentAnchorsDescending,
  scopedItemRefKey,
  upsertThreadConversationOutlineRecord,
} from "@bb/db";
import type {
  DbConnection,
  InlineOutputCharLimit,
  ScopedItemRef,
  StoredEventRow,
} from "@bb/db";
import { ApiError } from "../../errors.js";
import { roundDurationMs } from "../lib/duration.js";
import { runEventLoopWorkSync } from "../system/event-loop-work.js";
import { parseStoredEvent } from "./thread-data.js";
import {
  paginateTimelineRows,
  type ThreadTimelinePageKind,
  type ThreadTimelinePageRequest,
} from "./timeline-pagination.js";
import { DEFAULT_MAX_INLINE_OUTPUT_CHARS } from "./timeline-output-truncation.js";

interface TimelineTurnSummarySelection {
  sourceSeqEnd: number;
  sourceSeqStart: number;
  turnId: string;
}

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
  eventBudget: number;
  responseByteBudget?: number;
  includeDiagnosticOperations: boolean;
  includeNestedRows?: boolean;
  maxInlineOutputChars: InlineOutputCharLimit;
  maxSeq: number;
  page: ThreadTimelinePageRequest;
  summaryOnly?: boolean;
  providerDisplayName?: string;
  planCommand?: ProviderComposerCommand | null;
}

interface BuildTimelineTurnSummaryDetailsOptions extends TimelineTurnSummarySelection {
  beforeCursor?: string;
  includeDiagnosticOperations: boolean;
  providerDisplayName?: string;
}

export const THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT = 20;

export const THREAD_TIMELINE_SEGMENT_LIMIT_MAX = 100;

export const THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT = 4 * 1024 * 1024;

type ThreadTimelineBuildProfileStage =
  | "event-query"
  | "group-context-query"
  | "ordering-context-query"
  | "accepted-client-request-context-query"
  | "event-json-decode"
  | "summary-compaction"
  | "context-window-query"
  | "context-window-json-decode"
  | "thread-view-projection"
  | "pagination-segmentation";

type ThreadTimelineEventSelectionStrategy = "full" | "standard-window";

interface ThreadTimelineBuildProfileStageTiming {
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
  responseRowCount: number;
  returnedSegmentCount: number;
  selectionStrategy: ThreadTimelineEventSelectionStrategy;
  stageTimings: ThreadTimelineBuildProfileStageTiming[];
}

interface BuildThreadTimelineInternalOptions extends BuildThreadTimelineOptions {
  includeProfile: boolean;
}

interface TimelineEventRowSelection {
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

interface TimelineWindowRowsArgs {
  rows: readonly StoredEventRow[];
  threadId: string;
}

interface TimelineWindowParentedRowsArgs extends TimelineWindowRowsArgs {
  excludeDiagnosticEvents: boolean;
  maxInlineOutputChars: InlineOutputCharLimit;
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

function retainedOutputPreviewsByCallId(
  events: readonly ThreadEventWithMeta[],
  availablePreview: Extract<
    TimelineOutputPreview["experimental_fullOutputAvailability"],
    "available" | "detail-limit"
  >,
  now: number,
): ReadonlyMap<string, TimelineOutputPreview> {
  const previews = new Map<string, TimelineOutputPreview>();
  for (const { event } of events) {
    if (event.type !== "item/completed") {
      continue;
    }
    const item = event.item;
    if (item.type !== "commandExecution" && item.type !== "toolCall") {
      continue;
    }
    const truncation =
      item.type === "commandExecution"
        ? item.truncation?.aggregatedOutput
        : item.truncation?.result;
    if (truncation !== undefined) {
      previews.set(item.id, {
        experimental_fullOutputAvailability:
          truncation.truncatedAt > now ? availablePreview : "retention-expired",
        totalChars: truncation.originalLength,
      });
    } else {
      previews.delete(item.id);
    }
  }
  return previews;
}

export function applyRetainedOutputPreviews(
  rows: readonly TimelineRow[],
  events: readonly ThreadEventWithMeta[],
  availablePreview: Extract<
    TimelineOutputPreview["experimental_fullOutputAvailability"],
    "available" | "detail-limit"
  >,
): TimelineRow[] {
  const previews = retainedOutputPreviewsByCallId(
    events,
    availablePreview,
    Date.now(),
  );
  if (previews.size === 0) {
    return [...rows];
  }

  const applyToRows = (nestedRows: readonly TimelineRow[]): TimelineRow[] => {
    const nextRows = nestedRows.map((row): TimelineRow => {
      if (row.kind === "turn") {
        if (row.children === null) {
          return row;
        }
        const originalChildren = row.children;
        const children = applyToRows(originalChildren);
        const changed = children.some(
          (child, index) => child !== originalChildren[index],
        );
        return changed ? { ...row, children } : row;
      }
      if (row.kind !== "work") {
        return row;
      }
      if (row.workKind === "delegation") {
        const childRows = applyToRows(row.childRows);
        const changed = childRows.some(
          (child, index) => child !== row.childRows[index],
        );
        return changed ? { ...row, childRows } : row;
      }
      if (row.workKind !== "command" && row.workKind !== "tool") {
        return row;
      }
      const outputPreview = previews.get(row.callId);
      return outputPreview === undefined ? row : { ...row, outputPreview };
    });
    return nextRows;
  };

  return applyToRows(rows);
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

function isStoredDelegatingItemRow(row: StoredEventRow): boolean {
  return (
    (row.itemKind === "toolCall" || row.itemKind === "delegation") &&
    row.itemId !== null
  );
}

function collectStoredDelegatingItemIds(
  rows: readonly StoredEventRow[],
): string[] {
  const itemIds = new Set<string>();
  for (const row of rows) {
    if (!isStoredDelegatingItemRow(row) || row.itemId === null) {
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
  const visibleToolCallIds = new Set(collectStoredDelegatingItemIds(rows));
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

    const childSequenceBounds = args.sequenceBounds;
    const childRows = listStoredEventRowsByParentToolCallIds(db, {
      beforeSequence: childSequenceBounds?.beforeSequence,
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
      excludeDiagnosticEvents: args.excludeDiagnosticEvents,
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
      if (isStoredDelegatingItemRow(row) && row.itemId !== null) {
        visibleToolCallIds.add(row.itemId);
      }
    }
    rows = mergeStoredEventRowsById([...rows, ...newChildRows]);
  }

  const contextOnlyToolCallIds = new Set<string>();
  const missingParentToolCallIds = collectStoredParentToolCallIds(rows).filter(
    (parentToolCallId) => !visibleToolCallIds.has(parentToolCallId),
  );
  const parentRows = listStoredDelegatingItemRowsByItemIds(db, {
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

const CROSS_TURN_TOOL_ITEM_KINDS: ReadonlySet<ThreadEventItemType> = new Set([
  "commandExecution",
  "toolCall",
  "webSearch",
  "webFetch",
  "imageView",
  "fileRead",
  "search",
  "planSteps",
  "delegation",
  "extension",
]);

function filterExactEventRowsForRequestedTurn(
  args: FilterExactEventRowsForRequestedTurnArgs,
): FilterExactEventRowsForRequestedTurnResult {
  const rows: StoredEventRow[] = [];
  let removedRows = false;
  const openToolCallIds = new Set<string>();
  for (const row of args.exactEventRows) {
    if (row.scopeKind === "turn" && row.turnId !== args.turnId) {
      const continuesOpenToolCall =
        row.itemId !== null &&
        row.type.startsWith("item/") &&
        openToolCallIds.has(row.itemId);
      if (!continuesOpenToolCall) {
        removedRows = true;
        continue;
      }
    } else if (
      row.type === "item/started" &&
      row.itemId !== null &&
      row.itemKind !== null &&
      CROSS_TURN_TOOL_ITEM_KINDS.has(row.itemKind)
    ) {
      openToolCallIds.add(row.itemId);
    }
    if (row.type === "item/completed" && row.itemId !== null) {
      openToolCallIds.delete(row.itemId);
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

function storedEventRowItemRef(row: StoredEventRow): ScopedItemRef {
  return {
    itemId: row.itemId ?? "",
    scopeKind: row.scopeKind,
    turnId: row.turnId,
  };
}

interface SequenceWindowItemRowsArgs extends TimelineWindowRowsArgs {
  beforeSequence: number | undefined;
  maxInlineOutputChars: InlineOutputCharLimit;
  ownership: "later" | "origin";
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

function ensureSequenceWindowWholeItemRows(
  db: DbConnection,
  args: SequenceWindowItemRowsArgs,
): StoredEventRow[] {
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

  const spans = listItemEventSpansByItems(db, {
    items: [...windowItems.values()],
    threadId: args.threadId,
  });
  const itemKeysOwnedByNewerWindow = new Set<string>();
  const itemsStartingBeforeWindow = new Map<string, ScopedItemRef>();
  const sequenceEnd = args.beforeSequence ?? Infinity;
  for (const span of spans) {
    const key = scopedItemRefKey(span);
    if (args.ownership === "origin") {
      const openInLaterWindow =
        span.completedSeq === null && span.maxSequence >= sequenceEnd;
      if (span.minSequence < args.sequenceStart || openInLaterWindow) {
        itemKeysOwnedByNewerWindow.add(key);
      } else if ((span.completedSeq ?? -1) >= sequenceEnd) {
        itemsStartingBeforeWindow.set(key, span);
      }
      continue;
    }
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

  const backfillRows = listStoredItemLifecycleRowsByItems(db, {
    items: [...itemsStartingBeforeWindow.values()],
    maxInlineOutputChars: args.maxInlineOutputChars,
    threadId: args.threadId,
  }).filter((row) =>
    args.ownership === "origin"
      ? row.sequence >= (args.beforeSequence ?? Infinity)
      : row.sequence < args.sequenceStart,
  );
  if (args.ownership === "origin") {
    return mergeStoredEventRowsById([...rows, ...backfillRows]);
  }

  const completedItemKeys = new Set<string>();
  for (const row of [...rows, ...backfillRows]) {
    if (row.type === "item/completed" && row.itemId !== null) {
      completedItemKeys.add(scopedItemRefKey(storedEventRowItemRef(row)));
    }
  }
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

function ensureTimelineWindowBackgroundTaskStateRows(
  db: DbConnection,
  args: TimelineWindowRowsArgs & { beforeSequence?: number },
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
    beforeSequence: args.beforeSequence,
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

function ensureLatestTimelineHeadStateRows(
  db: DbConnection,
  args: TimelineWindowRowsArgs,
): StoredEventRow[] {
  const headStateRows = [
    ...listLatestThreadStateEventRowsByThreadIds(db, {
      threadIds: [args.threadId],
      kind: LEGACY_CODEX_GOAL_EXTENSION_KIND,
    }),
    ...listTodoSnapshotEventRowsForThread(db, { threadId: args.threadId }),
  ];
  if (headStateRows.length === 0) {
    return [...args.rows];
  }

  return mergeStoredEventRowsById([...args.rows, ...headStateRows]);
}

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

function selectStandardTimelineEventRows(
  db: DbConnection,
  thread: Thread,
  page: ThreadTimelinePageRequest,
  eventBudget: number,
  maxInlineOutputChars: InlineOutputCharLimit,
  epochSequenceStart: number,
  excludeDiagnosticEvents: boolean,
  maxSeq: number,
  contentCursor: TimelineContentCursor | undefined,
  profile: ThreadTimelineBuildProfileAccumulator | null,
): TimelineEventRowSelection {
  const beforeSequence =
    contentCursor?.beforeSequence ??
    (page.kind === "older" ? page.beforeCursor.anchorSeq : maxSeq + 1);
  const anchors = listTimelineSegmentAnchorsDescending(db, {
    threadId: thread.id,
    sequenceStart: epochSequenceStart,
    beforeSequence,
    limit: page.segmentLimit + 1,
  });
  if (
    page.kind === "older" &&
    !isTimelineCursorSequencePresent(db, {
      threadId: thread.id,
      sequence: page.beforeCursor.anchorSeq,
    })
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      "Timeline pagination cursor is no longer available",
    );
  }
  const budgetFloor = findTimelineWindowBudgetFloorSequence(db, {
    threadId: thread.id,
    sequenceStart: epochSequenceStart,
    beforeSequence,
    eventBudget,
    excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    excludeDiagnosticEvents,
  });
  const count = Math.max(
    1,
    countAffordableAnchors(anchors, budgetFloor, page.segmentLimit),
  );
  const oldestAnchor = anchors[count - 1];
  const hasPrefix =
    budgetFloor !== undefined &&
    oldestAnchor !== undefined &&
    findTimelineWindowBudgetFloorSequence(db, {
      threadId: thread.id,
      sequenceStart: epochSequenceStart,
      beforeSequence: oldestAnchor.sequence,
      eventBudget: 0,
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
      excludeDiagnosticEvents,
    }) !== undefined;
  const hasOlder = anchors.length > count || hasPrefix;
  const sequenceStart =
    contentCursor !== undefined && page.kind === "older"
      ? page.beforeCursor.anchorSeq
      : hasOlder
        ? anchors[count - 1]!.sequence
        : epochSequenceStart;
  const windowArgs = {
    threadId: thread.id,
    sequenceStart,
    beforeSequence,
    excludeDiagnosticEvents,
    excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    maxInlineOutputChars,
  };
  const groupingContext = measureThreadTimelineStage(
    profile,
    "ordering-context-query",
    () =>
      getTimelineGroupingContext(db, {
        threadId: thread.id,
        sequenceStart: epochSequenceStart,
        maxSeq,
      }),
  );
  let rows = listStoredTimelineThreadWindowEventRows(db, windowArgs);
  const initialTurnIds = [
    ...listTimelineRootWindowTurnIds(db, windowArgs),
    ...rows.flatMap((row) => {
      if (row.type !== "client/turn/requested") return [];
      const requestId = tryReadClientTurnRequestedRequestId(row);
      const turnId =
        requestId === null
          ? undefined
          : groupingContext.acceptedTurnIds.get(requestId);
      return turnId === undefined ? [] : [turnId];
    }),
  ];
  rows = measureThreadTimelineStage(profile, "group-context-query", () => {
    let selectedRows = rows;
    const fetchedTurns = new Set<string>();
    for (;;) {
      const turnIds = [
        ...new Set([
          ...initialTurnIds,
          ...selectedRows.flatMap((row) =>
            row.turnId === null ? [] : [row.turnId],
          ),
        ]),
      ].filter((turnId) => !fetchedTurns.has(turnId));
      if (turnIds.length === 0) break;
      for (const turnId of turnIds) fetchedTurns.add(turnId);
      selectedRows = mergeStoredEventRowsById([
        ...selectedRows,
        ...listStoredTimelineTurnEventRows(db, {
          ...windowArgs,
          sequenceStart: epochSequenceStart,
          beforeSequence: maxSeq + 1,
          turnIds,
        }),
      ]);
      selectedRows = ensureTimelineWindowParentedRows(db, {
        threadId: thread.id,
        rows: selectedRows,
        maxInlineOutputChars,
        excludeDiagnosticEvents,
        sequenceBounds: {
          sequenceStart: epochSequenceStart,
          beforeSequence: maxSeq + 1,
        },
      }).rows.filter((row) => row.sequence <= maxSeq);
    }
    selectedRows = ensureTimelineWindowBackgroundTaskStateRows(db, {
      threadId: thread.id,
      rows: selectedRows,
      beforeSequence: maxSeq + 1,
    }).filter((row) => row.sequence <= maxSeq);
    if (page.kind === "latest")
      selectedRows = ensureLatestTimelineHeadStateRows(db, {
        threadId: thread.id,
        rows: ensureLatestTimelineOpenBackgroundTaskStateRows(db, {
          threadId: thread.id,
          rows: selectedRows,
        }),
      }).filter((row) => row.sequence <= maxSeq);
    return selectedRows;
  });
  const contextStart = rows.reduce(
    (start, row) => Math.min(start, row.sequence),
    sequenceStart,
  );
  const contextEnd = rows.reduce(
    (end, row) => Math.max(end, row.sequence),
    beforeSequence - 1,
  );
  const contextRows = measureThreadTimelineStage(
    profile,
    "group-context-query",
    () =>
      listStoredEventRows(db, {
        threadId: thread.id,
        afterSequence: contextStart - 1,
        beforeSequence: contextEnd + 1,
        types: [
          "client/turn/requested",
          "client/turn/rejected",
          "turn/input/accepted",
          "turn/started",
          "turn/completed",
          "system/thread/interrupted",
        ],
      }),
  );
  const existingRequests = new Set(
    [...contextRows, ...rows].flatMap((row) =>
      row.type === "client/turn/requested"
        ? [tryReadClientTurnRequestedRequestId(row)]
        : [],
    ),
  );
  const requestKeys = rows
    .filter((row) => row.type === "turn/input/accepted")
    .filter(
      (row) => !existingRequests.has(parseAcceptedInputClientRequestId(row)),
    )
    .map((row) => ({
      threadId: thread.id,
      requestId: parseAcceptedInputClientRequestId(row),
    }));
  const requestedRows = listStoredClientTurnRequestRowsByKeys(db, {
    keys: requestKeys,
  }).filter((row) => row.sequence <= maxSeq);
  const requestContext = [...contextRows, ...requestedRows, ...rows];
  const terminalRequestIds = new Set(
    requestContext.flatMap((row) =>
      row.type === "turn/input/accepted"
        ? [parseAcceptedInputClientRequestId(row)]
        : row.type === "client/turn/rejected"
          ? [parseRejectedClientRequestId(row)]
          : [],
    ),
  );
  const unresolvedRequests = requestContext.flatMap((row) => {
    if (row.type !== "client/turn/requested") return [];
    const id = tryReadClientTurnRequestedRequestId(row);
    return id === null || terminalRequestIds.has(id) ? [] : [id];
  });
  const terminalContext =
    unresolvedRequests.length === 0
      ? []
      : [
          ...listStoredTurnInputAcceptedRowsByClientRequestIds(db, {
            threadId: thread.id,
            afterSequence: contextStart - 1,
            clientRequestIds: unresolvedRequests,
          }),
          ...listStoredTurnRejectedRowsByClientRequestIds(db, {
            threadId: thread.id,
            afterSequence: contextStart - 1,
            clientRequestIds: unresolvedRequests,
          }),
        ].filter((row) => row.sequence <= maxSeq);
  const interruptionRows = listTimelineInterruptionRows(db, {
    threadId: thread.id,
    sequenceStart: epochSequenceStart,
    maxSeq,
  });
  const visibleSequences = new Set(
    [...contextRows, ...rows].map((row) => row.sequence),
  );
  return {
    contextOnlyInterruptionSequences: new Set(
      interruptionRows
        .filter((row) => !visibleSequences.has(row.sequence))
        .map((row) => row.sequence),
    ),
    orderingBoundarySequence: groupingContext.orderingBoundarySequence,
    ownedSequenceStart: sequenceStart,
    ownedSequenceEnd: beforeSequence,
    knownHasOlderSegments: (
      contentCursor === undefined
        ? hasOlder
        : sequenceStart > epochSequenceStart
    )
      ? true
      : null,
    paginationPage:
      contentCursor === undefined ? page : { ...page, segmentLimit: 1 },
    responsePageKind: page.kind,
    rows: ensureTimelineWindowTurnStartedRows(db, {
      threadId: thread.id,
      rows: mergeStoredEventRowsById([
        ...interruptionRows,
        ...terminalContext,
        ...contextRows,
        ...requestedRows,
        ...rows,
      ]),
    }),
    strategy:
      sequenceStart === epochSequenceStart && page.kind === "latest"
        ? "full"
        : "standard-window",
  };
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
  const nestedStart = profile.stageTimings.length;
  const result = fn();
  const nestedDuration = profile.stageTimings
    .slice(nestedStart)
    .reduce((sum, timing) => sum + timing.durationMs, 0);
  profile.stageTimings.push({
    durationMs: performance.now() - startTime - nestedDuration,
    stage,
  });
  return result;
}

function completeThreadTimelineBuildProfile(
  accumulator: ThreadTimelineBuildProfileAccumulator,
  options: BuildThreadTimelineInternalOptions,
): ThreadTimelineBuildProfile {
  return {
    compactedEventCount: accumulator.compactedEventCount,
    contextWindowEventDataBytes: accumulator.contextWindowEventDataBytes,
    contextWindowEventRowCount: accumulator.contextWindowEventRowCount,
    decodedEventCount: accumulator.decodedEventCount,
    eventDataBytes: accumulator.eventDataBytes,
    eventRowCount: accumulator.eventRowCount,
    pageKind: options.page.kind,
    projectedRowCount: accumulator.projectedRowCount,
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
  const snapshot = resolveTimelineSnapshot(
    db,
    thread,
    options.page,
    JSON.stringify([
      options.includeDiagnosticOperations,
      options.includeNestedRows ?? false,
      options.maxInlineOutputChars,
      options.providerDisplayName ?? null,
      thread.title ?? thread.titleFallback ?? "",
      resolveThreadWorkspaceRoot(db, thread),
    ]),
    options.maxSeq === 0 ? undefined : options.maxSeq,
  );
  const contentCursor = readTimelineContentCursor(options.page);
  const profile = options.includeProfile
    ? createThreadTimelineBuildProfileAccumulator()
    : null;
  const includeNestedRows = options.includeNestedRows ?? false;
  const includeDiagnosticOperations = options.includeDiagnosticOperations;
  const contextBoundarySeq = getLatestCompletedThreadContextClearSequence(db, {
    atOrBeforeSequence: snapshot.maxSeq,
    threadId: thread.id,
  });
  const storedEventSelection = measureThreadTimelineStage(
    profile,
    "event-query",
    () =>
      selectStandardTimelineEventRows(
        db,
        thread,
        options.page,
        options.eventBudget,
        options.maxInlineOutputChars,
        contextBoundarySeq ?? 0,
        !includeDiagnosticOperations,
        snapshot.maxSeq,
        contentCursor,
        profile,
      ),
  );
  const eventSelection =
    options.maxInlineOutputChars === null
      ? {
          ...storedEventSelection,
          rows: hydrateRetainedEventOutputRows(db, storedEventSelection.rows),
        }
      : storedEventSelection;
  const rawEventRows = eventSelection.rows;
  if (profile) {
    profile.eventDataBytes = byteLengthOfStoredEventRows(rawEventRows);
    profile.eventRowCount = rawEventRows.length;
    profile.selectionStrategy = eventSelection.strategy;
  }
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
        sequenceStart: contextBoundarySeq ?? 0,
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
    includeDiagnosticOperations,
    isLatestPage: options.page.kind === "latest",
    providerDisplayName: options.providerDisplayName,
    planCommand: options.planCommand,
    threadStatus: snapshot.status,
    threadName: thread.title ?? thread.titleFallback ?? "",
    workspaceRoot: resolveThreadWorkspaceRoot(db, thread),
  };
  const contextWindowEvents = measureThreadTimelineStage(
    profile,
    "context-window-json-decode",
    () => contextWindowUsageRows.map((row) => toThreadEventWithMeta(row)),
  );
  const acceptedClientRequestContext: AcceptedClientRequestContext = {
    acceptedClientRequestEvents: [],
    rejectedClientRequestEvents: [],
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
          includeNestedRows,
          providerId: thread.providerId,
          turnMessageDetail: includeNestedRows ? "full" : "summary",
        },
      }),
  );
  const projectedTimelineRows = applyRetainedOutputPreviews(
    orderTimelineRowsUsingContext(
      timeline.rows.filter(
        (row) =>
          !(
            row.kind === "system" &&
            row.systemKind === "operation" &&
            row.operationKind === "thread-interrupted" &&
            eventSelection.contextOnlyInterruptionSequences.has(
              row.sourceSeqStart,
            )
          ),
      ),
      decodedEvents,
      eventSelection.orderingBoundarySequence,
    ),
    decodedRawEvents,
    "available",
  );
  if (profile) {
    profile.projectedRowCount = projectedTimelineRows.length;
  }
  const paginatedTimeline = measureThreadTimelineStage(
    profile,
    "pagination-segmentation",
    () =>
      paginateTimelineRows({
        contextBoundarySeq,
        contentCursor,
        maxLeaves: Math.max(1, options.eventBudget),
        maxBytes:
          options.responseByteBudget ?? THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT,
        ownedSequenceStart: eventSelection.ownedSequenceStart,
        ownedSequenceEnd: eventSelection.ownedSequenceEnd,
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
    maxSeq: snapshot.maxSeq,
    rows: options.summaryOnly ? [] : paginatedTimeline.rows,
    contextBoundarySeq,
    activePromptMode:
      options.page.kind === "latest" ? timeline.activePromptMode : null,
    activeThinking:
      options.page.kind === "latest" ? timeline.activeThinking : null,
    activeWorkflows:
      options.page.kind === "latest" ? timeline.activeWorkflows : [],
    activeBackgroundCommands:
      options.page.kind === "latest" ? timeline.activeBackgroundCommands : [],
    pendingTodos: timeline.pendingTodos,
    goal: timeline.goal,
    modelFallback:
      options.page.kind === "latest" ? timeline.modelFallback : null,
    providerAuthRequired:
      options.page.kind === "latest" ? timeline.providerAuthRequired : null,
    contextWindowUsage:
      options.page.kind === "latest"
        ? (timeline.contextWindowUsage ?? undefined)
        : undefined,
    timelinePage: {
      kind: eventSelection.responsePageKind,
      segmentLimit: options.page.segmentLimit,
      returnedSegmentCount: paginatedTimeline.returnedSegmentCount,
      hasOlderRows: paginatedTimeline.hasOlderRows,
      olderCursor: bindTimelineCursor(
        paginatedTimeline.olderCursor,
        snapshot,
        paginatedTimeline.contentCursor,
      ),
      historySnapshot: timelineSnapshotKey(snapshot),
      contentPage: paginatedTimeline.contentPage,
    },
  };
  return {
    response,
    profile:
      profile === null
        ? null
        : completeThreadTimelineBuildProfile(profile, options),
  };
}

export function buildThreadTimeline(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineOptions,
): ThreadTimelineResponse {
  return runEventLoopWorkSync(`timeline-build ${thread.id}`, () =>
    db.transaction(
      () =>
        buildThreadTimelineInternal(db, thread, {
          ...options,
          includeProfile: false,
        }).response,
    ),
  );
}

export function buildThreadTimelineWithProfile(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineOptions,
): { profile: ThreadTimelineBuildProfile; response: ThreadTimelineResponse } {
  return runEventLoopWorkSync(`timeline-build ${thread.id}`, () => {
    const result = db.transaction(() =>
      buildThreadTimelineInternal(db, thread, {
        ...options,
        includeProfile: true,
      }),
    );
    if (result.profile === null) {
      throw new Error("Profiled timeline build returned no profile");
    }
    return { profile: result.profile, response: result.response };
  });
}

interface BuildThreadConversationOutlineOptions {
  maxSeq: number;
  providerDisplayName?: string;
}

interface LoadThreadConversationOutlineOptions extends BuildThreadConversationOutlineOptions {
  outlineSequence: number;
}

const CONVERSATION_OUTLINE_PREVIEW_MAX_LENGTH = 200;
const CONVERSATION_OUTLINE_PROJECTION_VERSION = 1;
const conversationOutlineItemsSchema =
  threadConversationOutlineItemSchema.array();

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

export function buildThreadConversationOutline(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadConversationOutlineOptions,
): ThreadConversationOutlineResponse {
  return runEventLoopWorkSync(`conversation-outline ${thread.id}`, () => {
    const contextBoundarySeq = getLatestCompletedThreadContextClearSequence(
      db,
      {
        atOrBeforeSequence: options.maxSeq,
        threadId: thread.id,
      },
    );
    const rawEventRows = listStoredConversationOutlineEventRows(db, {
      sequenceStart: contextBoundarySeq ?? 0,
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
        includeNestedRows: false,
        includeDiagnosticOperations: false,
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

export function buildThreadConversationOutlineProjectionKey(
  thread: Thread,
  outlineSequence: number,
  providerDisplayName: string | undefined,
): string {
  return JSON.stringify([
    CONVERSATION_OUTLINE_PROJECTION_VERSION,
    outlineSequence,
    thread.providerId,
    providerDisplayName ?? null,
    thread.status,
    thread.title,
    thread.titleFallback,
  ]);
}

function parseThreadConversationOutlineItems(
  itemsJson: string,
): ThreadConversationOutlineItem[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(itemsJson);
  } catch {
    return null;
  }
  const result = conversationOutlineItemsSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

function shouldMaterializeThreadConversationOutline(thread: Thread): boolean {
  return thread.status === "idle" || thread.status === "error";
}

export function loadThreadConversationOutline(
  db: DbConnection,
  thread: Thread,
  options: LoadThreadConversationOutlineOptions,
): ThreadConversationOutlineResponse {
  const projectionKey = buildThreadConversationOutlineProjectionKey(
    thread,
    options.outlineSequence,
    options.providerDisplayName,
  );
  const stored = getThreadConversationOutlineRecord(db, thread.id);
  if (stored?.projectionKey === projectionKey) {
    const items = parseThreadConversationOutlineItems(stored.itemsJson);
    if (items !== null) {
      return { items, maxSeq: options.maxSeq };
    }
  }

  const response = buildThreadConversationOutline(db, thread, options);
  if (shouldMaterializeThreadConversationOutline(thread)) {
    upsertThreadConversationOutlineRecord(db, {
      itemsJson: JSON.stringify(response.items),
      projectionKey,
      threadId: thread.id,
    });
  }
  return response;
}

export function buildTimelineTurnSummaryDetails(
  db: DbConnection,
  thread: Thread,
  options: BuildTimelineTurnSummaryDetailsOptions,
): TimelineTurnSummaryDetailsResponse {
  return db.transaction(() =>
    buildTimelineTurnSummaryDetailsPage(db, thread, options),
  );
}

function buildTimelineTurnSummaryDetailsPage(
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

  const detailsPage: ThreadTimelinePageRequest =
    options.beforeCursor === undefined
      ? { kind: "latest", segmentLimit: 1 }
      : {
          kind: "older",
          segmentLimit: 1,
          beforeCursor: {
            anchorId: options.beforeCursor,
            anchorSeq: Math.max(1, options.sourceSeqStart),
          },
        };
  const snapshot = resolveTimelineSnapshot(
    db,
    thread,
    detailsPage,
    JSON.stringify([
      "turn-details",
      options.turnId,
      options.sourceSeqStart,
      options.sourceSeqEnd,
      options.includeDiagnosticOperations,
      options.providerDisplayName ?? null,
      thread.title ?? thread.titleFallback ?? "",
      resolveThreadWorkspaceRoot(db, thread),
    ]),
  );
  const contentCursor = readTimelineContentCursor(detailsPage);
  const includeDiagnosticOperations = options.includeDiagnosticOperations;
  const detailsWindow = {
    beforeSequence: Math.min(options.sourceSeqEnd, snapshot.maxSeq) + 1,
    excludeDiagnosticEvents: !includeDiagnosticOperations,
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
    }).filter((row) => row.sequence <= snapshot.maxSeq);
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
  const wholeItemEventRows = ensureSequenceWindowWholeItemRows(db, {
    beforeSequence: detailsWindow.beforeSequence,
    maxInlineOutputChars: detailsInlineOutputLimit,
    ownership: "later",
    rows: mergeStoredEventRowsById([...requestedTurnStartedRows, ...eventRows]),
    sequenceStart: detailsWindow.sequenceStart,
    threadId: thread.id,
  });
  const eventRowsWithParentedChildren = ensureTimelineWindowParentedRows(db, {
    excludeDiagnosticEvents: !includeDiagnosticOperations,
    maxInlineOutputChars: detailsInlineOutputLimit,
    sequenceBounds: {
      beforeSequence: snapshot.maxSeq + 1,
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
      beforeSequence: snapshot.maxSeq + 1,
    });
  const hydratedEventRows =
    detailsInlineOutputLimit === null
      ? hydrateRetainedEventOutputRowsWithinDataByteLimit(
          db,
          eventRowsWithBackgroundTaskState,
          THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT,
        )
      : eventRowsWithBackgroundTaskState;
  const projectionEventRows =
    byteLengthOfStoredEventRows(hydratedEventRows) <=
    THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT
      ? hydratedEventRows
      : eventRowsWithBackgroundTaskState;
  const projectionSourceSeqStart = eventRowsWithTurnStarts.reduce(
    (sourceSeqStart, row) =>
      row.type === "turn/started" && row.turnId === options.turnId
        ? Math.min(sourceSeqStart, row.sequence)
        : sourceSeqStart,
    sourceRange.sourceSeqStart,
  );
  const projectionEvents = projectionEventRows
    .filter((row) => row.sequence <= snapshot.maxSeq)
    .map((row) => toThreadEventWithMeta(row));
  const children = buildThreadTimelineTurnDetailsFromEvents({
    events: projectionEvents,
    options: {
      includeDiagnosticOperations,
      sourceSeqEnd: sourceRange.sourceSeqEnd,
      sourceSeqStart: projectionSourceSeqStart,
      providerDisplayName: options.providerDisplayName,
      threadStatus: snapshot.status,
      threadName: thread.title ?? thread.titleFallback ?? "",
      workspaceRoot: resolveThreadWorkspaceRoot(db, thread),
    },
  });

  if (children.kind !== "missing-match") {
    const contents = paginateTimelineContents(
      applyRetainedOutputPreviews(
        children.rows,
        projectionEvents,
        "detail-limit",
      ),
      contentCursor?.beforeLeaf,
      1_500,
      THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT,
    );
    const cursor =
      contents.start === 0
        ? null
        : bindTimelineCursor(
            {
              anchorId: options.turnId,
              anchorSeq: Math.max(1, options.sourceSeqStart),
            },
            snapshot,
            { beforeLeaf: contents.start, beforeSequence: snapshot.maxSeq + 1 },
          );
    return {
      rows: contents.rows,
      olderCursor: cursor?.anchorId ?? null,
      historySnapshot: timelineSnapshotKey(snapshot),
    };
  }

  throw new Error(
    `Timeline turn summary details could not match range ${options.sourceSeqStart}-${options.sourceSeqEnd}`,
  );
}
