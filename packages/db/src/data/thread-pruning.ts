import {
  emptyArchivePruningProbe,
  pruneArchiveCandidates,
} from "./archive-pruning-probes.js";
import type { ThreadEventType } from "@bb/domain";
import { pruneRateLimitSnapshotWindow } from "./rate-limit-pruning.js";
import { eq, gt, inArray, sql } from "drizzle-orm";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import { events, threadPruningCursors, threads } from "../schema.js";
import { preserveEventBookmark } from "./event-bookmarks.js";
import { bumpThreadEventRewriteGeneration } from "./event-rewrite-generation.js";
import {
  getHighWaterMarks,
  pruneContextWindowUsageEventsBeforeSequenceInTransaction,
  pruneThreadEventsBeforeSequenceInTransaction,
  pruneTokenUsageEventsBeforeSequenceInTransaction,
} from "./events.js";

export const THREAD_PRUNING_POLICIES = [
  "rate-limits",
  "archive",
  "turn-diffs",
] as const;
export type ThreadPruningPolicy = (typeof THREAD_PRUNING_POLICIES)[number];
const VERSION_BY_POLICY: Record<ThreadPruningPolicy, number> = {
  "rate-limits": 1,
  archive: 1,
  "turn-diffs": 1,
};
const BATCH_SIZE = 500;

export function getNextThreadPruningPolicy(
  db: DbConnection,
  excluded: ReadonlySet<string>,
): ThreadPruningPolicy | null {
  const rows = db
    .select({
      policy: threadPruningCursors.policy,
      updatedAt: threadPruningCursors.updatedAt,
    })
    .from(threadPruningCursors)
    .where(inArray(threadPruningCursors.policy, [...THREAD_PRUNING_POLICIES]))
    .all();
  const updated = new Map(rows.map((row) => [row.policy, row.updatedAt]));
  return (
    THREAD_PRUNING_POLICIES.filter((policy) => !excluded.has(policy)).sort(
      (a, b) => (updated.get(a) ?? 0) - (updated.get(b) ?? 0),
    )[0] ?? null
  );
}

function clearRateLimitKeepers(db: DbQueryConnection): number {
  return db.run(
    sql`DELETE FROM thread_pruning_rate_limit_keepers WHERE provider_id IN (SELECT provider_id FROM thread_pruning_rate_limit_keepers ORDER BY provider_id LIMIT 500)`,
  ).changes;
}

function advanceThreadPruningTransaction(
  db: DbConnection,
  policy: ThreadPruningPolicy,
) {
  const result = db.transaction(
    (tx) => {
      const latestAdvance = tx
        .select({ updatedAt: threadPruningCursors.updatedAt })
        .from(threadPruningCursors)
        .where(
          inArray(threadPruningCursors.policy, [...THREAD_PRUNING_POLICIES]),
        )
        .all();
      const now = Math.max(
        Date.now(),
        ...latestAdvance.map((row) => row.updatedAt + 1),
      );
      tx.insert(threadPruningCursors)
        .values({ policy, version: VERSION_BY_POLICY[policy], updatedAt: now })
        .onConflictDoNothing()
        .run();
      let cursor = tx
        .select()
        .from(threadPruningCursors)
        .where(eq(threadPruningCursors.policy, policy))
        .get();
      if (!cursor) throw new Error("Missing thread pruning cursor");
      if (cursor.version !== VERSION_BY_POLICY[policy]) {
        cursor = {
          policy,
          version: VERSION_BY_POLICY[policy],
          lastThreadId: "",
          currentThreadId: null,
          step: 0,
          sequence: 0,
          upperSequence: 0,
          cycle: 0,
          latestRootSequence: 0,
          latestContextSequence: 0,
          ...emptyArchivePruningProbe(),
          updatedAt: now,
        };
      }
      let action:
        | "advanced"
        | "cycle-complete"
        | "thread-complete"
        | "unarchived"
        | "missing-thread" = "advanced";
      let removed = 0;
      let scanned = 0;
      let removedBytes = 0;
      let bookkeepingRemoved = 0;
      if (cursor.currentThreadId === null) {
        const next = tx
          .select({ id: threads.id })
          .from(threads)
          .where(gt(threads.id, cursor.lastThreadId))
          .orderBy(threads.id)
          .limit(1)
          .get();
        if (!next) {
          if (policy === "rate-limits")
            bookkeepingRemoved = clearRateLimitKeepers(tx);
          if (bookkeepingRemoved === 0) {
            cursor.lastThreadId = "";
            cursor.cycle += 1;
            action = "cycle-complete";
          }
        } else {
          cursor.currentThreadId = next.id;
          cursor.upperSequence = getHighWaterMarks(tx, [next.id])[next.id] ?? 0;
          cursor.sequence = 0;
          cursor.step = 0;
          cursor.latestRootSequence = 0;
          cursor.latestContextSequence = 0;
          Object.assign(cursor, emptyArchivePruningProbe());
        }
      }
      const threadId = cursor.currentThreadId;
      if (threadId !== null) {
        const thread = tx
          .select({ archivedAt: threads.archivedAt })
          .from(threads)
          .where(eq(threads.id, threadId))
          .get();
        if (!thread) {
          if (policy === "rate-limits")
            bookkeepingRemoved = clearRateLimitKeepers(tx);
          if (bookkeepingRemoved === 0) action = "missing-thread";
        } else if (policy === "archive" && thread.archivedAt === null)
          action = "unarchived";
        else if (policy === "rate-limits") {
          if (cursor.step === 0 || cursor.step === 2) {
            const cleaned = clearRateLimitKeepers(tx);
            bookkeepingRemoved = cleaned;
            if (cleaned === 0) {
              if (cursor.step === 2) action = "thread-complete";
              else {
                cursor.step = 1;
                cursor.sequence = cursor.upperSequence + 1;
              }
            }
          } else {
            const batch = pruneRateLimitSnapshotWindow(tx, {
              threadId,
              afterSequence: 0,
              throughSequence: cursor.sequence - 1,
              durable: true,
            });
            scanned = batch.scanned;
            removed = batch.removed;
            removedBytes = batch.removedBytes;
            cursor.sequence = batch.nextSequence;
            if (scanned < BATCH_SIZE) cursor.step = 2;
          }
        } else {
          const types: readonly ThreadEventType[] =
            policy === "turn-diffs" || cursor.step === 4
              ? ["turn/diff/updated"]
              : cursor.step <= 1
                ? ["thread/contextWindowUsage/updated"]
                : cursor.step <= 3
                  ? ["thread/tokenUsage/updated"]
                  : cursor.step === 6
                    ? ["item/backgroundTask/progress"]
                    : [
                        "item/agentMessage/delta",
                        "item/commandExecution/outputDelta",
                        "item/reasoning/summaryTextDelta",
                        "item/reasoning/textDelta",
                      ];
          const rows = tx.all<
            Pick<
              typeof events.$inferSelect,
              | "id"
              | "type"
              | "turnId"
              | "itemId"
              | "parentToolCallId"
              | "sequence"
              | "providerThreadId"
            >
          >(sql`
            SELECT id, type, turn_id AS turnId, item_id AS itemId, parent_tool_call_id AS parentToolCallId, sequence, provider_thread_id AS providerThreadId
            FROM events INDEXED BY ${sql.raw(types.length === 1 ? "events_thread_type_sequence_idx" : "events_thread_sequence_idx")}
            WHERE thread_id = ${threadId} AND sequence > ${cursor.sequence} AND sequence <= ${cursor.upperSequence}
              ${types.length === 1 ? sql`AND type = ${types[0]!}` : sql``}
            ORDER BY sequence LIMIT ${BATCH_SIZE}
          `);
          scanned = rows.length;
          const last = rows.at(-1);
          let windowComplete = true;
          let throughSequence = last?.sequence ?? cursor.sequence;
          if (last) {
            const window = {
              threadId,
              afterSequence: cursor.sequence,
              throughSequence: last.sequence,
              candidateIds: rows.map((row) => row.id),
            };
            const relevantIds = rows
              .filter((row) => types.includes(row.type))
              .map((row) => row.id);
            const bytesQuery = sql`SELECT COALESCE(SUM(length(CAST(data AS BLOB))), 0) AS bytes FROM events WHERE ${inArray(events.id, relevantIds)} AND ${inArray(events.type, [...types])}`;
            const before =
              relevantIds.length === 0
                ? 0
                : (tx.get<{ bytes: number }>(bytesQuery)?.bytes ?? 0);
            if (policy === "turn-diffs") {
              for (const row of rows)
                preserveEventBookmark(tx, { threadId, ...row });
              removed = tx
                .delete(events)
                .where(
                  inArray(
                    events.id,
                    rows.map((row) => row.id),
                  ),
                )
                .run().changes;
            } else {
              const args = {
                ...window,
                sequenceCutoff: Math.max(0, cursor.upperSequence - 120),
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
                    if (row.hasContext)
                      cursor.latestContextSequence = row.sequence;
                  }
                  break;
                }
                case 1:
                  removed =
                    pruneContextWindowUsageEventsBeforeSequenceInTransaction(
                      tx,
                      args,
                    );
                  break;
                case 3:
                  removed = pruneTokenUsageEventsBeforeSequenceInTransaction(
                    tx,
                    args,
                  );
                  break;
                case 4:
                  removed = pruneThreadEventsBeforeSequenceInTransaction(tx, {
                    ...args,
                    types: ["turn/diff/updated"],
                  });
                  break;
                case 5:
                case 6: {
                  const batch = pruneArchiveCandidates(tx, {
                    threadId,
                    candidates: rows,
                    kind: cursor.step === 5 ? "deltas" : "background",
                    probe: cursor,
                  });
                  removed = batch.removed;
                  windowComplete = batch.complete;
                  throughSequence = batch.sequence || cursor.sequence;
                  break;
                }
                default:
                  throw new Error("Invalid archive pruning step");
              }
            }
            if (removed > 0) {
              preserveEventBookmark(tx, {
                threadId,
                sequence: cursor.upperSequence,
                providerThreadId: null,
              });
              const provider = [...rows]
                .reverse()
                .find((row) => row.providerThreadId !== null);
              if (provider)
                preserveEventBookmark(tx, {
                  threadId,
                  sequence: provider.sequence,
                  providerThreadId: provider.providerThreadId,
                });
              const after = tx.get<{ bytes: number }>(bytesQuery)?.bytes ?? 0;
              removedBytes = before - after;
            }
            cursor.sequence = throughSequence;
          }
          if (
            windowComplete &&
            (rows.length < BATCH_SIZE ||
              cursor.sequence >= cursor.upperSequence)
          ) {
            if (policy === "archive" && cursor.step < 6) {
              cursor.step += 1;
              cursor.sequence = 0;
              Object.assign(cursor, emptyArchivePruningProbe());
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
          Object.assign(cursor, emptyArchivePruningProbe());
          cursor.sequence = 0;
          cursor.step = 0;
        }
      }
      cursor.updatedAt = now;
      tx.update(threadPruningCursors)
        .set(cursor)
        .where(eq(threadPruningCursors.policy, policy))
        .run();
      return {
        policy,
        action,
        threadId,
        scanned,
        removed,
        removedBytes,
        bookkeepingRemoved,
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
  policy: ThreadPruningPolicy,
) {
  const timeout: unknown = db.$client.pragma("busy_timeout", { simple: true });
  if (typeof timeout !== "number")
    throw new Error("Invalid SQLite busy timeout");
  db.$client.pragma("busy_timeout = 0");
  try {
    return advanceThreadPruningTransaction(db, policy);
  } finally {
    db.$client.pragma(`busy_timeout = ${timeout}`);
  }
}
