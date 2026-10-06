import {
  getDatabaseDataVersion,
  getThreadEventRewriteGeneration,
  type DbConnection,
} from "@bb/db";
import type { ThreadConversationOutlineItem } from "@bb/server-contract";
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
  contextBoundarySeq: number;
  dataVersion: number;
  generation: number;
  key: string;
  maxSeq: number;
  chars: number;
  projectionState: ConversationOutlineProjectionState;
}

interface OutlineCache {
  entries: Map<string, Entry>;
  chars: number;
}

const caches = new WeakMap<DbConnection, OutlineCache>();
const MAX_ENTRIES = 16;
const MAX_CHARS = 8_000_000;

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

function hasBackgroundState(events: ThreadEventWithMeta[]): boolean {
  return events.some(
    ({ event }) =>
      "item" in event &&
      (event.item.type === "backgroundTask" ||
        event.item.type === "delegation"),
  );
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
  if (hasBackgroundState(events)) return false;
  let hasTailTurn = false;
  return events.every(({ event }) => {
    if (event.type === "turn/started") hasTailTurn = true;
    const parentId = parentItemId(event);
    if (parentId !== null && checkpoint.parentItemIds.has(parentId))
      return false;
    if (
      "item" in event &&
      event.item.type === "toolCall" &&
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
  if (hasBackgroundState(projection.events)) return previous;
  const activeTurns = new Set<string>();
  const pendingRequests = new Set<string>();
  let completedBoundary = previous.sequenceStart;
  let boundary = previous.sequenceStart;
  for (const { event, meta } of projection.events) {
    if (isThreadError(event)) {
      completedBoundary = boundary;
    }
    if (
      event.type === "client/turn/requested" &&
      (event.target.kind === "steer" ||
        (event.target.kind === "auto" && event.target.expectedTurnId !== null))
    )
      pendingRequests.add(event.requestId);
    if (event.type === "turn/input/accepted")
      pendingRequests.delete(event.clientRequestId);
    if (event.type === "client/turn/rejected")
      pendingRequests.delete(event.requestId);
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
    if ("item" in event && event.item.type === "toolCall")
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
  contextBoundarySeq: number;
  orderingBoundarySequence: number | null;
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
  const entry = cache.entries.get(args.threadId);
  if (entry !== undefined) {
    cache.entries.delete(args.threadId);
    cache.chars -= entry.chars;
  }
  const empty: Checkpoint = {
    agentMessageDeltaCount: 0,
    items: [],
    sequenceStart: args.contextBoundarySeq,
    turnIds: new Set(),
    requestIds: new Set(),
    parentItemIds: new Set(),
  };
  const canReuseEntry =
    entry !== undefined &&
    entry.key === args.key &&
    entry.dataVersion === dataVersion &&
    entry.generation === generation &&
    entry.contextBoundarySeq === args.contextBoundarySeq &&
    (args.orderingBoundarySequence === null ||
      entry.checkpoint.sequenceStart <= args.orderingBoundarySequence) &&
    entry.maxSeq <= args.maxSeq;
  const previousState = canReuseEntry ? entry.projectionState : null;
  const projectionState = args.resolveProjectionState(
    canReuseEntry ? entry.maxSeq + 1 : args.contextBoundarySeq,
    previousState,
  );
  let checkpoint =
    canReuseEntry &&
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
    entry !== undefined &&
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
  if (next.sequenceStart > args.contextBoundarySeq) {
    const chars =
      next === entry?.checkpoint
        ? entry.chars
        : JSON.stringify(next.items).length +
          [...next.turnIds, ...next.requestIds, ...next.parentItemIds].reduce(
            (sum, id) => sum + id.length,
            0,
          );
    if (chars <= MAX_CHARS) {
      cache.entries.set(args.threadId, {
        agentMessageDeltaCount,
        checkpoint: next,
        contextBoundarySeq: args.contextBoundarySeq,
        dataVersion,
        generation,
        key: args.key,
        maxSeq: args.maxSeq,
        chars,
        projectionState,
      });
      cache.chars += chars;
    }
  }
  while (cache.entries.size > MAX_ENTRIES || cache.chars > MAX_CHARS) {
    const oldest = cache.entries.keys().next().value;
    if (oldest === undefined) break;
    cache.chars -= cache.entries.get(oldest)!.chars;
    cache.entries.delete(oldest);
  }
  return items;
}
