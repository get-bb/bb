import { createHash } from "node:crypto";
import {
  buildTimelineFeedRowsFromViewRows,
  buildThreadTimelineFeedFromEvents,
  buildThreadTimelineFromEvents,
  THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
  buildThreadTimelineTurnDetailsFromEvents,
  buildTimelineViewRows,
  compactThreadTimelineSummaryEvents,
  formatToolCallResultOutput,
  timelineFileChangeIndexFromRowId,
  type LatestThreadTimelinePageRequest,
  type OlderThreadTimelinePageRequest,
  type TimelineFeedKeyRow,
  type TimelineFeedFileDiffLookup,
  type TimelineFeedFileDiffLookupArgs,
  type ThreadTimelineViewRow,
  type TimelineViewWorkRow,
  type ThreadEventWithMeta,
  type ThreadTimelineFeedFromEventsSuccess,
  type ThreadTimelinePageKind,
  type ThreadTimelinePageRequest,
} from "@bb/thread-view";
import {
  type ClientTurnRequestId,
  type Thread,
  type ThreadEvent,
} from "@bb/domain";
import type {
  TimelineFeedDetailPart,
  TimelineFeedRow,
  TimelinePaginationCursor,
  TimelineCommandWorkRow,
  TimelineRow,
  TimelineToolWorkRow,
  ThreadTimelineFeedResponse,
  TimelineRowDetailResponse,
  TimelineTurnSummaryDetailsResponse,
  TimelineWorkOutputDetailResponse,
} from "@bb/server-contract";
import {
  findTimelineSegmentAnchorSequenceAfter,
  getEnvironment,
  getTimelineSegmentAnchorAtSequence,
  getTimelineFileChangeDiffLargeValue,
  getTimelineWorkOutputLargeValue,
  getThreadEventRevision,
  listContextWindowUsageRows,
  listTimelineFileChangeDiffLargeValueMetadata,
  listRecentStoredEventRows,
  listStoredClientTurnRequestIdsInRange,
  listStoredEventRowsInRange,
  listLatestBackgroundTaskStateRowsByItemIds,
  listStoredTimelineFeedWindowEventRows,
  listStoredTurnInputAcceptedRowsByClientRequestIds,
  listStoredTurnStartedRowsByTurnIdsUpToSequence,
  listTimelineSegmentAnchorsDescending,
} from "@bb/db";
import type {
  DbConnection,
  StoredEventRow,
  StoredTimelineFeedEventRow,
  TimelineFileChangeDiffLargeValueMetadataListRow,
  TimelineFeedRedundantDeltaCompletionItemKind,
  ThreadEventRevision,
} from "@bb/db";
import { ApiError } from "../../errors.js";
import { parseStoredEvent } from "./thread-data.js";

export type {
  LatestThreadTimelinePageRequest,
  OlderThreadTimelinePageRequest,
  ThreadTimelinePageKind,
  ThreadTimelinePageRequest,
};

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

interface BuildThreadTimelineFeedOptions {
  isDevelopment: boolean;
  page: ThreadTimelinePageRequest;
  summaryOnly: boolean;
}

interface BuildTimelineTurnSummaryDetailsOptions extends TimelineTurnSummarySelection {
  isDevelopment: boolean;
}

interface BuildTimelineRowDetailOptions {
  isDevelopment: boolean;
  parts: readonly TimelineFeedDetailPart[];
  rowKey: string;
  sourceSeqEnd: number;
  sourceSeqStart: number;
}

interface BuildTimelineWorkOutputDetailOptions {
  callId: string;
  isDevelopment: boolean;
  sourceSeqEnd: number;
  sourceSeqStart: number;
  workKind: "command" | "tool";
}

interface GetStoredTimelineWorkOutputArgs {
  callId: string;
  sourceSeqEnd: number;
  sourceSeqStart: number;
  threadId: string;
  workKind: "command" | "tool";
}

interface TimelineFeedFileDiffMetadataContext {
  db: DbConnection;
  fileDiffMetadataByKey: ReadonlyMap<
    string,
    readonly TimelineFileChangeDiffMetadataEntry[]
  >;
  threadId: string;
}

interface TimelineFeedDetailLookupContext
  extends TimelineFeedFileDiffMetadataContext, TimelineFeedFileDiffLookup {}

interface TimelineFileChangeDiffMetadataEntry {
  originalLength: number;
  sequence: number;
}

interface GetStoredTimelineFileDiffArgs {
  callId: string;
  changeIndex: number;
  sourceSeqEnd: number;
  sourceSeqStart: number;
  threadId: string;
}

interface TimelineRowsSourceRange {
  seqEnd: number;
  seqStart: number;
}

interface TimelineRowsSourceRangeRow {
  sourceSeqEnd: number;
  sourceSeqStart: number;
}

interface BuildThreadTimelineFeedCacheKeyArgs {
  eventRevision: ThreadEventRevision;
  includeProviderUnhandledOperations: boolean;
  page: ThreadTimelinePageRequest;
  summaryOnly: boolean;
  thread: Thread;
  workspaceRoot: string | null;
}

interface BuildThreadTimelineFeedRequestCacheKeyArgs {
  includeProviderUnhandledOperations: boolean;
  page: ThreadTimelinePageRequest;
  summaryOnly: boolean;
  thread: Thread;
  workspaceRoot: string | null;
}

interface FormatStoredTimelineToolOutputArgs {
  sequence: number;
  threadId: string;
  value: string;
}

interface TimelineFeedRowKeyParts {
  digest: string;
  prefix: string;
  sourceSeqStart: number;
}

interface CachedTimelineParsedEvent {
  data: string;
  event: ThreadEvent;
}

interface LatestTimelineFeedSegmentState {
  sourceSeqStart: number;
  turnId: string;
}

interface CachedTimelineFeedState {
  eventRevision: ThreadEventRevision;
  latestSegment: LatestTimelineFeedSegmentState | null;
  response: ThreadTimelineFeedResponse;
}

interface TryBuildIncrementalLatestFeedArgs {
  db: DbConnection;
  eventRevision: ThreadEventRevision;
  includeProviderUnhandledOperations: boolean;
  page: ThreadTimelinePageRequest;
  stateKey: string;
  summaryOnly: boolean;
  thread: Thread;
  workspaceRoot: string | null;
}

interface BuildLatestSegmentFeedArgs {
  db: DbConnection;
  includeProviderUnhandledOperations: boolean;
  latestSegment: LatestTimelineFeedSegmentState;
  page: ThreadTimelinePageRequest;
  previousResponse: ThreadTimelineFeedResponse;
  thread: Thread;
  workspaceRoot: string | null;
}

interface LatestTurnAppendSafetyArgs {
  appendedRows: readonly StoredEventRow[];
  eventRevision: ThreadEventRevision;
  latestSegment: LatestTimelineFeedSegmentState;
  previousEventRevision: ThreadEventRevision;
}

interface SpliceLatestSegmentFeedRowsArgs {
  latestSegment: LatestTimelineFeedSegmentState;
  previousRows: readonly TimelineFeedRow[];
  segmentRows: readonly TimelineFeedRow[];
}

interface BuildThreadTimelineFeedResponseArgs {
  feedTimeline: ThreadTimelineFeedFromEventsSuccess;
  threadId: string;
}

interface LruMapOptions {
  maxEntries: number;
}

class LruMap<TKey, TValue> {
  private readonly entries = new Map<TKey, TValue>();
  private readonly maxEntries: number;

  constructor(options: LruMapOptions) {
    this.maxEntries = options.maxEntries;
  }

  get(key: TKey): TValue | undefined {
    const value = this.entries.get(key);
    if (value === undefined) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: TKey, value: TValue): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.entries.delete(oldestKey);
    }
  }
}

export const THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT = 20;
export const THREAD_TIMELINE_SEGMENT_LIMIT_MAX = 100;
const THREAD_TIMELINE_PARSED_EVENT_CACHE_MAX_ROWS = 10_000;
const THREAD_TIMELINE_PARSED_EVENT_CACHE_MAX_DATA_CHARS = 16 * 1024;
const THREAD_TIMELINE_FEED_RESPONSE_CACHE_MAX_ENTRIES = 128;
const parsedTimelineEventCache = new LruMap<string, CachedTimelineParsedEvent>({
  maxEntries: THREAD_TIMELINE_PARSED_EVENT_CACHE_MAX_ROWS,
});
const feedResponseTimelineCache = new LruMap<
  string,
  ThreadTimelineFeedResponse
>({
  maxEntries: THREAD_TIMELINE_FEED_RESPONSE_CACHE_MAX_ENTRIES,
});
const feedStateTimelineCache = new LruMap<string, CachedTimelineFeedState>({
  maxEntries: THREAD_TIMELINE_FEED_RESPONSE_CACHE_MAX_ENTRIES,
});

interface TimelineEventRowSelection {
  acceptedClientRequestContextRows: StoredEventRow[];
  paginationPage: ThreadTimelinePageRequest;
  responsePageKind: ThreadTimelinePageKind;
  rows: StoredEventRow[];
}

interface TimelineWindowRowsArgs {
  rows: readonly StoredEventRow[];
  threadId: string;
}

interface TimelineFeedResolvedDeltaKeyParts {
  itemId: string;
  itemKind: TimelineFeedRedundantDeltaCompletionItemKind;
  parentToolCallId: string;
  turnId: string;
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

function cacheParsedTimelineEvent(
  row: StoredEventRow,
  event: ThreadEvent,
): void {
  if (row.data.length > THREAD_TIMELINE_PARSED_EVENT_CACHE_MAX_DATA_CHARS) {
    return;
  }
  parsedTimelineEventCache.set(row.id, {
    data: row.data,
    event,
  });
}

function getCachedFeedResponseTimeline(
  key: string,
): ThreadTimelineFeedResponse | null {
  const cached = feedResponseTimelineCache.get(key);
  if (cached === undefined) {
    return null;
  }
  return cached;
}

function cacheFeedResponseTimeline(
  key: string,
  response: ThreadTimelineFeedResponse,
): void {
  feedResponseTimelineCache.set(key, response);
}

function getCachedFeedStateTimeline(
  key: string,
): CachedTimelineFeedState | null {
  const cached = feedStateTimelineCache.get(key);
  if (cached === undefined) {
    return null;
  }
  return cached;
}

function cacheFeedStateTimeline(
  key: string,
  state: CachedTimelineFeedState,
): void {
  feedStateTimelineCache.set(key, state);
}

function parseTimelineStoredEvent(row: StoredEventRow): ThreadEvent {
  const cached = parsedTimelineEventCache.get(row.id);
  if (cached && cached.data === row.data) {
    return cached.event;
  }

  const event = parseStoredEvent(row);
  cacheParsedTimelineEvent(row, event);
  return event;
}

function buildThreadTimelineFeedRequestCacheKey({
  includeProviderUnhandledOperations,
  page,
  summaryOnly,
  thread,
  workspaceRoot,
}: BuildThreadTimelineFeedRequestCacheKeyArgs): string {
  const hash = createHash("sha256");
  hash.update(thread.id);
  hash.update("\0");
  hash.update(thread.status);
  hash.update("\0");
  hash.update(workspaceRoot ?? "");
  hash.update("\0");
  hash.update(includeProviderUnhandledOperations ? "dev" : "prod");
  hash.update("\0");
  hash.update(summaryOnly ? "summary-only" : "rows");
  hash.update("\0");
  hash.update(JSON.stringify(page));
  return hash.digest("base64url");
}

function buildThreadTimelineFeedCacheKey({
  eventRevision,
  includeProviderUnhandledOperations,
  page,
  summaryOnly,
  thread,
  workspaceRoot,
}: BuildThreadTimelineFeedCacheKeyArgs): string {
  return [
    buildThreadTimelineFeedRequestCacheKey({
      includeProviderUnhandledOperations,
      page,
      summaryOnly,
      thread,
      workspaceRoot,
    }),
    eventRevision.count,
    eventRevision.maxSequence,
  ].join("\0");
}

function toThreadEventWithMeta(row: StoredEventRow): ThreadEventWithMeta {
  return {
    event: parseTimelineStoredEvent(row),
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

function timelineFeedResolvedDeltaKey(
  parts: TimelineFeedResolvedDeltaKeyParts,
): string {
  return [
    parts.turnId,
    parts.itemId,
    parts.itemKind,
    parts.parentToolCallId,
  ].join("\0");
}

function isTimelineFeedRedundantDeltaCompletionItemKind(
  itemKind: StoredEventRow["itemKind"],
): itemKind is TimelineFeedRedundantDeltaCompletionItemKind {
  switch (itemKind) {
    case "agentMessage":
    case "commandExecution":
    case "reasoning":
      return true;
    case null:
    case "backgroundTask":
    case "contextCompaction":
    case "fileChange":
    case "imageView":
    case "plan":
    case "toolCall":
    case "userMessage":
    case "webFetch":
    case "webSearch":
      return false;
  }
}

function collectTimelineFeedReplayableCompletionKeys(
  rows: readonly StoredTimelineFeedEventRow[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    if (
      row.type !== "item/completed" ||
      row.turnId === null ||
      row.itemId === null ||
      row.timelineFeedHasReplayableCompletionBody !== 1 ||
      !isTimelineFeedRedundantDeltaCompletionItemKind(row.itemKind)
    ) {
      continue;
    }

    keys.add(
      timelineFeedResolvedDeltaKey({
        itemId: row.itemId,
        itemKind: row.itemKind,
        parentToolCallId: row.timelineFeedParentToolCallId,
        turnId: row.turnId,
      }),
    );
  }
  return keys;
}

function filterResolvedTimelineFeedDeltaRows(
  rows: readonly StoredTimelineFeedEventRow[],
): StoredEventRow[] {
  const completionKeys = collectTimelineFeedReplayableCompletionKeys(rows);
  if (completionKeys.size === 0) {
    return [...rows];
  }

  return rows.filter((row) => {
    if (
      row.turnId === null ||
      row.itemId === null ||
      row.timelineFeedDeltaCompletionItemKind === null
    ) {
      return true;
    }

    return !completionKeys.has(
      timelineFeedResolvedDeltaKey({
        itemId: row.itemId,
        itemKind: row.timelineFeedDeltaCompletionItemKind,
        parentToolCallId: row.timelineFeedParentToolCallId,
        turnId: row.turnId,
      }),
    );
  });
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
  const feedWindowRows = listStoredTimelineFeedWindowEventRows(db, {
    beforeSequence,
    excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    sequenceStart,
    threadId: thread.id,
  });

  const selectedRows = ensureTimelineWindowBackgroundTaskStateRows(db, {
    threadId: thread.id,
    rows: ensureTimelineWindowTurnStartedRows(db, {
      threadId: thread.id,
      rows: filterResolvedTimelineFeedDeltaRows(feedWindowRows),
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

function selectTimelineEventRows(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineFeedOptions,
): TimelineEventRowSelection {
  return selectStandardTimelineEventRows(db, thread, options.page);
}

function timelineFeedRowKindPrefix(row: TimelineFeedKeyRow): string {
  switch (row.kind) {
    case "bundle-summary":
      return "b";
    case "conversation":
      return "c";
    case "step-summary":
      return "p";
    case "system":
      return "s";
    case "turn":
      return "t";
    case "work":
      return `w${row.workKind.slice(0, 1)}`;
  }
}

function timelineFeedRowDigest(row: TimelineFeedKeyRow): string {
  return createHash("sha256")
    .update(row.id)
    .digest("base64url")
    .slice(0, 10);
}

function timelineFeedRowKey(row: TimelineFeedKeyRow): string {
  const digest = timelineFeedRowDigest(row);
  return `${timelineFeedRowKindPrefix(row)}_${row.sourceSeqStart}_${digest}`;
}

const TIMELINE_FILE_CHANGE_DIFF_JSON_PATH_PATTERN =
  /^\$\.item\.changes\[(\d+)\]\.diff$/u;
const TIMELINE_FEED_ROW_KEY_PATTERN = /^([^_]+)_(\d+)_(.+)$/u;

function parseTimelineFeedRowKey(rowKey: string): TimelineFeedRowKeyParts | null {
  const match = TIMELINE_FEED_ROW_KEY_PATTERN.exec(rowKey);
  if (!match) {
    return null;
  }
  const prefix = match[1];
  const sourceSeqStartText = match[2];
  const digest = match[3];
  if (
    prefix === undefined ||
    sourceSeqStartText === undefined ||
    digest === undefined
  ) {
    return null;
  }
  const sourceSeqStart = Number(sourceSeqStartText);
  if (!Number.isSafeInteger(sourceSeqStart)) {
    return null;
  }
  return {
    digest,
    prefix,
    sourceSeqStart,
  };
}

function isSummaryTimelineFeedRowKeyPrefix(prefix: string): boolean {
  return prefix === "b" || prefix === "p";
}

function timelineFileChangeIndexFromJsonPath(jsonPath: string): number | null {
  const match = TIMELINE_FILE_CHANGE_DIFF_JSON_PATH_PATTERN.exec(jsonPath);
  if (!match) {
    return null;
  }
  const changeIndex = Number(match[1]);
  return Number.isSafeInteger(changeIndex) && changeIndex >= 0
    ? changeIndex
    : null;
}

function timelineFileDiffMetadataKey(
  callId: string,
  changeIndex: number,
): string {
  return `${callId}\0${changeIndex}`;
}

function mergeTimelineRowsSourceRange(
  current: TimelineRowsSourceRange | null,
  row: TimelineRowsSourceRangeRow,
): TimelineRowsSourceRange {
  return {
    seqEnd:
      current === null
        ? row.sourceSeqEnd
        : Math.max(current.seqEnd, row.sourceSeqEnd),
    seqStart:
      current === null
        ? row.sourceSeqStart
        : Math.min(current.seqStart, row.sourceSeqStart),
  };
}

function collectTimelineRowsSourceRange(
  rows: readonly TimelineRowsSourceRangeRow[],
): TimelineRowsSourceRange | null {
  let range: TimelineRowsSourceRange | null = null;
  for (const row of rows) {
    range = mergeTimelineRowsSourceRange(range, row);
  }
  return range;
}

function addTimelineFileDiffMetadataEntry(
  metadataByKey: Map<string, TimelineFileChangeDiffMetadataEntry[]>,
  row: TimelineFileChangeDiffLargeValueMetadataListRow,
): void {
  if (row.itemId === null) {
    return;
  }
  const changeIndex = timelineFileChangeIndexFromJsonPath(row.jsonPath);
  if (changeIndex === null) {
    return;
  }
  const key = timelineFileDiffMetadataKey(row.itemId, changeIndex);
  const entries = metadataByKey.get(key) ?? [];
  entries.push({
    originalLength: row.originalLength,
    sequence: row.sequence,
  });
  metadataByKey.set(key, entries);
}

function createTimelineFeedDetailLookupContext(
  db: DbConnection,
  threadId: string,
  rows: readonly TimelineRowsSourceRangeRow[],
): TimelineFeedDetailLookupContext {
  const range = collectTimelineRowsSourceRange(rows);
  const metadataByKey = new Map<
    string,
    TimelineFileChangeDiffMetadataEntry[]
  >();
  if (range !== null) {
    for (const row of listTimelineFileChangeDiffLargeValueMetadata(db, {
      seqEnd: range.seqEnd,
      seqStart: range.seqStart,
      threadId,
    })) {
      addTimelineFileDiffMetadataEntry(metadataByKey, row);
    }
  }
  const context: TimelineFeedFileDiffMetadataContext = {
    db,
    fileDiffMetadataByKey: metadataByKey,
    threadId,
  };
  return {
    ...context,
    getMetadata(args: TimelineFeedFileDiffLookupArgs) {
      return getTimelineFileDiffMetadata(context, args.row, args.changeIndex);
    },
    getStoredDiff(args: TimelineFeedFileDiffLookupArgs) {
      return getStoredTimelineFileDiff(db, {
        callId: args.row.callId,
        changeIndex: args.changeIndex,
        sourceSeqEnd: args.row.sourceSeqEnd,
        sourceSeqStart: args.row.sourceSeqStart,
        threadId,
      });
    },
  };
}

function getTimelineFileDiffMetadata(
  lookupContext: TimelineFeedFileDiffMetadataContext,
  row: Extract<TimelineViewWorkRow, { workKind: "file-change" }>,
  changeIndex: number,
): TimelineFileChangeDiffMetadataEntry | null {
  const entries = lookupContext.fileDiffMetadataByKey.get(
    timelineFileDiffMetadataKey(row.callId, changeIndex),
  );
  if (!entries) {
    return null;
  }
  return (
    entries.find(
      (entry) =>
        entry.sequence >= row.sourceSeqStart &&
        entry.sequence <= row.sourceSeqEnd,
    ) ?? null
  );
}

function getStoredTimelineFileDiff(
  db: DbConnection,
  args: GetStoredTimelineFileDiffArgs,
): string | null {
  return (
    getTimelineFileChangeDiffLargeValue(db, {
      callId: args.callId,
      changeIndex: args.changeIndex,
      seqEnd: args.sourceSeqEnd,
      seqStart: args.sourceSeqStart,
      threadId: args.threadId,
    })?.value ?? null
  );
}

function mapTimelineViewRowsToFeedRowsWithDetailLookup(
  db: DbConnection,
  threadId: string,
  rows: readonly ThreadTimelineViewRow[],
): TimelineFeedRow[] {
  return buildTimelineFeedRowsFromViewRows({
    fileDiffLookup: createTimelineFeedDetailLookupContext(db, threadId, rows),
    rowKeyForRow: timelineFeedRowKey,
    rows,
  });
}

function findLatestTimelineFeedSegmentInRows(
  rows: readonly TimelineFeedRow[],
): LatestTimelineFeedSegmentState | null {
  let latestSegment: LatestTimelineFeedSegmentState | null = null;
  for (const row of rows) {
    if (
      row.kind === "conversation" &&
      row.role === "user" &&
      row.turnRequest.kind === "message" &&
      row.turnId !== null &&
      (latestSegment === null ||
        row.source.start > latestSegment.sourceSeqStart)
    ) {
      latestSegment = {
        sourceSeqStart: row.source.start,
        turnId: row.turnId,
      };
    }
    if (row.kind === "turn" && row.children !== null) {
      const childSegment = findLatestTimelineFeedSegmentInRows(row.children);
      if (
        childSegment !== null &&
        (latestSegment === null ||
          childSegment.sourceSeqStart > latestSegment.sourceSeqStart)
      ) {
        latestSegment = childSegment;
      }
    }
  }
  return latestSegment;
}

function findLatestTimelineFeedSegment(
  response: ThreadTimelineFeedResponse,
): LatestTimelineFeedSegmentState | null {
  if (response.timelinePage.kind !== "latest") {
    return null;
  }
  return findLatestTimelineFeedSegmentInRows(response.rows);
}

function buildThreadTimelineFeedResponse({
  feedTimeline,
  threadId,
}: BuildThreadTimelineFeedResponseArgs): ThreadTimelineFeedResponse {
  return {
    threadId,
    rows: feedTimeline.rows,
    activeThinking: feedTimeline.activeThinking,
    pendingTodos: feedTimeline.pendingTodos,
    contextWindowUsage: feedTimeline.contextWindowUsage,
    timelinePage: feedTimeline.timelinePage,
  };
}

function cacheLatestTimelineFeedState(
  stateKey: string,
  eventRevision: ThreadEventRevision,
  response: ThreadTimelineFeedResponse,
): void {
  cacheFeedStateTimeline(stateKey, {
    eventRevision,
    latestSegment: findLatestTimelineFeedSegment(response),
    response,
  });
}

function isTailStateTimelineEventType(type: StoredEventRow["type"]): boolean {
  switch (type) {
    case "thread/contextWindowUsage/updated":
    case "thread/tokenUsage/updated":
      return true;
    default:
      return false;
  }
}

function isSegmentBoundaryTimelineEventType(
  type: StoredEventRow["type"],
): boolean {
  switch (type) {
    case "client/turn/requested":
    case "client/turn/start":
    case "client/thread/start":
      return true;
    default:
      return false;
  }
}

function canAppendRowsUseLatestTurnFastPath({
  appendedRows,
  eventRevision,
  latestSegment,
  previousEventRevision,
}: LatestTurnAppendSafetyArgs): boolean {
  if (eventRevision.maxSequence <= previousEventRevision.maxSequence) {
    return false;
  }
  const countDelta = eventRevision.count - previousEventRevision.count;
  if (countDelta !== appendedRows.length || appendedRows.length === 0) {
    return false;
  }

  let hasAppendOnlyStateRow = false;
  let hasTimelineSegmentRow = false;
  for (const row of appendedRows) {
    if (row.sequence <= previousEventRevision.maxSequence) {
      return false;
    }
    if (isTailStateTimelineEventType(row.type)) {
      hasAppendOnlyStateRow = true;
      continue;
    }
    if (isSegmentBoundaryTimelineEventType(row.type)) {
      return false;
    }
    if (row.scopeKind !== "turn" || row.turnId !== latestSegment.turnId) {
      return false;
    }
    hasTimelineSegmentRow = true;
  }
  return hasTimelineSegmentRow || hasAppendOnlyStateRow;
}

function spliceLatestSegmentFeedRows({
  latestSegment,
  previousRows,
  segmentRows,
}: SpliceLatestSegmentFeedRowsArgs): TimelineFeedRow[] {
  const prefixRows = previousRows.filter(
    (row) => row.source.end < latestSegment.sourceSeqStart,
  );
  return [...prefixRows, ...segmentRows];
}

function buildLatestSegmentFeed({
  db,
  includeProviderUnhandledOperations,
  latestSegment,
  page,
  previousResponse,
  thread,
  workspaceRoot,
}: BuildLatestSegmentFeedArgs): ThreadTimelineFeedResponse | null {
  const segmentRows = listStoredTimelineFeedWindowEventRows(db, {
    beforeSequence: undefined,
    excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    sequenceStart: latestSegment.sourceSeqStart,
    threadId: thread.id,
  });
  if (segmentRows.length === 0) {
    return null;
  }

  const selectedSegmentRows = ensureTimelineWindowBackgroundTaskStateRows(db, {
    threadId: thread.id,
    rows: ensureTimelineWindowTurnStartedRows(db, {
      threadId: thread.id,
      rows: filterResolvedTimelineFeedDeltaRows(segmentRows),
    }),
  });
  const acceptedClientRequestContextRows =
    selectAcceptedClientRequestContextRows(db, {
      rows: selectedSegmentRows,
      threadId: thread.id,
    });
  const decodedRawEvents = selectedSegmentRows.map((row) =>
    toThreadEventWithMeta(row),
  );
  const decodedEvents = compactThreadTimelineSummaryEvents(decodedRawEvents);
  const contextWindowUsageRows = listContextWindowUsageRows(db, {
    threadId: thread.id,
  });
  const feedTimeline = buildThreadTimelineFeedFromEvents({
    acceptedClientRequestContext: {
      acceptedClientRequestEvents: acceptedClientRequestContextRows.map((row) =>
        toThreadEventWithMeta(row),
      ),
    },
    contextWindowEvents: contextWindowUsageRows.map((row) =>
      toThreadEventWithMeta(row),
    ),
    events: decodedEvents,
    options: {
      fileDiffLookupForRows: (rows) =>
        createTimelineFeedDetailLookupContext(db, thread.id, rows),
      includeDebugRawEvents: false,
      includeProviderUnhandledOperations,
      isLatestPage: true,
      paginationPage: page,
      responsePageKind: "latest",
      rowKeyForRow: timelineFeedRowKey,
      summaryOnly: false,
      threadStatus: thread.status,
      workspaceRoot,
    },
  });
  if (feedTimeline.kind === "missing-cursor") {
    return null;
  }

  return {
    threadId: thread.id,
    rows: spliceLatestSegmentFeedRows({
      latestSegment,
      previousRows: previousResponse.rows,
      segmentRows: feedTimeline.rows,
    }),
    activeThinking: feedTimeline.activeThinking,
    pendingTodos: feedTimeline.pendingTodos ?? previousResponse.pendingTodos,
    contextWindowUsage:
      feedTimeline.contextWindowUsage ?? previousResponse.contextWindowUsage,
    timelinePage: previousResponse.timelinePage,
  };
}

function tryBuildIncrementalLatestTimelineFeed({
  db,
  eventRevision,
  includeProviderUnhandledOperations,
  page,
  stateKey,
  summaryOnly,
  thread,
  workspaceRoot,
}: TryBuildIncrementalLatestFeedArgs): ThreadTimelineFeedResponse | null {
  if (summaryOnly || page.kind !== "latest") {
    return null;
  }

  const cachedState = getCachedFeedStateTimeline(stateKey);
  if (cachedState === null || cachedState.latestSegment === null) {
    return null;
  }

  const appendedRows = listStoredEventRowsInRange(db, {
    seqEnd: eventRevision.maxSequence,
    seqStart: cachedState.eventRevision.maxSequence + 1,
    threadId: thread.id,
  });
  if (
    !canAppendRowsUseLatestTurnFastPath({
      appendedRows,
      eventRevision,
      latestSegment: cachedState.latestSegment,
      previousEventRevision: cachedState.eventRevision,
    })
  ) {
    return null;
  }

  return buildLatestSegmentFeed({
    db,
    includeProviderUnhandledOperations,
    latestSegment: cachedState.latestSegment,
    page,
    previousResponse: cachedState.response,
    thread,
    workspaceRoot,
  });
}

export function buildThreadTimelineFeed(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineFeedOptions,
): ThreadTimelineFeedResponse {
  const includeProviderUnhandledOperations = options.isDevelopment;
  const workspaceRoot = resolveThreadWorkspaceRoot(db, thread);
  // Events are append-only and sequence-unique for a thread. Count + max
  // sequence invalidates cached feeds on appends and pruning/deletes without
  // rereading the selected event JSON on the warm path.
  const eventRevision = getThreadEventRevision(db, {
    threadId: thread.id,
  });
  const requestCacheKey = buildThreadTimelineFeedRequestCacheKey({
    includeProviderUnhandledOperations,
    page: options.page,
    summaryOnly: options.summaryOnly,
    thread,
    workspaceRoot,
  });
  const cacheKey = buildThreadTimelineFeedCacheKey({
    eventRevision,
    includeProviderUnhandledOperations,
    page: options.page,
    summaryOnly: options.summaryOnly,
    thread,
    workspaceRoot,
  });
  const cachedFeed = getCachedFeedResponseTimeline(cacheKey);
  if (cachedFeed !== null) {
    return cachedFeed;
  }

  const incrementalFeed = tryBuildIncrementalLatestTimelineFeed({
    db,
    eventRevision,
    includeProviderUnhandledOperations,
    page: options.page,
    stateKey: requestCacheKey,
    summaryOnly: options.summaryOnly,
    thread,
    workspaceRoot,
  });
  if (incrementalFeed !== null) {
    cacheFeedResponseTimeline(cacheKey, incrementalFeed);
    cacheLatestTimelineFeedState(
      requestCacheKey,
      eventRevision,
      incrementalFeed,
    );
    return incrementalFeed;
  }

  const eventSelection = selectTimelineEventRows(db, thread, options);
  const rawEventRows = eventSelection.rows;
  const acceptedClientRequestContextRows = mergeStoredEventRowsById([
    ...eventSelection.acceptedClientRequestContextRows,
    ...selectAcceptedClientRequestContextRows(db, {
      rows: rawEventRows,
      threadId: thread.id,
    }),
  ]);
  const contextWindowUsageRows = listContextWindowUsageRows(db, {
    threadId: thread.id,
  });

  const decodedRawEvents = rawEventRows.map((row) =>
    toThreadEventWithMeta(row),
  );
  const decodedEvents = compactThreadTimelineSummaryEvents(decodedRawEvents);
  const feedTimeline = buildThreadTimelineFeedFromEvents({
    acceptedClientRequestContext: {
      acceptedClientRequestEvents: acceptedClientRequestContextRows.map((row) =>
        toThreadEventWithMeta(row),
      ),
    },
    contextWindowEvents: contextWindowUsageRows.map((row) =>
      toThreadEventWithMeta(row),
    ),
    events: decodedEvents,
    options: {
      fileDiffLookupForRows: (rows) =>
        createTimelineFeedDetailLookupContext(db, thread.id, rows),
      includeDebugRawEvents: false,
      includeProviderUnhandledOperations,
      isLatestPage: options.page.kind === "latest",
      paginationPage: eventSelection.paginationPage,
      responsePageKind: eventSelection.responsePageKind,
      rowKeyForRow: timelineFeedRowKey,
      summaryOnly: options.summaryOnly,
      threadStatus: thread.status,
      workspaceRoot,
    },
  });
  if (feedTimeline.kind === "missing-cursor") {
    throw new ApiError(
      400,
      "invalid_request",
      "Timeline pagination cursor is no longer available",
    );
  }
  const feedResponse = buildThreadTimelineFeedResponse({
    feedTimeline,
    threadId: thread.id,
  });
  cacheFeedResponseTimeline(cacheKey, feedResponse);
  cacheLatestTimelineFeedState(requestCacheKey, eventRevision, feedResponse);
  return feedResponse;
}

function buildTimelineRowsForDetail(
  db: DbConnection,
  thread: Thread,
  options: {
    isDevelopment: boolean;
    sourceSeqEnd: number;
    sourceSeqStart: number;
  },
): TimelineRow[] {
  if (options.sourceSeqStart > options.sourceSeqEnd) {
    throw new ApiError(
      400,
      "invalid_request",
      "sourceSeqStart must be less than or equal to sourceSeqEnd",
    );
  }

  const exactEventRows = listStoredEventRowsInRange(db, {
    threadId: thread.id,
    seqStart: options.sourceSeqStart,
    seqEnd: options.sourceSeqEnd,
  });
  if (exactEventRows.length === 0) {
    throw new ApiError(404, "invalid_request", "Timeline row not found");
  }

  const missingTurnIds = collectTurnIdsMissingStartedRows(exactEventRows);
  const turnStartedRows =
    missingTurnIds.length === 0
      ? []
      : listStoredTurnStartedRowsByTurnIdsUpToSequence(db, {
          threadId: thread.id,
          sequenceCutoff: maxStoredEventSequence(exactEventRows),
          turnIds: missingTurnIds,
        });
  return buildThreadTimelineFromEvents({
    acceptedClientRequestContext: {
      acceptedClientRequestEvents: [],
    },
    contextWindowEvents: [],
    events: [...turnStartedRows, ...exactEventRows].map((row) =>
      toThreadEventWithMeta(row),
    ),
    options: {
      includeDebugRawEvents: false,
      includeNestedRows: true,
      includeProviderUnhandledOperations: options.isDevelopment,
      isLatestPage: false,
      threadStatus: thread.status,
      turnMessageDetail: "full",
      workspaceRoot: resolveThreadWorkspaceRoot(db, thread),
    },
  }).rows;
}

function collectTimelineViewRows(
  rows: readonly ThreadTimelineViewRow[],
): ThreadTimelineViewRow[] {
  const collectedRows: ThreadTimelineViewRow[] = [];
  for (const row of rows) {
    collectedRows.push(row);
    switch (row.kind) {
      case "bundle-summary":
      case "step-summary":
        collectedRows.push(...collectTimelineViewRows(row.children));
        continue;
      case "conversation":
      case "system":
        continue;
      case "turn":
        if (row.children !== null) {
          collectedRows.push(...collectTimelineViewRows(row.children));
        }
        continue;
      case "work":
        if (row.workKind === "delegation") {
          collectedRows.push(...collectTimelineViewRows(row.childRows));
        }
        continue;
    }
  }
  return collectedRows;
}

function timelineDetailRowSourceMatches(
  row: ThreadTimelineViewRow,
  options: BuildTimelineRowDetailOptions,
): boolean {
  return (
    row.sourceSeqStart === options.sourceSeqStart &&
    row.sourceSeqEnd === options.sourceSeqEnd
  );
}

function timelineDetailRowCanUseSourceFallback(
  row: ThreadTimelineViewRow,
): boolean {
  return row.kind === "bundle-summary" || row.kind === "step-summary";
}

function timelineDetailSummaryRowMatchesRequest(
  row: ThreadTimelineViewRow,
  options: BuildTimelineRowDetailOptions,
): boolean {
  if (!timelineDetailRowCanUseSourceFallback(row)) {
    return false;
  }
  const requestedKey = parseTimelineFeedRowKey(options.rowKey);
  if (
    requestedKey === null ||
    requestedKey.sourceSeqStart !== options.sourceSeqStart ||
    requestedKey.sourceSeqStart !== row.sourceSeqStart
  ) {
    return false;
  }

  const rowPrefix = timelineFeedRowKindPrefix(row);
  const prefixMatches =
    requestedKey.prefix === rowPrefix ||
    (isSummaryTimelineFeedRowKeyPrefix(requestedKey.prefix) &&
      isSummaryTimelineFeedRowKeyPrefix(rowPrefix));
  return prefixMatches && requestedKey.digest === timelineFeedRowDigest(row);
}

function timelineDetailRequestIsForSummaryRow(
  options: BuildTimelineRowDetailOptions,
): boolean {
  const requestedKey = parseTimelineFeedRowKey(options.rowKey);
  return (
    requestedKey !== null &&
    requestedKey.sourceSeqStart === options.sourceSeqStart &&
    isSummaryTimelineFeedRowKeyPrefix(requestedKey.prefix)
  );
}

function resolveSummaryTimelineDetailSourceSeqEnd(
  db: DbConnection,
  thread: Thread,
  options: BuildTimelineRowDetailOptions,
): number | null {
  if (!timelineDetailRequestIsForSummaryRow(options)) {
    return null;
  }
  const nextSegmentAnchorSequence = findTimelineSegmentAnchorSequenceAfter(db, {
    sequence: options.sourceSeqStart,
    threadId: thread.id,
  });
  const sourceSeqEnd =
    nextSegmentAnchorSequence === undefined
      ? getThreadEventRevision(db, { threadId: thread.id }).maxSequence
      : nextSegmentAnchorSequence - 1;
  return sourceSeqEnd > options.sourceSeqEnd ? sourceSeqEnd : null;
}

function timelineDetailRowMatchesRequest(
  row: ThreadTimelineViewRow,
  options: BuildTimelineRowDetailOptions,
): boolean {
  if (
    timelineDetailRowSourceMatches(row, options) &&
    timelineFeedRowKey(row) === options.rowKey
  ) {
    return true;
  }
  return timelineDetailSummaryRowMatchesRequest(row, options);
}

function findTimelineDetailRowInSourceRows(
  rows: readonly TimelineRow[],
  options: BuildTimelineRowDetailOptions,
): ThreadTimelineViewRow | null {
  const viewRows = buildTimelineViewRows(rows);
  return (
    findTimelineDetailRow(viewRows, options) ??
    findTimelineDetailRow(
      buildTimelineViewRows(rows, { closedScope: true }),
      options,
    )
  );
}

function findTimelineDetailRow(
  rows: readonly ThreadTimelineViewRow[],
  options: BuildTimelineRowDetailOptions,
): ThreadTimelineViewRow | null {
  return (
    collectTimelineViewRows(rows).find((row) =>
      timelineDetailRowMatchesRequest(row, options),
    ) ?? null
  );
}

export function buildTimelineRowDetail(
  db: DbConnection,
  thread: Thread,
  options: BuildTimelineRowDetailOptions,
): TimelineRowDetailResponse {
  const rows = buildTimelineRowsForDetail(db, thread, {
    isDevelopment: options.isDevelopment,
    sourceSeqEnd: options.sourceSeqEnd,
    sourceSeqStart: options.sourceSeqStart,
  });
  let matchingRow = findTimelineDetailRowInSourceRows(rows, options);
  if (!matchingRow) {
    const expandedSourceSeqEnd = resolveSummaryTimelineDetailSourceSeqEnd(
      db,
      thread,
      options,
    );
    if (expandedSourceSeqEnd !== null) {
      matchingRow = findTimelineDetailRowInSourceRows(
        buildTimelineRowsForDetail(db, thread, {
          isDevelopment: options.isDevelopment,
          sourceSeqEnd: expandedSourceSeqEnd,
          sourceSeqStart: options.sourceSeqStart,
        }),
        options,
      );
    }
  }
  if (!matchingRow) {
    throw new ApiError(404, "invalid_request", "Timeline row not found");
  }

  const parts: TimelineRowDetailResponse["parts"] = {
    text: null,
    output: null,
    systemDetail: null,
    fileDiff: null,
    stdout: null,
    stderr: null,
    children: null,
    workflow: null,
  };
  const requestedParts = new Set(options.parts);

  switch (matchingRow.kind) {
    case "bundle-summary":
    case "step-summary":
      if (requestedParts.has("children")) {
        parts.children = mapTimelineViewRowsToFeedRowsWithDetailLookup(
          db,
          thread.id,
          matchingRow.children,
        );
      }
      break;
    case "conversation":
      if (requestedParts.has("text")) {
        parts.text = matchingRow.text;
      }
      break;
    case "system":
      if (requestedParts.has("system-detail")) {
        parts.systemDetail = matchingRow.detail;
      }
      break;
    case "turn":
      if (requestedParts.has("children")) {
        parts.children =
          matchingRow.children === null
            ? []
            : mapTimelineViewRowsToFeedRowsWithDetailLookup(
                db,
                thread.id,
                matchingRow.children,
              );
      }
      break;
    case "work":
      switch (matchingRow.workKind) {
        case "command":
        case "tool":
          if (requestedParts.has("output")) {
            parts.output =
              getStoredTimelineWorkOutput(db, {
                callId: matchingRow.callId,
                sourceSeqEnd: matchingRow.sourceSeqEnd,
                sourceSeqStart: matchingRow.sourceSeqStart,
                threadId: thread.id,
                workKind: matchingRow.workKind,
              }) ?? matchingRow.output;
          }
          break;
        case "file-change":
          if (requestedParts.has("file-diff")) {
            const changeIndex = timelineFileChangeIndexFromRowId(
              matchingRow.id,
            );
            parts.fileDiff =
              changeIndex === null
                ? matchingRow.change.diff
                : (getStoredTimelineFileDiff(db, {
                    callId: matchingRow.callId,
                    changeIndex,
                    sourceSeqEnd: matchingRow.sourceSeqEnd,
                    sourceSeqStart: matchingRow.sourceSeqStart,
                    threadId: thread.id,
                  }) ?? matchingRow.change.diff);
          }
          if (requestedParts.has("stdout")) {
            parts.stdout = matchingRow.stdout;
          }
          if (requestedParts.has("stderr")) {
            parts.stderr = matchingRow.stderr;
          }
          break;
        case "delegation":
          if (requestedParts.has("output")) {
            parts.output =
              getStoredTimelineWorkOutput(db, {
                callId: matchingRow.callId,
                sourceSeqEnd: matchingRow.sourceSeqEnd,
                sourceSeqStart: matchingRow.sourceSeqStart,
                threadId: thread.id,
                workKind: "tool",
              }) ?? matchingRow.output;
          }
          if (requestedParts.has("children")) {
            parts.children = mapTimelineViewRowsToFeedRowsWithDetailLookup(
              db,
              thread.id,
              matchingRow.childRows,
            );
          }
          break;
        case "workflow":
          if (requestedParts.has("workflow")) {
            parts.workflow = matchingRow.workflow;
          }
          break;
        case "web-search":
        case "web-fetch":
        case "image-view":
        case "approval":
        case "question":
          break;
      }
      break;
  }

  return {
    rowKey: options.rowKey,
    source: {
      start: matchingRow.sourceSeqStart,
      end: matchingRow.sourceSeqEnd,
    },
    parts,
  };
}

function collectTimelineWorkOutputRows(
  rows: readonly TimelineRow[],
): Array<TimelineCommandWorkRow | TimelineToolWorkRow> {
  const outputRows: Array<TimelineCommandWorkRow | TimelineToolWorkRow> = [];
  for (const row of rows) {
    switch (row.kind) {
      case "conversation":
      case "system":
        continue;
      case "turn":
        if (row.children !== null) {
          outputRows.push(...collectTimelineWorkOutputRows(row.children));
        }
        continue;
      case "work":
        switch (row.workKind) {
          case "command":
          case "tool":
            outputRows.push(row);
            continue;
          case "delegation":
            outputRows.push(...collectTimelineWorkOutputRows(row.childRows));
            continue;
          case "file-change":
          case "web-search":
          case "web-fetch":
          case "image-view":
          case "approval":
          case "question":
          case "workflow":
            continue;
        }
    }
  }
  return outputRows;
}

function formatStoredTimelineToolOutput(
  db: DbConnection,
  args: FormatStoredTimelineToolOutputArgs,
): string | null {
  const [row] = listStoredEventRowsInRange(db, {
    seqEnd: args.sequence,
    seqStart: args.sequence,
    threadId: args.threadId,
  });
  if (!row) {
    return null;
  }

  const event = parseTimelineStoredEvent(row);
  if (event.type !== "item/completed" || event.item.type !== "toolCall") {
    return null;
  }

  const serverPrefix = event.item.server ? `${event.item.server}:` : "";
  return formatToolCallResultOutput(
    `${serverPrefix}${event.item.tool}`,
    args.value,
  );
}

function getStoredTimelineWorkOutput(
  db: DbConnection,
  args: GetStoredTimelineWorkOutputArgs,
): string | null {
  const largeValue = getTimelineWorkOutputLargeValue(db, {
    callId: args.callId,
    seqEnd: args.sourceSeqEnd,
    seqStart: args.sourceSeqStart,
    threadId: args.threadId,
    workKind: args.workKind,
  });
  if (largeValue === null) {
    return null;
  }
  if (args.workKind === "command") {
    return largeValue.value;
  }
  return formatStoredTimelineToolOutput(db, {
    sequence: largeValue.sequence,
    threadId: args.threadId,
    value: largeValue.value,
  });
}

export function buildTimelineWorkOutputDetail(
  db: DbConnection,
  thread: Thread,
  options: BuildTimelineWorkOutputDetailOptions,
): TimelineWorkOutputDetailResponse {
  const storedOutput = getStoredTimelineWorkOutput(db, {
    callId: options.callId,
    sourceSeqEnd: options.sourceSeqEnd,
    sourceSeqStart: options.sourceSeqStart,
    threadId: thread.id,
    workKind: options.workKind,
  });
  if (storedOutput !== null) {
    return {
      output: storedOutput,
    };
  }

  const rows = buildTimelineRowsForDetail(db, thread, {
    isDevelopment: options.isDevelopment,
    sourceSeqEnd: options.sourceSeqEnd,
    sourceSeqStart: options.sourceSeqStart,
  });
  const matchingRow = collectTimelineWorkOutputRows(rows).find(
    (row) => row.callId === options.callId && row.workKind === options.workKind,
  );
  if (!matchingRow) {
    throw new ApiError(404, "invalid_request", "Timeline row not found");
  }

  return {
    output: matchingRow.output,
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
    turnId: options.turnId,
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
      sourceSeqEnd: sourceRange.sourceSeqEnd,
      sourceSeqStart: sourceRange.sourceSeqStart,
      threadStatus: thread.status,
      turnId: options.turnId,
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
