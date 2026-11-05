import {
  resumeEventProjectionFold,
  type EventProjectionFold,
  type ThreadEventWithMeta,
} from "@bb/thread-view";
import {
  getDatabaseDataVersion,
  getThreadEventRewriteGeneration,
  type DbConnection,
  type StoredEventRow,
} from "@bb/db";

interface KeptTimelineProjectionFold {
  dataVersion: number;
  fold: EventProjectionFold;
  generation: number;
  rows: readonly StoredEventRow[];
  threadId: string;
}

export interface TimelineProjectionFoldArgs {
  decodedRows: readonly ThreadEventWithMeta[];
  key: string;
  rows: readonly StoredEventRow[];
  start: () => EventProjectionFold;
  threadId: string;
}

const TIMELINE_PROJECTION_FOLD_MAX_ENTRIES = 16;

const keptFolds = new WeakMap<
  DbConnection,
  Map<string, KeptTimelineProjectionFold>
>();

function startsWithRows(
  rows: readonly StoredEventRow[],
  prefix: readonly StoredEventRow[],
): boolean {
  if (prefix.length > rows.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (rows[index] !== prefix[index]) return false;
  }
  return true;
}

export function clearTimelineProjectionFolds(db: DbConnection): void {
  keptFolds.delete(db);
}

export function forgetTimelineProjectionFolds(
  db: DbConnection,
  threadId: string,
): void {
  const folds = keptFolds.get(db);
  if (folds === undefined) return;
  for (const [key, kept] of folds) {
    if (kept.threadId === threadId) folds.delete(key);
  }
}

export function keepTimelineProjectionFold(
  db: DbConnection,
  stats: { foldedEventCount: number },
  args: TimelineProjectionFoldArgs,
): EventProjectionFold {
  let folds = keptFolds.get(db);
  if (folds === undefined) {
    folds = new Map();
    keptFolds.set(db, folds);
  }
  const generation = getThreadEventRewriteGeneration(args.threadId);
  const dataVersion = getDatabaseDataVersion(db);
  const kept = folds.get(args.key);
  folds.delete(args.key);
  const resumed =
    kept !== undefined &&
    kept.generation === generation &&
    kept.dataVersion === dataVersion &&
    startsWithRows(args.rows, kept.rows) &&
    resumeEventProjectionFold(
      kept.fold,
      args.decodedRows.slice(kept.rows.length),
    );
  const fold = resumed ? kept.fold : args.start();
  stats.foldedEventCount = resumed
    ? args.rows.length - kept.rows.length
    : fold.events.length;
  folds.set(args.key, {
    dataVersion,
    fold,
    generation,
    rows: args.rows,
    threadId: args.threadId,
  });
  while (folds.size > TIMELINE_PROJECTION_FOLD_MAX_ENTRIES) {
    folds.delete(folds.keys().next().value!);
  }
  return fold;
}
