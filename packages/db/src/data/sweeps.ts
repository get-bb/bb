import { eq, and, sql, lt, asc, inArray } from "drizzle-orm";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import {
  COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS,
  type RetainedEventOutputTarget,
} from "../retained-event-output.js";
import { environments, events, maintenanceScanCursors } from "../schema.js";
import {
  insertPreparedRetainedEventOutput,
  prepareCompletedEventOutputData,
} from "./retained-event-outputs.js";

export {
  COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS,
  COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS,
  COMPLETED_EVENT_OUTPUT_RETENTION_MS,
  COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS,
} from "../retained-event-output.js";

export const DESTROYED_ENVIRONMENT_TTL_MS = 7 * 24 * 60 * 60_000;

export const CLOSED_SESSION_ROW_RETENTION_MS = 7 * 24 * 60 * 60_000;

const COMPLETED_EVENT_OUTPUT_MIGRATION_CURSOR_VERSION = 1;
const COMPLETED_EVENT_OUTPUT_MIGRATION_COMPLETED_AT = -1;
export const DEFAULT_CLOSED_SESSION_PRUNE_BATCH_SIZE = 1_000;
export const DEFAULT_DESTROYED_ENVIRONMENT_EVENT_DETACH_BATCH_SIZE = 50;
export const DEFAULT_COMPLETED_EVENT_OUTPUT_MIGRATION_SCAN_LIMIT = 250;
export const DEFAULT_DESTROYED_ENVIRONMENT_PRUNE_BATCH_SIZE = 10;
export const MAX_COMPLETED_EVENT_OUTPUT_MIGRATION_EVENT_DATA_BYTES =
  8 * 1024 * 1024;

const COMPLETED_EVENT_OUTPUT_MIGRATION_CURSOR_POLICY =
  "legacy_completed_event_output_sidecar";
const COMPLETED_EVENT_OUTPUT_MIGRATION_WINDOW_POLICY =
  "legacy_completed_event_output_sidecar_window";

type ClosedSessionState = "closed";
type ClosedSessionDeleteParameters = [ClosedSessionState, number, number];
type CompletedEventOutputScanParameters = [
  "item/completed",
  RetainedEventOutputTarget["itemKind"],
  number,
  number,
  string,
  number,
];
type CompletedEventOutputCandidateParameters = [
  "item/completed",
  RetainedEventOutputTarget["itemKind"],
  number,
  number,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
  RetainedEventOutputTarget["itemKind"],
  string,
  number,
];
interface CompletedEventOutputScanCursor {
  lastCreatedAt: number;
  lastEventId: string;
  updatedAt: number;
}

interface CompletedEventOutputScanState {
  cursor: CompletedEventOutputScanCursor;
  window: CompletedEventOutputScanCursor | null;
}

interface CompletedEventOutputScanRow {
  created_at: number;
  id: string;
}

interface CompletedEventOutputCandidateRow {
  created_at: number;
  data: string;
  id: string;
  thread_id: string;
}

interface AdvanceCompletedEventOutputMigrationCursorArgs extends RetainedEventOutputTarget {
  lastCreatedAt: number;
  lastEventId: string;
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
  updatedBefore: number;
  eventBatchSize: number;
  limit: number;
}

export interface PruneDestroyedEnvironmentsResult {
  deleted: number;
  detachedEvents: number;
}

export interface MigrateNextCompletedEventItemOutputArgs extends RetainedEventOutputTarget {
  limit: number;
  migratedAt: number;
}

export interface MigrateNextCompletedEventItemOutputResult {
  action: "complete" | "idle" | "migrated" | "scanned";
  eventId: string | null;
  migratedBytes: number;
  migratedRows: number;
  retained: boolean;
  scanRows: number;
  threadId: string | null;
}

export function pruneClosedSessions(
  db: DbConnection,
  args: PruneClosedSessionsArgs,
): PruneClosedSessionsResult {
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
  args: RetainedEventOutputTarget,
  policy: string = COMPLETED_EVENT_OUTPUT_MIGRATION_CURSOR_POLICY,
): string {
  return [
    policy,
    `v${COMPLETED_EVENT_OUTPUT_MIGRATION_CURSOR_VERSION}`,
    args.itemKind,
    args.outputPath,
  ].join(":");
}

function getCompletedEventOutputScanState(
  db: DbQueryConnection,
  args: RetainedEventOutputTarget,
): CompletedEventOutputScanState {
  const cursorId = buildCompletedEventOutputCursorId(args);
  const windowId = buildCompletedEventOutputCursorId(
    args,
    COMPLETED_EVENT_OUTPUT_MIGRATION_WINDOW_POLICY,
  );
  const rows = db
    .select({
      id: maintenanceScanCursors.id,
      lastCreatedAt: maintenanceScanCursors.lastCreatedAt,
      lastEventId: maintenanceScanCursors.lastEventId,
      updatedAt: maintenanceScanCursors.updatedAt,
    })
    .from(maintenanceScanCursors)
    .where(inArray(maintenanceScanCursors.id, [cursorId, windowId]))
    .all();
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const cursor = rowsById.get(cursorId);
  const window = rowsById.get(windowId);

  return {
    cursor: cursor ?? { lastCreatedAt: 0, lastEventId: "", updatedAt: 0 },
    window: window ?? null,
  };
}

function listCompletedEventOutputScanRows(
  db: DbConnection,
  args: MigrateNextCompletedEventItemOutputArgs,
  cursor: CompletedEventOutputScanCursor,
): CompletedEventOutputScanRow[] {
  if (args.limit <= 0) {
    return [];
  }

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
      args.migratedAt,
      cursor.lastCreatedAt,
      cursor.lastEventId,
      args.limit,
    );
}

function findCompletedEventOutputCandidate(
  db: DbConnection,
  args: MigrateNextCompletedEventItemOutputArgs,
  cursor: CompletedEventOutputScanCursor,
  window: CompletedEventOutputScanCursor,
): CompletedEventOutputCandidateRow | undefined {
  const valuePath = `$.item.${args.outputPath}`;
  const truncationPath = `$.item.truncation.${args.outputPath}`;
  return db.$client
    .prepare<
      CompletedEventOutputCandidateParameters,
      CompletedEventOutputCandidateRow
    >(
      `
        SELECT id, created_at, data, thread_id
        FROM events
        WHERE type = ?
          AND item_kind = ?
          AND created_at < ?
          AND (created_at, id) >= (?, ?)
          AND (created_at, id) <= (?, ?)
          AND CASE
          WHEN octet_length(data) > ? THEN 0
          WHEN json_valid(data) THEN
            json_type(data, ?) = 'text'
            AND json_type(data, ?) IS NULL
            AND json_extract(data, ?) = ?
            AND octet_length(json_extract(data, ?)) > ?
          ELSE 0 END
        ORDER BY created_at, id
        LIMIT 1
      `,
    )
    .get(
      "item/completed",
      args.itemKind,
      args.migratedAt,
      cursor.lastCreatedAt,
      cursor.lastEventId,
      window.lastCreatedAt,
      window.lastEventId,
      MAX_COMPLETED_EVENT_OUTPUT_MIGRATION_EVENT_DATA_BYTES,
      valuePath,
      truncationPath,
      "$.item.type",
      args.itemKind,
      valuePath,
      COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS,
    );
}

function advanceCompletedEventOutputMigrationCursor(
  db: DbQueryConnection,
  args: AdvanceCompletedEventOutputMigrationCursorArgs,
  policy: string = COMPLETED_EVENT_OUTPUT_MIGRATION_CURSOR_POLICY,
): void {
  db.insert(maintenanceScanCursors)
    .values({
      id: buildCompletedEventOutputCursorId(args, policy),
      policy,
      version: COMPLETED_EVENT_OUTPUT_MIGRATION_CURSOR_VERSION,
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

function clearCompletedEventOutputMigrationWindow(
  db: DbQueryConnection,
  args: RetainedEventOutputTarget,
): void {
  db.delete(maintenanceScanCursors)
    .where(
      eq(
        maintenanceScanCursors.id,
        buildCompletedEventOutputCursorId(
          args,
          COMPLETED_EVENT_OUTPUT_MIGRATION_WINDOW_POLICY,
        ),
      ),
    )
    .run();
}

function sameCompletedEventOutputScanPosition(
  left: CompletedEventOutputScanCursor,
  right: CompletedEventOutputScanCursor,
): boolean {
  return (
    left.lastCreatedAt === right.lastCreatedAt &&
    left.lastEventId === right.lastEventId
  );
}

function completedEventOutputScanPositionAfter(
  left: CompletedEventOutputScanCursor,
  right: CompletedEventOutputScanCursor,
): boolean {
  return (
    left.lastCreatedAt > right.lastCreatedAt ||
    (left.lastCreatedAt === right.lastCreatedAt &&
      left.lastEventId > right.lastEventId)
  );
}

function persistCompletedEventOutputMigrationPosition(
  db: DbQueryConnection,
  args: MigrateNextCompletedEventItemOutputArgs,
  position: CompletedEventOutputScanCursor,
  window: CompletedEventOutputScanCursor,
): void {
  advanceCompletedEventOutputMigrationCursor(db, {
    ...args,
    lastCreatedAt: position.lastCreatedAt,
    lastEventId: position.lastEventId,
    updatedAt: args.migratedAt,
  });
  if (sameCompletedEventOutputScanPosition(position, window)) {
    clearCompletedEventOutputMigrationWindow(db, args);
    return;
  }
  advanceCompletedEventOutputMigrationCursor(
    db,
    {
      ...args,
      lastCreatedAt: window.lastCreatedAt,
      lastEventId: window.lastEventId,
      updatedAt: args.migratedAt,
    },
    COMPLETED_EVENT_OUTPUT_MIGRATION_WINDOW_POLICY,
  );
}

function emptyCompletedEventOutputMigrationResult(
  action: "complete" | "idle" | "scanned",
  scanRows: number,
): MigrateNextCompletedEventItemOutputResult {
  return {
    action,
    eventId: null,
    migratedBytes: 0,
    migratedRows: 0,
    retained: false,
    scanRows,
    threadId: null,
  };
}

export function migrateNextCompletedEventItemOutput(
  db: DbConnection,
  args: MigrateNextCompletedEventItemOutputArgs,
): MigrateNextCompletedEventItemOutputResult {
  if (args.limit <= 0) {
    return emptyCompletedEventOutputMigrationResult("idle", 0);
  }
  const state = getCompletedEventOutputScanState(db, args);
  const cursor = state.cursor;
  if (cursor.lastCreatedAt === COMPLETED_EVENT_OUTPUT_MIGRATION_COMPLETED_AT) {
    return emptyCompletedEventOutputMigrationResult("complete", 0);
  }

  let window =
    state.window && completedEventOutputScanPositionAfter(state.window, cursor)
      ? state.window
      : null;
  let initialWindowScanRows: number | null = null;
  if (!window) {
    const rows = listCompletedEventOutputScanRows(db, args, cursor);
    if (rows.length === 0) {
      if (cursor.lastCreatedAt === 0 && cursor.lastEventId === "") {
        if (state.window) {
          clearCompletedEventOutputMigrationWindow(db, args);
        }
        return emptyCompletedEventOutputMigrationResult("idle", 0);
      }
      db.transaction(
        (tx) => {
          advanceCompletedEventOutputMigrationCursor(tx, {
            ...args,
            lastCreatedAt: COMPLETED_EVENT_OUTPUT_MIGRATION_COMPLETED_AT,
            lastEventId: "",
            updatedAt: args.migratedAt,
          });
          clearCompletedEventOutputMigrationWindow(tx, args);
        },
        { behavior: "immediate" },
      );
      return emptyCompletedEventOutputMigrationResult("complete", 0);
    }
    const lastRow = rows.at(-1);
    if (!lastRow) {
      throw new Error("Expected completed output migration scan row");
    }
    window = {
      lastCreatedAt: lastRow.created_at,
      lastEventId: lastRow.id,
      updatedAt: args.migratedAt,
    };
    initialWindowScanRows = rows.length;
  }

  const candidate = findCompletedEventOutputCandidate(db, args, cursor, window);
  const candidatePosition = candidate
    ? {
        lastCreatedAt: candidate.created_at,
        lastEventId: candidate.id,
        updatedAt: args.migratedAt,
      }
    : window;
  const scanRows = initialWindowScanRows ?? 0;
  if (!candidate) {
    db.transaction(
      (tx) =>
        persistCompletedEventOutputMigrationPosition(
          tx,
          args,
          candidatePosition,
          window,
        ),
      { behavior: "immediate" },
    );
    return emptyCompletedEventOutputMigrationResult("scanned", scanRows);
  }

  const prepared = prepareCompletedEventOutputData({
    createdAt: candidate.created_at,
    data: candidate.data,
    itemKind: args.itemKind,
    type: "item/completed",
  });
  if (!prepared.retainedOutput) {
    db.transaction(
      (tx) =>
        persistCompletedEventOutputMigrationPosition(
          tx,
          args,
          candidatePosition,
          window,
        ),
      { behavior: "immediate" },
    );
    return emptyCompletedEventOutputMigrationResult("scanned", scanRows);
  }
  const retainedOutput = prepared.retainedOutput;
  const retained = retainedOutput.expiresAt > args.migratedAt;
  db.transaction(
    (tx) => {
      const update = tx
        .update(events)
        .set({ data: prepared.data })
        .where(
          and(eq(events.id, candidate.id), eq(events.data, candidate.data)),
        )
        .run();
      if (update.changes !== 1) {
        throw new Error(
          "Completed output migration event changed during advance",
        );
      }
      if (retained) {
        insertPreparedRetainedEventOutput(tx, {
          eventId: candidate.id,
          output: retainedOutput,
        });
      }
      persistCompletedEventOutputMigrationPosition(
        tx,
        args,
        candidatePosition,
        window,
      );
    },
    { behavior: "immediate" },
  );

  return {
    action: "migrated",
    eventId: candidate.id,
    migratedBytes: Buffer.byteLength(retainedOutput.value),
    migratedRows: 1,
    retained,
    scanRows,
    threadId: candidate.thread_id,
  };
}

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
  if (args.limit <= 0 || args.eventBatchSize <= 0) {
    return { deleted: 0, detachedEvents: 0 };
  }

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

  let deleted = 0;
  let detachedEvents = 0;
  for (const environmentId of staleEnvironmentIds) {
    const result = db.transaction(
      (tx) => {
        const detached = tx.run(sql`
          UPDATE events
          SET environment_id = NULL
          WHERE rowid IN (
            SELECT rowid
            FROM events INDEXED BY events_environment_idx
            WHERE environment_id = ${environmentId}
            ORDER BY rowid
            LIMIT ${args.eventBatchSize}
          )
        `).changes;
        if (detached > 0) {
          return { deleted: 0, detachedEvents: detached };
        }
        const deleteResult = tx
          .delete(environments)
          .where(eq(environments.id, environmentId))
          .run();
        return { deleted: deleteResult.changes, detachedEvents: 0 };
      },
      { behavior: "immediate" },
    );
    detachedEvents += result.detachedEvents;
    if (result.deleted > 0) {
      notifier.notifyEnvironment(environmentId, ["environment-deleted"]);
      deleted += result.deleted;
    }
  }

  return { deleted, detachedEvents };
}
