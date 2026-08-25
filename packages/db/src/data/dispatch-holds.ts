import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type {
  DispatchHoldHolder,
  DispatchHoldKind,
  DispatchHoldPayload,
  DispatchHoldReleaseKind,
} from "@bb/domain";
import type {
  DbConnection,
  DbQueryConnection,
  DbTransaction,
} from "../connection.js";
import { createDispatchHoldId } from "../ids.js";
import { queryInSqliteVariableBatches } from "./events.js";
import { dispatchHolds } from "../schema.js";

export type DispatchHoldRow = typeof dispatchHolds.$inferSelect;

export interface CreateDispatchHoldInput {
  kind: DispatchHoldKind;
  threadId: string;
  payload: DispatchHoldPayload;
  holder: DispatchHoldHolder;
  userReleasable: boolean;
  reason: string;
  /** Non-null makes the hold auto-release when the timer sweep reaches it. */
  resumeAt: number | null;
  /** JSON-encoded gate amendment applied on release. */
  amend: string | null;
  /** JSON-encoded before/after audit pair for amendments. */
  originalRequest: string | null;
  effectiveRequest: string | null;
  expectedReleaseAt: number | null;
  staleAfterMs: number | null;
}

export interface ListDispatchHoldsFilter {
  threadId?: string;
  holder?: DispatchHoldHolder;
  /** Omitted lists released holds too, which is what an audit view wants. */
  liveOnly?: boolean;
}

export interface UpdateDispatchHoldReportInput {
  id: string;
  reportedAt: number;
  /** Each field left `undefined` keeps its current value. */
  reason?: string;
  expectedReleaseAt?: number;
  staleAfterMs?: number;
}

export function createDispatchHold(
  db: DbConnection | DbTransaction,
  input: CreateDispatchHoldInput,
): DispatchHoldRow {
  const row: DispatchHoldRow = {
    id: createDispatchHoldId(),
    kind: input.kind,
    threadId: input.threadId,
    payload: JSON.stringify(input.payload),
    holder: input.holder,
    userReleasable: input.userReleasable,
    reason: input.reason,
    resumeAt: input.resumeAt,
    amend: input.amend,
    originalRequest: input.originalRequest,
    effectiveRequest: input.effectiveRequest,
    expectedReleaseAt: input.expectedReleaseAt,
    staleAfterMs: input.staleAfterMs,
    lastReportAt: null,
    createdAt: Date.now(),
    releasedAt: null,
    releaseKind: null,
  };
  db.insert(dispatchHolds).values(row).run();
  return row;
}

export function getDispatchHold(
  db: DbQueryConnection,
  id: string,
): DispatchHoldRow | undefined {
  return db
    .select()
    .from(dispatchHolds)
    .where(eq(dispatchHolds.id, id))
    .limit(1)
    .all()
    .at(0);
}

/**
 * Oldest first, matching the order holds are expected to dispatch in. Rows
 * created in the same millisecond have random ids, so the id breaks ties
 * consistently with `dispatch_holds_thread_live_idx`.
 */
export function listDispatchHolds(
  db: DbQueryConnection,
  filter: ListDispatchHoldsFilter = {},
): DispatchHoldRow[] {
  const conditions: SQL[] = [];
  if (filter.threadId !== undefined) {
    conditions.push(eq(dispatchHolds.threadId, filter.threadId));
  }
  if (filter.holder !== undefined) {
    conditions.push(eq(dispatchHolds.holder, filter.holder));
  }
  if (filter.liveOnly === true) {
    conditions.push(isNull(dispatchHolds.releasedAt));
  }
  const query = db.select().from(dispatchHolds);
  return (conditions.length === 0 ? query : query.where(and(...conditions)))
    .orderBy(asc(dispatchHolds.createdAt), asc(dispatchHolds.id))
    .all();
}

/**
 * Live hold counts for a batch of threads, for the list badge. Threads with no
 * live hold are absent rather than reported as zero, so the caller can default
 * without this query having to return a row per thread.
 */
export function listLiveDispatchHoldCountsByThreadIds(
  db: DbQueryConnection,
  args: { threadIds: readonly string[] },
): { threadId: string; liveHoldCount: number }[] {
  return queryInSqliteVariableBatches({
    dedupeKey: (threadId) => threadId,
    fixedVariableCount: 0,
    queryBatch: (threadIds) =>
      db
        .select({
          threadId: dispatchHolds.threadId,
          liveHoldCount: sql<number>`count(*)`,
        })
        .from(dispatchHolds)
        .where(
          and(
            isNull(dispatchHolds.releasedAt),
            inArray(dispatchHolds.threadId, [...threadIds]),
          ),
        )
        .groupBy(dispatchHolds.threadId)
        .all(),
    values: args.threadIds,
    variableCountPerValue: 1,
  });
}

/**
 * Live holds whose `resumeAt` has arrived, for the timer sweep. The boundary
 * is inclusive: a hold scheduled for exactly `nowMs` is due.
 */
export function listDueDispatchHolds(
  db: DbQueryConnection,
  nowMs: number,
): DispatchHoldRow[] {
  return db
    .select()
    .from(dispatchHolds)
    .where(
      and(
        isNull(dispatchHolds.releasedAt),
        isNotNull(dispatchHolds.resumeAt),
        lte(dispatchHolds.resumeAt, nowMs),
      ),
    )
    .orderBy(asc(dispatchHolds.resumeAt), asc(dispatchHolds.id))
    .all();
}

/**
 * Live holds whose owner has gone quiet: `staleAfterMs` has elapsed since the
 * last report, or since creation when the owner has never reported. Nothing is
 * auto-released — this only drives the "No update for N min" treatment.
 */
export function listStaleDispatchHolds(
  db: DbQueryConnection,
  nowMs: number,
): DispatchHoldRow[] {
  return db
    .select()
    .from(dispatchHolds)
    .where(
      and(
        isNull(dispatchHolds.releasedAt),
        isNotNull(dispatchHolds.staleAfterMs),
        lte(
          sql`COALESCE(${dispatchHolds.lastReportAt}, ${dispatchHolds.createdAt}) + ${dispatchHolds.staleAfterMs}`,
          nowMs,
        ),
      ),
    )
    .orderBy(asc(dispatchHolds.createdAt), asc(dispatchHolds.id))
    .all();
}

/**
 * Records a progress report from the hold's owner. Always stamps
 * `lastReportAt`, which is what stall detection reads, so a bare report is
 * still a heartbeat. Returns false when the hold is gone or already released:
 * a late report from a torn-down owner must not resurrect stall state.
 */
export function updateDispatchHoldReport(
  db: DbConnection,
  input: UpdateDispatchHoldReportInput,
): boolean {
  return (
    db
      .update(dispatchHolds)
      .set({
        lastReportAt: input.reportedAt,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        ...(input.expectedReleaseAt === undefined
          ? {}
          : { expectedReleaseAt: input.expectedReleaseAt }),
        ...(input.staleAfterMs === undefined
          ? {}
          : { staleAfterMs: input.staleAfterMs }),
      })
      .where(
        and(
          eq(dispatchHolds.id, input.id),
          isNull(dispatchHolds.releasedAt),
        ),
      )
      .run().changes > 0
  );
}

/**
 * Edits the dispatch a live hold will run — the composer editing a held turn's
 * inline input. Refused once the hold is released: by then the payload has
 * already been dispatched (or discarded), so an edit would either be silently
 * lost or rewrite history.
 */
export function updateDispatchHoldPayload(
  db: DbConnection,
  args: { id: string; payload: DispatchHoldPayload },
): boolean {
  return (
    db
      .update(dispatchHolds)
      .set({ payload: JSON.stringify(args.payload) })
      .where(
        and(eq(dispatchHolds.id, args.id), isNull(dispatchHolds.releasedAt)),
      )
      .run().changes > 0
  );
}

/**
 * Reschedules a live hold's timer — "Send later" moved to a different time.
 * Refused once released for the same reason a payload edit is: the dispatch
 * has already happened, so a new `resumeAt` could never fire.
 */
export function updateDispatchHoldResumeAt(
  db: DbConnection,
  args: { id: string; resumeAt: number },
): boolean {
  return (
    db
      .update(dispatchHolds)
      .set({ resumeAt: args.resumeAt })
      .where(
        and(eq(dispatchHolds.id, args.id), isNull(dispatchHolds.releasedAt)),
      )
      .run().changes > 0
  );
}

/**
 * Compare-and-set release: succeeds only while `releasedAt` is still null, so
 * a timer firing at the same moment the user hits "Release now" produces one
 * dispatch, not two. The caller that gets `true` owns the release.
 */
export function releaseDispatchHold(
  db: DbConnection,
  args: { id: string; releaseKind: DispatchHoldReleaseKind; releasedAt: number },
): boolean {
  return (
    db
      .update(dispatchHolds)
      .set({ releasedAt: args.releasedAt, releaseKind: args.releaseKind })
      .where(
        and(eq(dispatchHolds.id, args.id), isNull(dispatchHolds.releasedAt)),
      )
      .run().changes > 0
  );
}
