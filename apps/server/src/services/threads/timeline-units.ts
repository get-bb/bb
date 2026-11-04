import type { StoredEventRow } from "@bb/db";
import type { ThreadEvent } from "@bb/domain";

export interface TimelineUnitEvent {
  readonly event: ThreadEvent;
  row: StoredEventRow;
}

export interface TimelineUnitKeyContext {
  delegatedProviderThreadIds: Set<string>;
  progressedBackgroundTaskItemIds: Set<string>;
}

const ITEM_CLOSING_EVENT_TYPES: ReadonlySet<StoredEventRow["type"]> = new Set([
  "item/completed",
  "item/backgroundTask/completed",
  "item/delegation/completed",
]);

const PAYLOAD_KEY_EVENT_TYPES: ReadonlySet<StoredEventRow["type"]> = new Set([
  "client/turn/requested",
  "turn/input/accepted",
  "client/turn/rejected",
  "system/operation",
  "system/thread-provisioning",
  "system/interaction/lifecycle",
  "system/permissionGrant/lifecycle",
  "system/userQuestion/lifecycle",
  "system/provider-turn-watchdog",
]);

const BUFFERED_TEXT_ITEM_KINDS: ReadonlySet<StoredEventRow["itemKind"]> =
  new Set(["agentMessage", "plan", "reasoning"]);

const BUFFERED_TEXT_DELTA_TYPES: ReadonlySet<StoredEventRow["type"]> = new Set([
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
]);

function isTurnScopedBufferedTextRow(row: StoredEventRow): boolean {
  return (
    row.turnId !== null &&
    (BUFFERED_TEXT_ITEM_KINDS.has(row.itemKind) ||
      BUFFERED_TEXT_DELTA_TYPES.has(row.type))
  );
}

export function isDetachedBackgroundTaskRow(
  row: StoredEventRow,
  progressedBackgroundTaskItemIds: ReadonlySet<string>,
): row is StoredEventRow & { itemId: string } {
  return (
    row.itemKind === "backgroundTask" &&
    row.itemId !== null &&
    (row.type === "item/backgroundTask/completed" ||
      row.type === "item/completed") &&
    !progressedBackgroundTaskItemIds.has(row.itemId)
  );
}

export function isBackgroundTaskStartRow(
  row: StoredEventRow,
): row is StoredEventRow & { itemId: string } {
  return (
    row.itemKind === "backgroundTask" &&
    row.itemId !== null &&
    row.type === "item/started"
  );
}

function delegationChildRef(event: ThreadEvent): string | undefined {
  switch (event.type) {
    case "item/started":
    case "item/completed":
    case "item/delegation/progress":
    case "item/delegation/completed":
      return event.item.type === "delegation" ? event.item.childRef : undefined;
    default:
      return undefined;
  }
}

export function createTimelineUnitKeyContext(
  progressedBackgroundTaskItemIds: Set<string>,
): TimelineUnitKeyContext {
  return {
    delegatedProviderThreadIds: new Set(),
    progressedBackgroundTaskItemIds,
  };
}

export function timelineUnitEventKeys(
  unit: TimelineUnitEvent,
  context: TimelineUnitKeyContext,
): string[] {
  const { row } = unit;
  const keys: string[] = [];
  if (row.turnId !== null) keys.push(`t:${row.turnId}`);
  if (
    row.type === "item/backgroundTask/progress" &&
    row.itemKind === "backgroundTask" &&
    row.itemId !== null
  ) {
    context.progressedBackgroundTaskItemIds.add(row.itemId);
  }
  if (
    isDetachedBackgroundTaskRow(row, context.progressedBackgroundTaskItemIds)
  ) {
    return keys;
  }
  if (row.itemId !== null && !isTurnScopedBufferedTextRow(row)) {
    keys.push(`i:${row.itemId}`);
  }
  if (row.parentToolCallId !== null && row.parentToolCallId.length > 0) {
    keys.push(`i:${row.parentToolCallId}`);
  }
  if (row.providerThreadId !== null) {
    if (
      row.itemKind === "delegation" &&
      delegationChildRef(unit.event) === row.providerThreadId
    ) {
      context.delegatedProviderThreadIds.add(row.providerThreadId);
      keys.push(`p:${row.providerThreadId}`);
    } else if (
      row.type === "turn/started" &&
      context.delegatedProviderThreadIds.has(row.providerThreadId)
    ) {
      keys.push(`p:${row.providerThreadId}`);
    }
  }
  if (!PAYLOAD_KEY_EVENT_TYPES.has(row.type)) return keys;
  const event = unit.event;
  switch (event.type) {
    case "client/turn/requested":
      keys.push(`r:${event.requestId}`);
      if (
        (event.target.kind === "auto" || event.target.kind === "steer") &&
        event.target.expectedTurnId !== null
      ) {
        keys.push(`t:${event.target.expectedTurnId}`);
      }
      break;
    case "turn/input/accepted":
      keys.push(`r:${event.clientRequestId}`);
      break;
    case "client/turn/rejected":
      keys.push(`r:${event.requestId}`);
      break;
    case "system/operation":
      keys.push(`o:${event.operationId}`);
      break;
    case "system/thread-provisioning":
      keys.push(`v:${event.provisioningId}`);
      break;
    case "system/interaction/lifecycle":
      keys.push(`x:${event.interaction.id}`);
      break;
    case "system/permissionGrant/lifecycle":
    case "system/userQuestion/lifecycle":
      keys.push(`x:${event.interactionId}`);
      break;
    case "system/provider-turn-watchdog":
      keys.push(`t:${event.activeTurnId}`);
      break;
    default:
      break;
  }
  return keys;
}

interface OpenTimelineItem {
  kind: StoredEventRow["itemKind"];
  outlivesTurn: boolean;
  turnId: string | null;
}

interface OpenTimelineState {
  items: Map<string, OpenTimelineItem>;
  requests: Set<string>;
  turns: Set<string>;
}

function applyOpenState(state: OpenTimelineState, unit: TimelineUnitEvent) {
  const { row } = unit;
  switch (row.type) {
    case "turn/started":
      if (row.turnId !== null) state.turns.add(row.turnId);
      return;
    case "turn/completed":
      if (row.turnId === null) return;
      state.turns.delete(row.turnId);
      for (const [itemId, item] of state.items) {
        if (item.turnId === row.turnId && !item.outlivesTurn) {
          state.items.delete(itemId);
        }
      }
      return;
    case "thread/compacted":
      for (const [itemId, item] of state.items) {
        if (item.turnId === row.turnId && item.kind === "contextCompaction") {
          state.items.delete(itemId);
        }
      }
      return;
    case "system/thread/interrupted":
      state.turns.clear();
      for (const [itemId, item] of state.items) {
        if (!item.outlivesTurn) state.items.delete(itemId);
      }
      return;
    case "item/backgroundTask/progress":
      if (row.itemId !== null && row.itemKind === "backgroundTask") {
        state.items.set(row.itemId, {
          kind: row.itemKind,
          outlivesTurn: true,
          turnId: state.items.get(row.itemId)?.turnId ?? null,
        });
      }
      return;
    case "client/turn/requested":
    case "turn/input/accepted":
    case "client/turn/rejected":
      applyRequestState(state, unit.event);
      return;
    default:
      break;
  }
  if (row.itemId === null) return;
  if (row.type === "item/started") {
    state.items.set(row.itemId, {
      kind: row.itemKind,
      outlivesTurn: false,
      turnId: row.turnId,
    });
  } else if (ITEM_CLOSING_EVENT_TYPES.has(row.type)) {
    state.items.delete(row.itemId);
  }
}

function applyRequestState(state: OpenTimelineState, event: ThreadEvent) {
  switch (event.type) {
    case "client/turn/requested":
      state.requests.add(event.requestId);
      return;
    case "turn/input/accepted":
      state.requests.delete(event.clientRequestId);
      return;
    case "client/turn/rejected":
      state.requests.delete(event.requestId);
      return;
    default:
      return;
  }
}

function isCutCandidate(row: StoredEventRow): boolean {
  return row.type === "client/turn/requested" || row.type === "turn/started";
}

export interface TimelineUnitCutAnalyzer {
  cuts(): readonly number[];
  push(unit: TimelineUnitEvent): void;
  quiescent(): boolean;
}

interface TimelineUnitCutCandidate {
  index: number;
  sequence: number;
}

export function createTimelineUnitCutAnalyzer(
  context: TimelineUnitKeyContext,
  origins: Map<string, number> = new Map(),
): TimelineUnitCutAnalyzer {
  const candidates: TimelineUnitCutCandidate[] = [];
  const state: OpenTimelineState = {
    items: new Map(),
    requests: new Set(),
    turns: new Set(),
  };
  let index = 0;
  return {
    cuts: () => candidates.map((candidate) => candidate.index),
    quiescent: () =>
      state.turns.size === 0 &&
      state.items.size === 0 &&
      state.requests.size === 0,
    push(unit) {
      if (
        index > 0 &&
        isCutCandidate(unit.row) &&
        state.turns.size === 0 &&
        state.items.size === 0 &&
        state.requests.size === 0
      ) {
        candidates.push({ index, sequence: unit.row.sequence });
      }
      let earliest = unit.row.sequence;
      for (const key of timelineUnitEventKeys(unit, context)) {
        const origin = origins.get(key);
        if (origin === undefined) {
          origins.set(key, unit.row.sequence);
        } else if (origin < earliest) {
          earliest = origin;
        }
      }
      while ((candidates.at(-1)?.sequence ?? -Infinity) > earliest) {
        candidates.pop();
      }
      applyOpenState(state, unit);
      index += 1;
    },
  };
}

export function findTimelineUnitCuts(
  events: readonly TimelineUnitEvent[],
  progressedBackgroundTaskItemIds: Set<string>,
): readonly number[] {
  const analyzer = createTimelineUnitCutAnalyzer(
    createTimelineUnitKeyContext(progressedBackgroundTaskItemIds),
  );
  for (const unit of events) analyzer.push(unit);
  return analyzer.cuts();
}
