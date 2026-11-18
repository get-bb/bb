import { z } from "zod";
import {
  deleteThreadConversationOutlineCheckpoint,
  getDatabaseDataVersion,
  getThreadConversationOutlineCheckpoint,
  getThreadConversationOutlineKeys,
  getThreadEventRewriteGeneration,
  updateThreadConversationOutlineResponse,
  upsertThreadConversationOutlineCheckpoint,
  type DbConnection,
} from "@bb/db";
import {
  threadConversationOutlineItemSchema,
  type ThreadConversationOutlineItem,
} from "@bb/server-contract";
import {
  MIN_AGENT_MESSAGE_DELTAS_FOR_SUMMARY_COMPACTION,
  type ThreadEventWithMeta,
} from "@bb/thread-view";

interface ConversationOutlineProjection {
  events: ThreadEventWithMeta[];
  items: {
    item: ThreadConversationOutlineItem;
    sourceSeqStart: number;
    sourceSeqEnd: number;
  }[];
}

export interface ConversationOutlineSelection {
  events: ThreadEventWithMeta[];
  project: () => ConversationOutlineProjection["items"];
}

export interface ConversationOutlineProjectionState {
  includeNestedEvents: boolean;
  summaryCompactionEnabled: boolean;
}

interface Checkpoint {
  agentMessageDeltaCount: number;
  items: ThreadConversationOutlineItem[];
  sequenceStart: number;
  turnIds: Set<string>;
  requestIds: Set<string>;
  parentItemIds: Set<string>;
}

interface Entry {
  agentMessageDeltaCount: number;
  checkpoint: Checkpoint;
  historySequenceStart: number;
  dataVersion: number;
  generation: number;
  key: string;
  maxSeq: number;
  chars: number;
  projectionState: ConversationOutlineProjectionState;
  responseKey: string | null;
}

interface OutlineCache {
  entries: Map<string, Entry>;
  chars: number;
}

const caches = new WeakMap<DbConnection, OutlineCache>();
const MAX_ENTRIES = 16;
const MAX_CHARS = 8_000_000;

const storedItemsSchema = threadConversationOutlineItemSchema.array();
const storedStateSchema = z.object({
  checkpointAgentMessageDeltaCount: z.number().int().nonnegative(),
  agentMessageDeltaCount: z.number().int().nonnegative(),
  historySequenceStart: z.number().int().nonnegative(),
  projectionState: z.object({
    includeNestedEvents: z.boolean(),
    summaryCompactionEnabled: z.boolean(),
  }),
  turnIds: z.array(z.string()),
  requestIds: z.array(z.string()),
  parentItemIds: z.array(z.string()),
});

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function entryChars(checkpoint: Checkpoint, itemsJson: string): number {
  return (
    itemsJson.length +
    [
      ...checkpoint.turnIds,
      ...checkpoint.requestIds,
      ...checkpoint.parentItemIds,
    ].reduce((sum, id) => sum + id.length, 0)
  );
}

function readStoredEntry(
  db: DbConnection,
  args: {
    threadId: string;
    key: string;
    dataVersion: number;
    generation: number;
  },
): Entry | null {
  const record = getThreadConversationOutlineCheckpoint(db, args.threadId);
  if (record === null || record.projectionKey !== args.key) return null;
  const items = storedItemsSchema.safeParse(parseJson(record.itemsJson));
  const state = storedStateSchema.safeParse(parseJson(record.stateJson));
  if (!items.success || !state.success) return null;
  const checkpoint: Checkpoint = {
    agentMessageDeltaCount: state.data.checkpointAgentMessageDeltaCount,
    items: items.data,
    sequenceStart: record.sequenceStart,
    turnIds: new Set(state.data.turnIds),
    requestIds: new Set(state.data.requestIds),
    parentItemIds: new Set(state.data.parentItemIds),
  };
  return {
    agentMessageDeltaCount: state.data.agentMessageDeltaCount,
    checkpoint,
    historySequenceStart: state.data.historySequenceStart,
    dataVersion: args.dataVersion,
    generation: args.generation,
    key: args.key,
    maxSeq: record.sequenceStart - 1,
    chars: entryChars(checkpoint, record.itemsJson),
    projectionState: state.data.projectionState,
    responseKey: record.response?.responseKey ?? null,
  };
}

export function readStoredConversationOutline(
  db: DbConnection,
  args: { threadId: string; key: string; responseKey: string },
): ThreadConversationOutlineItem[] | null {
  const keys = getThreadConversationOutlineKeys(db, args.threadId);
  if (keys?.projectionKey !== args.key || keys.responseKey !== args.responseKey)
    return null;
  const record = getThreadConversationOutlineCheckpoint(db, args.threadId);
  if (record?.response?.responseKey !== args.responseKey) return null;
  const items = storedItemsSchema.safeParse(parseJson(record.itemsJson));
  const tail = storedItemsSchema.safeParse(
    parseJson(record.response.responseTailJson),
  );
  return items.success && tail.success ? [...items.data, ...tail.data] : null;
}

function storeEntry(
  db: DbConnection,
  threadId: string,
  entry: Entry,
  itemsJson: string,
  responseTailJson: string | null,
): void {
  upsertThreadConversationOutlineCheckpoint(db, {
    threadId,
    projectionKey: entry.key,
    sequenceStart: entry.checkpoint.sequenceStart,
    itemsJson,
    response:
      entry.responseKey === null || responseTailJson === null
        ? null
        : { responseKey: entry.responseKey, responseTailJson },
    stateJson: JSON.stringify({
      checkpointAgentMessageDeltaCount: entry.checkpoint.agentMessageDeltaCount,
      agentMessageDeltaCount: entry.agentMessageDeltaCount,
      historySequenceStart: entry.historySequenceStart,
      projectionState: entry.projectionState,
      turnIds: [...entry.checkpoint.turnIds],
      requestIds: [...entry.checkpoint.requestIds],
      parentItemIds: [...entry.checkpoint.parentItemIds],
    }),
  });
}

function referencedRequestId(
  event: ThreadEventWithMeta["event"],
): string | null {
  if (
    event.type === "client/turn/requested" ||
    event.type === "client/turn/rejected"
  ) {
    return event.requestId;
  }
  return event.type === "turn/input/accepted" ? event.clientRequestId : null;
}

function parentItemId(event: ThreadEventWithMeta["event"]): string | null {
  if ("item" in event && "parentToolCallId" in event.item)
    return event.item.parentToolCallId ?? null;
  return "parentToolCallId" in event ? (event.parentToolCallId ?? null) : null;
}

function backgroundItemId(event: ThreadEventWithMeta["event"]): string | null {
  return "item" in event &&
    (event.item.type === "backgroundTask" || event.item.type === "delegation")
    ? event.item.id
    : null;
}

function isThreadError(event: ThreadEventWithMeta["event"]): boolean {
  return (
    event.scope.kind === "thread" &&
    (event.type === "system/error" ||
      event.type === "provider/error" ||
      event.type === "system/thread/interrupted")
  );
}

function canReuse(
  checkpoint: Checkpoint,
  events: ThreadEventWithMeta[],
): boolean {
  let hasTailTurn = false;
  return events.every(({ event }) => {
    if (event.type === "turn/started") hasTailTurn = true;
    const parentId = parentItemId(event);
    if (parentId !== null && checkpoint.parentItemIds.has(parentId))
      return false;
    if (
      "item" in event &&
      (event.item.type === "toolCall" || backgroundItemId(event) !== null) &&
      checkpoint.parentItemIds.has(event.item.id)
    )
      return false;
    if (isThreadError(event) && !hasTailTurn) return false;
    if (
      event.scope.kind === "turn" &&
      checkpoint.turnIds.has(event.scope.turnId)
    )
      return false;
    const requestId = referencedRequestId(event);
    if (requestId !== null && checkpoint.requestIds.has(requestId))
      return false;
    if (
      event.type === "client/turn/requested" &&
      "expectedTurnId" in event.target
    ) {
      const turnId = event.target.expectedTurnId;
      if (turnId !== null && checkpoint.turnIds.has(turnId)) return false;
    }
    return true;
  });
}

function nextCheckpoint(
  projection: ConversationOutlineProjection,
  previous: Checkpoint,
  orderingBoundarySequence: number | null,
): Checkpoint {
  const activeTurns = new Set<string>();
  const pendingRequests = new Set<string>();
  const unacceptedRequests = new Set<string>();
  let completedBoundary = previous.sequenceStart;
  let boundary = previous.sequenceStart;
  for (const { event, meta } of projection.events) {
    if (isThreadError(event)) {
      completedBoundary = boundary;
    }
    if (
      event.type === "client/turn/requested" &&
      (event.target.kind === "steer" || event.target.kind === "auto") &&
      event.target.expectedTurnId !== null
    )
      pendingRequests.add(event.requestId);
    if (event.type === "client/turn/requested")
      unacceptedRequests.add(event.requestId);
    if (event.type === "turn/input/accepted") {
      pendingRequests.delete(event.clientRequestId);
      unacceptedRequests.delete(event.clientRequestId);
    }
    if (event.type === "client/turn/rejected") {
      pendingRequests.delete(event.requestId);
      unacceptedRequests.delete(event.requestId);
    }
    if (
      event.type === "system/manager/user_message" &&
      activeTurns.size === 0 &&
      unacceptedRequests.size === 0
    ) {
      if (
        orderingBoundarySequence === null ||
        completedBoundary <= orderingBoundarySequence
      )
        boundary = completedBoundary;
      completedBoundary = meta.seq + 1;
    }
    if (event.scope.kind !== "turn") continue;
    if (event.type === "turn/started") {
      if (
        activeTurns.size === 0 &&
        (orderingBoundarySequence === null ||
          completedBoundary <= orderingBoundarySequence)
      )
        boundary = completedBoundary;
      activeTurns.add(event.scope.turnId);
    }
    if (event.type === "turn/completed") {
      activeTurns.delete(event.scope.turnId);
      if (activeTurns.size === 0 && pendingRequests.size === 0)
        completedBoundary = meta.seq + 1;
    }
  }
  if (boundary <= previous.sequenceStart) return previous;
  const turnIds = new Set(previous.turnIds);
  const requestIds = new Set(previous.requestIds);
  const parentItemIds = new Set(previous.parentItemIds);
  for (const { event, meta } of projection.events) {
    if (meta.seq >= boundary) continue;
    if (event.scope.kind === "turn") turnIds.add(event.scope.turnId);
    const parentId = parentItemId(event);
    if (parentId !== null) parentItemIds.add(parentId);
    if (
      "item" in event &&
      (event.item.type === "toolCall" || backgroundItemId(event) !== null)
    )
      parentItemIds.add(event.item.id);
    const requestId = referencedRequestId(event);
    if (requestId !== null) requestIds.add(requestId);
  }
  const checkpoint: Checkpoint = {
    agentMessageDeltaCount:
      previous.agentMessageDeltaCount +
      projection.events.filter(
        ({ event, meta }) =>
          meta.seq < boundary && event.type === "item/agentMessage/delta",
      ).length,
    items: previous.items,
    sequenceStart: boundary,
    turnIds,
    requestIds,
    parentItemIds,
  };
  const tailEvents = projection.events.filter(
    ({ meta }) => meta.seq >= boundary,
  );
  if (!canReuse(checkpoint, tailEvents)) return previous;
  if (
    projection.items.some(
      ({ sourceSeqStart, sourceSeqEnd }) =>
        sourceSeqStart < boundary && sourceSeqEnd >= boundary,
    )
  )
    return previous;
  let reachedTail = false;
  const frozen: ThreadConversationOutlineItem[] = [];
  for (const row of projection.items) {
    if (row.sourceSeqStart >= boundary) reachedTail = true;
    else {
      if (reachedTail) return previous;
      frozen.push(row.item);
    }
  }
  checkpoint.items = [...previous.items, ...frozen];
  return checkpoint;
}

export function projectConversationOutlineIncrementally(args: {
  db: DbConnection;
  threadId: string;
  key: string;
  maxSeq: number;
  historySequenceStart: number;
  orderingBoundarySequence: number | null;
  responseKey: string;
  materializeResponse: boolean;
  resolveProjectionState: (
    sequenceStart: number,
    previous: ConversationOutlineProjectionState | null,
  ) => ConversationOutlineProjectionState;
  select: (
    sequenceStart: number,
    precedingAgentMessageDeltaCount: number,
    projectionState: ConversationOutlineProjectionState,
  ) => ConversationOutlineSelection;
}): ThreadConversationOutlineItem[] {
  let cache = caches.get(args.db);
  if (cache === undefined) {
    cache = { entries: new Map(), chars: 0 };
    caches.set(args.db, cache);
  }
  const dataVersion = getDatabaseDataVersion(args.db);
  const generation = getThreadEventRewriteGeneration(args.threadId);
  const cached = cache.entries.get(args.threadId);
  if (cached !== undefined) {
    cache.entries.delete(args.threadId);
    cache.chars -= cached.chars;
  }
  const empty: Checkpoint = {
    agentMessageDeltaCount: 0,
    items: [],
    sequenceStart: args.historySequenceStart,
    turnIds: new Set(),
    requestIds: new Set(),
    parentItemIds: new Set(),
  };
  const isUsable = (candidate: Entry) =>
    candidate.key === args.key &&
    candidate.historySequenceStart === args.historySequenceStart &&
    (args.orderingBoundarySequence === null ||
      candidate.checkpoint.sequenceStart <= args.orderingBoundarySequence) &&
    candidate.maxSeq <= args.maxSeq;
  let entry: Entry | null = null;
  if (
    cached !== undefined &&
    cached.dataVersion === dataVersion &&
    cached.generation === generation &&
    isUsable(cached)
  ) {
    entry = cached;
  } else if (cached !== undefined && cached.dataVersion !== dataVersion) {
    deleteThreadConversationOutlineCheckpoint(args.db, args.threadId);
  } else {
    const stored = readStoredEntry(args.db, {
      threadId: args.threadId,
      key: args.key,
      dataVersion,
      generation,
    });
    if (stored !== null && isUsable(stored)) entry = stored;
    else if (stored !== null)
      deleteThreadConversationOutlineCheckpoint(args.db, args.threadId);
  }
  const previousState = entry?.projectionState ?? null;
  const projectionState = args.resolveProjectionState(
    entry === null ? args.historySequenceStart : entry.maxSeq + 1,
    previousState,
  );
  let checkpoint =
    entry !== null &&
    previousState?.includeNestedEvents ===
      projectionState.includeNestedEvents &&
    previousState.summaryCompactionEnabled ===
      projectionState.summaryCompactionEnabled
      ? entry.checkpoint
      : empty;
  let selection = args.select(
    checkpoint.sequenceStart,
    checkpoint.agentMessageDeltaCount,
    projectionState,
  );
  let agentMessageDeltaCount =
    checkpoint.agentMessageDeltaCount +
    selection.events.filter(
      ({ event }) => event.type === "item/agentMessage/delta",
    ).length;
  const crossedCompactionThreshold =
    entry !== null &&
    entry.agentMessageDeltaCount <
      MIN_AGENT_MESSAGE_DELTAS_FOR_SUMMARY_COMPACTION &&
    agentMessageDeltaCount >= MIN_AGENT_MESSAGE_DELTAS_FOR_SUMMARY_COMPACTION;
  if (
    checkpoint !== empty &&
    (crossedCompactionThreshold || !canReuse(checkpoint, selection.events))
  ) {
    checkpoint = empty;
    selection = args.select(checkpoint.sequenceStart, 0, projectionState);
    agentMessageDeltaCount = selection.events.filter(
      ({ event }) => event.type === "item/agentMessage/delta",
    ).length;
  }
  if (entry !== null && checkpoint === empty)
    deleteThreadConversationOutlineCheckpoint(args.db, args.threadId);
  const projection = { events: selection.events, items: selection.project() };
  const items = [
    ...checkpoint.items,
    ...projection.items.map(({ item }) => item),
  ];
  const next = nextCheckpoint(
    projection,
    checkpoint,
    args.orderingBoundarySequence,
  );
  const hasCheckpoint = next.sequenceStart > args.historySequenceStart;
  const unchanged = entry !== null && next === entry.checkpoint;
  const storeResponse =
    args.materializeResponse && entry?.responseKey !== args.responseKey;
  const responseTailJson = storeResponse
    ? JSON.stringify(items.slice(next.items.length))
    : null;
  const responseKey = storeResponse
    ? args.responseKey
    : unchanged
      ? (entry?.responseKey ?? null)
      : null;
  const itemsJson = unchanged ? null : JSON.stringify(next.items);
  const nextEntry: Entry = {
    agentMessageDeltaCount,
    checkpoint: next,
    historySequenceStart: args.historySequenceStart,
    dataVersion,
    generation,
    key: args.key,
    maxSeq: args.maxSeq,
    chars:
      itemsJson === null ? (entry?.chars ?? 0) : entryChars(next, itemsJson),
    projectionState,
    responseKey,
  };
  if (itemsJson !== null && (hasCheckpoint || responseTailJson !== null))
    storeEntry(args.db, args.threadId, nextEntry, itemsJson, responseTailJson);
  else if (
    responseTailJson !== null &&
    !updateThreadConversationOutlineResponse(args.db, {
      threadId: args.threadId,
      responseKey: args.responseKey,
      responseTailJson,
    })
  )
    storeEntry(
      args.db,
      args.threadId,
      nextEntry,
      JSON.stringify(next.items),
      responseTailJson,
    );
  if (hasCheckpoint && nextEntry.chars <= MAX_CHARS) {
    cache.entries.set(args.threadId, nextEntry);
    cache.chars += nextEntry.chars;
  }
  while (cache.entries.size > MAX_ENTRIES || cache.chars > MAX_CHARS) {
    const oldest = cache.entries.keys().next().value;
    if (oldest === undefined) break;
    cache.chars -= cache.entries.get(oldest)!.chars;
    cache.entries.delete(oldest);
  }
  return items;
}
