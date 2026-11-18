import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type {
  HeldTurnCompletionStatus,
  SystemThreadInterruptedReason,
  ThreadStatus,
  ThreadTurnRequestKind,
  ThreadTurnRequestPhase,
} from "@bb/domain";
import type { DbQueryConnection, DbTransaction } from "../connection.js";
import {
  environments,
  threadRunStates,
  threadTurnRequests,
  threads,
} from "../schema.js";

export interface ThreadTurnRequestState {
  hostId: string;
  kind: ThreadTurnRequestKind;
  phase: ThreadTurnRequestPhase;
  requestId: string;
  sentAt: number;
  syncTitle: boolean;
}

export interface HeldTurnCompletion {
  status: HeldTurnCompletionStatus;
  turnId: string;
}

export interface ThreadStopState {
  ackedAt: number | null;
  reason: SystemThreadInterruptedReason;
  requestedAt: number;
  sentAt: number | null;
}

export interface StoredThreadRunState {
  heldCompletion: HeldTurnCompletion | null;
  requests: ThreadTurnRequestState[];
  stop: ThreadStopState | null;
}

type ThreadRow = typeof threads.$inferSelect;

export function readThreadRunState(
  db: DbQueryConnection,
  threadId: string,
): StoredThreadRunState {
  const requests = db
    .select({
      hostId: threadTurnRequests.hostId,
      kind: threadTurnRequests.kind,
      phase: threadTurnRequests.phase,
      requestId: threadTurnRequests.requestId,
      sentAt: threadTurnRequests.sentAt,
      syncTitle: threadTurnRequests.syncTitle,
    })
    .from(threadTurnRequests)
    .where(eq(threadTurnRequests.threadId, threadId))
    .orderBy(asc(threadTurnRequests.sentAt), asc(threadTurnRequests.requestId))
    .all();
  const run =
    db
      .select()
      .from(threadRunStates)
      .where(eq(threadRunStates.threadId, threadId))
      .get() ?? null;
  return {
    heldCompletion:
      run?.heldTurnId != null && run.heldTurnStatus != null
        ? { status: run.heldTurnStatus, turnId: run.heldTurnId }
        : null,
    requests,
    stop:
      run?.stopReason != null && run.stopRequestedAt != null
        ? {
            ackedAt: run.stopAckedAt,
            reason: run.stopReason,
            requestedAt: run.stopRequestedAt,
            sentAt: run.stopSentAt,
          }
        : null,
  };
}

interface WriteThreadLifecycleStateArgs {
  expectedStatus: ThreadStatus;
  next: StoredThreadRunState & { status: ThreadStatus };
  previous: StoredThreadRunState;
  threadId: string;
}

export type WriteThreadLifecycleStateResult =
  | { kind: "conflict" }
  | { kind: "written"; statusChanged: boolean; thread: ThreadRow };

function statusChangeNeedsAttention(args: {
  from: ThreadStatus;
  parentThreadId: string | null;
  to: ThreadStatus;
}): boolean {
  if (args.from === "active" && args.to === "idle") {
    return args.parentThreadId === null;
  }
  if (args.to !== "error") {
    return false;
  }
  return args.from === "active" || args.from === "starting";
}

function sameRequests(
  a: readonly ThreadTurnRequestState[],
  b: readonly ThreadTurnRequestState[],
): boolean {
  return (
    a.length === b.length &&
    a.every((request, index) => {
      const other = b[index]!;
      return (
        request.requestId === other.requestId &&
        request.phase === other.phase &&
        request.kind === other.kind &&
        request.syncTitle === other.syncTitle
      );
    })
  );
}

function sameRunRow(a: StoredThreadRunState, b: StoredThreadRunState): boolean {
  return (
    a.heldCompletion?.turnId === b.heldCompletion?.turnId &&
    a.heldCompletion?.status === b.heldCompletion?.status &&
    a.stop?.reason === b.stop?.reason &&
    a.stop?.requestedAt === b.stop?.requestedAt &&
    a.stop?.sentAt === b.stop?.sentAt &&
    a.stop?.ackedAt === b.stop?.ackedAt
  );
}

export function writeThreadLifecycleStateInTransaction(
  tx: DbTransaction,
  args: WriteThreadLifecycleStateArgs,
): WriteThreadLifecycleStateResult {
  const now = Date.now();
  const current = tx
    .select()
    .from(threads)
    .where(eq(threads.id, args.threadId))
    .get();
  if (!current || current.status !== args.expectedStatus) {
    return { kind: "conflict" };
  }
  let thread: ThreadRow = current;
  const statusChanged = args.next.status !== current.status;
  if (statusChanged) {
    const set: Partial<typeof threads.$inferInsert> = {
      status: args.next.status,
      statusChangedAt: now,
      updatedAt: now,
    };
    if (args.next.status === "idle" && current.environmentId !== null) {
      set.startupContext = null;
    }
    if (
      statusChangeNeedsAttention({
        from: current.status,
        parentThreadId: current.parentThreadId,
        to: args.next.status,
      })
    ) {
      set.latestAttentionAt = now;
    }
    const updated = tx
      .update(threads)
      .set(set)
      .where(
        and(eq(threads.id, args.threadId), eq(threads.status, current.status)),
      )
      .returning()
      .get();
    if (!updated) {
      return { kind: "conflict" };
    }
    thread = updated;
  }
  if (!sameRequests(args.previous.requests, args.next.requests)) {
    tx.delete(threadTurnRequests)
      .where(eq(threadTurnRequests.threadId, args.threadId))
      .run();
    if (args.next.requests.length > 0) {
      tx.insert(threadTurnRequests)
        .values(
          args.next.requests.map((request) => ({
            ...request,
            threadId: args.threadId,
          })),
        )
        .run();
    }
  }
  if (!sameRunRow(args.previous, args.next)) {
    if (args.next.heldCompletion === null && args.next.stop === null) {
      tx.delete(threadRunStates)
        .where(eq(threadRunStates.threadId, args.threadId))
        .run();
    } else {
      const values = {
        heldTurnId: args.next.heldCompletion?.turnId ?? null,
        heldTurnStatus: args.next.heldCompletion?.status ?? null,
        stopReason: args.next.stop?.reason ?? null,
        stopRequestedAt: args.next.stop?.requestedAt ?? null,
        stopSentAt: args.next.stop?.sentAt ?? null,
        stopAckedAt: args.next.stop?.ackedAt ?? null,
        updatedAt: now,
      };
      tx.insert(threadRunStates)
        .values({ threadId: args.threadId, ...values })
        .onConflictDoUpdate({ target: threadRunStates.threadId, set: values })
        .run();
    }
  }
  return { kind: "written", statusChanged, thread };
}

export function hasThreadStartTurnRequest(
  db: DbQueryConnection,
  threadId: string,
): boolean {
  return (
    db
      .select({ requestId: threadTurnRequests.requestId })
      .from(threadTurnRequests)
      .where(
        and(
          eq(threadTurnRequests.threadId, threadId),
          eq(threadTurnRequests.kind, "thread-start"),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

export function listThreadIdsAwaitingTurnRequestAnswers(
  db: DbQueryConnection,
): string[] {
  const awaiting = db
    .selectDistinct({ threadId: threadTurnRequests.threadId })
    .from(threadTurnRequests)
    .where(inArray(threadTurnRequests.phase, ["sent", "accepted"]))
    .all()
    .map((row) => row.threadId);
  const held = db
    .select({ threadId: threadRunStates.threadId })
    .from(threadRunStates)
    .where(
      or(
        isNotNull(threadRunStates.heldTurnId),
        isNotNull(threadRunStates.stopSentAt),
      ),
    )
    .all()
    .map((row) => row.threadId);
  return [...new Set([...awaiting, ...held])];
}

export function listThreadIdsWithOwedStopForHost(
  db: DbQueryConnection,
  args: { hostId: string },
): string[] {
  return db
    .select({ threadId: threadRunStates.threadId })
    .from(threadRunStates)
    .innerJoin(threads, eq(threads.id, threadRunStates.threadId))
    .innerJoin(environments, eq(environments.id, threads.environmentId))
    .where(
      and(
        isNotNull(threadRunStates.stopRequestedAt),
        isNull(threadRunStates.stopAckedAt),
        eq(environments.hostId, args.hostId),
      ),
    )
    .all()
    .map((row) => row.threadId);
}

export function listThreadIdsWithTurnRequestsForHost(
  db: DbQueryConnection,
  args: { hostId: string },
): string[] {
  return db
    .selectDistinct({ threadId: threadTurnRequests.threadId })
    .from(threadTurnRequests)
    .where(eq(threadTurnRequests.hostId, args.hostId))
    .all()
    .map((row) => row.threadId);
}
