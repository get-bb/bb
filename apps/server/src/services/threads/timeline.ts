import {
  projectConversationOutlineIncrementally,
  type ConversationOutlineSelection,
} from "./conversation-outline-cache.js";
import { paginateTimelineContents } from "./timeline-content-pagination.js";
import {
  deferSettledTimelineRow,
  timelineRowItemId,
} from "./timeline-deferred-content.js";
import {
  DEFAULT_MAX_INLINE_OUTPUT_CHARS,
  previewTimelineRowOutput,
} from "./timeline-output-shortening.js";
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
  type TimelineSnapshot,
} from "./timeline-snapshot.js";
import {
  buildThreadTimelineFromEvents,
  buildThreadTimelineFromProjection,
  projectThreadTimelineEvents,
  startThreadTimelineProjectionFold,
  THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
  buildThreadTimelineTurnDetailsFromEvents,
  compactThreadTimelineSummaryEvents,
  extractThreadProviderCommands,
  extractThreadSessionOptions,
  extractThreadTimelinePendingTodos,
  MIN_AGENT_MESSAGE_DELTAS_FOR_SUMMARY_COMPACTION,
  type AcceptedClientRequestContext,
  type EventProjection,
  type ThreadEventWithMeta,
} from "@bb/thread-view";
import {
  THREAD_PROVIDER_COMMANDS_STATE_KIND,
  THREAD_SESSION_OPTIONS_STATE_KIND,
  THREAD_SESSION_OPTION_SELECTIONS_STATE_KIND,
} from "@bb/domain";
import { sliceUtf16Head } from "@bb/text-utils";
import type {
  ClientTurnRequestId,
  CompletedTurnDisplay,
  ProviderComposerCommand,
  Thread,
  ThreadEvent,
  ThreadEventItemType,
} from "@bb/domain";
import type {
  ThreadConversationOutlineItem,
  ThreadConversationOutlineResponse,
  ThreadHeadStateResponse,
  TimelineConversationAttachments,
  ThreadConversationOutlineAttachmentSummary,
  ThreadMessageResponse,
  TimelineConversationRow,
  TimelineRow,
  TimelineOutputPreview,
  ThreadTimelineResponse,
  TimelineTurnSummaryDetailsResponse,
} from "@bb/server-contract";
import {
  mapTimelineRowTree,
  threadConversationOutlineItemSchema,
  timelineRowChildren,
} from "@bb/server-contract";
import {
  findStoredTimelineWindowByteBudgetFloor,
  findTimelineWindowBudgetFloorSequence,
  hydrateRetainedEventOutputRows,
  hydrateRetainedEventOutputRowsWithinDataByteLimit,
  getEnvironment,
  getLatestCompletedThreadContextClearSequence,
  getThreadConversationOutlineRecord,
  getStoredThreadEventRewriteGeneration,
  getThreadEventRewriteGeneration,
  listContextWindowUsageRows,
  isTimelineCursorSequencePresent,
  listStoredConversationOutlineEventRows,
  listStoredRootConversationOutlineEventRows,
  getStoredConversationOutlineProjectionState,
  listStoredClientTurnRequestIdsInRange,
  listStoredEventRows,
  listTimelineInterruptionRows,
  listStoredClientTurnRequestRowsByKeys,
  listStoredEventRowsByParentToolCallIds,
  listItemEventSpansByItems,
  listStoredBufferedTextDeltaRowsByItems,
  getStoredItemLifecycleSequenceRange,
  listStoredItemLifecycleRowsByItems,
  listLatestBackgroundTaskStateRowsByItemIds,
  listLatestThreadStateEventRowsByThreadIds,
  listLatestOpenBackgroundTaskStateRowsForThread,
  listStoredTimelineWindowEventRows,
  listStoredTimelineItemEventRows,
  listStoredItemStartSequencesBefore,
  listTimelineTurnEventRefsBefore,
  countTimelineTurnEventsOutsideWindow,
  listTimelineTurnFirstSequences,
  listStoredTimelineTurnEventRows,
  listStoredTimelineTurnContextRows,
  listStoredTimelineThreadWindowEventRows,
  listTimelineRootWindowTurnIds,
  listTodoSnapshotEventRowsForThread,
  listStoredDelegatingItemRowsByItemIds,
  listStoredTurnInputAcceptedRowsByClientRequestIds,
  listStoredTurnRejectedRowsByClientRequestIds,
  listStoredTurnStartedRowsByTurnIdsUpToSequence,
  listTimelineWindowHintsDescending,
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
import { roundDurationMs } from "@bb/process-utils";
import {
  finishMainThreadCost,
  runEventLoopWorkSync,
  startMainThreadCost,
  type MainThreadCost,
} from "../system/event-loop-work.js";
import { parseStoredEvent } from "./thread-data.js";
import { withCompactionOffer } from "./compaction-offer.js";
import { decodeStoredEventRowCached } from "./stored-event-decode-cache.js";
import {
  keepTimelineProjection,
  type BuiltTimelineProjection,
  type TimelineProjection,
} from "./timeline-projection-cache.js";
import {
  byteLengthOfStoredEventRows,
  decodeTimelineSelectionRows,
  withRowMeta,
} from "./timeline-selection-decode.js";
import { reusePreviousPageableTimelineRows } from "./timeline-window-reuse.js";
import {
  getOrProjectTimelineTurnDetails,
  type TimelineTurnDetailsProjection,
} from "./timeline-turn-details-cache.js";
import {
  loadValidTimelineTurnPlans,
  storeTimelineTurnPlans,
  timelineTurnPlanProjectionKey,
  type LoadedTimelineTurnPlan,
} from "./timeline-turn-plans.js";
import {
  forgetTimelineProjectionFolds,
  keepTimelineProjectionFold,
} from "./timeline-projection-fold.js";
import {
  timelineTurnSplitter,
  selectTimelineWindowStart,
  lookupLatestTimelineSelection,
  rememberDecodedLatestTimelineSelection,
  rememberLatestTimelineSelection,
  TimelineSelectionTrimFallback,
  isTurnContextRow,
  type LatestTimelineSelectionMemoArgs,
  type TimelineSelectionRowSource,
  type StandardTimelineEventRowSelection,
  type ThreadTimelineEventSelectionStrategy,
  type TimelineBudgetFloor,
} from "./timeline-selection-memo.js";
import {
  paginateTimelineRows,
  type ThreadTimelinePageKind,
  type ThreadTimelinePageRequest,
} from "./timeline-pagination.js";

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

export function resolveThreadTimelineSurface(
  db: DbConnection,
  thread: Thread,
  options: ThreadTimelineSurfaceOptions,
): ThreadTimelineSurface {
  const threadName = thread.title ?? thread.titleFallback ?? "";
  const workspaceRoot = resolveThreadWorkspaceRoot(db, thread);
  const cursorKey = JSON.stringify([
    options.includeClearedContextHistory,
    options.includeDiagnosticOperations,
    options.includeNestedRows ?? false,
    options.deferContent ?? false,
    options.maxInlineOutputChars,
    options.providerDisplayName ?? null,
    threadName,
    workspaceRoot,
    options.completedTurnDisplay,
    options.summarizeShellCommands,
  ]);
  return {
    cursorKey,
    cacheKey: JSON.stringify([
      cursorKey,
      options.planCommand ?? null,
      options.compactionOfferEnabled,
    ]),
    threadName,
    workspaceRoot,
  };
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

export interface ThreadTimelineSurfaceOptions {
  compactionOfferEnabled: boolean;
  completedTurnDisplay: CompletedTurnDisplay;
  deferContent?: boolean;
  includeClearedContextHistory: boolean;
  includeDiagnosticOperations: boolean;
  includeNestedRows?: boolean;
  maxInlineOutputChars: InlineOutputCharLimit;
  providerDisplayName?: string;
  planCommand?: ProviderComposerCommand | null;
  extensionStateKinds?: readonly string[];
  summarizeShellCommands: boolean;
}

interface ThreadTimelineSurface {
  cursorKey: string;
  cacheKey: string;
  threadName: string;
  workspaceRoot: string | null;
}

interface BuildThreadTimelineOptions extends ThreadTimelineSurfaceOptions {
  eventBudget: number;
  responseByteBudget?: number;
  maxSeq: number;
  page: ThreadTimelinePageRequest;
  summaryOnly?: boolean;
}

interface BuildTimelineTurnSummaryDetailsOptions extends TimelineTurnSummarySelection {
  beforeCursor?: string;
  deferContent: boolean;
  itemId: string | null;
  completedTurnDisplay: CompletedTurnDisplay;
  includeDiagnosticOperations: boolean;
  summarizeShellCommands: boolean;
  providerDisplayName?: string;
}

export const THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT = 20;
const MAX_EMPTY_TIMELINE_WINDOWS = 8;

export const THREAD_TIMELINE_SEGMENT_LIMIT_MAX = 100;

export const THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT = 4 * 1024 * 1024;

export const TIMELINE_TURN_DETAILS_PAGE_LEAF_LIMIT = 200;

export const TIMELINE_TURN_DETAILS_PAGE_BYTE_LIMIT = 1024 * 1024;

type ThreadTimelineBuildProfileStage =
  | "event-query"
  | "selection-memo-lookup"
  | "group-context-query"
  | "ordering-context-query"
  | "accepted-client-request-context-query"
  | "event-json-decode"
  | "summary-compaction"
  | "context-window-query"
  | "context-window-json-decode"
  | "thread-view-projection"
  | "thread-view-rows"
  | "pagination-segmentation";

interface ThreadTimelineBuildProfileStageTiming {
  durationMs: number;
  stage: ThreadTimelineBuildProfileStage;
}

export interface ThreadTimelineBuildProfile {
  compactedEventCount: number;
  foldedEventCount: number;
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

export type ThreadTimelineWindow = Omit<ThreadTimelineResponse, "tag">;

interface BuildThreadTimelineInternalResult {
  profile: ThreadTimelineBuildProfile;
  response: ThreadTimelineWindow;
}

interface ThreadTimelineBuildProfileAccumulator {
  compactedEventCount: number;
  foldedEventCount: number;
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

interface TimelineWindowRowsArgs {
  rows: readonly StoredEventRow[];
  threadId: string;
}

interface TimelineWindowParentedRowsArgs extends TimelineWindowRowsArgs {
  childOwnerSequenceStart?: number;
  excludeDiagnosticEvents: boolean;
  source: TimelineSelectionRowSource;
  maxInlineOutputChars: InlineOutputCharLimit;
  sequenceBounds: {
    beforeSequence: number | undefined;
    sequenceStart: number;
  } | null;
  lookups: TimelineWindowParentedRowLookups;
}

interface TimelineWindowParentedRowLookups {
  childToolCallIds: Set<string>;
  loadedTurnIds: ReadonlySet<string>;
  parentToolCallIds: Set<string>;
}

function createTimelineWindowParentedRowLookups(
  loadedTurnIds: ReadonlySet<string>,
): TimelineWindowParentedRowLookups {
  return {
    childToolCallIds: new Set(),
    loadedTurnIds,
    parentToolCallIds: new Set(),
  };
}

interface TimelineWindowParentedRowsResult {
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
  return withRowMeta(row, parseStoredEvent(row));
}

export function retainedOutputPreviewsByCallId(
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

function nextRetainedOutputPreviewExpiry(
  events: readonly ThreadEventWithMeta[],
  now: number,
): number | null {
  let expiresAt: number | null = null;
  for (const { event } of events) {
    if (event.type !== "item/completed") {
      continue;
    }
    const item = event.item;
    const truncation =
      item.type === "commandExecution"
        ? item.truncation?.aggregatedOutput
        : item.type === "toolCall"
          ? item.truncation?.result
          : undefined;
    if (
      truncation !== undefined &&
      truncation.truncatedAt > now &&
      (expiresAt === null || truncation.truncatedAt < expiresAt)
    ) {
      expiresAt = truncation.truncatedAt;
    }
  }
  return expiresAt;
}

export function withRetainedOutputPreview(
  row: TimelineRow,
  previews: ReadonlyMap<string, TimelineOutputPreview>,
): TimelineRow {
  if (
    row.kind !== "work" ||
    (row.workKind !== "command" && row.workKind !== "tool")
  ) {
    return row;
  }
  const outputPreview = previews.get(row.callId);
  return outputPreview === undefined ? row : { ...row, outputPreview };
}

type StoredEventDecoder = (row: StoredEventRow) => ThreadEvent;

function parseAcceptedInputClientRequestId(
  row: StoredEventRow,
  decode: StoredEventDecoder = parseStoredEvent,
): ClientTurnRequestId {
  const event = decode(row);
  switch (event.type) {
    case "turn/input/accepted":
      return event.clientRequestId;
    default:
      throw new Error(`Expected turn/input/accepted row ${row.id}`);
  }
}

function parseRejectedClientRequestId(
  row: StoredEventRow,
  decode: StoredEventDecoder = parseStoredEvent,
): ClientTurnRequestId {
  const event = decode(row);
  if (event.type !== "client/turn/rejected") {
    throw new Error(`Expected client/turn/rejected row ${row.id}`);
  }
  return event.requestId;
}

function tryReadClientTurnRequestedRequestId(
  row: StoredEventRow,
  decode: StoredEventDecoder = parseStoredEvent,
): ClientTurnRequestId | null {
  if (row.type !== "client/turn/requested") {
    return null;
  }
  const event = decode(row);
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

function databaseTimelineRowSource(
  db: DbConnection,
): TimelineSelectionRowSource {
  return {
    listChildRows: (args) => listStoredEventRowsByParentToolCallIds(db, args),
    listItemRows: (args) => listStoredTimelineItemEventRows(db, args),
    listItemStartsBefore: (args) =>
      listStoredItemStartSequencesBefore(db, args),
    listContextRows: (args) =>
      listStoredEventRows(db, { ...args, types: [...args.types] }),
    listParentRows: (args) => listStoredDelegatingItemRowsByItemIds(db, args),
    listRootWindowTurnIds: (args) => listTimelineRootWindowTurnIds(db, args),
    listThreadWindowRows: (args) =>
      listStoredTimelineThreadWindowEventRows(db, args),
    listTurnContextRows: (args) => listStoredTimelineTurnContextRows(db, args),
    countTurnEventsOutsideWindow: (args) =>
      countTimelineTurnEventsOutsideWindow(db, args),
    listTurnFirstSequences: (args) => listTimelineTurnFirstSequences(db, args),
    listTurnRows: (args) => listStoredTimelineTurnEventRows(db, args),
  };
}

const SMALL_TURN_OUTSIDE_EVENTS = 256;
const PLAN_MIN_TURN_EVENTS = 1_000;
const PLANNED_TURN_MAX_RANGES = 32;

function listPlannedTurnRows(
  source: TimelineSelectionRowSource,
  args: {
    beforeSequence: number;
    plans: ReadonlyMap<string, LoadedTimelineTurnPlan>;
    sequenceStart: number;
    windowArgs: Omit<
      Parameters<TimelineSelectionRowSource["listTurnRows"]>[0],
      "turnIds"
    >;
  },
): StoredEventRow[] {
  return [...args.plans].flatMap(([turnId, loaded]) => {
    const ranges = loaded.plan.items
      .flatMap((item) =>
        item.kind === "message" &&
        item.sourceSeqStart < args.beforeSequence &&
        item.sourceSeqEnd >= args.sequenceStart
          ? [{ end: item.sourceSeqEnd, start: item.sourceSeqStart }]
          : [],
      )
      .sort((left, right) => left.start - right.start)
      .reduce<{ end: number; start: number }[]>((merged, range) => {
        const last = merged[merged.length - 1];
        if (last !== undefined && range.start <= last.end + 1) {
          last.end = Math.max(last.end, range.end);
        } else {
          merged.push({ ...range });
        }
        return merged;
      }, []);
    const reads =
      ranges.length > PLANNED_TURN_MAX_RANGES
        ? [{ end: ranges[ranges.length - 1]!.end, start: ranges[0]!.start }]
        : ranges;
    return reads.flatMap((range) =>
      source.listTurnRows({
        ...args.windowArgs,
        sequenceStart: range.start,
        beforeSequence: range.end + 1,
        turnIds: [turnId],
      }),
    );
  });
}

const OMITTED_TURN_EVENT_SCAN_PAGE_SIZE = 256;

function latestPlannedMessageSequenceBefore(
  plans: ReadonlyMap<string, LoadedTimelineTurnPlan>,
  sequenceStart: number,
): number | null {
  let latest: number | null = null;
  for (const { plan } of plans.values()) {
    for (const item of plan.items) {
      if (
        item.kind === "message" &&
        item.sourceSeqEnd < sequenceStart &&
        (latest === null || item.sourceSeqEnd > latest)
      ) {
        latest = item.sourceSeqEnd;
      }
    }
  }
  return latest;
}

function latestWindowedTurnRowSequenceBefore(
  db: DbConnection,
  args: {
    epochSequenceStart: number;
    excludeDiagnosticEvents: boolean;
    maxInlineOutputChars: InlineOutputCharLimit;
    rows: readonly StoredEventRow[];
    sequenceStart: number;
    threadId: string;
    windowedTurnIds: ReadonlySet<string>;
  },
): number | null {
  if (args.windowedTurnIds.size === 0) return null;
  const parents = new Map<string, string | null>();
  for (const row of args.rows) {
    if (row.itemId !== null && !parents.has(row.itemId)) {
      parents.set(row.itemId, getStoredEventParentToolCallId(row) ?? null);
    }
  }
  const reaching = new Set<string>();
  const markReaching = (itemId: string | null) => {
    while (itemId !== null && !reaching.has(itemId)) {
      reaching.add(itemId);
      itemId = parents.get(itemId) ?? null;
    }
  };
  for (const row of args.rows) {
    if (row.sequence < args.sequenceStart) continue;
    markReaching(row.itemId);
    markReaching(getStoredEventParentToolCallId(row) ?? null);
  }
  const parentOf = (itemId: string): string | null => {
    if (!parents.has(itemId)) {
      const [parent] = listStoredDelegatingItemRowsByItemIds(db, {
        itemIds: [itemId],
        maxInlineOutputChars: args.maxInlineOutputChars,
        threadId: args.threadId,
      });
      parents.set(
        itemId,
        parent === undefined
          ? null
          : (getStoredEventParentToolCallId(parent) ?? null),
      );
    }
    return parents.get(itemId) ?? null;
  };
  const rowReachesWindow = (
    itemId: string | null,
    parentToolCallId: string | null,
  ): boolean => {
    if (itemId !== null && reaching.has(itemId)) return true;
    const visited = new Set<string>();
    let parent = parentToolCallId === "" ? null : parentToolCallId;
    while (parent !== null && !visited.has(parent)) {
      if (reaching.has(parent)) return true;
      visited.add(parent);
      parent = parentOf(parent);
    }
    return false;
  };
  let scanStart = args.epochSequenceStart;
  let beforeSequence = args.sequenceStart;
  for (let page = 0; ; page += 1) {
    if (page === 1) {
      scanStart = Math.max(
        scanStart,
        Math.min(
          ...listTimelineTurnFirstSequences(db, {
            epochSequenceStart: args.epochSequenceStart,
            maxSeq: args.sequenceStart - 1,
            threadId: args.threadId,
            turnIds: [...args.windowedTurnIds],
          }).values(),
        ),
      );
    }
    const refs = listTimelineTurnEventRefsBefore(db, {
      beforeSequence,
      excludeDiagnosticEvents: args.excludeDiagnosticEvents,
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
      limit: OMITTED_TURN_EVENT_SCAN_PAGE_SIZE,
      sequenceStart: scanStart,
      threadId: args.threadId,
    });
    for (const ref of refs) {
      if (
        args.windowedTurnIds.has(ref.turnId) &&
        !isTurnContextRow(ref) &&
        !rowReachesWindow(ref.itemId, ref.parentToolCallId)
      ) {
        return ref.sequence;
      }
    }
    if (refs.length < OMITTED_TURN_EVENT_SCAN_PAGE_SIZE) return null;
    beforeSequence = refs[refs.length - 1]!.sequence;
  }
}

function latestOmittedTurnRowSequence(
  db: DbConnection,
  args: Parameters<typeof latestWindowedTurnRowSequenceBefore>[1] & {
    turnPlans: ReadonlyMap<string, LoadedTimelineTurnPlan>;
  },
): number | null {
  if (args.sequenceStart <= args.epochSequenceStart) return null;
  const planned = latestPlannedMessageSequenceBefore(
    args.turnPlans,
    args.sequenceStart,
  );
  const windowed = latestWindowedTurnRowSequenceBefore(db, args);
  return planned === null
    ? windowed
    : windowed === null
      ? planned
      : Math.max(planned, windowed);
}

interface WindowedTurnItemRowsArgs {
  closedItemKeys: Set<string>;
  epochSequenceStart: number;
  excludeDiagnosticEvents: boolean;
  latestPage: boolean;
  maxInlineOutputChars: InlineOutputCharLimit;
  maxSeq: number;
  rows: readonly StoredEventRow[];
  sequenceStart: number;
  source: TimelineSelectionRowSource;
  threadId: string;
  windowedTurnIds: ReadonlySet<string>;
}

function collectWindowedTurnItemsCrossingWindow(
  args: WindowedTurnItemRowsArgs,
): ScopedItemRef[] {
  const items = new Map<
    string,
    { ref: ScopedItemRef; started: boolean; terminal: boolean }
  >();
  const startedItemIds = new Set<string>();
  const threadItemIds = new Set<string>();
  for (const row of args.rows) {
    if (row.itemId === null) continue;
    if (row.type === "item/started") startedItemIds.add(row.itemId);
    if (row.turnId === null) {
      const key = scopedItemRefKey(storedEventRowItemRef(row));
      if (row.scopeKind === "thread" && !args.closedItemKeys.has(key)) {
        args.closedItemKeys.add(key);
        threadItemIds.add(row.itemId);
      }
      continue;
    }
    if (!args.windowedTurnIds.has(row.turnId)) continue;
    const ref = storedEventRowItemRef(row);
    const key = scopedItemRefKey(ref);
    if (args.closedItemKeys.has(key)) continue;
    let item = items.get(key);
    if (item === undefined) {
      item = { ref, started: false, terminal: false };
      items.set(key, item);
    }
    if (row.type === "item/started") item.started = true;
    if (row.type === "item/completed") item.terminal = true;
  }
  const crossing: ScopedItemRef[] = [];
  const completedWithoutStart = new Set<string>();
  const startLookups = new Set<string>();
  for (const [key, item] of items) {
    args.closedItemKeys.add(key);
    if (!item.started && item.terminal) {
      completedWithoutStart.add(key);
      startLookups.add(item.ref.itemId);
    } else if (!item.started || (!item.terminal && !args.latestPage)) {
      crossing.push(item.ref);
    }
  }
  const threadItemsWithoutStart = new Set(
    [...threadItemIds].filter((itemId) => !startedItemIds.has(itemId)),
  );
  for (const itemId of threadItemsWithoutStart) startLookups.add(itemId);
  if (startLookups.size === 0) return crossing;
  return [
    ...crossing,
    ...args.source
      .listItemStartsBefore({
        beforeSequence: args.sequenceStart,
        itemIds: [...startLookups],
        threadId: args.threadId,
      })
      .filter(
        (start) =>
          completedWithoutStart.has(scopedItemRefKey(start)) ||
          (threadItemsWithoutStart.has(start.itemId) &&
            start.turnId !== null &&
            args.windowedTurnIds.has(start.turnId)),
      ),
  ];
}

function listWindowedTurnItemRows(
  args: WindowedTurnItemRowsArgs,
): StoredEventRow[] {
  const items = collectWindowedTurnItemsCrossingWindow(args);
  if (items.length === 0) return [];
  return args.source
    .listItemRows({
      beforeSequence: args.maxSeq + 1,
      excludeDiagnosticEvents: args.excludeDiagnosticEvents,
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
      items,
      maxInlineOutputChars: args.maxInlineOutputChars,
      sequenceStart: args.epochSequenceStart,
      threadId: args.threadId,
    })
    .filter((row) => row.sequence <= args.maxSeq);
}

function ensureTimelineWindowParentedRows(
  db: DbConnection,
  args: TimelineWindowParentedRowsArgs,
): TimelineWindowParentedRowsResult {
  let rows = [...args.rows];
  const rowIds = new Set(rows.map((row) => row.id));
  const visibleToolCallIds = new Set(collectStoredDelegatingItemIds(rows));
  const { lookups } = args;
  const ownerSequenceStart = args.childOwnerSequenceStart;
  const ownsChildren = (toolCallId: string): boolean =>
    ownerSequenceStart === undefined ||
    rows.some(
      (row) =>
        row.type === "item/started" &&
        row.itemId === toolCallId &&
        row.sequence >= ownerSequenceStart,
    );

  while (true) {
    const toolCallIdsToFetch = [...visibleToolCallIds].filter(
      (toolCallId) =>
        !lookups.childToolCallIds.has(toolCallId) && ownsChildren(toolCallId),
    );
    if (toolCallIdsToFetch.length === 0) {
      break;
    }
    for (const toolCallId of toolCallIdsToFetch) {
      lookups.childToolCallIds.add(toolCallId);
    }

    const childSequenceBounds = args.sequenceBounds;
    const childRows = args.source.listChildRows({
      beforeSequence: childSequenceBounds?.beforeSequence,
      excludedTurnIds: [...lookups.loadedTurnIds],
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

  const missingParentToolCallIds = collectStoredParentToolCallIds(rows).filter(
    (parentToolCallId) =>
      !visibleToolCallIds.has(parentToolCallId) &&
      !lookups.parentToolCallIds.has(parentToolCallId),
  );
  for (const parentToolCallId of missingParentToolCallIds) {
    lookups.parentToolCallIds.add(parentToolCallId);
  }
  const parentRows = args.source.listParentRows({
    itemIds: missingParentToolCallIds,
    maxInlineOutputChars: args.maxInlineOutputChars,
    threadId: args.threadId,
  });
  const newParentRows = parentRows.filter((row) => !rowIds.has(row.id));

  return {
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
): StoredEventRow[] {
  const rows: StoredEventRow[] = [];
  const openToolCallIds = new Set<string>();
  for (const row of args.exactEventRows) {
    if (row.scopeKind === "turn" && row.turnId !== args.turnId) {
      const continuesOpenToolCall =
        row.itemId !== null &&
        row.type.startsWith("item/") &&
        openToolCallIds.has(row.itemId);
      if (!continuesOpenToolCall) {
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
      continue;
    }
    rows.push(row);
  }

  return rows;
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
    if (
      (row.itemKind === "backgroundTask" || row.itemKind === "delegation") &&
      row.itemId !== null
    ) {
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

function listLatestTimelineHeadStateRows(
  db: DbConnection,
  threadId: string,
  extensionStateKinds: readonly string[],
): StoredEventRow[] {
  return mergeStoredEventRowsById([
    ...extensionStateKinds.flatMap((kind) =>
      listLatestThreadStateEventRowsByThreadIds(db, {
        threadIds: [threadId],
        kind,
      }),
    ),
    ...listLatestThreadStateEventRowsByThreadIds(db, {
      threadIds: [threadId],
      kind: THREAD_PROVIDER_COMMANDS_STATE_KIND,
    }),
    ...listLatestThreadStateEventRowsByThreadIds(db, {
      threadIds: [threadId],
      kind: THREAD_SESSION_OPTIONS_STATE_KIND,
    }),
    ...listLatestThreadStateEventRowsByThreadIds(db, {
      threadIds: [threadId],
      kind: THREAD_SESSION_OPTION_SELECTIONS_STATE_KIND,
    }),
    ...listTodoSnapshotEventRowsForThread(db, { threadId }),
  ]);
}

export function readThreadHeadState(
  db: DbConnection,
  thread: Thread,
): ThreadHeadStateResponse {
  const events = listLatestTimelineHeadStateRows(db, thread.id, []).map((row) =>
    withRowMeta(row, decodeStoredEventRowCached(db, row)),
  );
  return {
    pendingTodos: extractThreadTimelinePendingTodos(thread.status, events),
    providerCommands: extractThreadProviderCommands(events),
    sessionOptions: extractThreadSessionOptions(events),
  };
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
  knownBudgetFloor: TimelineBudgetFloor | null,
  profile: ThreadTimelineBuildProfileAccumulator,
  source: TimelineSelectionRowSource,
  extensionStateKinds: readonly string[],
  flatTurnDisplay: boolean,
  turnPlanKey: string | null,
): StandardTimelineEventRowSelection {
  const decode: StoredEventDecoder = (row) =>
    decodeStoredEventRowCached(db, row);
  const beforeSequence =
    contentCursor?.beforeSequence ??
    (page.kind === "older" ? page.beforeCursor.anchorSeq : maxSeq + 1);
  const hints = listTimelineWindowHintsDescending(db, {
    threadId: thread.id,
    sequenceStart: epochSequenceStart,
    beforeSequence,
    limit: page.segmentLimit + 1,
  });
  if (
    page.kind === "older" &&
    page.beforeCursor.anchorSeq !== epochSequenceStart &&
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
  const budgetFloor =
    knownBudgetFloor === null
      ? findTimelineWindowBudgetFloorSequence(db, {
          threadId: thread.id,
          sequenceStart: epochSequenceStart,
          beforeSequence,
          eventBudget,
          excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
          excludeDiagnosticEvents,
        })
      : knownBudgetFloor.sequence;
  const sequenceStart =
    contentCursor !== undefined && page.kind === "older"
      ? page.beforeCursor.anchorSeq
      : selectTimelineWindowStart({
          budgetFloorSequence: budgetFloor,
          epochSequenceStart,
          eventBudget,
          hints,
          segmentLimit: page.segmentLimit,
          splitTurnAt: timelineTurnSplitter(db, {
            epochSequenceStart,
            eventBudget,
            maxSeq,
            threadId: thread.id,
          }),
        });
  const hasOlder =
    sequenceStart > epochSequenceStart &&
    findTimelineWindowBudgetFloorSequence(db, {
      threadId: thread.id,
      sequenceStart: epochSequenceStart,
      beforeSequence: sequenceStart,
      eventBudget: 0,
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
      excludeDiagnosticEvents,
    }) !== undefined;
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
  let rows = source.listThreadWindowRows(windowArgs);
  const initialTurnIds = [
    ...source.listRootWindowTurnIds(windowArgs),
    ...rows.flatMap((row) => {
      if (row.type !== "client/turn/requested") return [];
      const requestId = tryReadClientTurnRequestedRequestId(row, decode);
      const turnId =
        requestId === null
          ? undefined
          : groupingContext.acceptedTurnIds.get(requestId);
      return turnId === undefined ? [] : [turnId];
    }),
  ];
  const fetchedTurns = new Set<string>();
  const parentedRowLookups =
    createTimelineWindowParentedRowLookups(fetchedTurns);
  const windowedTurns = new Set<string>();
  const closedItemKeys = new Set<string>();
  const turnPlans = new Map<string, LoadedTimelineTurnPlan>();
  const captureTurnPlanIds = new Set<string>();
  rows = measureThreadTimelineStage(profile, "group-context-query", () => {
    let selectedRows = rows;
    const itemRowsArgs = {
      closedItemKeys,
      epochSequenceStart,
      excludeDiagnosticEvents,
      latestPage: beforeSequence === maxSeq + 1,
      maxInlineOutputChars,
      maxSeq,
      sequenceStart,
      source,
      threadId: thread.id,
      windowedTurnIds: windowedTurns,
    };
    let parentedAddedRows = true;
    for (;;) {
      let turnIds = [
        ...new Set([
          ...initialTurnIds,
          ...selectedRows.flatMap((row) =>
            row.turnId === null ? [] : [row.turnId],
          ),
        ]),
      ].filter(
        (turnId) =>
          !fetchedTurns.has(turnId) &&
          !windowedTurns.has(turnId) &&
          !turnPlans.has(turnId),
      );
      const allTurnIds = turnIds;
      if (allTurnIds.length > 0) {
        const plannedNow =
          turnPlanKey === null || turnIds.length === 0
            ? new Map<string, LoadedTimelineTurnPlan>()
            : loadValidTimelineTurnPlans(db, {
                maxSeq,
                projectionKey: turnPlanKey,
                threadId: thread.id,
                turnIds,
              });
        for (const [turnId, plan] of plannedNow) turnPlans.set(turnId, plan);
        const plannedRows = listPlannedTurnRows(source, {
          beforeSequence,
          plans: plannedNow,
          sequenceStart,
          windowArgs,
        });
        const plannedContextRows = source.listTurnContextRows({
          ...windowArgs,
          sequenceStart: epochSequenceStart,
          beforeSequence: maxSeq + 1,
          turnIds: [...plannedNow.keys()],
        });
        turnIds = turnIds.filter((turnId) => !plannedNow.has(turnId));
        const latestPage = beforeSequence === maxSeq + 1;
        let windowTurnRows: StoredEventRow[];
        let outsideCounts: Map<string, number>;
        if (latestPage) {
          const firstSequences = source.listTurnFirstSequences({
            epochSequenceStart,
            maxSeq,
            threadId: thread.id,
            turnIds,
          });
          const firstSequenceOf = (turnId: string) =>
            firstSequences.get(turnId) ?? sequenceStart;
          const nearTurnIds = turnIds.filter(
            (turnId) =>
              firstSequenceOf(turnId) >=
              sequenceStart - SMALL_TURN_OUTSIDE_EVENTS,
          );
          const farTurnIds = turnIds.filter(
            (turnId) =>
              firstSequenceOf(turnId) <
              sequenceStart - SMALL_TURN_OUTSIDE_EVENTS,
          );
          windowTurnRows = [
            ...source.listTurnRows({
              ...windowArgs,
              sequenceStart: Math.min(
                sequenceStart,
                ...nearTurnIds.map(firstSequenceOf),
              ),
              turnIds: nearTurnIds,
            }),
            ...source.listTurnRows({ ...windowArgs, turnIds: farTurnIds }),
          ];
          outsideCounts = new Map(
            farTurnIds.map((turnId) => [
              turnId,
              sequenceStart - firstSequenceOf(turnId),
            ]),
          );
        } else {
          windowTurnRows = source.listTurnRows({ ...windowArgs, turnIds });
          outsideCounts = source.countTurnEventsOutsideWindow({
            beforeSequence,
            epochSequenceStart,
            maxSeq,
            sequenceStart,
            threadId: thread.id,
            turnIds,
          });
        }
        const completeTurnIds = new Set(
          turnIds.filter((turnId) => (outsideCounts.get(turnId) ?? 0) === 0),
        );
        const smallTurnIds = turnIds.filter((turnId) => {
          const count = outsideCounts.get(turnId) ?? 0;
          return count > 0 && count <= SMALL_TURN_OUTSIDE_EVENTS;
        });
        const partialTurnIds = turnIds.filter(
          (turnId) =>
            (outsideCounts.get(turnId) ?? 0) > SMALL_TURN_OUTSIDE_EVENTS,
        );
        const contextRows = source.listTurnContextRows({
          ...windowArgs,
          sequenceStart: epochSequenceStart,
          beforeSequence: maxSeq + 1,
          turnIds: partialTurnIds,
        });
        const completedTurnIds = new Set(
          contextRows.flatMap((row) =>
            row.type === "turn/completed" && row.turnId !== null
              ? [row.turnId]
              : [],
          ),
        );
        const unplannedTurnIds = flatTurnDisplay
          ? []
          : partialTurnIds.filter((turnId) => completedTurnIds.has(turnId));
        const wholeTurnIds = [...smallTurnIds, ...unplannedTurnIds];
        if (turnPlanKey !== null && !flatTurnDisplay) {
          const windowRowCounts = new Map<string, number>();
          const completedInWindow = new Set<string>();
          for (const row of windowTurnRows) {
            if (row.turnId === null) continue;
            windowRowCounts.set(
              row.turnId,
              (windowRowCounts.get(row.turnId) ?? 0) + 1,
            );
            if (row.type === "turn/completed")
              completedInWindow.add(row.turnId);
          }
          const turnEventCount = (turnId: string) =>
            (windowRowCounts.get(turnId) ?? 0) +
            (outsideCounts.get(turnId) ?? 0);
          for (const turnId of [...completeTurnIds, ...smallTurnIds]) {
            if (
              completedInWindow.has(turnId) &&
              turnEventCount(turnId) >= PLAN_MIN_TURN_EVENTS
            ) {
              captureTurnPlanIds.add(turnId);
            }
          }
          for (const turnId of unplannedTurnIds) {
            if (turnEventCount(turnId) >= PLAN_MIN_TURN_EVENTS) {
              captureTurnPlanIds.add(turnId);
            }
          }
        }
        const unplannedTurnIdSet = new Set(unplannedTurnIds);
        const windowTurnIds = partialTurnIds.filter(
          (turnId) => !unplannedTurnIdSet.has(turnId),
        );
        for (const turnId of completeTurnIds) fetchedTurns.add(turnId);
        for (const turnId of wholeTurnIds) fetchedTurns.add(turnId);
        for (const turnId of windowTurnIds) windowedTurns.add(turnId);
        const windowTurnIdSet = new Set(windowTurnIds);
        const newRows = [
          ...windowTurnRows,
          ...source.listTurnRows({
            ...windowArgs,
            sequenceStart: epochSequenceStart,
            beforeSequence: sequenceStart,
            turnIds: wholeTurnIds,
          }),
          ...(beforeSequence === maxSeq + 1
            ? []
            : source.listTurnRows({
                ...windowArgs,
                sequenceStart: beforeSequence,
                beforeSequence: maxSeq + 1,
                turnIds: wholeTurnIds,
              })),
          ...contextRows.filter(
            (row) => row.turnId !== null && windowTurnIdSet.has(row.turnId),
          ),
          ...plannedRows,
          ...plannedContextRows,
        ];
        if (newRows.length > 0) {
          selectedRows = mergeStoredEventRowsById([
            ...selectedRows,
            ...newRows,
          ]);
        }
      }
      const itemRows = listWindowedTurnItemRows({
        ...itemRowsArgs,
        rows: selectedRows,
      });
      if (
        allTurnIds.length === 0 &&
        itemRows.length === 0 &&
        !parentedAddedRows
      ) {
        break;
      }
      const rowsBeforeParents =
        itemRows.length === 0
          ? selectedRows
          : mergeStoredEventRowsById([...selectedRows, ...itemRows]);
      selectedRows = ensureTimelineWindowParentedRows(db, {
        childOwnerSequenceStart:
          beforeSequence === maxSeq + 1 ? undefined : sequenceStart,
        threadId: thread.id,
        rows: rowsBeforeParents,
        source,
        lookups: parentedRowLookups,
        maxInlineOutputChars,
        excludeDiagnosticEvents,
        sequenceBounds: {
          sequenceStart: epochSequenceStart,
          beforeSequence: maxSeq + 1,
        },
      }).rows.filter((row) => row.sequence <= maxSeq);
      parentedAddedRows = selectedRows.length > rowsBeforeParents.length;
    }
    selectedRows = ensureTimelineWindowBackgroundTaskStateRows(db, {
      threadId: thread.id,
      rows: selectedRows,
      beforeSequence: maxSeq + 1,
    }).filter((row) => row.sequence <= maxSeq);
    if (page.kind === "latest")
      selectedRows = ensureLatestTimelineOpenBackgroundTaskStateRows(db, {
        threadId: thread.id,
        rows: selectedRows,
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
      source.listContextRows({
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
        ? [tryReadClientTurnRequestedRequestId(row, decode)]
        : [],
    ),
  );
  const requestKeys = rows
    .filter((row) => row.type === "turn/input/accepted")
    .filter(
      (row) =>
        !existingRequests.has(parseAcceptedInputClientRequestId(row, decode)),
    )
    .map((row) => ({
      threadId: thread.id,
      requestId: parseAcceptedInputClientRequestId(row, decode),
    }));
  const requestedRows = listStoredClientTurnRequestRowsByKeys(db, {
    keys: requestKeys,
  }).filter((row) => row.sequence <= maxSeq);
  const requestContext = [...contextRows, ...requestedRows, ...rows];
  const terminalRequestIds = new Set(
    requestContext.flatMap((row) =>
      row.type === "turn/input/accepted"
        ? [parseAcceptedInputClientRequestId(row, decode)]
        : row.type === "client/turn/rejected"
          ? [parseRejectedClientRequestId(row, decode)]
          : [],
    ),
  );
  const unresolvedRequests = requestContext.flatMap((row) => {
    if (row.type !== "client/turn/requested") return [];
    const id = tryReadClientTurnRequestedRequestId(row, decode);
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
  const selectionRows = ensureTimelineWindowTurnStartedRows(db, {
    threadId: thread.id,
    rows: mergeStoredEventRowsById([
      ...interruptionRows,
      ...terminalContext,
      ...contextRows,
      ...requestedRows,
      ...rows,
    ]),
  });
  return {
    budgetFloorSequence: budgetFloor,
    hints,
    fetchedTurnIds: fetchedTurns,
    windowedTurnIds: windowedTurns,
    selection: {
      captureTurnPlanIds,
      turnPlans,
      headStateRows:
        page.kind === "latest"
          ? measureThreadTimelineStage(profile, "group-context-query", () =>
              listLatestTimelineHeadStateRows(
                db,
                thread.id,
                extensionStateKinds,
              ).filter(
                (row) =>
                  row.sequence <= maxSeq && !visibleSequences.has(row.sequence),
              ),
            )
          : [],
      contextOnlyInterruptionSequences: new Set(
        interruptionRows
          .filter((row) => !visibleSequences.has(row.sequence))
          .map((row) => row.sequence),
      ),
      orderingBoundarySequence: groupingContext.orderingBoundarySequence,
      ownedSequenceStart: sequenceStart,
      ownedSequenceEnd: beforeSequence,
      hasOlderSegments: hasOlder,
      omittedTurnSequenceEnd: latestOmittedTurnRowSequence(db, {
        epochSequenceStart,
        excludeDiagnosticEvents,
        maxInlineOutputChars,
        rows: selectionRows,
        sequenceStart,
        threadId: thread.id,
        turnPlans,
        windowedTurnIds: windowedTurns,
      }),
      paginationPage:
        contentCursor === undefined ? page : { ...page, segmentLimit: 1 },
      rows: selectionRows,
      strategy:
        !hasOlder && page.kind === "latest" ? "full" : "standard-window",
    },
  };
}

function createThreadTimelineBuildProfileAccumulator(): ThreadTimelineBuildProfileAccumulator {
  return {
    compactedEventCount: 0,
    foldedEventCount: 0,
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
  profile: ThreadTimelineBuildProfileAccumulator,
  stage: ThreadTimelineBuildProfileStage,
  fn: () => TResult,
): TResult {
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
  options: BuildThreadTimelineOptions,
): ThreadTimelineBuildProfile {
  return {
    compactedEventCount: accumulator.compactedEventCount,
    foldedEventCount: accumulator.foldedEventCount,
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

function selectTrimmedOrFreshRows(
  trimSource: TimelineSelectionRowSource | null,
  select: (
    source?: TimelineSelectionRowSource,
  ) => StandardTimelineEventRowSelection,
): StandardTimelineEventRowSelection {
  if (trimSource === null) return select();
  try {
    return select(trimSource);
  } catch (error) {
    if (!(error instanceof TimelineSelectionTrimFallback)) throw error;
    return select();
  }
}

const storedTurnPlanSelections = new WeakSet<object>();

function buildThreadTimelineInternal(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineOptions,
): BuildThreadTimelineInternalResult {
  const surface = resolveThreadTimelineSurface(db, thread, options);
  const snapshot = resolveTimelineSnapshot(
    db,
    thread,
    options.page,
    surface.cursorKey,
    options.maxSeq === 0 ? undefined : options.maxSeq,
  );
  const contentCursor = readTimelineContentCursor(options.page);
  const profile = createThreadTimelineBuildProfileAccumulator();
  const includeNestedRows = options.includeNestedRows ?? false;
  const includeDiagnosticOperations = options.includeDiagnosticOperations;
  const contextBoundarySeq = getLatestCompletedThreadContextClearSequence(db, {
    atOrBeforeSequence: snapshot.maxSeq,
    threadId: thread.id,
  });
  const historySequenceStart = options.includeClearedContextHistory
    ? 0
    : (contextBoundarySeq ?? 0);
  const turnPlanKey =
    options.completedTurnDisplay === "flat" || includeNestedRows
      ? null
      : timelineTurnPlanProjectionKey([
          getStoredThreadEventRewriteGeneration(db, thread.id),
          thread.providerId,
          snapshot.status,
          historySequenceStart,
          includeDiagnosticOperations,
          options.summarizeShellCommands,
          options.maxInlineOutputChars,
          options.providerDisplayName ?? null,
          surface.threadName,
          surface.workspaceRoot,
        ]);
  const selectRows = (
    knownBudgetFloor: TimelineBudgetFloor | null,
    source: TimelineSelectionRowSource = databaseTimelineRowSource(db),
  ) =>
    selectStandardTimelineEventRows(
      db,
      thread,
      options.page,
      options.eventBudget,
      options.maxInlineOutputChars,
      historySequenceStart,
      !includeDiagnosticOperations,
      snapshot.maxSeq,
      contentCursor,
      knownBudgetFloor,
      profile,
      source,
      options.extensionStateKinds ?? [],
      options.completedTurnDisplay === "flat",
      turnPlanKey,
    );
  const maxInlineOutputChars = options.maxInlineOutputChars;
  const active = thread.status === "active";
  if (!active) forgetTimelineProjectionFolds(db, thread.id);
  const memoArgs: LatestTimelineSelectionMemoArgs | null =
    options.page.kind === "latest" &&
    contentCursor === undefined &&
    maxInlineOutputChars !== null
      ? {
          active,
          epochSequenceStart: historySequenceStart,
          eventBudget: options.eventBudget,
          excludeDiagnosticEvents: !includeDiagnosticOperations,
          extensionStateKinds: options.extensionStateKinds ?? [],
          flatTurnDisplay: options.completedTurnDisplay === "flat",
          maxInlineOutputChars,
          maxSeq: snapshot.maxSeq,
          page: options.page,
          threadId: thread.id,
          turnPlanKey,
        }
      : null;
  const { decodedPrefix, selection: storedEventSelection } =
    measureThreadTimelineStage(profile, "event-query", () => {
      if (memoArgs === null) {
        return { decodedPrefix: null, selection: selectRows(null).selection };
      }
      const lookup = measureThreadTimelineStage(
        profile,
        "selection-memo-lookup",
        () => lookupLatestTimelineSelection(db, memoArgs),
      );
      if (lookup.selection !== null) {
        return {
          decodedPrefix: lookup.decodedPrefix,
          selection: lookup.selection,
        };
      }
      const result = selectTrimmedOrFreshRows(lookup.trimSource, (source) =>
        selectRows(lookup.budgetFloor, source),
      );
      rememberLatestTimelineSelection(db, memoArgs, lookup, result);
      return { decodedPrefix: null, selection: result.selection };
    });
  const eventSelection =
    options.maxInlineOutputChars === null
      ? {
          ...storedEventSelection,
          rows: hydrateRetainedEventOutputRows(db, storedEventSelection.rows),
        }
      : storedEventSelection;
  const rawEventRows = eventSelection.rows;
  const decodedSelection = measureThreadTimelineStage(
    profile,
    "event-json-decode",
    () => decodeTimelineSelectionRows(db, rawEventRows, decodedPrefix),
  );
  if (memoArgs !== null) {
    rememberDecodedLatestTimelineSelection(
      db,
      memoArgs,
      rawEventRows,
      decodedSelection,
    );
  }
  const decodedRawEvents = decodedSelection.events.slice();
  profile.eventDataBytes = decodedSelection.dataBytes;
  profile.eventRowCount = rawEventRows.length;
  profile.selectionStrategy = eventSelection.strategy;
  profile.eventRowCount += eventSelection.headStateRows.length;
  profile.eventDataBytes += byteLengthOfStoredEventRows(
    eventSelection.headStateRows,
  );
  profile.decodedEventCount =
    decodedRawEvents.length + eventSelection.headStateRows.length;
  const contextWindowUsageRows = measureThreadTimelineStage(
    profile,
    "context-window-query",
    () =>
      listContextWindowUsageRows(db, {
        sequenceStart: contextBoundarySeq ?? 0,
        threadId: thread.id,
      }),
  );
  profile.contextWindowEventDataBytes = byteLengthOfStoredEventRows(
    contextWindowUsageRows,
  );
  profile.contextWindowEventRowCount = contextWindowUsageRows.length;
  const projectionOptions = {
    completedTurnDisplay: options.completedTurnDisplay,
    includeDiagnosticOperations,
    isLatestPage: options.page.kind === "latest",
    providerDisplayName: options.providerDisplayName,
    planCommand: options.planCommand,
    extensionStateKinds: options.extensionStateKinds,
    summarizeShellCommands: options.summarizeShellCommands,
    threadStatus: snapshot.status,
    threadName: surface.threadName,
    workspaceRoot: surface.workspaceRoot,
    providerId: thread.providerId,
  };
  const deferContent = options.deferContent ?? false;
  const captureTurnPlans = eventSelection.captureTurnPlanIds.size > 0;
  const timelineOptions = {
    ...projectionOptions,
    captureTurnPlans,
    includeNestedRows,
    omitSettledDelegationChildRows: deferContent && !captureTurnPlans,
    storedTurnPlans: new Map(
      [...eventSelection.turnPlans].map(([turnId, loaded]) => [
        turnId,
        loaded.plan,
      ]),
    ),
  };
  const project = (
    cachedEventProjection: EventProjection | null,
  ): BuiltTimelineProjection => {
    const headStateEvents = measureThreadTimelineStage(
      profile,
      "event-json-decode",
      () =>
        eventSelection.headStateRows.map((row) =>
          withRowMeta(row, decodeStoredEventRowCached(db, row)),
        ),
    );
    const decodedEvents = measureThreadTimelineStage(
      profile,
      "summary-compaction",
      () => compactThreadTimelineSummaryEvents(decodedRawEvents),
    );
    const contextWindowEvents = measureThreadTimelineStage(
      profile,
      "context-window-json-decode",
      () =>
        contextWindowUsageRows.map((row) =>
          withRowMeta(row, decodeStoredEventRowCached(db, row)),
        ),
    );
    const acceptedClientRequestContext: AcceptedClientRequestContext = {
      acceptedClientRequestEvents: [],
      rejectedClientRequestEvents: [],
    };
    const eventProjection =
      cachedEventProjection ??
      measureThreadTimelineStage(profile, "thread-view-projection", () =>
        projectThreadTimelineEvents({
          acceptedClientRequestContext,
          events: decodedEvents,
          fold:
            memoArgs === null || !active
              ? undefined
              : keepTimelineProjectionFold(db, profile, {
                  decodedRows: decodedRawEvents,
                  key: JSON.stringify([
                    thread.id,
                    memoArgs.epochSequenceStart,
                    memoArgs.eventBudget,
                    memoArgs.excludeDiagnosticEvents,
                    memoArgs.maxInlineOutputChars,
                    memoArgs.page.segmentLimit,
                    includeDiagnosticOperations,
                    options.providerDisplayName ?? null,
                    snapshot.status,
                    surface.threadName,
                  ]),
                  rows: rawEventRows,
                  start: () =>
                    startThreadTimelineProjectionFold({
                      acceptedClientRequestContext,
                      events: decodedEvents,
                      options: timelineOptions,
                    }),
                  threadId: thread.id,
                }),
          options: timelineOptions,
        }),
      );
    const { rows: timelineRows, ...summary } = measureThreadTimelineStage(
      profile,
      "thread-view-rows",
      () =>
        buildThreadTimelineFromProjection({
          acceptedClientRequestContext,
          contextWindowEvents,
          headStateEvents,
          events: decodedEvents,
          options: timelineOptions,
          projection: eventProjection,
        }),
    );
    const projection: TimelineProjection = {
      compactedEventCount: decodedEvents.length,
      rows: orderTimelineRowsUsingContext(
        timelineRows.filter(
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
        eventSelection.orderingBoundarySequence,
      ),
      summary,
    };
    return { eventProjection, projection };
  };
  const projection =
    memoArgs === null
      ? project(null).projection
      : keepTimelineProjection(
          {
            contextWindowRows: contextWindowUsageRows,
            headStateRows: eventSelection.headStateRows,
            projectionKey: JSON.stringify([
              projectionOptions,
              eventSelection.orderingBoundarySequence,
              [...eventSelection.contextOnlyInterruptionSequences],
            ]),
            rows: rawEventRows,
            rowsKey: JSON.stringify([
              includeNestedRows,
              timelineOptions.omitSettledDelegationChildRows,
              captureTurnPlans,
              [...eventSelection.turnPlans.keys()],
            ]),
          },
          project,
        );
  const timeline = projection.summary;
  if (
    turnPlanKey !== null &&
    captureTurnPlans &&
    !storedTurnPlanSelections.has(storedEventSelection)
  ) {
    storedTurnPlanSelections.add(storedEventSelection);
    storeTimelineTurnPlans(db, {
      maxSeq: snapshot.maxSeq,
      plans: timeline.turnPlans,
      projectionKey: turnPlanKey,
      rows: storedEventSelection.rows,
      threadId: thread.id,
      turnIds: eventSelection.captureTurnPlanIds,
    });
  }
  const projectedTimelineRows = projection.rows;
  profile.compactedEventCount = projection.compactedEventCount;
  profile.projectedRowCount = projectedTimelineRows.length;
  const retainedOutputPreviews = retainedOutputPreviewsByCallId(
    decodedRawEvents,
    "available",
    Date.now(),
  );
  const mappedTimelineRows = mapTimelineRowTree(
    projectedTimelineRows,
    (row) => {
      const previewed = withRetainedOutputPreview(row, retainedOutputPreviews);
      return deferContent ? deferSettledTimelineRow(previewed) : previewed;
    },
  );
  const pageableTimelineRows =
    options.page.kind === "latest" && contentCursor === undefined
      ? reusePreviousPageableTimelineRows(
          db,
          JSON.stringify([
            thread.id,
            options.page.segmentLimit,
            deferContent,
            includeNestedRows,
          ]),
          mappedTimelineRows,
        )
      : mappedTimelineRows;
  const paginatedTimeline = measureThreadTimelineStage(
    profile,
    "pagination-segmentation",
    () =>
      paginateTimelineRows({
        contentCursor,
        maxLeaves: Math.max(1, options.eventBudget),
        maxBytes:
          options.responseByteBudget ?? THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT,
        ownedSequenceStart: eventSelection.ownedSequenceStart,
        ownedSequenceEnd: eventSelection.ownedSequenceEnd,
        hasOlderSegments: eventSelection.hasOlderSegments,
        omittedTurnSequenceEnd: eventSelection.omittedTurnSequenceEnd,
        page: eventSelection.paginationPage,
        rows: pageableTimelineRows,
      }),
  );
  profile.responseRowCount = paginatedTimeline.rows.length;
  profile.returnedSegmentCount = paginatedTimeline.returnedSegmentCount;

  const response: ThreadTimelineWindow = {
    maxSeq: snapshot.maxSeq,
    rows: options.summaryOnly ? [] : paginatedTimeline.rows,
    contextBoundarySeq,
    completedTurnDisplay: options.completedTurnDisplay,
    activePromptMode:
      options.page.kind === "latest" ? timeline.activePromptMode : null,
    activeThinking:
      options.page.kind === "latest" ? timeline.activeThinking : null,
    activeWorkflows:
      options.page.kind === "latest" ? timeline.activeWorkflows : [],
    activeBackgroundCommands:
      options.page.kind === "latest" ? timeline.activeBackgroundCommands : [],
    pendingTodos: timeline.pendingTodos,
    extensionStates: timeline.extensionStates,
    providerCommands: timeline.providerCommands,
    sessionOptions: timeline.sessionOptions,
    modelFallback:
      options.page.kind === "latest" ? timeline.modelFallback : null,
    contextWindowUsage:
      options.page.kind === "latest" && timeline.contextWindowUsage
        ? withCompactionOffer(db, {
            enabled: options.compactionOfferEnabled,
            sequenceStart: contextBoundarySeq ?? 0,
            threadId: thread.id,
            usage: timeline.contextWindowUsage,
          })
        : undefined,
    timelinePage: {
      returnedSegmentCount: paginatedTimeline.returnedSegmentCount,
      olderCursor: bindTimelineCursor(
        paginatedTimeline.olderCursor,
        snapshot,
        paginatedTimeline.contentCursor,
      ),
      historySnapshot: timelineSnapshotKey(snapshot),
      olderRowsSourceSeqEnd: paginatedTimeline.olderRowsSourceSeqEnd,
      olderRowUpdates: options.summaryOnly
        ? undefined
        : paginatedTimeline.olderRowUpdates,
    },
  };
  return {
    response,
    profile: completeThreadTimelineBuildProfile(profile, options),
  };
}

export function buildThreadTimelineWithProfile(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineOptions,
): {
  cost: MainThreadCost;
  profile: ThreadTimelineBuildProfile;
  response: ThreadTimelineWindow;
} {
  return runEventLoopWorkSync(`timeline-build ${thread.id}`, () => {
    const started = startMainThreadCost();
    const built = db.transaction(() => {
      const result = buildThreadTimelineInternal(db, thread, options);
      if (options.summaryOnly) return result;
      for (
        let skipped = 0;
        skipped < MAX_EMPTY_TIMELINE_WINDOWS;
        skipped += 1
      ) {
        const cursor = result.response.timelinePage.olderCursor;
        if (result.response.rows.length > 0 || cursor === null) break;
        const older = buildThreadTimelineInternal(db, thread, {
          ...options,
          page: {
            kind: "older",
            beforeCursor: cursor,
            segmentLimit: options.page.segmentLimit,
          },
        });
        result.response.rows = older.response.rows;
        result.response.timelinePage = older.response.timelinePage;
        result.profile.eventRowCount += older.profile.eventRowCount;
        result.profile.eventDataBytes += older.profile.eventDataBytes;
        result.profile.decodedEventCount += older.profile.decodedEventCount;
        result.profile.compactedEventCount += older.profile.compactedEventCount;
        result.profile.foldedEventCount += older.profile.foldedEventCount;
        result.profile.contextWindowEventRowCount +=
          older.profile.contextWindowEventRowCount;
        result.profile.contextWindowEventDataBytes +=
          older.profile.contextWindowEventDataBytes;
        result.profile.projectedRowCount += older.profile.projectedRowCount;
        result.profile.responseRowCount = older.profile.responseRowCount;
        result.profile.returnedSegmentCount =
          older.profile.returnedSegmentCount;
        result.profile.stageTimings.push(...older.profile.stageTimings);
        result.profile.totalDurationMs = roundDurationMs(
          result.profile.totalDurationMs + older.profile.totalDurationMs,
        );
      }
      return result;
    });
    return { ...built, cost: finishMainThreadCost(started) };
  });
}

interface BuildThreadConversationOutlineOptions {
  completedTurnDisplay: CompletedTurnDisplay;
  includeClearedContextHistory: boolean;
  maxSeq: number;
  providerDisplayName?: string;
}

interface LoadThreadConversationOutlineOptions extends BuildThreadConversationOutlineOptions {
  outlineSequence: number;
}

const CONVERSATION_OUTLINE_PREVIEW_MAX_LENGTH = 200;
const CONVERSATION_OUTLINE_PROJECTION_VERSION = 2;
const conversationOutlineItemsSchema =
  threadConversationOutlineItemSchema.array();

function toConversationOutlinePreview(text: string): string {
  let prefixLength = CONVERSATION_OUTLINE_PREVIEW_MAX_LENGTH * 2;
  while (true) {
    const prefix =
      prefixLength >= text.length ? text : sliceUtf16Head(text, prefixLength);
    const normalized = prefix.replace(/\s+/g, " ").trim();
    if (
      normalized.length >= CONVERSATION_OUTLINE_PREVIEW_MAX_LENGTH ||
      prefixLength >= text.length
    ) {
      if (normalized.length <= CONVERSATION_OUTLINE_PREVIEW_MAX_LENGTH) {
        return normalized;
      }
      return sliceUtf16Head(
        normalized,
        CONVERSATION_OUTLINE_PREVIEW_MAX_LENGTH,
      ).trimEnd();
    }
    prefixLength *= 2;
  }
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

interface BuildThreadConversationRowsOptions extends BuildThreadConversationOutlineOptions {
  includeNestedRows: boolean;
}

function collectConversationRows(
  rows: readonly TimelineRow[],
  conversationRows: TimelineConversationRow[],
): void {
  for (const row of rows) {
    if (row.kind === "conversation") {
      conversationRows.push(row);
    } else if (row.kind === "turn" && row.children !== null) {
      collectConversationRows(row.children, conversationRows);
    }
  }
}

function resolveConversationHistorySequenceStart(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadConversationOutlineOptions,
): number {
  if (options.includeClearedContextHistory) return 0;
  return (
    getLatestCompletedThreadContextClearSequence(db, {
      atOrBeforeSequence: options.maxSeq,
      threadId: thread.id,
    }) ?? 0
  );
}

function buildThreadConversationRows(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadConversationRowsOptions,
): TimelineConversationRow[] {
  return runEventLoopWorkSync(`conversation-rows ${thread.id}`, () => {
    const rawEventRows = listStoredConversationOutlineEventRows(db, {
      sequenceStart: resolveConversationHistorySequenceStart(
        db,
        thread,
        options,
      ),
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
        completedTurnDisplay: options.completedTurnDisplay,
        includeNestedRows: options.includeNestedRows,
        omitSettledDelegationChildRows: false,
        includeDiagnosticOperations: false,
        isLatestPage: true,
        providerDisplayName: options.providerDisplayName,
        providerId: thread.providerId,
        summarizeShellCommands: true,
        threadName: thread.title ?? thread.titleFallback ?? "",
        threadStatus: thread.status,
        workspaceRoot: resolveThreadWorkspaceRoot(db, thread),
      },
    });
    const conversationRows: TimelineConversationRow[] = [];
    collectConversationRows(timeline.rows, conversationRows);
    return conversationRows;
  });
}

function selectThreadConversationOutline(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadConversationOutlineOptions,
  sequenceStart: number,
  precedingAgentMessageDeltaCount: number,
  rootProjection: { summaryCompactionEnabled: boolean } | null,
): ConversationOutlineSelection {
  const selectRows =
    rootProjection === null
      ? listStoredConversationOutlineEventRows
      : listStoredRootConversationOutlineEventRows;
  const rawEventRows = selectRows(db, {
    sequenceStart,
    threadId: thread.id,
  });
  const decodedRawEvents = rawEventRows.map((row) =>
    toThreadEventWithMeta(row),
  );
  const decodedEvents = compactThreadTimelineSummaryEvents(
    decodedRawEvents,
    rootProjection === null
      ? precedingAgentMessageDeltaCount
      : rootProjection.summaryCompactionEnabled
        ? MIN_AGENT_MESSAGE_DELTAS_FOR_SUMMARY_COMPACTION
        : 0,
  );
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
  return {
    events: decodedRawEvents,
    project: () => {
      const timeline = buildThreadTimelineFromEvents({
        acceptedClientRequestContext,
        contextWindowEvents: [],
        events: decodedEvents,
        options: {
          completedTurnDisplay: options.completedTurnDisplay,
          includeNestedRows: false,
          omitSettledDelegationChildRows: false,
          includeDiagnosticOperations: false,
          isLatestPage: true,
          providerDisplayName: options.providerDisplayName,
          providerId: thread.providerId,
          summarizeShellCommands: true,
          threadName: thread.title ?? thread.titleFallback ?? "",
          threadStatus: thread.status,
          workspaceRoot: resolveThreadWorkspaceRoot(db, thread),
        },
      });
      const items: ReturnType<ConversationOutlineSelection["project"]> = [];
      for (const row of timeline.rows) {
        if (row.kind !== "conversation") {
          continue;
        }
        items.push({
          sourceSeqStart: row.sourceSeqStart,
          sourceSeqEnd: row.sourceSeqEnd,
          item: {
            id: row.id,
            role: row.role,
            preview: toConversationOutlinePreview(row.text),
            attachmentSummary: toConversationOutlineAttachmentSummary(
              row.attachments,
            ),
          },
        });
      }
      return items;
    },
  };
}

export function buildThreadConversationOutline(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadConversationOutlineOptions,
): ThreadConversationOutlineResponse {
  return runEventLoopWorkSync(`conversation-outline ${thread.id}`, () => {
    const sequenceStart = resolveConversationHistorySequenceStart(
      db,
      thread,
      options,
    );
    const selection = selectThreadConversationOutline(
      db,
      thread,
      options,
      sequenceStart,
      0,
      null,
    );
    return {
      items: selection.project().map(({ item }) => item),
      maxSeq: options.maxSeq,
    };
  });
}

interface GetThreadMessageOptions extends BuildThreadConversationOutlineOptions {
  seq: number;
  before: number;
  after: number;
}

export function getThreadMessage(
  db: DbConnection,
  thread: Thread,
  options: GetThreadMessageOptions,
): ThreadMessageResponse {
  const rows = buildThreadConversationRows(db, thread, {
    ...options,
    includeNestedRows: true,
  });
  const index = rows.findIndex((row) => row.messageSeq === options.seq);
  const message = rows[index];
  if (message === undefined) {
    throw new ApiError(
      404,
      "message_not_found",
      `Thread ${thread.id} has no message ${options.seq}; an edit may have removed it or a context clear hidden it`,
    );
  }
  return {
    message,
    before: rows.slice(Math.max(0, index - options.before), index),
    after: rows.slice(index + 1, index + 1 + options.after),
  };
}

export function buildThreadConversationOutlineProjectionKey(
  db: DbConnection,
  thread: Thread,
  outlineSequence: number,
  options: BuildThreadConversationOutlineOptions,
): string {
  return JSON.stringify([
    CONVERSATION_OUTLINE_PROJECTION_VERSION,
    getStoredThreadEventRewriteGeneration(db, thread.id),
    outlineSequence,
    thread.providerId,
    options.providerDisplayName ?? null,
    thread.status,
    thread.title,
    thread.titleFallback,
    options.completedTurnDisplay,
    options.includeClearedContextHistory,
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
    db,
    thread,
    options.outlineSequence,
    options,
  );
  const stored = getThreadConversationOutlineRecord(db, thread.id);
  if (stored?.projectionKey === projectionKey) {
    const items = parseThreadConversationOutlineItems(stored.itemsJson);
    if (items !== null) {
      return { items, maxSeq: options.maxSeq };
    }
  }

  const response = runEventLoopWorkSync(
    `conversation-outline ${thread.id}`,
    () => {
      const historySequenceStart = resolveConversationHistorySequenceStart(
        db,
        thread,
        options,
      );
      const { orderingBoundarySequence } = getTimelineGroupingContext(db, {
        maxSeq: options.maxSeq,
        sequenceStart: historySequenceStart,
        threadId: thread.id,
      });
      return {
        items: projectConversationOutlineIncrementally({
          db,
          threadId: thread.id,
          key: buildThreadConversationOutlineProjectionKey(
            db,
            thread,
            0,
            options,
          ),
          maxSeq: options.maxSeq,
          historySequenceStart,
          orderingBoundarySequence,
          resolveProjectionState: (classificationSequenceStart, previous) => {
            const state = getStoredConversationOutlineProjectionState(db, {
              threadId: thread.id,
              sequenceStart: historySequenceStart,
              classificationSequenceStart,
              summaryCompactionDeltaThreshold:
                MIN_AGENT_MESSAGE_DELTAS_FOR_SUMMARY_COMPACTION,
            });
            return {
              includeNestedEvents:
                orderingBoundarySequence !== null ||
                previous?.includeNestedEvents === true ||
                state.includeNestedEvents,
              summaryCompactionEnabled: state.summaryCompactionEnabled,
            };
          },
          select: (sequenceStart, precedingAgentMessageDeltaCount, state) =>
            selectThreadConversationOutline(
              db,
              thread,
              options,
              sequenceStart,
              precedingAgentMessageDeltaCount,
              state.includeNestedEvents
                ? null
                : { summaryCompactionEnabled: state.summaryCompactionEnabled },
            ),
        }),
        maxSeq: options.maxSeq,
      };
    },
  );
  if (shouldMaterializeThreadConversationOutline(thread)) {
    upsertThreadConversationOutlineRecord(db, {
      itemsJson: JSON.stringify(response.items),
      projectionKey,
      threadId: thread.id,
    });
  }
  return response;
}

function collectTimelineItemRows(
  rows: readonly TimelineRow[],
  itemId: string,
  matches: Map<string, TimelineRow>,
): void {
  for (const row of rows) {
    if (timelineRowItemId(row) === itemId) {
      if (!matches.has(row.id)) {
        matches.set(row.id, row);
      }
      continue;
    }
    const nested = timelineRowChildren(row);
    if (nested !== null) {
      collectTimelineItemRows(nested, itemId, matches);
    }
  }
}

function scopeTimelineTurnDetailsRows(
  rows: TimelineRow[],
  retainedOutputPreviews: ReadonlyMap<string, TimelineOutputPreview>,
  options: BuildTimelineTurnSummaryDetailsOptions,
): TimelineRow[] | null {
  const withPreview = (row: TimelineRow) =>
    withRetainedOutputPreview(row, retainedOutputPreviews);
  const shorten = (nested: TimelineRow[]) =>
    mapTimelineRowTree(nested, (row) => {
      const previewed = withPreview(row);
      return previewTimelineRowOutput(
        options.deferContent ? deferSettledTimelineRow(previewed) : previewed,
      );
    });
  if (options.itemId === null) {
    return shorten(rows);
  }
  const matches = new Map<string, TimelineRow>();
  collectTimelineItemRows(rows, options.itemId, matches);
  const matched = [...matches.values()];
  const delegation = matched.find(
    (row) => row.kind === "work" && row.workKind === "delegation",
  );
  if (
    delegation?.kind === "work" &&
    delegation.workKind === "delegation" &&
    delegation.childRows !== null
  ) {
    return [{ ...delegation, childRows: shorten(delegation.childRows) }];
  }
  return matched.length === 0 ? null : mapTimelineRowTree(matched, withPreview);
}

function resolveTimelineTurnDetailsRange(
  db: DbConnection,
  thread: Thread,
  options: BuildTimelineTurnSummaryDetailsOptions,
): Pick<TimelineTurnSummarySelection, "sourceSeqEnd" | "sourceSeqStart"> {
  const lifecycle =
    options.itemId === null
      ? null
      : getStoredItemLifecycleSequenceRange(db, {
          itemId: options.itemId,
          threadId: thread.id,
          turnId: options.turnId,
        });
  if (lifecycle === null) {
    return {
      sourceSeqEnd: options.sourceSeqEnd,
      sourceSeqStart: options.sourceSeqStart,
    };
  }
  return {
    sourceSeqEnd: Math.max(options.sourceSeqEnd, lifecycle.last),
    sourceSeqStart: Math.min(options.sourceSeqStart, lifecycle.first),
  };
}

export function buildTimelineTurnSummaryDetails(
  db: DbConnection,
  thread: Thread,
  options: BuildTimelineTurnSummaryDetailsOptions,
): TimelineTurnSummaryDetailsResponse {
  return db.transaction(() =>
    buildTimelineTurnSummaryDetailsPage(db, thread, {
      ...options,
      ...resolveTimelineTurnDetailsRange(db, thread, options),
    }),
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
      options.itemId,
      options.deferContent,
      options.sourceSeqStart,
      options.sourceSeqEnd,
      options.includeDiagnosticOperations,
      options.providerDisplayName ?? null,
      thread.title ?? thread.titleFallback ?? "",
      resolveThreadWorkspaceRoot(db, thread),
      options.completedTurnDisplay,
      options.summarizeShellCommands,
    ]),
  );
  const contentCursor = readTimelineContentCursor(detailsPage);
  const now = Date.now();
  const projection = getOrProjectTimelineTurnDetails(db, {
    now,
    project: () =>
      projectTimelineTurnSummaryDetails(db, thread, options, snapshot, now),
    revision: JSON.stringify([
      timelineSnapshotKey(snapshot),
      getThreadEventRewriteGeneration(thread.id),
    ]),
    slot: JSON.stringify([thread.id, snapshot.surface]),
  });
  const contents = paginateTimelineContents(
    projection.rows,
    contentCursor?.beforeLeaf,
    TIMELINE_TURN_DETAILS_PAGE_LEAF_LIMIT,
    TIMELINE_TURN_DETAILS_PAGE_BYTE_LIMIT,
    projection.leafBytes,
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

function projectTimelineTurnSummaryDetails(
  db: DbConnection,
  thread: Thread,
  options: BuildTimelineTurnSummaryDetailsOptions,
  snapshot: TimelineSnapshot,
  now: number,
): Pick<TimelineTurnDetailsProjection, "expiresAt" | "rows"> {
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
    ...exactEventRowsForRequestedTurn,
    ...acceptedInputRowsByTurn.requestedTurnRows,
  ]);

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
  const turnContextRows = mergeStoredEventRowsById([
    ...requestedTurnStartedRows,
    ...eventRows,
  ]);
  const turnLifecycleRows = listStoredEventRows(db, {
    threadId: thread.id,
    afterSequence:
      turnContextRows.reduce(
        (minSequence, row) => Math.min(minSequence, row.sequence),
        options.sourceSeqStart,
      ) - 1,
    beforeSequence: contextSequenceCutoff + 1,
    types: ["turn/started", "turn/completed"],
  });
  const wholeItemEventRows = ensureSequenceWindowWholeItemRows(db, {
    beforeSequence: detailsWindow.beforeSequence,
    maxInlineOutputChars: detailsInlineOutputLimit,
    rows: mergeStoredEventRowsById([...turnContextRows, ...turnLifecycleRows]),
    sequenceStart: detailsWindow.sequenceStart,
    threadId: thread.id,
  });
  const eventRowsWithParentedChildren = ensureTimelineWindowParentedRows(db, {
    excludeDiagnosticEvents: !includeDiagnosticOperations,
    lookups: createTimelineWindowParentedRowLookups(new Set()),
    source: databaseTimelineRowSource(db),
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
  const projectionEvents = projectionEventRows
    .filter((row) => row.sequence <= snapshot.maxSeq)
    .map((row) => toThreadEventWithMeta(row));
  const children = buildThreadTimelineTurnDetailsFromEvents({
    events: projectionEvents,
    options: {
      completedTurnDisplay: options.completedTurnDisplay,
      includeDiagnosticOperations,
      sourceSeqStart: options.sourceSeqStart,
      summarizeShellCommands: options.summarizeShellCommands,
      turnId: options.turnId,
      providerDisplayName: options.providerDisplayName,
      threadStatus: snapshot.status,
      threadName: thread.title ?? thread.titleFallback ?? "",
      workspaceRoot: resolveThreadWorkspaceRoot(db, thread),
    },
  });

  if (children.kind === "missing-match") {
    throw new ApiError(
      400,
      "invalid_request",
      `Timeline turn summary details range ${options.sourceSeqStart}-${options.sourceSeqEnd} does not include turn ${options.turnId}`,
    );
  }
  const scopedRows = scopeTimelineTurnDetailsRows(
    children.rows,
    retainedOutputPreviewsByCallId(projectionEvents, "detail-limit", now),
    options,
  );
  if (scopedRows === null) {
    throw new ApiError(
      400,
      "invalid_request",
      `Timeline turn summary details range ${options.sourceSeqStart}-${options.sourceSeqEnd} does not include item ${options.itemId}`,
    );
  }
  return {
    expiresAt: nextRetainedOutputPreviewExpiry(projectionEvents, now),
    rows: scopedRows,
  };
}
