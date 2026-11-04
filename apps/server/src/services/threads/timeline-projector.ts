import {
  THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
  type ThreadEventWithMeta,
  type ThreadTimelineUnitProjection,
} from "@bb/thread-view";
import type { ThreadEvent } from "@bb/domain";
import type { TimelineOutputPreview } from "@bb/server-contract";
import {
  findEarliestTimelineReferenceSequence,
  getDatabaseDataVersion,
  getThreadEventRewriteGeneration,
  hydrateRetainedEventOutputRows,
  listStoredTimelineRangeEventRows,
  listTimelineBackgroundTaskCompletionRows,
  listTimelineBackgroundTaskCompletions,
  listTimelineBackgroundTaskOrigins,
  listLatestOpenBackgroundTaskStateRowsForThread,
  listStoredTurnCompletedRowsByTurnIds,
  listStoredTurnStartedRowsByTurnIdsUpToSequence,
  listTimelineProgressedBackgroundTaskItemIds,
  listUnfinishedTimelineBackgroundTasks,
  listUnfinishedTimelineTurns,
  type DbConnection,
  type InlineOutputCharLimit,
  type StoredEventRow,
  type TimelineReferenceKeys,
} from "@bb/db";
import { parseStoredEvent } from "./thread-data.js";
import {
  assignTimelineUnitBackgroundTasks,
  projectableTimelineEvents,
  projectTimelineUnitRows,
  unownedTimelineUnitBackgroundTaskItemIds,
  timelineUnitEventWithMeta,
  type TimelineUnitRows,
  type TimelineUnitSurface,
} from "./timeline-unit-projection.js";
import {
  createTimelineUnitCutAnalyzer,
  createTimelineUnitKeyContext,
  findTimelineUnitCuts,
  isBackgroundTaskStartRow,
  timelineUnitEventKeys,
  type TimelineUnitCutAnalyzer,
  type TimelineUnitEvent,
  type TimelineUnitKeyContext,
} from "./timeline-units.js";

export type { TimelineUnitSurface } from "./timeline-unit-projection.js";

export interface TimelineProjectionSource {
  epochSequenceStart: number;
  excludeDiagnosticEvents: boolean;
  maxInlineOutputChars: InlineOutputCharLimit;
}

export interface TimelineProjectionStats {
  decodedEventCount: number;
  eventDataBytes: number;
  eventRowCount: number;
  projectedEventCount: number;
  reusedUnitCount: number;
}

export interface TimelineWindowProjection {
  openEvents: ThreadEventWithMeta[];
  pendingBackgroundUnits: ThreadTimelineUnitProjection[];
  retainedOutputPreviews: (
    availablePreview: "available" | "detail-limit",
    now: number,
  ) => ReadonlyMap<string, TimelineOutputPreview>;
  units: ThreadTimelineUnitProjection[];
}

interface UnitResult extends TimelineUnitRows {
  backgroundTaskItemIds: string[];
  size: number;
  throughSeq: number;
}

interface FrozenUnit {
  endSeq: number;
  events: TimelineUnitEvent[] | null;
  results: Map<string, UnitResult>;
  startSeq: number;
}

interface TailResult {
  length: number;
  result: UnitResult;
}

interface BackgroundTaskState {
  pendingBackgroundTasks: Map<string, number>;
  progressedBackgroundTaskItemIds: Set<string>;
}

interface OpenBackgroundTaskHeader {
  events: TimelineUnitEvent[];
  projections: Map<string, ThreadTimelineUnitProjection>;
}

interface ThreadEventLog extends BackgroundTaskState {
  analyzer: TimelineUnitCutAnalyzer;
  openTaskHeader: OpenBackgroundTaskHeader | null;
  dataVersion: number;
  frozen: FrozenUnit[];
  generation: number;
  keyContext: TimelineUnitKeyContext;
  keyOrigins: Map<string, number>;
  lastUsed: number;
  size: number;
  source: TimelineProjectionSource;
  startSeq: number;
  tail: TimelineUnitEvent[];
  tailResults: Map<string, TailResult>;
  tailStartSeq: number;
  threadId: string;
  throughSeq: number;
}

interface TimelineProjector {
  logs: Map<string, ThreadEventLog>;
  size: number;
  tick: number;
}

export const TIMELINE_PROJECTOR_MAX_LOGS = 64;
const TIMELINE_PROJECTOR_MAX_CHARS = 96_000_000;

const projectors = new WeakMap<DbConnection, TimelineProjector>();

function getProjector(db: DbConnection): TimelineProjector {
  let projector = projectors.get(db);
  if (projector === undefined) {
    projector = { logs: new Map(), size: 0, tick: 0 };
    projectors.set(db, projector);
  }
  return projector;
}

export function forgetThreadTimelineProjection(
  db: DbConnection,
  threadId: string,
): void {
  const projector = projectors.get(db);
  if (projector === undefined) return;
  for (const [key, log] of projector.logs) {
    if (log.threadId === threadId) dropLog(projector, key, log);
  }
}

export function clearThreadTimelineProjections(db: DbConnection): void {
  projectors.delete(db);
}

export function countThreadTimelineProjectionLogs(db: DbConnection): number {
  return projectors.get(db)?.logs.size ?? 0;
}

function dropLog(
  projector: TimelineProjector,
  key: string,
  log: ThreadEventLog,
): void {
  projector.logs.delete(key);
  projector.size -= log.size;
}

function remeasure(projector: TimelineProjector, log: ThreadEventLog): void {
  let size = 0;
  for (const unit of log.tail) size += unit.row.data.length;
  for (const cached of log.tailResults.values()) size += cached.result.size;
  for (const unit of log.frozen) {
    for (const event of unit.events ?? []) size += event.row.data.length;
    for (const result of unit.results.values()) size += result.size;
  }
  projector.size += size - log.size;
  log.size = size;
}

function evict(projector: TimelineProjector, keep: ThreadEventLog): void {
  while (
    projector.logs.size > TIMELINE_PROJECTOR_MAX_LOGS ||
    projector.size > TIMELINE_PROJECTOR_MAX_CHARS
  ) {
    let oldestKey: string | null = null;
    let oldest: ThreadEventLog | null = null;
    for (const [key, log] of projector.logs) {
      if (log === keep) continue;
      if (oldest === null || log.lastUsed < oldest.lastUsed) {
        oldestKey = key;
        oldest = log;
      }
    }
    if (oldestKey === null || oldest === null) return;
    dropLog(projector, oldestKey, oldest);
  }
}

function logKey(threadId: string, source: TimelineProjectionSource): string {
  return JSON.stringify([
    threadId,
    source.epochSequenceStart,
    source.excludeDiagnosticEvents,
    source.maxInlineOutputChars,
  ]);
}

function surfaceKey(surface: TimelineUnitSurface): string {
  return JSON.stringify([
    surface.completedTurnDisplay,
    surface.includeDiagnosticOperations,
    surface.includeNestedRows,
    surface.providerDisplayName ?? null,
    surface.summarizeShellCommands,
    surface.threadInterruptedAt,
    surface.threadName,
    surface.threadStatus,
    surface.workspaceRoot,
  ]);
}

function lazyTimelineUnitEvent(row: StoredEventRow): TimelineUnitEvent {
  let event: ThreadEvent | undefined;
  return {
    get event() {
      event ??= parseStoredEvent(row);
      return event;
    },
    row,
  };
}

function unitEventsFromRows(
  db: DbConnection,
  log: Pick<ThreadEventLog, "source">,
  stored: StoredEventRow[],
  stats: TimelineProjectionStats,
): TimelineUnitEvent[] {
  const rows =
    log.source.maxInlineOutputChars === null
      ? hydrateRetainedEventOutputRows(db, stored)
      : stored;
  stats.eventRowCount += rows.length;
  stats.decodedEventCount += rows.length;
  for (const row of rows) stats.eventDataBytes += row.data.length;
  return rows.map(lazyTimelineUnitEvent);
}

function readRange(
  db: DbConnection,
  log: Pick<ThreadEventLog, "source" | "threadId">,
  afterSequence: number,
  throughSequence: number,
  stats: TimelineProjectionStats,
): TimelineUnitEvent[] {
  if (throughSequence <= afterSequence) return [];
  return unitEventsFromRows(
    db,
    log,
    listStoredTimelineRangeEventRows(db, {
      afterSequence,
      excludeDiagnosticEvents: log.source.excludeDiagnosticEvents,
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
      maxInlineOutputChars: log.source.maxInlineOutputChars,
      threadId: log.threadId,
      throughSequence,
    }),
    stats,
  );
}

type ReferenceKeySets = { [K in keyof TimelineReferenceKeys]: Set<string> };

function emptyReferenceKeys(): ReferenceKeySets {
  return {
    interactionIds: new Set(),
    itemIds: new Set(),
    operationIds: new Set(),
    provisioningIds: new Set(),
    providerThreadIds: new Set(),
    requestIds: new Set(),
    turnIds: new Set(),
  };
}

const REFERENCE_KEY_FIELDS: Partial<
  Record<string, keyof TimelineReferenceKeys>
> = {
  i: "itemIds",
  o: "operationIds",
  p: "providerThreadIds",
  r: "requestIds",
  t: "turnIds",
  v: "provisioningIds",
  x: "interactionIds",
};

function addReferenceKey(keys: ReferenceKeySets, key: string): void {
  const field = REFERENCE_KEY_FIELDS[key.slice(0, 1)];
  if (field === undefined) {
    throw new Error(`Unknown timeline reference key ${key}`);
  }
  keys[field].add(key.slice(2));
}

function hasReferenceKeys(keys: ReferenceKeySets): boolean {
  return Object.values(keys).some((values) => values.size > 0);
}

function earliestReferenceBefore(
  db: DbConnection,
  log: Pick<ThreadEventLog, "source" | "threadId">,
  keys: ReferenceKeySets,
  beforeSequence: number,
): number | null {
  if (
    !hasReferenceKeys(keys) ||
    beforeSequence <= log.source.epochSequenceStart
  ) {
    return null;
  }
  return findEarliestTimelineReferenceSequence(db, {
    beforeSequence,
    keys: {
      interactionIds: [...keys.interactionIds],
      itemIds: [...keys.itemIds],
      operationIds: [...keys.operationIds],
      provisioningIds: [...keys.provisioningIds],
      providerThreadIds: [...keys.providerThreadIds],
      requestIds: [...keys.requestIds],
      turnIds: [...keys.turnIds],
    },
    sequenceStart: log.source.epochSequenceStart,
    threadId: log.threadId,
  });
}

function definesNewKey(unit: TimelineUnitEvent, key: string): boolean {
  if (unit.row.type !== "client/turn/requested") return false;
  const event = unit.event;
  return (
    event.type === "client/turn/requested" && key === `r:${event.requestId}`
  );
}

type LogIdentity = Pick<
  ThreadEventLog,
  | "pendingBackgroundTasks"
  | "progressedBackgroundTaskItemIds"
  | "source"
  | "threadId"
>;

function closedStartBefore(
  db: DbConnection,
  log: LogIdentity,
  events: TimelineUnitEvent[],
  start: number,
  throughSeq: number,
  stats: TimelineProjectionStats,
): { events: TimelineUnitEvent[]; start: number } {
  const unfinished = [
    ...listUnfinishedTimelineTurns(db, {
      sequenceStart: log.source.epochSequenceStart,
      threadId: log.threadId,
      throughSequence: throughSeq,
    }),
    ...[...log.pendingBackgroundTasks].flatMap(([itemId, startedSequence]) =>
      log.progressedBackgroundTaskItemIds.has(itemId)
        ? [{ interruptedSequence: null, startedSequence }]
        : [],
    ),
  ].sort((left, right) => left.startedSequence - right.startedSequence);
  const earliestUnfinishedOpenAt = (sequence: number): number | null => {
    for (const span of unfinished) {
      if (span.startedSequence >= sequence) return null;
      if (
        span.interruptedSequence === null ||
        span.interruptedSequence >= sequence
      ) {
        return span.startedSequence;
      }
    }
    return null;
  };
  let closedStart = start;
  let closedEvents = events;
  let pending = events;
  for (;;) {
    const keys = emptyReferenceKeys();
    const context = createTimelineUnitKeyContext(
      log.progressedBackgroundTaskItemIds,
    );
    const seen = new Set<string>();
    for (const unit of pending) {
      for (const key of timelineUnitEventKeys(unit, context)) {
        if (seen.has(key)) continue;
        seen.add(key);
        if (!definesNewKey(unit, key)) addReferenceKey(keys, key);
      }
      if (unit.row.type === "turn/started" && unit.row.providerThreadId) {
        keys.providerThreadIds.add(unit.row.providerThreadId);
      }
    }
    const earliest = Math.min(
      earliestReferenceBefore(db, log, keys, closedStart) ?? closedStart,
      earliestUnfinishedOpenAt(closedStart) ?? closedStart,
    );
    if (earliest >= closedStart) {
      return { events: closedEvents, start: closedStart };
    }
    pending = readRange(db, log, earliest - 1, closedStart - 1, stats);
    closedEvents = [...pending, ...closedEvents];
    closedStart = earliest;
  }
}

function recordKeys(
  log: ThreadEventLog,
  events: readonly TimelineUnitEvent[],
): void {
  for (const unit of events) {
    for (const key of timelineUnitEventKeys(unit, log.keyContext)) {
      if (!log.keyOrigins.has(key)) log.keyOrigins.set(key, unit.row.sequence);
    }
  }
}

function resetTailAnalyzer(log: ThreadEventLog): void {
  log.analyzer = createTimelineUnitCutAnalyzer(
    createTimelineUnitKeyContext(log.progressedBackgroundTaskItemIds),
  );
  for (const unit of log.tail) log.analyzer.push(unit);
}

function freezeTail(log: ThreadEventLog): void {
  const cuts = [...log.analyzer.cuts()];
  if (log.tail.length > 0 && log.analyzer.quiescent()) {
    cuts.push(log.tail.length);
  }
  const lastCut = cuts.at(-1);
  if (lastCut === undefined) return;
  const bounds = [0, ...cuts];
  const frozen: FrozenUnit[] = [];
  for (let index = 0; index + 1 < bounds.length; index += 1) {
    const end = bounds[index + 1]!;
    frozen.push({
      endSeq:
        end < log.tail.length
          ? log.tail[end]!.row.sequence - 1
          : log.throughSeq,
      events: log.tail.slice(bounds[index]!, end),
      results: new Map(),
      startSeq:
        index === 0 ? log.tailStartSeq : log.tail[bounds[index]!]!.row.sequence,
    });
  }
  log.frozen.push(...frozen);
  log.tailResults.clear();
  log.tail = log.tail.slice(lastCut);
  log.tailStartSeq = log.tail[0]?.row.sequence ?? frozen.at(-1)!.endSeq + 1;
  resetTailAnalyzer(log);
}

function mergeFrozenFrom(
  db: DbConnection,
  log: ThreadEventLog,
  sequence: number,
  stats: TimelineProjectionStats,
): void {
  const index = log.frozen.findIndex((unit) => unit.endSeq >= sequence);
  if (index === -1) return;
  const startSeq = log.frozen[index]!.startSeq;
  log.frozen.splice(index);
  log.tail = [
    ...readRange(db, log, startSeq - 1, log.tailStartSeq - 1, stats),
    ...log.tail,
  ];
  log.tailStartSeq = startSeq;
  log.tailResults.clear();
}

function loadBackgroundTaskState(
  db: DbConnection,
  threadId: string,
  source: TimelineProjectionSource,
  throughSeq: number,
): BackgroundTaskState {
  const range = {
    sequenceStart: source.epochSequenceStart,
    threadId,
    throughSequence: throughSeq,
  };
  return {
    pendingBackgroundTasks: new Map(
      listUnfinishedTimelineBackgroundTasks(db, range).map((task) => [
        task.itemId,
        task.startedSequence,
      ]),
    ),
    progressedBackgroundTaskItemIds: new Set(
      listTimelineProgressedBackgroundTaskItemIds(db, range),
    ),
  };
}

function trackBackgroundTasks(
  log: ThreadEventLog,
  events: readonly TimelineUnitEvent[],
): void {
  for (const { row } of events) {
    if (
      row.itemKind === "backgroundTask" ||
      row.type === "turn/started" ||
      row.type === "turn/completed"
    ) {
      log.openTaskHeader = null;
    }
    if (isBackgroundTaskStartRow(row)) {
      log.pendingBackgroundTasks.set(row.itemId, row.sequence);
    } else if (
      row.itemKind === "backgroundTask" &&
      row.itemId !== null &&
      (row.type === "item/completed" ||
        row.type === "item/backgroundTask/completed")
    ) {
      log.pendingBackgroundTasks.delete(row.itemId);
    }
  }
}

function createLog(
  db: DbConnection,
  threadId: string,
  source: TimelineProjectionSource,
  windowStartSeq: number,
  throughSeq: number,
  stats: TimelineProjectionStats,
): ThreadEventLog {
  const start = Math.max(windowStartSeq, source.epochSequenceStart);
  const background = loadBackgroundTaskState(db, threadId, source, throughSeq);
  const identity = { ...background, source, threadId };
  const closed = closedStartBefore(
    db,
    identity,
    readRange(db, identity, start - 1, throughSeq, stats),
    start,
    throughSeq,
    stats,
  );
  const keyContext = createTimelineUnitKeyContext(
    background.progressedBackgroundTaskItemIds,
  );
  const keyOrigins = new Map<string, number>();
  const analyzer = createTimelineUnitCutAnalyzer(keyContext, keyOrigins);
  for (const unit of closed.events) analyzer.push(unit);
  return {
    ...background,
    analyzer,
    dataVersion: getDatabaseDataVersion(db),
    frozen: [],
    generation: getThreadEventRewriteGeneration(threadId),
    keyContext,
    keyOrigins,
    lastUsed: 0,
    openTaskHeader: null,
    size: 0,
    source,
    startSeq: closed.start,
    tail: closed.events,
    tailResults: new Map(),
    tailStartSeq: closed.start,
    threadId,
    throughSeq,
  };
}

function extendBackward(
  db: DbConnection,
  log: ThreadEventLog,
  windowStartSeq: number,
  stats: TimelineProjectionStats,
): void {
  const start = Math.max(windowStartSeq, log.source.epochSequenceStart);
  if (start >= log.startSeq) return;
  const closed = closedStartBefore(
    db,
    log,
    readRange(db, log, start - 1, log.startSeq - 1, stats),
    start,
    log.throughSeq,
    stats,
  );
  const bounds = [
    0,
    ...findTimelineUnitCuts(closed.events, log.progressedBackgroundTaskItemIds),
  ];
  const prepended: FrozenUnit[] =
    closed.events.length === 0
      ? [
          {
            endSeq: log.startSeq - 1,
            events: [],
            results: new Map(),
            startSeq: closed.start,
          },
        ]
      : bounds.map((boundary, index) => ({
          endSeq:
            index + 1 < bounds.length
              ? closed.events[bounds[index + 1]!]!.row.sequence - 1
              : log.startSeq - 1,
          events: closed.events.slice(
            boundary,
            bounds[index + 1] ?? closed.events.length,
          ),
          results: new Map(),
          startSeq:
            index === 0 ? closed.start : closed.events[boundary]!.row.sequence,
        }));
  const previousOrigins = log.keyOrigins;
  const previousDelegations = log.keyContext.delegatedProviderThreadIds;
  log.keyOrigins = new Map();
  log.keyContext = createTimelineUnitKeyContext(
    log.progressedBackgroundTaskItemIds,
  );
  recordKeys(log, closed.events);
  for (const [key, origin] of previousOrigins) {
    if (!log.keyOrigins.has(key)) log.keyOrigins.set(key, origin);
  }
  for (const providerThreadId of previousDelegations) {
    log.keyContext.delegatedProviderThreadIds.add(providerThreadId);
  }
  log.frozen = [...prepended, ...log.frozen];
  log.startSeq = closed.start;
}

function advance(
  db: DbConnection,
  log: ThreadEventLog,
  throughSeq: number,
  stats: TimelineProjectionStats,
): "advanced" | "reset" {
  if (throughSeq <= log.throughSeq) return "advanced";
  const appended = readRange(db, log, log.throughSeq, throughSeq, stats);
  log.throughSeq = throughSeq;
  trackBackgroundTasks(log, appended);
  if (appended.length === 0) {
    freezeTail(log);
    return "advanced";
  }
  const unknown = emptyReferenceKeys();
  let earliestFrozenReference = Number.POSITIVE_INFINITY;
  for (const unit of appended) {
    for (const key of timelineUnitEventKeys(unit, log.keyContext)) {
      const origin = log.keyOrigins.get(key);
      if (origin === undefined) {
        log.keyOrigins.set(key, unit.row.sequence);
        if (!definesNewKey(unit, key)) addReferenceKey(unknown, key);
      } else if (origin < log.tailStartSeq) {
        earliestFrozenReference = Math.min(earliestFrozenReference, origin);
      }
    }
  }
  const earliestStored = earliestReferenceBefore(
    db,
    log,
    unknown,
    log.tailStartSeq,
  );
  if (earliestStored !== null) {
    if (earliestStored < log.startSeq) return "reset";
    earliestFrozenReference = Math.min(earliestFrozenReference, earliestStored);
  }
  log.tail.push(...appended);
  if (Number.isFinite(earliestFrozenReference)) {
    mergeFrozenFrom(db, log, earliestFrozenReference, stats);
    resetTailAnalyzer(log);
  } else {
    for (const unit of appended) log.analyzer.push(unit);
  }
  freezeTail(log);
  return "advanced";
}

interface UnitInput {
  endSeq: number;
  events: readonly TimelineUnitEvent[];
  startSeq: number;
}

function readCompletions(
  db: DbConnection,
  log: ThreadEventLog,
  itemIds: readonly string[],
  afterSequence: number,
  throughSequence: number,
  stats: TimelineProjectionStats,
): TimelineUnitEvent[] {
  return unitEventsFromRows(
    db,
    log,
    listTimelineBackgroundTaskCompletionRows(db, {
      afterSequence,
      itemIds,
      maxInlineOutputChars: log.source.maxInlineOutputChars,
      threadId: log.threadId,
      throughSequence,
    }),
    stats,
  );
}

function projectUnits(
  db: DbConnection,
  log: ThreadEventLog,
  inputs: readonly UnitInput[],
  throughSeq: number,
  surface: TimelineUnitSurface,
  stats: TimelineProjectionStats,
): UnitResult[] {
  if (inputs.length === 0) return [];
  const progressed = log.progressedBackgroundTaskItemIds;
  const unowned = inputs.map((input) =>
    unownedTimelineUnitBackgroundTaskItemIds(input.events, progressed),
  );
  const candidates = [...new Set(unowned.flat())];
  const origins =
    candidates.length === 0
      ? new Map<string, number>()
      : listTimelineBackgroundTaskOrigins(db, {
          beforeSequence: Math.max(...inputs.map((input) => input.startSeq)),
          itemIds: candidates,
          sequenceStart: log.source.epochSequenceStart,
          threadId: log.threadId,
        });
  const backgrounds = inputs.map((input, index) =>
    assignTimelineUnitBackgroundTasks(
      input.events,
      progressed,
      new Set(
        unowned[index]!.filter(
          (itemId) =>
            (origins.get(itemId) ?? Number.POSITIVE_INFINITY) < input.startSeq,
        ),
      ),
    ),
  );
  const owning = inputs.filter(
    (input, index) =>
      backgrounds[index]!.ownedItemIds.length > 0 && input.endSeq < throughSeq,
  );
  const completions =
    owning.length === 0
      ? []
      : readCompletions(
          db,
          log,
          [...new Set(backgrounds.flatMap((tasks) => tasks.ownedItemIds))],
          Math.min(...owning.map((input) => input.endSeq)),
          throughSeq,
          stats,
        );
  return inputs.map((input, index) => {
    const background = backgrounds[index]!;
    const owned = new Set(background.ownedItemIds);
    const projectable = projectableTimelineEvents([
      ...input.events,
      ...completions.filter(
        ({ row }) =>
          row.sequence > input.endSeq &&
          row.itemId !== null &&
          owned.has(row.itemId),
      ),
    ]);
    stats.projectedEventCount += projectable.length;
    let size = 0;
    for (const unit of projectable) size += unit.row.data.length;
    return {
      ...projectTimelineUnitRows(projectable, surface, background.foreignSeqs),
      backgroundTaskItemIds: background.ownedItemIds,
      size,
      throughSeq,
    };
  });
}

function staleBackgroundTaskResults(
  db: DbConnection,
  log: ThreadEventLog,
  results: readonly UnitResult[],
  throughSeq: number,
): Set<UnitResult> {
  const checked = results.filter(
    (result) =>
      result.backgroundTaskItemIds.length > 0 &&
      result.throughSeq !== throughSeq,
  );
  const stale = new Set<UnitResult>();
  if (checked.length === 0) return stale;
  const ranges = checked.map((result) => ({
    high: Math.max(result.throughSeq, throughSeq),
    low: Math.min(result.throughSeq, throughSeq),
    result,
  }));
  const completions = listTimelineBackgroundTaskCompletions(db, {
    afterSequence: Math.min(...ranges.map((range) => range.low)),
    itemIds: [
      ...new Set(checked.flatMap((result) => result.backgroundTaskItemIds)),
    ],
    threadId: log.threadId,
    throughSequence: Math.max(...ranges.map((range) => range.high)),
  });
  for (const { high, low, result } of ranges) {
    const itemIds = new Set(result.backgroundTaskItemIds);
    if (
      completions.some(
        (completion) =>
          completion.sequence > low &&
          completion.sequence <= high &&
          itemIds.has(completion.itemId),
      )
    ) {
      stale.add(result);
    } else if (throughSeq > result.throughSeq) {
      result.throughSeq = throughSeq;
    }
  }
  return stale;
}

function frozenUnitResults(
  db: DbConnection,
  log: ThreadEventLog,
  units: readonly FrozenUnit[],
  surface: TimelineUnitSurface,
  throughSeq: number,
  stats: TimelineProjectionStats,
): UnitResult[] {
  const key = surfaceKey(surface);
  const results: Array<UnitResult | undefined> = units.map((unit) =>
    unit.endSeq > throughSeq ? undefined : unit.results.get(key),
  );
  const stale = staleBackgroundTaskResults(
    db,
    log,
    results.filter((result) => result !== undefined),
    throughSeq,
  );
  const pending: Array<{ cache: boolean; index: number; input: UnitInput }> =
    [];
  units.forEach((unit, index) => {
    const result = results[index];
    if (result !== undefined && !stale.has(result)) {
      stats.reusedUnitCount += 1;
      return;
    }
    if (unit.endSeq > throughSeq) {
      pending.push({
        cache: false,
        index,
        input: {
          endSeq: throughSeq,
          events: readRange(db, log, unit.startSeq - 1, throughSeq, stats),
          startSeq: unit.startSeq,
        },
      });
      return;
    }
    const cache = result === undefined || throughSeq > result.throughSeq;
    if (cache) unit.results.delete(key);
    pending.push({
      cache,
      index,
      input: {
        endSeq: unit.endSeq,
        events:
          unit.events ??
          readRange(db, log, unit.startSeq - 1, unit.endSeq, stats),
        startSeq: unit.startSeq,
      },
    });
  });
  const projected = projectUnits(
    db,
    log,
    pending.map((entry) => entry.input),
    throughSeq,
    surface,
    stats,
  );
  pending.forEach(({ cache, index }, position) => {
    const result = projected[position]!;
    results[index] = result;
    if (cache) units[index]!.results.set(key, result);
  });
  return results.map((result) => {
    if (result === undefined) {
      throw new Error("Timeline unit was not projected");
    }
    return result;
  });
}

interface ProjectTimelineWindowArgs {
  atHead: boolean;
  latestPage: boolean;
  source: TimelineProjectionSource;
  surface: TimelineUnitSurface;
  threadId: string;
  throughSeq: number;
  windowStartSeq: number;
}

function resolveLog(
  db: DbConnection,
  projector: TimelineProjector,
  args: ProjectTimelineWindowArgs,
  stats: TimelineProjectionStats,
): ThreadEventLog {
  const key = logKey(args.threadId, args.source);
  const existing = projector.logs.get(key);
  if (
    existing !== undefined &&
    existing.generation === getThreadEventRewriteGeneration(args.threadId) &&
    existing.dataVersion === getDatabaseDataVersion(db) &&
    advance(db, existing, args.throughSeq, stats) === "advanced"
  ) {
    extendBackward(db, existing, args.windowStartSeq, stats);
    return existing;
  }
  for (const [otherKey, other] of projector.logs) {
    if (other.threadId === args.threadId) dropLog(projector, otherKey, other);
  }
  const log = createLog(
    db,
    args.threadId,
    args.source,
    args.windowStartSeq,
    args.throughSeq,
    stats,
  );
  projector.logs.set(key, log);
  freezeTail(log);
  return log;
}

function projectOpenTail(
  db: DbConnection,
  log: ThreadEventLog,
  args: ProjectTimelineWindowArgs,
  stats: TimelineProjectionStats,
): { events: TimelineUnitEvent[]; result: UnitResult } | null {
  if (log.tailStartSeq > args.throughSeq || log.tail.length === 0) return null;
  const bounds = { endSeq: args.throughSeq, startSeq: log.tailStartSeq };
  if (args.throughSeq < log.throughSeq) {
    const tail = readRange(
      db,
      log,
      log.tailStartSeq - 1,
      args.throughSeq,
      stats,
    );
    return {
      events: projectableTimelineEvents(tail),
      result: projectUnits(
        db,
        log,
        [{ ...bounds, events: tail }],
        args.throughSeq,
        args.surface,
        stats,
      )[0]!,
    };
  }
  const events = projectableTimelineEvents(log.tail);
  const key = surfaceKey(args.surface);
  const cached = log.tailResults.get(key);
  if (cached !== undefined && cached.length === log.tail.length) {
    stats.reusedUnitCount += 1;
    return { events, result: cached.result };
  }
  const result = projectUnits(
    db,
    log,
    [{ ...bounds, events: log.tail }],
    args.throughSeq,
    args.surface,
    stats,
  )[0]!;
  log.tailResults.set(key, { length: log.tail.length, result });
  return { events, result };
}

function listOpenBackgroundTaskEvents(
  db: DbConnection,
  log: ThreadEventLog,
  throughSeq: number,
  stats: TimelineProjectionStats,
): TimelineUnitEvent[] {
  const taskRows = listLatestOpenBackgroundTaskStateRowsForThread(db, {
    threadId: log.threadId,
  }).filter((row) => row.sequence <= throughSeq);
  const turnIds = [
    ...new Set(
      taskRows.flatMap((row) => (row.turnId === null ? [] : [row.turnId])),
    ),
  ];
  const turnRows =
    turnIds.length === 0
      ? []
      : [
          ...listStoredTurnStartedRowsByTurnIdsUpToSequence(db, {
            sequenceCutoff: throughSeq,
            threadId: log.threadId,
            turnIds,
          }),
          ...listStoredTurnCompletedRowsByTurnIds(db, {
            threadId: log.threadId,
            turnIds,
          }).filter((row) => row.sequence <= throughSeq),
        ];
  return unitEventsFromRows(
    db,
    log,
    [...turnRows, ...taskRows].sort(
      (left, right) => left.sequence - right.sequence,
    ),
    stats,
  );
}

function projectOpenBackgroundTaskHeader(
  db: DbConnection,
  log: ThreadEventLog,
  args: ProjectTimelineWindowArgs,
  firstProjectedSeq: number,
  stats: TimelineProjectionStats,
): ThreadTimelineUnitProjection | null {
  const header =
    args.atHead && log.openTaskHeader !== null
      ? log.openTaskHeader
      : {
          events: listOpenBackgroundTaskEvents(db, log, args.throughSeq, stats),
          projections: new Map<string, ThreadTimelineUnitProjection>(),
        };
  if (args.atHead) log.openTaskHeader = header;
  const taskEvents = header.events.filter(
    ({ row }) =>
      row.itemKind === "backgroundTask" && row.sequence < firstProjectedSeq,
  );
  if (taskEvents.length === 0) return null;
  const turnIds = new Set(taskEvents.map(({ row }) => row.turnId));
  const events = header.events.filter(
    (event) =>
      taskEvents.includes(event) ||
      (event.row.itemKind !== "backgroundTask" &&
        turnIds.has(event.row.turnId)),
  );
  const key = `${surfaceKey(args.surface)}|${taskEvents.map(({ row }) => row.sequence).join(",")}`;
  const cached = header.projections.get(key);
  if (cached !== undefined) return cached;
  const projectable = projectableTimelineEvents(events);
  stats.projectedEventCount += projectable.length;
  const { projection } = projectTimelineUnitRows(
    projectable,
    args.surface,
    new Set(),
  );
  header.projections.set(key, projection);
  return projection;
}

export function projectTimelineWindow(
  db: DbConnection,
  args: ProjectTimelineWindowArgs,
  stats: TimelineProjectionStats,
): TimelineWindowProjection {
  const projector = getProjector(db);
  const log = resolveLog(db, projector, args, stats);
  projector.tick += 1;
  log.lastUsed = projector.tick;
  const windowStart = Math.max(args.windowStartSeq, log.startSeq);
  const windowUnits = log.frozen.filter(
    (unit) => unit.endSeq >= windowStart && unit.startSeq <= args.throughSeq,
  );
  const results = frozenUnitResults(
    db,
    log,
    windowUnits,
    args.surface,
    args.throughSeq,
    stats,
  );
  const header = args.latestPage
    ? projectOpenBackgroundTaskHeader(
        db,
        log,
        args,
        windowUnits[0]?.startSeq ?? log.tailStartSeq,
        stats,
      )
    : null;
  const tail = projectOpenTail(db, log, args, stats);
  if (tail !== null) results.push(tail.result);
  const runningTaskOrigins = [...log.pendingBackgroundTasks.values()];
  for (const unit of log.frozen) {
    if (
      !runningTaskOrigins.some(
        (sequence) => sequence >= unit.startSeq && sequence <= unit.endSeq,
      )
    ) {
      unit.events = null;
    }
  }
  remeasure(projector, log);
  evict(projector, log);
  return {
    openEvents: (tail?.events ?? []).map(timelineUnitEventWithMeta),
    pendingBackgroundUnits: header === null ? [] : [header],
    retainedOutputPreviews: (availablePreview, now) => {
      const previews = new Map<string, TimelineOutputPreview>();
      for (const result of results) {
        for (const [callId, truncation] of result.retainedOutputs) {
          if (truncation === null) {
            previews.delete(callId);
            continue;
          }
          previews.set(callId, {
            experimental_fullOutputAvailability:
              truncation.truncatedAt > now
                ? availablePreview
                : "retention-expired",
            totalChars: truncation.originalLength,
          });
        }
      }
      return previews;
    },
    units: results.map((result) => result.projection),
  };
}
