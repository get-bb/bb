import { advanceCompletedItemCompaction } from "./completed-item-compaction.js";
import { isBeforeLatestThreadEvent } from "./event-pruning-guards.js";
import {
  advanceLiveEventPruning,
  emptyResolvedItemPruningProbe,
} from "./resolved-item-pruning.js";
import { pruneRateLimitSnapshotWindow } from "./rate-limit-pruning.js";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { events, threadPruningCursors, threads } from "../schema.js";
import { bumpThreadEventRewriteGeneration } from "./event-rewrite-generation.js";
import {
  getHighWaterMarks,
  pruneContextWindowUsageEventsInTransaction,
  pruneTokenUsageEventsInTransaction,
} from "./events.js";

export const THREAD_PRUNING_POLICIES = [
  "rate-limits",
  "usage",
  "turn-diffs",
  "resolved-items",
  "completed-items",
] as const;
export type ThreadPruningPolicy = (typeof THREAD_PRUNING_POLICIES)[number];
const VERSION_BY_POLICY: Record<ThreadPruningPolicy, number> = {
  "rate-limits": 1,
  usage: 1,
  "turn-diffs": 1,
  "resolved-items": 1,
  "completed-items": 1,
};
const BATCH_SIZE = 500;
const LIVE_BATCH_SIZE = 32;

export function getNextThreadPruningPolicy(
  db: DbConnection,
  excluded: ReadonlySet<string>,
  scope = "",
): ThreadPruningPolicy | null {
  const rows = db
    .select({
      policy: threadPruningCursors.policy,
      updatedAt: threadPruningCursors.updatedAt,
    })
    .from(threadPruningCursors)
    .where(
      and(
        eq(threadPruningCursors.scope, scope),
        inArray(threadPruningCursors.policy, [...THREAD_PRUNING_POLICIES]),
      ),
    )
    .all();
  const updated = new Map(rows.map((row) => [row.policy, row.updatedAt]));
  return (
    THREAD_PRUNING_POLICIES.filter(
      (policy) =>
        !excluded.has(policy) && (scope === "" || policy !== "completed-items"),
    ).sort((a, b) => (updated.get(a) ?? 0) - (updated.get(b) ?? 0))[0] ?? null
  );
}

function advanceThreadPruningTransaction(
  db: DbConnection,
  policy: ThreadPruningPolicy,
  threadScope?: string,
) {
  const scope = threadScope ?? "";
  const batchSize = threadScope === undefined ? BATCH_SIZE : LIVE_BATCH_SIZE;
  const result = db.transaction(
    (tx) => {
      const latestAdvance = tx
        .select({ updatedAt: threadPruningCursors.updatedAt })
        .from(threadPruningCursors)
        .where(
          and(
            eq(threadPruningCursors.scope, scope),
            inArray(threadPruningCursors.policy, [...THREAD_PRUNING_POLICIES]),
          ),
        )
        .all();
      const now = Math.max(
        Date.now(),
        ...latestAdvance.map((row) => row.updatedAt + 1),
      );
      tx.insert(threadPruningCursors)
        .values({
          policy,
          scope,
          threadId: threadScope ?? null,
          version: VERSION_BY_POLICY[policy],
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
      let cursor = tx
        .select()
        .from(threadPruningCursors)
        .where(
          and(
            eq(threadPruningCursors.policy, policy),
            eq(threadPruningCursors.scope, scope),
          ),
        )
        .get();
      if (!cursor) throw new Error("Missing thread pruning cursor");
      if (cursor.version !== VERSION_BY_POLICY[policy]) {
        cursor = {
          policy,
          scope,
          threadId: threadScope ?? null,
          version: VERSION_BY_POLICY[policy],
          lastThreadId: "",
          currentThreadId: null,
          step: 0,
          sequence: 0,
          upperSequence: 0,
          cycle: 0,
          latestRootSequence: 0,
          latestContextSequence: 0,
          ...emptyResolvedItemPruningProbe(),
          updatedAt: now,
        };
      }
      let action:
        | "advanced"
        | "cycle-complete"
        | "thread-complete"
        | "missing-thread" = "advanced";
      let removed = 0;
      let scanned = 0;
      let removedBytes = 0;
      if (cursor.currentThreadId === null) {
        const next = tx
          .select({ id: threads.id })
          .from(threads)
          .where(
            threadScope === undefined
              ? gt(threads.id, cursor.lastThreadId)
              : eq(threads.id, threadScope),
          )
          .orderBy(threads.id)
          .limit(1)
          .get();
        if (!next) {
          cursor.lastThreadId = "";
          cursor.cycle += 1;
          action = "cycle-complete";
        } else {
          cursor.currentThreadId = next.id;
          cursor.upperSequence = getHighWaterMarks(tx, [next.id])[next.id] ?? 0;
          cursor.sequence = 0;
          cursor.step = 0;
          cursor.latestRootSequence = 0;
          cursor.latestContextSequence = 0;
          Object.assign(cursor, emptyResolvedItemPruningProbe());
        }
      }
      const threadId = cursor.currentThreadId;
      if (threadId !== null) {
        const thread = tx
          .select({ id: threads.id })
          .from(threads)
          .where(eq(threads.id, threadId))
          .get();
        if (!thread) {
          action = "missing-thread";
        } else if (policy === "rate-limits") {
          const batch = pruneRateLimitSnapshotWindow(tx, {
            threadId,
            afterSequence: cursor.sequence,
            throughSequence: cursor.upperSequence,
            limit: threadScope === undefined ? 64 : LIVE_BATCH_SIZE,
          });
          scanned = batch.scanned;
          removed = batch.removed;
          cursor.sequence = batch.nextSequence;
          if (batch.complete || cursor.sequence >= cursor.upperSequence)
            action = "thread-complete";
        } else if (policy === "completed-items") {
          const batch = advanceCompletedItemCompaction(tx, {
            threadId,
            afterSequence: cursor.sequence,
            throughSequence: cursor.upperSequence,
            limit: batchSize,
          });
          scanned = batch.scanned;
          removed = batch.removed;
          removedBytes = batch.removedBytes;
          cursor.sequence = batch.nextSequence;
          if (batch.complete || cursor.sequence >= cursor.upperSequence)
            action = "thread-complete";
        } else if (policy === "resolved-items") {
          const batch = advanceLiveEventPruning(tx, {
            threadId,
            kind: cursor.step === 0 ? "deltas" : "background",
            limit: batchSize,
          });
          scanned = batch.scanned;
          removed = batch.removed;
          if (batch.complete) {
            if (cursor.step === 0) cursor.step = 1;
            else action = "thread-complete";
          }
        } else {
          const type =
            policy === "turn-diffs"
              ? "turn/diff/updated"
              : cursor.step <= 1
                ? "thread/contextWindowUsage/updated"
                : "thread/tokenUsage/updated";
          const rows = tx.all<{ id: string; sequence: number }>(sql`
            SELECT id, sequence FROM events INDEXED BY events_thread_type_sequence_idx
            WHERE thread_id = ${threadId} AND type = ${type}
              AND sequence > ${cursor.sequence} AND sequence <= ${cursor.upperSequence}
            ORDER BY sequence LIMIT ${batchSize}
          `);
          scanned = rows.length;
          const last = rows.at(-1);
          const throughSequence = last?.sequence ?? cursor.sequence;
          if (last) {
            const window = {
              threadId,
              afterSequence: cursor.sequence,
              throughSequence: last.sequence,
              candidateIds: rows.map((row) => row.id),
            };
            const relevantIds = rows.map((row) => row.id);
            const bytesQuery = sql`SELECT COALESCE(SUM(length(CAST(data AS BLOB))), 0) AS bytes FROM events WHERE ${inArray(events.id, relevantIds)} AND ${events.type} = ${type}`;
            const before =
              threadScope !== undefined || relevantIds.length === 0
                ? 0
                : (tx.get<{ bytes: number }>(bytesQuery)?.bytes ?? 0);
            if (policy === "turn-diffs") {
              removed = tx
                .delete(events)
                .where(
                  and(
                    inArray(
                      events.id,
                      rows.map((row) => row.id),
                    ),
                    isBeforeLatestThreadEvent(threadId),
                  ),
                )
                .run().changes;
            } else {
              const args = {
                ...window,
                usageKeepers: {
                  latestRootSequence: cursor.latestRootSequence,
                  latestContextSequence: cursor.latestContextSequence,
                },
              };
              switch (cursor.step) {
                case 0:
                case 2: {
                  const type =
                    cursor.step === 0
                      ? "thread/contextWindowUsage/updated"
                      : "thread/tokenUsage/updated";
                  const path =
                    cursor.step === 0
                      ? "$.contextWindowUsage.modelContextWindow"
                      : "$.tokenUsage.modelContextWindow";
                  const usage = tx.all<{
                    sequence: number;
                    hasContext: number;
                  }>(sql`
                  SELECT sequence, CASE WHEN json_valid(data) THEN json_extract(data, ${path}) IS NOT NULL ELSE 0 END AS hasContext FROM events candidate INDEXED BY events_thread_type_sequence_idx
                  WHERE thread_id = ${threadId} AND sequence > ${window.afterSequence} AND sequence <= ${window.throughSequence} AND type = ${type}
                  AND NOT EXISTS (SELECT 1 FROM events nested WHERE nested.thread_id = candidate.thread_id AND nested.turn_id = candidate.turn_id AND nested.type = 'turn/started' AND nested.parent_tool_call_id IS NOT NULL)
                  ORDER BY sequence
                `);
                  for (const row of usage) {
                    cursor.latestRootSequence = row.sequence;
                    if (cursor.step === 0 && row.hasContext)
                      cursor.latestContextSequence = row.sequence;
                  }
                  break;
                }
                case 1:
                  removed = pruneContextWindowUsageEventsInTransaction(
                    tx,
                    args,
                  );
                  break;
                case 3:
                  removed = pruneTokenUsageEventsInTransaction(tx, args);
                  break;
                default:
                  throw new Error("Invalid usage pruning step");
              }
            }
            if (removed > 0 && threadScope === undefined) {
              const after = tx.get<{ bytes: number }>(bytesQuery)?.bytes ?? 0;
              removedBytes = before - after;
            }
            cursor.sequence = throughSequence;
          }
          if (
            rows.length < batchSize ||
            cursor.sequence >= cursor.upperSequence
          ) {
            if (policy === "usage" && cursor.step < 3) {
              cursor.step += 1;
              cursor.sequence = 0;
              Object.assign(cursor, emptyResolvedItemPruningProbe());
              if (cursor.step === 2) {
                cursor.latestRootSequence = 0;
                cursor.latestContextSequence = 0;
              }
            } else action = "thread-complete";
          }
        }
        if (action !== "advanced") {
          cursor.lastThreadId = threadId;
          cursor.currentThreadId = null;
          Object.assign(cursor, emptyResolvedItemPruningProbe());
          cursor.sequence = 0;
          cursor.step = 0;
        }
      }
      cursor.updatedAt = now;
      tx.update(threadPruningCursors)
        .set(cursor)
        .where(
          and(
            eq(threadPruningCursors.policy, policy),
            eq(threadPruningCursors.scope, scope),
          ),
        )
        .run();
      return {
        policy,
        action,
        threadId,
        scanned,
        removed,
        removedBytes,
        cursor,
      };
    },
    { behavior: "immediate" },
  );
  if (result.removed > 0 && result.threadId !== null)
    bumpThreadEventRewriteGeneration(result.threadId);
  return result;
}

export function advanceThreadPruning(
  db: DbConnection,
  target: ThreadPruningPolicy | { threadId: string },
) {
  const timeout: unknown = db.$client.pragma("busy_timeout", { simple: true });
  if (typeof timeout !== "number")
    throw new Error("Invalid SQLite busy timeout");
  db.$client.pragma("busy_timeout = 0");
  try {
    const threadScope =
      typeof target === "string" ? undefined : target.threadId;
    const policy =
      typeof target === "string"
        ? target
        : getNextThreadPruningPolicy(db, new Set(), target.threadId);
    if (policy === null) throw new Error("Missing live pruning policy");
    return advanceThreadPruningTransaction(db, policy, threadScope);
  } finally {
    db.$client.pragma(`busy_timeout = ${timeout}`);
  }
}
