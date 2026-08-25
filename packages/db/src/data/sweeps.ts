import {
  eq,
  and,
  gt,
  isNotNull,
  isNull,
  sql,
  lt,
  asc,
} from "drizzle-orm";
import { type ThreadEventItemType } from "@bb/domain";
import type { DbConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { environments, maintenanceScanCursors, threads } from "../schema.js";
import { getLatestThreadSequence } from "./events.js";

/** Destroyed environments are hard-deleted after 7 days. */
export const DESTROYED_ENVIRONMENT_TTL_MS = 7 * 24 * 60 * 60_000;

/** Closed daemon session rows are retained briefly for debugging/history. */
export const CLOSED_SESSION_ROW_RETENTION_MS = 7 * 24 * 60 * 60_000;

/** Completed item output remains inspectable, but old large blobs are bounded. */
export const COMPLETED_EVENT_OUTPUT_RETENTION_MS = 7 * 24 * 60 * 60_000;

export const COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS = 32 * 1024;
export const COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS = 2 * 1024;
export const COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS = 2 * 1024;
const COMPLETED_EVENT_OUTPUT_TRUNCATION_CURSOR_VERSION = 1;
export const DEFAULT_CLOSED_SESSION_PRUNE_BATCH_SIZE = 1_000;
export const DEFAULT_COMPLETED_EVENT_OUTPUT_TRUNCATION_BATCH_SIZE = 250;
// Each environment delete cascades ON DELETE SET NULL over its events and
// threads (~0.007 ms/event), so the per-tick budget is environments, not rows.
export const DEFAULT_DESTROYED_ENVIRONMENT_PRUNE_BATCH_SIZE = 10;

const COMPLETED_EVENT_OUTPUT_TRUNCATION_MARKER =
  "\n\n[... output truncated by retention policy; showing beginning and end ...]\n\n";
const COMPLETED_EVENT_OUTPUT_TRUNCATION_CURSOR_POLICY =
  "completed_event_output_truncation";

type ClosedSessionState = "closed";
type ClosedSessionDeleteParameters = [ClosedSessionState, number, number];
type CompletedEventOutputItemKind = Extract<
  ThreadEventItemType,
  "commandExecution" | "toolCall" | "webSearch" | "webFetch"
>;
type CompletedEventOutputPath = "aggregatedOutput" | "result" | "resultText";
type CompletedEventOutputScanParameters = [
  "item/completed",
  CompletedEventOutputItemKind,
  number,
  number,
  string,
  number,
];
type SqliteParameter = string | number | bigint | Buffer | null;

interface CompletedEventOutputPathTarget {
  itemKind: CompletedEventOutputItemKind;
  outputPath: CompletedEventOutputPath;
}

interface CompletedEventOutputScanCursor {
  lastCreatedAt: number;
  lastEventId: string;
}

interface CompletedEventOutputScanRow {
  created_at: number;
  id: string;
}

interface TruncateCompletedEventItemOutputPathArgs
  extends CompletedEventOutputPathTarget,
    TruncateCompletedEventItemOutputsArgs {}

interface UpdateCompletedEventOutputScanRowsArgs
  extends CompletedEventOutputPathTarget {
  rows: CompletedEventOutputScanRow[];
  truncatedAt: number;
}

interface AdvanceCompletedEventOutputScanCursorArgs
  extends CompletedEventOutputPathTarget,
    CompletedEventOutputScanCursor {
  updatedAt: number;
}

export interface PruneClosedSessionsArgs {
  closedBefore: number;
  limit: number;
}

export interface PruneClosedSessionsResult {
  deleted: number;
}

export interface PruneDestroyedEnvironmentsArgs {
  // Compared against `environments.updatedAt`: the table has no destroy
  // timestamp, and any metadata write (e.g. PATCH /environments/:id) moves
  // this clock, restarting the retention window for a destroyed row.
  updatedBefore: number;
  limit: number;
}

export interface PruneDestroyedEnvironmentsResult {
  deleted: number;
}

export interface TruncateCompletedEventItemOutputsArgs {
  createdBefore: number;
  limit: number;
  truncatedAt: number;
}

export interface TruncateCompletedEventItemOutputsResult {
  commandExecutionOutputs: number;
  toolCallResults: number;
  webFetchResultTexts: number;
  webSearchResultTexts: number;
}

export function pruneClosedSessions(
  db: DbConnection,
  args: PruneClosedSessionsArgs,
): PruneClosedSessionsResult {
  // Keep the prune plan pinned to the retention index; this path runs
  // periodically and can otherwise regress into a scan plus temp sort.
  const result = db.$client
    .prepare<ClosedSessionDeleteParameters>(
      `
        DELETE FROM host_daemon_sessions
        WHERE id IN (
          SELECT id
          FROM host_daemon_sessions INDEXED BY host_daemon_sessions_closed_prune_idx
          WHERE status = ?
            AND closed_at IS NOT NULL
            AND closed_at < ?
          ORDER BY closed_at
          LIMIT ?
        )
      `,
    )
    .run("closed", args.closedBefore, args.limit);

  return { deleted: result.changes };
}

function buildCompletedEventOutputCursorId(
  args: CompletedEventOutputPathTarget,
): string {
  return [
    COMPLETED_EVENT_OUTPUT_TRUNCATION_CURSOR_POLICY,
    `v${COMPLETED_EVENT_OUTPUT_TRUNCATION_CURSOR_VERSION}`,
    args.itemKind,
    args.outputPath,
  ].join(":");
}

function getCompletedEventOutputScanCursor(
  db: DbConnection,
  args: CompletedEventOutputPathTarget,
): CompletedEventOutputScanCursor {
  const row = db
    .select({
      lastCreatedAt: maintenanceScanCursors.lastCreatedAt,
      lastEventId: maintenanceScanCursors.lastEventId,
    })
    .from(maintenanceScanCursors)
    .where(
      eq(maintenanceScanCursors.id, buildCompletedEventOutputCursorId(args)),
    )
    .get();

  return row ?? { lastCreatedAt: 0, lastEventId: "" };
}

function listCompletedEventOutputScanRows(
  db: DbConnection,
  args: TruncateCompletedEventItemOutputPathArgs,
): CompletedEventOutputScanRow[] {
  if (args.limit <= 0) {
    return [];
  }

  const cursor = getCompletedEventOutputScanCursor(db, args);
  return db.$client
    .prepare<CompletedEventOutputScanParameters, CompletedEventOutputScanRow>(
      `
        SELECT id, created_at
        FROM events
        WHERE type = ?
          AND item_kind = ?
          AND created_at < ?
          AND (created_at, id) > (?, ?)
        ORDER BY created_at, id
        LIMIT ?
      `,
    )
    .all(
      "item/completed",
      args.itemKind,
      args.createdBefore,
      cursor.lastCreatedAt,
      cursor.lastEventId,
      args.limit,
    );
}

function updateCompletedEventOutputScanRows(
  db: DbConnection,
  args: UpdateCompletedEventOutputScanRowsArgs,
): number {
  if (args.rows.length === 0) {
    return 0;
  }

  const valuePath = `$.item.${args.outputPath}`;
  const truncationPath = `$.item.truncation.${args.outputPath}`;
  const rowPlaceholders = args.rows.map(() => "?").join(",");
  const parameters: SqliteParameter[] = [
    valuePath,
    valuePath,
    COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS,
    COMPLETED_EVENT_OUTPUT_TRUNCATION_MARKER,
    valuePath,
    COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS,
    `${truncationPath}.originalLength`,
    valuePath,
    `${truncationPath}.retainedHeadLength`,
    COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS,
    `${truncationPath}.retainedTailLength`,
    COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS,
    `${truncationPath}.truncatedAt`,
    args.truncatedAt,
    ...args.rows.map((row) => row.id),
    valuePath,
    truncationPath,
    valuePath,
    COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS,
  ];

  const result = db.$client
    .prepare<SqliteParameter[]>(
      `
        UPDATE events
        SET data = json_set(
          data,
          ?,
          substr(json_extract(data, ?), 1, ?)
            || ?
            || substr(json_extract(data, ?), -?),
          ?,
          length(json_extract(data, ?)),
          ?,
          ?,
          ?,
          ?,
          ?,
          ?
        )
        WHERE id IN (${rowPlaceholders})
          AND json_type(data, ?) = 'text'
          AND json_type(data, ?) IS NULL
          AND length(json_extract(data, ?)) > ?
      `,
    )
    .run(...parameters);

  return result.changes;
}

function advanceCompletedEventOutputScanCursor(
  db: DbConnection,
  args: AdvanceCompletedEventOutputScanCursorArgs,
): void {
  db.insert(maintenanceScanCursors)
    .values({
      id: buildCompletedEventOutputCursorId(args),
      policy: COMPLETED_EVENT_OUTPUT_TRUNCATION_CURSOR_POLICY,
      version: COMPLETED_EVENT_OUTPUT_TRUNCATION_CURSOR_VERSION,
      itemKind: args.itemKind,
      outputPath: args.outputPath,
      lastCreatedAt: args.lastCreatedAt,
      lastEventId: args.lastEventId,
      updatedAt: args.updatedAt,
    })
    .onConflictDoUpdate({
      target: maintenanceScanCursors.id,
      set: {
        lastCreatedAt: args.lastCreatedAt,
        lastEventId: args.lastEventId,
        updatedAt: args.updatedAt,
      },
    })
    .run();
}

function truncateCompletedEventItemOutputPath(
  db: DbConnection,
  args: TruncateCompletedEventItemOutputPathArgs,
): number {
  const rows = listCompletedEventOutputScanRows(db, args);
  const truncated = updateCompletedEventOutputScanRows(db, {
    itemKind: args.itemKind,
    outputPath: args.outputPath,
    rows,
    truncatedAt: args.truncatedAt,
  });
  const lastRow = rows.at(-1);
  if (lastRow) {
    advanceCompletedEventOutputScanCursor(db, {
      itemKind: args.itemKind,
      outputPath: args.outputPath,
      lastCreatedAt: lastRow.created_at,
      lastEventId: lastRow.id,
      updatedAt: args.truncatedAt,
    });
  }
  return truncated;
}

export function truncateCompletedEventItemOutputs(
  db: DbConnection,
  args: TruncateCompletedEventItemOutputsArgs,
): TruncateCompletedEventItemOutputsResult {
  return {
    commandExecutionOutputs: truncateCompletedEventItemOutputPath(db, {
      ...args,
      itemKind: "commandExecution",
      outputPath: "aggregatedOutput",
    }),
    toolCallResults: truncateCompletedEventItemOutputPath(db, {
      ...args,
      itemKind: "toolCall",
      outputPath: "result",
    }),
    webFetchResultTexts: truncateCompletedEventItemOutputPath(db, {
      ...args,
      itemKind: "webFetch",
      outputPath: "resultText",
    }),
    webSearchResultTexts: truncateCompletedEventItemOutputPath(db, {
      ...args,
      itemKind: "webSearch",
      outputPath: "resultText",
    }),
  };
}

/**
 * `provider/unhandled` rows are raw provider events bb could not translate,
 * persisted for diagnostics. Stored rows are read back only by the
 * diagnostics timeline path (development builds or the
 * `showUnhandledProviderEvents` setting) and by the legacy claude-code
 * model-fallback extraction for rows persisted before `provider/modelFallback`
 * existed; nothing replays them to a provider. They are capped by age
 * regardless of thread archival. Retention policy — revisit deliberately,
 * not incidentally.
 */
export const PROVIDER_UNHANDLED_EVENT_RETENTION_MS = 30 * 24 * 60 * 60_000;
export const DEFAULT_PROVIDER_UNHANDLED_EVENT_PRUNE_BATCH_SIZE = 1_000;

export interface PruneProviderUnhandledEventsArgs {
  createdBefore: number;
  limit: number;
}

export interface PruneProviderUnhandledEventsResult {
  deleted: number;
}

type ProviderUnhandledDeleteParameters = [number, number];

/**
 * Deletes `provider/unhandled` event rows created before the cutoff,
 * oldest-first, bounded per pass. Deleting from the head of the partial
 * retention index means each pass resumes where the last one stopped
 * without a cursor.
 */
export function pruneProviderUnhandledEvents(
  db: DbConnection,
  args: PruneProviderUnhandledEventsArgs,
): PruneProviderUnhandledEventsResult {
  // Keep the prune plan pinned to the partial retention index; the literal
  // type predicate is what makes the partial index usable.
  const result = db.$client
    .prepare<ProviderUnhandledDeleteParameters>(
      `
        DELETE FROM events
        WHERE id IN (
          SELECT id
          FROM events INDEXED BY events_provider_unhandled_created_idx
          WHERE type = 'provider/unhandled'
            AND created_at < ?
          ORDER BY created_at
          LIMIT ?
        )
      `,
    )
    .run(args.createdBefore, args.limit);

  return { deleted: result.changes };
}

const ARCHIVED_THREAD_EVENT_RETENTION_CURSOR_POLICY =
  "archived_thread_event_retention";
const ARCHIVED_THREAD_EVENT_RETENTION_CURSOR_VERSION = 1;
const ARCHIVED_THREAD_EVENT_RETENTION_CURSOR_ID = [
  ARCHIVED_THREAD_EVENT_RETENTION_CURSOR_POLICY,
  `v${ARCHIVED_THREAD_EVENT_RETENTION_CURSOR_VERSION}`,
].join(":");

/** Archived threads examined per retention pass. */
export const DEFAULT_ARCHIVED_THREAD_EVENT_PRUNE_THREAD_BATCH_SIZE = 50;
/**
 * Total event rows deleted per retention pass. Bounds the write transaction
 * so a backlog of hundreds of thousands of rows drains across passes without
 * stalling foreground work on the synchronous SQLite writer.
 */
export const DEFAULT_ARCHIVED_THREAD_EVENT_PRUNE_ROW_BATCH_SIZE = 2_000;

export interface PruneArchivedThreadEventsArgs {
  /**
   * Number of most recent sequence slots kept per archived thread. The
   * caller (the server) owns this product policy.
   */
  keepRecent: number;
  maxRows: number;
  maxThreads: number;
  now: number;
}

export interface PruneArchivedThreadEventsResult {
  /**
   * True when this pass reached the end of the archived-thread walk; the
   * cursor has wrapped and the next pass starts over.
   */
  completedCycle: boolean;
  deleted: number;
  scannedThreads: number;
}

type ArchivedThreadEventDeleteParameters = [string, number, number];

function getArchivedThreadEventRetentionCursorThreadId(
  db: DbConnection,
): string {
  const row = db
    .select({ lastEventId: maintenanceScanCursors.lastEventId })
    .from(maintenanceScanCursors)
    .where(
      eq(maintenanceScanCursors.id, ARCHIVED_THREAD_EVENT_RETENTION_CURSOR_ID),
    )
    .get();

  return row?.lastEventId ?? "";
}

function setArchivedThreadEventRetentionCursorThreadId(
  db: DbConnection,
  args: { threadId: string; updatedAt: number },
): void {
  db.insert(maintenanceScanCursors)
    .values({
      id: ARCHIVED_THREAD_EVENT_RETENTION_CURSOR_ID,
      policy: ARCHIVED_THREAD_EVENT_RETENTION_CURSOR_POLICY,
      version: ARCHIVED_THREAD_EVENT_RETENTION_CURSOR_VERSION,
      itemKind: "",
      outputPath: "",
      lastCreatedAt: 0,
      lastEventId: args.threadId,
      updatedAt: args.updatedAt,
    })
    .onConflictDoUpdate({
      target: maintenanceScanCursors.id,
      set: {
        lastEventId: args.threadId,
        updatedAt: args.updatedAt,
      },
    })
    .run();
}

/**
 * Hard-deletes archived threads' events beyond the caller's keep-recent
 * window (the same window the on-archive prune already applies to its
 * prunable event classes — the product accepts that an archived thread keeps
 * only its recent history). Walks archived, non-deleted threads in id order
 * behind a durable keyset cursor, so a large backlog drains across passes
 * and newly archived threads are picked up on the next cycle. Unarchiving a
 * thread removes it from the walk — rows already pruned stay gone, which is
 * the same contract the on-archive prune implies.
 */
export function pruneArchivedThreadEvents(
  db: DbConnection,
  args: PruneArchivedThreadEventsArgs,
): PruneArchivedThreadEventsResult {
  if (args.keepRecent < 0 || args.maxThreads <= 0 || args.maxRows <= 0) {
    return { completedCycle: false, deleted: 0, scannedThreads: 0 };
  }

  const cursorThreadId = getArchivedThreadEventRetentionCursorThreadId(db);
  const threadRows = db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        isNotNull(threads.archivedAt),
        isNull(threads.deletedAt),
        gt(threads.id, cursorThreadId),
      ),
    )
    .orderBy(threads.id)
    .limit(args.maxThreads)
    .all();

  let deleted = 0;
  let scannedThreads = 0;
  let lastFinishedThreadId = cursorThreadId;
  let exhaustedRowBudget = false;
  for (const threadRow of threadRows) {
    scannedThreads += 1;
    const latestSequence = getLatestThreadSequence(db, {
      threadId: threadRow.id,
    });
    const sequenceCutoff = latestSequence - args.keepRecent;
    if (sequenceCutoff > 0) {
      // Keep the delete plan pinned to the (thread_id, sequence) index; the
      // subquery is a bounded oldest-first range scan on it.
      const result = db.$client
        .prepare<ArchivedThreadEventDeleteParameters>(
          `
            DELETE FROM events
            WHERE id IN (
              SELECT id
              FROM events INDEXED BY events_thread_sequence_idx
              WHERE thread_id = ?
                AND sequence <= ?
              ORDER BY sequence
              LIMIT ?
            )
          `,
        )
        .run(threadRow.id, sequenceCutoff, args.maxRows - deleted);
      deleted += result.changes;
      if (deleted >= args.maxRows) {
        // The thread may still hold prunable rows; leave the cursor before
        // it so the next pass resumes here.
        exhaustedRowBudget = true;
        break;
      }
    }
    lastFinishedThreadId = threadRow.id;
  }

  const completedCycle =
    !exhaustedRowBudget && threadRows.length < args.maxThreads;
  setArchivedThreadEventRetentionCursorThreadId(db, {
    threadId: completedCycle ? "" : lastFinishedThreadId,
    updatedAt: args.now,
  });

  return { completedCycle, deleted, scannedThreads };
}

/**
 * Sweep retiring managed environments with zero non-archived threads.
 * Returns the list of environment records that are candidates for cleanup.
 * The caller decides what to do (e.g., queue destroy commands).
 *
 * The archive grace window (delay a retiring environment's destroy so an
 * accidental archive can be undone) is enforced by the server in
 * `advanceEnvironmentCleanup`, not here: this sweep returns a candidate as soon
 * as it is retiring with no live threads, and the advance defers the actual
 * destroy until the grace window elapses. Keeping the grace check in one place
 * (the advance) avoids splitting the policy across the db query.
 */
export function sweepManagedEnvironments(db: DbConnection) {
  const rows = db
    .select()
    .from(environments)
    .where(
      and(
        eq(environments.managed, true),
        eq(environments.status, "retiring"),
        sql`NOT EXISTS (
          SELECT 1 FROM threads
          WHERE threads.environment_id = ${environments.id}
          AND threads.archived_at IS NULL
          AND threads.deleted_at IS NULL
        )`,
      ),
    )
    .all();

  return rows;
}

export function pruneDestroyedEnvironments(
  db: DbConnection,
  notifier: DbNotifier,
  args: PruneDestroyedEnvironmentsArgs,
): PruneDestroyedEnvironmentsResult {
  if (args.limit <= 0) {
    return { deleted: 0 };
  }

  // Oldest first so a backlog drains deterministically and every call makes
  // progress even when a later batch is cut short.
  const staleEnvironmentIds = db
    .select({ id: environments.id })
    .from(environments)
    .where(
      and(
        eq(environments.status, "destroyed"),
        lt(environments.updatedAt, args.updatedBefore),
      ),
    )
    .orderBy(asc(environments.updatedAt), asc(environments.id))
    .limit(args.limit)
    .all()
    .map((environment) => environment.id);

  // `limit` on the SELECT above is what bounds a call: each environment's
  // ON DELETE SET NULL cascade over its events and threads runs synchronously
  // inside the DELETE and this loop never yields, so a call costs `limit`
  // cascades whether they run as one `id IN (...)` statement or one statement
  // each (a restart backlog with no LIMIT held the event loop for seconds).
  // One DELETE per environment only keeps each implicit transaction to a
  // single environment, so a failure mid-batch leaves already-pruned rows
  // pruned and each notification follows its own commit. Keeping the event
  // loop responsive across environments is the caller's job: the server sweep
  // calls this with `limit: 1` and yields between calls.
  for (const environmentId of staleEnvironmentIds) {
    db.delete(environments).where(eq(environments.id, environmentId)).run();
    notifier.notifyEnvironment(environmentId, ["environment-deleted"]);
  }

  return { deleted: staleEnvironmentIds.length };
}
