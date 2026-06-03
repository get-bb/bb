import {
  asc,
  eq,
  and,
  isNotNull,
  sql,
  lt,
  ne,
  inArray,
  or,
} from "drizzle-orm";
import {
  activeLifecycleOperationStates,
  type ThreadEventItemType,
} from "@bb/domain";
import type { DbConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import {
  environmentOperations,
  hostDaemonCommandAttempts,
  hostDaemonCommands,
  hostDaemonSessions,
  environments,
  maintenanceScanCursors,
  pendingInteractions,
  threadOperations,
} from "../schema.js";

const LEGACY_TERMINALIZED_EXPIRED_COMMAND_RESULT_PAYLOAD = JSON.stringify({
  errorCode: "command_expired",
  errorMessage: "Command expired after retry",
});
const LEGACY_TERMINALIZED_EXPIRED_ENVIRONMENT_LIFECYCLE_COMMAND_TYPES = [
  "environment.destroy",
  "environment.provision",
];
const LEGACY_TERMINALIZED_EXPIRED_THREAD_LIFECYCLE_COMMAND_TYPES = [
  "thread.start",
  "thread.stop",
];
const LEGACY_TERMINALIZED_EXPIRED_INTERACTION_LIFECYCLE_COMMAND_TYPES = [
  "interactive.resolve",
];

/** Destroyed environments are hard-deleted after 7 days. */
const DESTROYING_ENVIRONMENT_TTL_MS = 7 * 24 * 60 * 60_000;

/** Completed daemon commands keep result payloads briefly for result retries. */
export const COMPLETED_COMMAND_PAYLOAD_RETENTION_MS = 24 * 60 * 60_000;

/** Completed daemon command rows are retained briefly for debugging/history. */
export const COMPLETED_COMMAND_ROW_RETENTION_MS = 7 * 24 * 60 * 60_000;

/** Closed daemon session rows are retained briefly for debugging/history. */
export const CLOSED_SESSION_ROW_RETENTION_MS = 7 * 24 * 60 * 60_000;

/** Completed item output remains inspectable, but old large blobs are bounded. */
export const COMPLETED_EVENT_OUTPUT_RETENTION_MS = 7 * 24 * 60 * 60_000;

export const COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS = 32 * 1024;
export const COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS = 2 * 1024;
export const COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS = 2 * 1024;
export const COMPLETED_EVENT_OUTPUT_TRUNCATION_CURSOR_VERSION = 1;
export const DEFAULT_COMPLETED_COMMAND_PRUNE_BATCH_SIZE = 1_000;
export const DEFAULT_CLOSED_SESSION_PRUNE_BATCH_SIZE = 1_000;
export const DEFAULT_COMPLETED_EVENT_OUTPUT_TRUNCATION_BATCH_SIZE = 250;

const COMPLETED_EVENT_OUTPUT_TRUNCATION_MARKER =
  "\n\n[... output truncated by retention policy; showing beginning and end ...]\n\n";
const COMPLETED_EVENT_OUTPUT_TRUNCATION_CURSOR_POLICY =
  "completed_event_output_truncation";

type CompletedCommandState = "success" | "error";
export const READ_ONLY_HOST_DAEMON_COMMAND_TYPES = [
  "environment.cleanup_preflight",
] as const;
const LEGACY_READ_ONLY_HOST_DAEMON_COMMAND_TYPES = [
  "host.file_metadata",
  "host.list_branches",
  "host.list_files",
  "host.list_paths",
  "host.read_file",
  "host.read_file_relative",
  "provider.list",
  "provider.list_models",
  "workspace.diff",
  "workspace.status",
] as const;
export const COMPLETED_READ_ONLY_COMMAND_PRUNE_TYPES = [
  ...READ_ONLY_HOST_DAEMON_COMMAND_TYPES,
  // Historical rows for command types that now run only through online RPC.
  ...LEGACY_READ_ONLY_HOST_DAEMON_COMMAND_TYPES,
  // Historical replay capture rows from the removed durable replay protocol.
  "replay.capture_get",
  "replay.capture_list",
] as const;
type ReadOnlyHostDaemonCommandType =
  (typeof COMPLETED_READ_ONLY_COMMAND_PRUNE_TYPES)[number];
type CompletedCommandRowDeleteParameters = [
  CompletedCommandState,
  CompletedCommandState,
  ...ReadOnlyHostDaemonCommandType[],
  number,
  number,
];
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

export interface PruneCompletedCommandPayloadsArgs {
  completedBefore: number;
}

export interface PruneCompletedCommandPayloadsResult {
  pruned: number;
}

export interface PruneCompletedCommandRowsArgs {
  completedBefore: number;
  limit: number;
}

export interface PruneCompletedCommandsResult {
  deleted: number;
}

export interface PruneClosedSessionsArgs {
  closedBefore: number;
  limit: number;
}

export interface PruneClosedSessionsResult {
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

export interface SweepExpiredLeasesResult {
  expiredHostIds: string[];
  expiredSessionIds: string[];
  sessionsClosed: number;
}

export interface SweepExpiredCommandsResult {
  expiredCommands: ExpiredCommandAttempt[];
  requeued: number;
}

export interface ExpiredCommandAttempt {
  attemptId: string;
  commandId: string;
}

export interface ListLegacyTerminalizedExpiredLifecycleCommandsNeedingSettlementArgs {
  limit: number;
}

type SqlPredicate = ReturnType<typeof and>;

function isExpiredActiveCommandAttemptPredicate(
  currentTime: number,
): SqlPredicate {
  return and(
    eq(hostDaemonCommandAttempts.status, "active"),
    sql`${hostDaemonCommandAttempts.leaseExpiresAt} <= ${currentTime}`,
  );
}

function hasNoExpiredCommandAttemptPredicate(): SqlPredicate {
  return sql`NOT EXISTS (
    SELECT 1
    FROM host_daemon_command_attempts AS previous_attempt
    WHERE previous_attempt.command_id = ${hostDaemonCommandAttempts.commandId}
      AND previous_attempt.status = 'expired'
  )`;
}

function hasExpiredCommandAttemptPredicate(): SqlPredicate {
  return sql`EXISTS (
    SELECT 1
    FROM host_daemon_command_attempts AS previous_attempt
    WHERE previous_attempt.command_id = ${hostDaemonCommandAttempts.commandId}
      AND previous_attempt.status = 'expired'
  )`;
}

function isFirstExpiredCommandAttemptPredicate(
  currentTime: number,
): SqlPredicate {
  return and(
    isExpiredActiveCommandAttemptPredicate(currentTime),
    hasNoExpiredCommandAttemptPredicate(),
  );
}

function isRetriedExpiredCommandPredicate(currentTime: number): SqlPredicate {
  return and(
    isExpiredActiveCommandAttemptPredicate(currentTime),
    hasExpiredCommandAttemptPredicate(),
  );
}

export function pruneCompletedCommandPayloads(
  db: DbConnection,
  args: PruneCompletedCommandPayloadsArgs,
): PruneCompletedCommandPayloadsResult {
  const result = db
    .update(hostDaemonCommands)
    .set({
      payload: "{}",
      resultPayload: null,
    })
    .where(
      and(
        inArray(hostDaemonCommands.state, ["success", "error"]),
        isNotNull(hostDaemonCommands.completedAt),
        lt(hostDaemonCommands.completedAt, args.completedBefore),
        or(
          ne(hostDaemonCommands.payload, "{}"),
          isNotNull(hostDaemonCommands.resultPayload),
        ),
      ),
    )
    .run();

  return { pruned: result.changes };
}

function deleteCompletedCommandRowsByCohort(
  db: DbConnection,
  args: PruneCompletedCommandRowsArgs & { includeReadOnlyTypes: boolean },
): PruneCompletedCommandsResult {
  const readOnlyCommandPlaceholders = COMPLETED_READ_ONLY_COMMAND_PRUNE_TYPES.map(
    () => "?",
  ).join(", ");
  const typePredicate = args.includeReadOnlyTypes
    ? `type IN (${readOnlyCommandPlaceholders})`
    : `type NOT IN (${readOnlyCommandPlaceholders})`;
  const result = db.$client
    .prepare<CompletedCommandRowDeleteParameters>(
      `
        DELETE FROM host_daemon_commands
        WHERE id IN (
          SELECT id
          FROM host_daemon_commands INDEXED BY host_daemon_commands_completed_prune_idx
          WHERE state IN (?, ?)
            AND completed_at IS NOT NULL
            AND ${typePredicate}
            AND completed_at < ?
          ORDER BY completed_at
          LIMIT ?
        )
      `,
    )
    .run(
      "success",
      "error",
      ...COMPLETED_READ_ONLY_COMMAND_PRUNE_TYPES,
      args.completedBefore,
      args.limit,
    );

  return { deleted: result.changes };
}

export function pruneCompletedReadOnlyCommandRows(
  db: DbConnection,
  args: PruneCompletedCommandRowsArgs,
): PruneCompletedCommandsResult {
  return deleteCompletedCommandRowsByCohort(db, {
    ...args,
    includeReadOnlyTypes: true,
  });
}

export function pruneCompletedDurableCommandRows(
  db: DbConnection,
  args: PruneCompletedCommandRowsArgs,
): PruneCompletedCommandsResult {
  return deleteCompletedCommandRowsByCohort(db, {
    ...args,
    includeReadOnlyTypes: false,
  });
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
 * Sweep expired command delivery attempts.
 *
 * - first expired attempt: mark attempt expired and make the command fetchable
 *   again;
 * - later expired attempt: mark the exact attempt expired and return it for
 *   command-result settlement.
 *
 * Retried expirations are terminalized by the server with command-result owner
 * side effects and command completion in one transaction.
 */
export function sweepExpiredCommands(
  db: DbConnection,
  _notifier: DbNotifier,
  now?: number,
): SweepExpiredCommandsResult {
  const currentTime = now ?? Date.now();
  return db.transaction((tx) => {
    const firstExpiredAttempts = tx
      .select({
        attemptId: hostDaemonCommandAttempts.id,
        commandId: hostDaemonCommandAttempts.commandId,
      })
      .from(hostDaemonCommandAttempts)
      .where(isFirstExpiredCommandAttemptPredicate(currentTime))
      .all();

    if (firstExpiredAttempts.length > 0) {
      tx.update(hostDaemonCommandAttempts)
        .set({
          status: "expired",
          settledAt: currentTime,
        })
        .where(
          inArray(
            hostDaemonCommandAttempts.id,
            firstExpiredAttempts.map((attempt) => attempt.attemptId),
          ),
        )
        .run();
      tx.update(hostDaemonCommands)
        .set({
          state: "pending",
          fetchedAt: null,
          sessionId: null,
        })
        .where(
          inArray(
            hostDaemonCommands.id,
            firstExpiredAttempts.map((attempt) => attempt.commandId),
          ),
        )
        .run();
    }

    const expiredCommands = tx
      .select({
        attemptId: hostDaemonCommandAttempts.id,
        commandId: hostDaemonCommandAttempts.commandId,
      })
      .from(hostDaemonCommandAttempts)
      .where(isRetriedExpiredCommandPredicate(currentTime))
      .all();

    if (expiredCommands.length > 0) {
      tx.update(hostDaemonCommandAttempts)
        .set({
          status: "expired",
          settledAt: currentTime,
        })
        .where(
          inArray(
            hostDaemonCommandAttempts.id,
            expiredCommands.map((attempt) => attempt.attemptId),
          ),
        )
        .run();
    }

    return {
      requeued: firstExpiredAttempts.length,
      expiredCommands,
    };
  });
}

/**
 * Temporary compatibility scan for rows terminalized by pre-unification sweep
 * code before command owner side effects ran. Remove after deployed instances
 * have had at least one durable-command retention window to drain this backlog.
 */
export function listLegacyTerminalizedExpiredLifecycleCommandsNeedingSettlement(
  db: DbConnection,
  args: ListLegacyTerminalizedExpiredLifecycleCommandsNeedingSettlementArgs,
): string[] {
  if (args.limit <= 0) {
    return [];
  }

  const activeStates = [...activeLifecycleOperationStates];
  const environmentCommandIds = db
    .select({ id: hostDaemonCommands.id })
    .from(hostDaemonCommands)
    .innerJoin(
      environmentOperations,
      eq(environmentOperations.commandId, hostDaemonCommands.id),
    )
    .where(
      and(
        inArray(hostDaemonCommands.type, [
          ...LEGACY_TERMINALIZED_EXPIRED_ENVIRONMENT_LIFECYCLE_COMMAND_TYPES,
        ]),
        eq(hostDaemonCommands.state, "error"),
        isNotNull(hostDaemonCommands.completedAt),
        eq(
          hostDaemonCommands.resultPayload,
          LEGACY_TERMINALIZED_EXPIRED_COMMAND_RESULT_PAYLOAD,
        ),
        or(
          and(
            eq(hostDaemonCommands.type, "environment.destroy"),
            eq(environmentOperations.kind, "destroy"),
          ),
          and(
            eq(hostDaemonCommands.type, "environment.provision"),
            inArray(environmentOperations.kind, ["provision", "reprovision"]),
          ),
        ),
        inArray(environmentOperations.state, activeStates),
      ),
    )
    .orderBy(asc(hostDaemonCommands.completedAt), asc(hostDaemonCommands.id))
    .limit(args.limit)
    .all()
    .map((row) => row.id);

  const remainingThreadLimit = args.limit - environmentCommandIds.length;
  if (remainingThreadLimit <= 0) {
    return environmentCommandIds;
  }

  const threadCommandIds = db
    .select({ id: hostDaemonCommands.id })
    .from(hostDaemonCommands)
    .innerJoin(
      threadOperations,
      eq(threadOperations.commandId, hostDaemonCommands.id),
    )
    .where(
      and(
        inArray(hostDaemonCommands.type, [
          ...LEGACY_TERMINALIZED_EXPIRED_THREAD_LIFECYCLE_COMMAND_TYPES,
        ]),
        eq(hostDaemonCommands.state, "error"),
        isNotNull(hostDaemonCommands.completedAt),
        eq(
          hostDaemonCommands.resultPayload,
          LEGACY_TERMINALIZED_EXPIRED_COMMAND_RESULT_PAYLOAD,
        ),
        or(
          and(
            eq(hostDaemonCommands.type, "thread.start"),
            eq(threadOperations.kind, "start"),
          ),
          and(
            eq(hostDaemonCommands.type, "thread.stop"),
            eq(threadOperations.kind, "stop"),
          ),
        ),
        inArray(threadOperations.state, activeStates),
      ),
    )
    .orderBy(asc(hostDaemonCommands.completedAt), asc(hostDaemonCommands.id))
    .limit(remainingThreadLimit)
    .all()
    .map((row) => row.id);

  const remainingInteractionLimit =
    args.limit - environmentCommandIds.length - threadCommandIds.length;
  if (remainingInteractionLimit <= 0) {
    return [...environmentCommandIds, ...threadCommandIds];
  }

  const interactionCommandIds = db
    .select({ id: hostDaemonCommands.id })
    .from(hostDaemonCommands)
    .innerJoin(
      pendingInteractions,
      eq(pendingInteractions.resolvingCommandId, hostDaemonCommands.id),
    )
    .where(
      and(
        inArray(hostDaemonCommands.type, [
          ...LEGACY_TERMINALIZED_EXPIRED_INTERACTION_LIFECYCLE_COMMAND_TYPES,
        ]),
        eq(hostDaemonCommands.state, "error"),
        isNotNull(hostDaemonCommands.completedAt),
        eq(
          hostDaemonCommands.resultPayload,
          LEGACY_TERMINALIZED_EXPIRED_COMMAND_RESULT_PAYLOAD,
        ),
        eq(pendingInteractions.status, "resolving"),
      ),
    )
    .orderBy(asc(hostDaemonCommands.completedAt), asc(hostDaemonCommands.id))
    .limit(remainingInteractionLimit)
    .all()
    .map((row) => row.id);

  return [
    ...environmentCommandIds,
    ...threadCommandIds,
    ...interactionCommandIds,
  ];
}

/**
 * Sweep expired leases: sessions past lease timeout.
 * - Close the session (status="closed", closeReason="expired")
 * - Notify host availability changed
 *
 * Returns the closed sessions and hosts so the server can notify runtime
 * display state and close any still-registered sockets.
 */
export function sweepExpiredLeases(
  db: DbConnection,
  notifier: DbNotifier,
  now?: number,
): SweepExpiredLeasesResult {
  const currentTime = now ?? Date.now();

  // Find active sessions past their lease
  const expiredSessions = db
    .select()
    .from(hostDaemonSessions)
    .where(
      and(
        eq(hostDaemonSessions.status, "active"),
        lt(hostDaemonSessions.leaseExpiresAt, currentTime),
      ),
    )
    .all();

  if (expiredSessions.length === 0) {
    return {
      expiredHostIds: [],
      expiredSessionIds: [],
      sessionsClosed: 0,
    };
  }

  db.update(hostDaemonSessions)
    .set({
      status: "closed",
      closedAt: currentTime,
      closeReason: "expired",
      updatedAt: currentTime,
    })
    .where(
      inArray(
        hostDaemonSessions.id,
        expiredSessions.map((session) => session.id),
      ),
    )
    .run();

  for (const session of expiredSessions) {
    notifier.notifyHost(session.hostId, ["host-disconnected"]);
  }

  const expiredHostIds = [
    ...new Set(expiredSessions.map((session) => session.hostId)),
  ];

  return {
    expiredHostIds,
    expiredSessionIds: expiredSessions.map((session) => session.id),
    sessionsClosed: expiredSessions.length,
  };
}

/**
 * Sweep managed environments with recorded cleanup intent and zero
 * non-archived threads.
 * Returns the list of environment records that are candidates for cleanup.
 * The caller decides what to do (e.g., queue destroy commands).
 */
export function sweepManagedEnvironments(db: DbConnection) {
  const rows = db
    .select()
    .from(environments)
    .where(
      and(
        eq(environments.managed, true),
        sql`${environments.cleanupRequestedAt} IS NOT NULL`,
        ne(environments.status, "destroyed"),
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

export function sweepDestroyingEnvironments(
  db: DbConnection,
  notifier: DbNotifier,
  now?: number,
) {
  const currentTime = now ?? Date.now();
  const staleEnvironmentIds = db
    .select({ id: environments.id })
    .from(environments)
    .where(
      and(
        or(
          eq(environments.status, "destroying"),
          eq(environments.status, "destroyed"),
        ),
        lt(environments.updatedAt, currentTime - DESTROYING_ENVIRONMENT_TTL_MS),
      ),
    )
    .all()
    .map((environment) => environment.id);

  if (staleEnvironmentIds.length === 0) {
    return { deleted: 0 };
  }

  db.delete(environments)
    .where(inArray(environments.id, staleEnvironmentIds))
    .run();
  for (const environmentId of staleEnvironmentIds) {
    notifier.notifyEnvironment(environmentId, ["environment-deleted"]);
  }

  return {
    deleted: staleEnvironmentIds.length,
  };
}
