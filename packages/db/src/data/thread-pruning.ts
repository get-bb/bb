import { performance } from "node:perf_hooks";
import { THREAD_PRUNING_PENDING_POLICY } from "./thread-pruning-work.js";
import { isBeforeLatestThreadEvent } from "./event-pruning-guards.js";
import {
  advanceLiveEventPruning,
  emptyResolvedItemPruningProbe,
} from "./resolved-item-pruning.js";
import { pruneRateLimitSnapshotWindow } from "./rate-limit-pruning.js";
import { and, eq, gt, gte, inArray, lt, notInArray, sql, type SQLWrapper } from "drizzle-orm";
import type { ThreadEventType } from "@bb/domain";
import type { DbConnection, DbQueryConnection, DbTransaction } from "../connection.js";
import {
  events,
  pendingInteractions,
  threadPruningCursors,
  threadPruningWork,
  threads,
} from "../schema.js";
import {
  ACTIVE_PENDING_INTERACTION_STATUSES,
  ACTIVE_THREAD_STATUSES,
} from "./maintenance.js";
import { bumpThreadEventRewriteGeneration } from "./event-rewrite-generation.js";
import {
  getHighWaterMarks,
  getContextWindowUsagePruningBoundarySequence,
  pruneContextWindowUsageEventsInTransaction,
  pruneTokenUsageEventsInTransaction,
} from "./events.js";

export const THREAD_PRUNING_POLICIES = [
  "rate-limits",
  "usage",
  "turn-diffs",
  "resolved-items",
] as const;
export type ThreadPruningPolicy = (typeof THREAD_PRUNING_POLICIES)[number];
const VERSION_BY_POLICY: Record<ThreadPruningPolicy, number> = {
  "rate-limits": 1,
  usage: 1,
  "turn-diffs": 1,
  "resolved-items": 1,
};
export const PRUNABLE_THREAD_EVENT_TYPES = [
  "provider/rateLimits/updated",
  "thread/tokenUsage/updated",
  "thread/contextWindowUsage/updated",
  "turn/diff/updated",
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/backgroundTask/progress",
] as const satisfies readonly ThreadEventType[];
const TIMELINE_PRESERVING_POLICIES: ReadonlySet<ThreadPruningPolicy> = new Set([
  "usage",
  "turn-diffs",
]);
const BATCH_SIZE = 500;
const LIVE_BATCH_SIZE = 32;
const CHUNK_SIZE = 16;
export const THREAD_PRUNING_ADVANCE_WORK_BUDGET_MS = 20;

function isSettledThread(threadId: SQLWrapper | string) {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${threads} WHERE ${threads.id} = ${threadId}
      AND ${inArray(threads.status, [...ACTIVE_THREAD_STATUSES])}
  ) AND NOT EXISTS (
    SELECT 1 FROM ${pendingInteractions} WHERE ${pendingInteractions.threadId} = ${threadId}
      AND ${inArray(pendingInteractions.status, [...ACTIVE_PENDING_INTERACTION_STATUSES])}
  )`;
}

function hasSettledWork(db: DbQueryConnection, policy: string): boolean {
  return (
    db
      .select({ threadId: threadPruningWork.threadId })
      .from(threadPruningWork)
      .where(
        and(
          eq(threadPruningWork.policy, policy),
          isSettledThread(threadPruningWork.threadId),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

function drainPendingThreadPruningWork(
  db: DbQueryConnection,
  threadId?: string,
): void {
  const pending = db
    .select({ threadId: threadPruningWork.threadId })
    .from(threadPruningWork)
    .where(
      and(
        eq(threadPruningWork.policy, THREAD_PRUNING_PENDING_POLICY),
        threadId === undefined
          ? undefined
          : eq(threadPruningWork.threadId, threadId),
      ),
    )
    .orderBy(threadPruningWork.threadId)
    .limit(32)
    .all();
  for (const { threadId } of pending) {
    db.run(sql`INSERT INTO thread_pruning_work (policy, thread_id)
      VALUES ${sql.join(
        THREAD_PRUNING_POLICIES.map((policy) => sql`(${policy}, ${threadId})`),
        sql`, `,
      )}
      ON CONFLICT (policy, thread_id) DO UPDATE SET revision = revision + 1`);
    db.run(sql`DELETE FROM thread_pruning_work
      WHERE policy = ${THREAD_PRUNING_PENDING_POLICY} AND thread_id = ${threadId}`);
  }
}

function enqueueEveryThread(db: DbQueryConnection, policy: ThreadPruningPolicy) {
  db.run(sql`INSERT INTO thread_pruning_work (policy, thread_id)
    SELECT ${policy}, id FROM threads WHERE true
    ON CONFLICT (policy, thread_id) DO NOTHING`);
}

export function getNextThreadPruningPolicy(
  db: DbConnection,
  excluded: ReadonlySet<string>,
  scope = "",
): ThreadPruningPolicy | null {
  const rows = db
    .select({
      policy: threadPruningCursors.policy,
      version: threadPruningCursors.version,
      currentThreadId: threadPruningCursors.currentThreadId,
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
  const cursorByPolicy = new Map(rows.map((row) => [row.policy, row]));
  const hasIncoming =
    scope === "" && hasSettledWork(db, THREAD_PRUNING_PENDING_POLICY);
  const pending =
    scope === ""
      ? new Set(
          THREAD_PRUNING_POLICIES.filter((policy) => {
            const cursor = cursorByPolicy.get(policy);
            return (
              cursor === undefined ||
              cursor.version !== VERSION_BY_POLICY[policy] ||
              cursor.currentThreadId !== null ||
              hasIncoming ||
              hasSettledWork(db, policy)
            );
          }),
        )
      : new Set(THREAD_PRUNING_POLICIES);
  const updated = new Map(rows.map((row) => [row.policy, row.updatedAt]));
  return (
    THREAD_PRUNING_POLICIES.filter(
      (policy) => !excluded.has(policy) && pending.has(policy),
    ).sort((a, b) => (updated.get(a) ?? 0) - (updated.get(b) ?? 0))[0] ?? null
  );
}

function prepareThreadPruningCursor(
  tx: DbTransaction,
  policy: ThreadPruningPolicy,
  threadScope: string | undefined,
) {
  const scope = threadScope ?? "";
  drainPendingThreadPruningWork(tx, threadScope);
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
  const created =
    tx
      .insert(threadPruningCursors)
      .values({
        policy,
        scope,
        threadId: threadScope ?? null,
        version: VERSION_BY_POLICY[policy],
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run().changes > 0;
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
  const stale = cursor.version !== VERSION_BY_POLICY[policy];
  if (threadScope === undefined && (created || stale))
    enqueueEveryThread(tx, policy);
  if (stale) {
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
      workRevision: 0,
      cycle: 0,
      latestRootSequence: 0,
      latestContextSequence: 0,
      ...emptyResolvedItemPruningProbe(),
      updatedAt: now,
    };
  }
  return { cursor, now };
}

type ThreadPruningCursorRow = typeof threadPruningCursors.$inferSelect;

function pickNextPruningThread(
  tx: DbTransaction,
  cursor: ThreadPruningCursorRow,
  policy: ThreadPruningPolicy,
  threadScope: string | undefined,
  excludedThreadIds: ReadonlySet<string>,
): boolean {
  const notExcluded =
    excludedThreadIds.size === 0
      ? undefined
      : notInArray(threadPruningWork.threadId, [...excludedThreadIds]);
  let next =
    threadScope === undefined
      ? tx
          .select({
            id: threadPruningWork.threadId,
            revision: threadPruningWork.revision,
          })
          .from(threadPruningWork)
          .where(
            and(
              eq(threadPruningWork.policy, policy),
              gt(threadPruningWork.threadId, cursor.lastThreadId),
              isSettledThread(threadPruningWork.threadId),
              notExcluded,
            ),
          )
          .orderBy(threadPruningWork.threadId)
          .limit(1)
          .get()
      : tx
          .select({ id: threads.id })
          .from(threads)
          .where(eq(threads.id, threadScope))
          .get();
  if (!next && threadScope === undefined && cursor.lastThreadId !== "") {
    next = tx
      .select({
        id: threadPruningWork.threadId,
        revision: threadPruningWork.revision,
      })
      .from(threadPruningWork)
      .where(
        and(
          eq(threadPruningWork.policy, policy),
          isSettledThread(threadPruningWork.threadId),
          notExcluded,
        ),
      )
      .orderBy(threadPruningWork.threadId)
      .limit(1)
      .get();
    if (next) {
      cursor.lastThreadId = "";
      cursor.cycle += 1;
    }
  }
  if (!next) {
    cursor.lastThreadId = "";
    cursor.cycle += 1;
    return false;
  }
  cursor.currentThreadId = next.id;
  cursor.workRevision =
    tx
      .select({ revision: threadPruningWork.revision })
      .from(threadPruningWork)
      .where(
        and(
          eq(threadPruningWork.threadId, next.id),
          eq(threadPruningWork.policy, policy),
        ),
      )
      .get()?.revision ?? 0;
  cursor.upperSequence = getHighWaterMarks(tx, [next.id])[next.id] ?? 0;
  cursor.sequence = 0;
  cursor.step = 0;
  cursor.latestRootSequence = 0;
  cursor.latestContextSequence = 0;
  Object.assign(cursor, emptyResolvedItemPruningProbe());
  return true;
}

export function pickThreadPruningThread(
  db: DbConnection,
  args: { excludedThreadIds: ReadonlySet<string>; policy: ThreadPruningPolicy },
): string | null {
  return advanceWithoutBusyWait(db, () => db.transaction(
    (tx) => {
      const { cursor, now } = prepareThreadPruningCursor(tx, args.policy, undefined);
      if (
        cursor.currentThreadId !== null &&
        args.excludedThreadIds.has(cursor.currentThreadId)
      ) {
        cursor.lastThreadId = cursor.currentThreadId;
        cursor.currentThreadId = null;
      }
      if (cursor.currentThreadId === null)
        pickNextPruningThread(tx, cursor, args.policy, undefined, args.excludedThreadIds);
      tx.update(threadPruningCursors)
        .set({ ...cursor, updatedAt: now })
        .where(
          and(
            eq(threadPruningCursors.policy, args.policy),
            eq(threadPruningCursors.scope, ""),
          ),
        )
        .run();
      return cursor.currentThreadId;
    },
    { behavior: "immediate" },
  ));
}

function advanceThreadPruningTransaction(
  db: DbConnection,
  policy: ThreadPruningPolicy,
  threadScope: string | undefined,
) {
  const scope = threadScope ?? "";
  const batchSize = threadScope === undefined ? BATCH_SIZE : LIVE_BATCH_SIZE;
  const result = db.transaction(
    (tx) => {
      const deadline = performance.now() + THREAD_PRUNING_ADVANCE_WORK_BUDGET_MS;
      const withinDeadline = () => performance.now() < deadline;
      const { cursor, now } = prepareThreadPruningCursor(tx, policy, threadScope);
      let action:
        | "advanced"
        | "cycle-complete"
        | "thread-complete"
        | "thread-busy"
        | "missing-thread" = "advanced";
      let removed = 0;
      let scanned = 0;
      let removedBytes = 0;
      if (
        cursor.currentThreadId === null &&
        !pickNextPruningThread(tx, cursor, policy, threadScope, new Set())
      )
        action = "cycle-complete";
      const threadId = cursor.currentThreadId;
      if (threadId !== null) {
        const thread = tx
          .select({
            settled:
              threadScope === undefined
                ? sql<number>`${isSettledThread(threadId)}`
                : sql<number>`1`,
          })
          .from(threads)
          .where(eq(threads.id, threadId))
          .get();
        if (!thread) {
          action = "missing-thread";
        } else if (!thread.settled) {
          action = "thread-busy";
        } else if (policy === "rate-limits") {
          const limit = threadScope === undefined ? 64 : LIVE_BATCH_SIZE;
          let complete = false;
          while (
            !complete &&
            scanned < limit &&
            cursor.sequence < cursor.upperSequence &&
            (scanned === 0 || withinDeadline())
          ) {
            const batch = pruneRateLimitSnapshotWindow(tx, {
              threadId,
              afterSequence: cursor.sequence,
              throughSequence: cursor.upperSequence,
              limit: Math.min(CHUNK_SIZE, limit - scanned),
            });
            scanned += batch.scanned;
            removed += batch.removed;
            cursor.sequence = batch.nextSequence;
            complete = batch.complete;
          }
          if (complete || cursor.sequence >= cursor.upperSequence)
            action = "thread-complete";
        } else if (policy === "resolved-items") {
          const batch = advanceLiveEventPruning(tx, {
            threadId,
            kind: cursor.step === 0 ? "deltas" : "background",
            limit: batchSize,
            deadline,
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
          const boundarySequence =
            policy === "usage" && cursor.step === 1
              ? getContextWindowUsagePruningBoundarySequence(tx, threadId)
              : 0;
          let exhausted = false;
          while (
            !exhausted &&
            scanned < batchSize &&
            (scanned === 0 || withinDeadline())
          ) {
            const chunkSize = Math.min(CHUNK_SIZE, batchSize - scanned);
            const chunk = tx.all<{ id: string; sequence: number }>(sql`
              SELECT id, sequence FROM events INDEXED BY events_thread_type_sequence_idx
              WHERE thread_id = ${threadId} AND type = ${type}
                AND sequence > ${cursor.sequence} AND sequence <= ${cursor.upperSequence}
              ORDER BY sequence LIMIT ${chunkSize}
            `);
            exhausted = chunk.length < chunkSize;
            const last = chunk.at(-1);
            if (!last) break;
            scanned += chunk.length;
            const window = {
              threadId,
              afterSequence: cursor.sequence,
              throughSequence: last.sequence,
              candidateIds: chunk.map((row) => row.id),
            };
            const relevantIds = chunk.map((row) => row.id);
            const bytesQuery = sql`SELECT COALESCE(SUM(octet_length(data)), 0) AS bytes FROM events WHERE ${inArray(events.id, relevantIds)} AND ${events.type} = ${type}`;
            const before =
              threadScope !== undefined ||
              (policy === "usage" && (cursor.step === 0 || cursor.step === 2))
                ? 0
                : (tx.get<{ bytes: number }>(bytesQuery)?.bytes ?? 0);
            let chunkRemoved = 0;
            if (policy === "turn-diffs") {
              chunkRemoved = tx
                .delete(events)
                .where(
                  and(
                    inArray(events.id, relevantIds),
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
                  boundarySequence,
                },
              };
              switch (cursor.step) {
                case 0:
                case 2: {
                  const type =
                    cursor.step === 0
                      ? "thread/contextWindowUsage/updated"
                      : "thread/tokenUsage/updated";
                  const hasContext =
                    cursor.step === 0
                      ? sql`CASE WHEN json_valid(data) THEN json_extract(data, '$.contextWindowUsage.modelContextWindow') IS NOT NULL ELSE 0 END`
                      : sql`0`;
                  const usage = tx.all<{
                    sequence: number;
                    hasContext: number;
                  }>(sql`
                  SELECT sequence, ${hasContext} AS hasContext FROM events candidate INDEXED BY events_thread_type_sequence_idx
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
                  chunkRemoved = pruneContextWindowUsageEventsInTransaction(
                    tx,
                    args,
                  );
                  break;
                case 3:
                  chunkRemoved = pruneTokenUsageEventsInTransaction(tx, args);
                  break;
                default:
                  throw new Error("Invalid usage pruning step");
              }
            }
            if (chunkRemoved > 0 && threadScope === undefined) {
              const after = tx.get<{ bytes: number }>(bytesQuery)?.bytes ?? 0;
              removedBytes += before - after;
            }
            removed += chunkRemoved;
            cursor.sequence = last.sequence;
          }
          if (exhausted || cursor.sequence >= cursor.upperSequence) {
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
          if (threadScope === undefined && action !== "thread-busy")
            tx.delete(threadPruningWork)
              .where(
                and(
                  eq(threadPruningWork.policy, policy),
                  eq(threadPruningWork.threadId, threadId),
                  sql`${threadPruningWork.revision} <= ${cursor.workRevision}`,
                ),
              )
              .run();
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
  if (
    result.removed > 0 &&
    result.threadId !== null &&
    !TIMELINE_PRESERVING_POLICIES.has(policy)
  )
    bumpThreadEventRewriteGeneration(result.threadId);
  return result;
}

export function findUnprunableThreadEventSequence(
  db: DbQueryConnection,
  args: { beforeSequence: number; sequenceStart: number; threadId: string },
): number | undefined {
  return db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        gte(events.sequence, args.sequenceStart),
        lt(events.sequence, args.beforeSequence),
        notInArray(events.type, [...PRUNABLE_THREAD_EVENT_TYPES]),
      ),
    )
    .orderBy(events.sequence)
    .limit(1)
    .get()?.sequence;
}

export function advanceThreadPruning(
  db: DbConnection,
  target: ThreadPruningPolicy | { threadId: string },
) {
  return advanceWithoutBusyWait(db, () => {
    const threadScope =
      typeof target === "string" ? undefined : target.threadId;
    const policy =
      typeof target === "string"
        ? target
        : getNextThreadPruningPolicy(db, new Set(), target.threadId);
    if (policy === null) throw new Error("Missing live pruning policy");
    return advanceThreadPruningTransaction(db, policy, threadScope);
  });
}

function advanceWithoutBusyWait<T>(db: DbConnection, advance: () => T): T {
  const timeout: unknown = db.$client.pragma("busy_timeout", { simple: true });
  if (typeof timeout !== "number")
    throw new Error("Invalid SQLite busy timeout");
  db.$client.pragma("busy_timeout = 0");
  try {
    return advance();
  } finally {
    db.$client.pragma(`busy_timeout = ${timeout}`);
  }
}

export function deleteThreadScopedPruningCursors(
  db: DbConnection,
  threadId: string,
): void {
  db.delete(threadPruningCursors)
    .where(eq(threadPruningCursors.scope, threadId))
    .run();
}
