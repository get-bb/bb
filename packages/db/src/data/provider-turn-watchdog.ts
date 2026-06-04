import { aliasedTable, and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";
import {
  providerTurnWatchdogActivityEventTypeSchema,
  providerTurnWatchdogActivityEventTypeValues,
  providerTurnWatchdogThreadScopedActivityEventTypeValues,
} from "@bb/domain";
import type { ProviderTurnWatchdogActivityEventType } from "@bb/domain";
import type { DbQueryConnection } from "../connection.js";
import { environments, events, pendingInteractions, threads } from "../schema.js";

export interface ListProviderTurnIdleWatchdogCandidatesArgs {
  idleThresholdMs: number;
  limit: number;
  now: number;
}

export interface ProviderTurnIdleWatchdogCandidateRow {
  activeTurnId: string;
  activeTurnStartedAt: number;
  elapsedMs: number;
  environmentId: string;
  hostId: string;
  lastActivityEventAt: number;
  lastActivityEventSequence: number;
  lastActivityEventType: ProviderTurnWatchdogActivityEventType;
  providerId: string;
  providerThreadId: string | null;
  threadId: string;
}

const activityEventTypeSqlList = sql.join(
  providerTurnWatchdogActivityEventTypeValues.map((eventType) =>
    sql`${eventType}`,
  ),
  sql`, `,
);

const threadScopedActivityEventTypeSqlList = sql.join(
  providerTurnWatchdogThreadScopedActivityEventTypeValues.map((eventType) =>
    sql`${eventType}`,
  ),
  sql`, `,
);

type LatestTurnStartedColumn = "created_at" | "turn_id";

/**
 * Correlated subquery selecting one column from the thread's latest
 * turn/started event (the active turn). Parameterized by column so
 * activeTurnId and activeTurnStartedAt are built from the same predicate and
 * can never describe two different turns.
 */
function latestTurnStartedSql(column: LatestTurnStartedColumn): SQL {
  return sql`(
    SELECT latest_started.${sql.raw(column)}
    FROM events AS latest_started
    WHERE latest_started.thread_id = ${threads.id}
      AND latest_started.type = 'turn/started'
      AND latest_started.turn_id IS NOT NULL
    ORDER BY latest_started.sequence DESC
    LIMIT 1
  )`;
}

interface ActivityAnchorShapeSqlArgs {
  activeTurnIdSql: SQL;
  turnIdColumn: AnyColumn;
  typeColumn: AnyColumn;
}

/**
 * The anchor-shape predicate: an event counts as provider activity when it is
 * scoped to the active turn and in the activity list, or persisted
 * thread-scoped (turn_id NULL) and in the thread-scoped activity list. Built
 * once for both the candidate-row WHERE arm and the MAX(sequence) guard —
 * the two occurrences must stay semantically identical or they describe
 * different event sets (the watchdog then either never fires for the thread
 * or anchors on the wrong row). Self-parenthesized: drizzle's and() joins raw
 * fragments without wrapping them, so a bare OR would misassociate.
 */
function activityAnchorShapeSql(args: ActivityAnchorShapeSqlArgs): SQL {
  return sql`(
    (${args.turnIdColumn} = ${args.activeTurnIdSql} AND ${args.typeColumn} IN (${activityEventTypeSqlList}))
    OR
    (${args.turnIdColumn} IS NULL AND ${args.typeColumn} IN (${threadScopedActivityEventTypeSqlList}))
  )`;
}

function parseNonEmptyString(value: string | null, fieldName: string): string {
  if (value === null || value.length === 0) {
    throw new Error(`Provider turn watchdog candidate missing ${fieldName}`);
  }
  return value;
}

function parseNonNegativeInteger(
  value: number | null,
  fieldName: string,
): number {
  if (value === null || !Number.isInteger(value) || value < 0) {
    throw new Error(`Provider turn watchdog candidate invalid ${fieldName}`);
  }
  return value;
}

function parsePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Provider turn watchdog candidate invalid ${fieldName}`);
  }
  return value;
}

function parseProviderTurnIdleWatchdogCandidateRow(
  row: Omit<
    ProviderTurnIdleWatchdogCandidateRow,
    "activeTurnId" | "activeTurnStartedAt" | "lastActivityEventType"
  > & {
    activeTurnId: string | null;
    activeTurnStartedAt: number | null;
    lastActivityEventType: string;
  },
): ProviderTurnIdleWatchdogCandidateRow {
  return {
    activeTurnId: parseNonEmptyString(row.activeTurnId, "activeTurnId"),
    activeTurnStartedAt: parseNonNegativeInteger(
      row.activeTurnStartedAt,
      "activeTurnStartedAt",
    ),
    elapsedMs: parseNonNegativeInteger(row.elapsedMs, "elapsedMs"),
    environmentId: row.environmentId,
    hostId: row.hostId,
    lastActivityEventAt: parseNonNegativeInteger(
      row.lastActivityEventAt,
      "lastActivityEventAt",
    ),
    lastActivityEventSequence: parsePositiveInteger(
      row.lastActivityEventSequence,
      "lastActivityEventSequence",
    ),
    lastActivityEventType: providerTurnWatchdogActivityEventTypeSchema.parse(
      row.lastActivityEventType,
    ),
    providerId: row.providerId,
    providerThreadId: row.providerThreadId,
    threadId: row.threadId,
  };
}

/**
 * Lists active threads whose latest provider activity is older than the idle
 * threshold. The anchor (the row this query returns) is the newest event that
 * is either scoped to the active turn — the thread's latest turn/started — or
 * a thread-scoped background task event (turn_id NULL by scope policy; see
 * providerTurnWatchdogThreadScopedActivityEventTypeValues). A streaming
 * workflow therefore holds the watchdog off, while a workflow that stops
 * reporting progress still trips it.
 *
 * Stale thread-scoped events from before the active turn can never become the
 * anchor: sequences are per-thread monotonic and the active turn's own
 * turn/started is itself an activity event, so it always outranks them.
 *
 * Known tradeoff: background task rows carry no turn linkage, so a streaming
 * task spawned by a previous turn (or an ambient task) also defers the
 * watchdog for the current turn. Accepted — a session demonstrably streaming
 * events is not hung, which is the question this watchdog answers.
 *
 * Every turn-correlated guard (turn/completed, pending interactions, turn
 * started-at) correlates on the active-turn subquery — not the anchor row's
 * turn_id, which is NULL for thread-scoped anchors. Threads whose status is
 * "active" but that have no turn/started yet (status flips when the turn
 * command is queued) are excluded explicitly; without that guard a
 * thread-scoped event could anchor a candidate whose NULL activeTurnId throws
 * in row parsing and aborts the entire sweep batch.
 */
export function listProviderTurnIdleWatchdogCandidates(
  db: DbQueryConnection,
  args: ListProviderTurnIdleWatchdogCandidatesArgs,
): ProviderTurnIdleWatchdogCandidateRow[] {
  const activeTurnIdSql = latestTurnStartedSql("turn_id");
  const activityEvents = aliasedTable(events, "activity");
  const rows = db
    .select({
      activeTurnId: sql<string | null>`${activeTurnIdSql}`,
      activeTurnStartedAt: sql<number | null>`${latestTurnStartedSql(
        "created_at",
      )}`,
      elapsedMs: sql<number>`${args.now} - ${events.createdAt}`,
      environmentId: environments.id,
      hostId: environments.hostId,
      lastActivityEventAt: events.createdAt,
      lastActivityEventSequence: events.sequence,
      lastActivityEventType: events.type,
      providerId: threads.providerId,
      providerThreadId: sql<string | null>`COALESCE(
        NULLIF(${events.providerThreadId}, ''),
        (
          SELECT latest_provider.provider_thread_id
          FROM events AS latest_provider
          WHERE latest_provider.thread_id = ${events.threadId}
            AND latest_provider.provider_thread_id IS NOT NULL
            AND latest_provider.provider_thread_id != ''
          ORDER BY latest_provider.sequence DESC
          LIMIT 1
        )
      )`,
      threadId: threads.id,
    })
    .from(events)
    .innerJoin(threads, eq(threads.id, events.threadId))
    .innerJoin(environments, eq(environments.id, threads.environmentId))
    .where(
      and(
        eq(threads.status, "active"),
        isNull(threads.deletedAt),
        isNull(threads.stopRequestedAt),
        isNotNull(threads.environmentId),
        sql`${activeTurnIdSql} IS NOT NULL`,
        activityAnchorShapeSql({
          activeTurnIdSql,
          turnIdColumn: events.turnId,
          typeColumn: events.type,
        }),
        sql`${events.sequence} = (
          SELECT MAX(${activityEvents.sequence})
          FROM events AS activity
          WHERE ${activityEvents.threadId} = ${events.threadId}
            AND ${activityAnchorShapeSql({
              activeTurnIdSql,
              turnIdColumn: activityEvents.turnId,
              typeColumn: activityEvents.type,
            })}
        )`,
        sql`NOT EXISTS (
          SELECT 1
          FROM events AS completed
          WHERE completed.thread_id = ${threads.id}
            AND completed.turn_id = ${activeTurnIdSql}
            AND completed.type = 'turn/completed'
        )`,
        sql`${args.now} - ${events.createdAt} >= ${args.idleThresholdMs}`,
        sql`NOT EXISTS (
          SELECT 1
          FROM ${pendingInteractions} AS active_interaction
          WHERE active_interaction.thread_id = ${threads.id}
            AND active_interaction.turn_id = ${activeTurnIdSql}
            AND active_interaction.status IN ('pending', 'resolving')
        )`,
      ),
    )
    .orderBy(asc(events.createdAt))
    .limit(args.limit)
    .all();

  return rows.map(parseProviderTurnIdleWatchdogCandidateRow);
}
