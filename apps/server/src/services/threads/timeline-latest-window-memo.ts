import { THREAD_TIMELINE_EXCLUDED_EVENT_TYPES } from "@bb/thread-view";
import {
  advanceTimelineWindowBudgetFloorSequence,
  getDatabaseDataVersion,
  getThreadEventRewriteGeneration,
  summarizeTimelineAppendedEvents,
  type DbConnection,
  type StoredEventRow,
} from "@bb/db";

interface LatestTimelineWindowValues {
  budgetFloorSequence: number | undefined;
  headStateRows: StoredEventRow[];
  orderingBoundarySequence: number | null;
}

export interface LatestTimelineWindowInputs extends LatestTimelineWindowValues {
  hasOlderSegments: (sequenceStart: number) => boolean;
}

interface OlderSegmentsProbe {
  hasOlder: boolean;
  sequenceStart: number;
}

export interface LatestTimelineWindowMemoArgs {
  epochSequenceStart: number;
  eventBudget: number;
  excludeDiagnosticEvents: boolean;
  maxSeq: number;
  threadId: string;
}

export interface LatestTimelineWindowInputSources {
  budgetFloorSequence: () => number | undefined;
  hasOlderSegments: (sequenceStart: number) => boolean;
  headStateRows: () => StoredEventRow[];
  orderingBoundarySequence: () => number | null;
}

interface LatestTimelineWindowMemoEntry extends LatestTimelineWindowValues {
  dataVersion: number;
  generation: number;
  maxSeq: number;
  olderSegments: OlderSegmentsProbe | null;
  threadId: string;
}

const LATEST_TIMELINE_WINDOW_MEMO_MAX_ENTRIES = 64;
const LATEST_TIMELINE_WINDOW_MEMO_MAX_APPENDED_EVENTS = 512;

const memos = new WeakMap<
  DbConnection,
  Map<string, LatestTimelineWindowMemoEntry>
>();

function memoKey(args: LatestTimelineWindowMemoArgs): string {
  return JSON.stringify([
    args.threadId,
    args.epochSequenceStart,
    args.eventBudget,
    args.excludeDiagnosticEvents,
  ]);
}

function advanceInputs(
  db: DbConnection,
  args: LatestTimelineWindowMemoArgs,
  entry: LatestTimelineWindowMemoEntry,
  sources: LatestTimelineWindowInputSources,
): Omit<LatestTimelineWindowMemoEntry, "dataVersion" | "generation"> {
  if (args.maxSeq === entry.maxSeq) return entry;
  const appended = summarizeTimelineAppendedEvents(db, {
    afterSequence: entry.maxSeq,
    excludeDiagnosticEvents: args.excludeDiagnosticEvents,
    excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    threadId: args.threadId,
    throughSequence: args.maxSeq,
  });
  return {
    budgetFloorSequence:
      appended.backgroundTaskState || entry.budgetFloorSequence === undefined
        ? sources.budgetFloorSequence()
        : advanceTimelineWindowBudgetFloorSequence(db, {
            appendedEventCount: appended.budgetEventCount,
            excludeDiagnosticEvents: args.excludeDiagnosticEvents,
            excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
            floorSequence: entry.budgetFloorSequence,
            threadId: args.threadId,
          }),
    headStateRows: appended.headState
      ? sources.headStateRows()
      : entry.headStateRows,
    maxSeq: args.maxSeq,
    olderSegments: appended.backgroundTaskState ? null : entry.olderSegments,
    orderingBoundarySequence:
      appended.ordering || appended.parented
        ? sources.orderingBoundarySequence()
        : entry.orderingBoundarySequence,
    threadId: args.threadId,
  };
}

export function clearLatestTimelineWindowInputs(db: DbConnection): void {
  memos.delete(db);
}

export function forgetLatestTimelineWindowInputs(
  db: DbConnection,
  threadId: string,
): void {
  const memo = memos.get(db);
  if (memo === undefined) return;
  for (const [key, entry] of memo) {
    if (entry.threadId === threadId) memo.delete(key);
  }
}

export function readLatestTimelineWindowInputs(
  db: DbConnection,
  args: LatestTimelineWindowMemoArgs,
  sources: LatestTimelineWindowInputSources,
): LatestTimelineWindowInputs {
  let memo = memos.get(db);
  if (memo === undefined) {
    memo = new Map();
    memos.set(db, memo);
  }
  const key = memoKey(args);
  const generation = getThreadEventRewriteGeneration(args.threadId);
  const dataVersion = getDatabaseDataVersion(db);
  const entry = memo.get(key);
  memo.delete(key);
  const next: LatestTimelineWindowMemoEntry = {
    ...(entry !== undefined &&
    entry.generation === generation &&
    entry.dataVersion === dataVersion &&
    args.maxSeq >= entry.maxSeq &&
    args.maxSeq - entry.maxSeq <=
      LATEST_TIMELINE_WINDOW_MEMO_MAX_APPENDED_EVENTS
      ? advanceInputs(db, args, entry, sources)
      : {
          budgetFloorSequence: sources.budgetFloorSequence(),
          headStateRows: sources.headStateRows(),
          maxSeq: args.maxSeq,
          olderSegments: null,
          orderingBoundarySequence: sources.orderingBoundarySequence(),
          threadId: args.threadId,
        }),
    dataVersion,
    generation,
  };
  memo.set(key, next);
  while (memo.size > LATEST_TIMELINE_WINDOW_MEMO_MAX_ENTRIES) {
    memo.delete(memo.keys().next().value!);
  }
  return {
    budgetFloorSequence: next.budgetFloorSequence,
    hasOlderSegments: (sequenceStart) => {
      if (next.olderSegments?.sequenceStart !== sequenceStart) {
        next.olderSegments = {
          hasOlder: sources.hasOlderSegments(sequenceStart),
          sequenceStart,
        };
      }
      return next.olderSegments.hasOlder;
    },
    headStateRows: next.headStateRows,
    orderingBoundarySequence: next.orderingBoundarySequence,
  };
}
