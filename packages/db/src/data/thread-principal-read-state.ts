import { and, eq, inArray } from "drizzle-orm";
import type { ThreadChangeKind } from "@bb/domain";
import type {
  DbConnection,
  DbQueryConnection,
  DbTransaction,
} from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { threadPrincipalReadState, threads } from "../schema.js";

type ThreadWriteConnection = DbConnection | DbTransaction;

/**
 * Stock single-operator Principal id. Must match the server local-owner
 * adapter; kept here so the db package does not depend on apps/server.
 */
export const THREAD_READ_STATE_LOCAL_OWNER_PRINCIPAL_ID = "local-owner";

export function isLocalOwnerThreadReadPrincipal(principalId: string): boolean {
  return principalId === THREAD_READ_STATE_LOCAL_OWNER_PRINCIPAL_ID;
}

export interface ThreadPrincipalReadStateRow {
  threadId: string;
  principalId: string;
  lastReadAt: number | null;
  readCursor: string | null;
  updatedAt: number;
}

export interface GetThreadLastReadAtForPrincipalArgs {
  globalLastReadAt: number | null;
  principalId: string;
  threadId: string;
}

export interface ListThreadLastReadAtByThreadIdsForPrincipalArgs {
  /**
   * Global `threads.last_read_at` values keyed by thread id. Required so
   * local-owner projection can stay on the compatibility column without a
   * second round-trip.
   */
  globalLastReadAtByThreadId: ReadonlyMap<string, number | null>;
  principalId: string;
  threadIds: readonly string[];
}

export interface SetThreadReadStateForPrincipalArgs {
  lastReadAt: number | null;
  principalId: string;
  readCursor?: string | null;
  threadId: string;
}

export interface SetThreadReadStateForPrincipalResult {
  changed: boolean;
  lastReadAt: number | null;
  projectId: string;
  threadId: string;
}

function assertNonEmptyPrincipalId(principalId: string): void {
  if (typeof principalId !== "string" || principalId.length === 0) {
    throw new Error(
      "Thread principal read state requires a non-empty principalId",
    );
  }
}

function assertNonEmptyThreadId(threadId: string): void {
  if (typeof threadId !== "string" || threadId.length === 0) {
    throw new Error(
      "Thread principal read state requires a non-empty threadId",
    );
  }
}

/**
 * Project one thread's public `lastReadAt` for a Principal.
 * local-owner always uses the global column; signed Principals use only their
 * durable row (missing row => null, never fall back to global).
 */
export function getThreadLastReadAtForPrincipal(
  db: DbQueryConnection,
  args: GetThreadLastReadAtForPrincipalArgs,
): number | null {
  assertNonEmptyPrincipalId(args.principalId);
  assertNonEmptyThreadId(args.threadId);

  if (isLocalOwnerThreadReadPrincipal(args.principalId)) {
    return args.globalLastReadAt;
  }

  const row = db
    .select({ lastReadAt: threadPrincipalReadState.lastReadAt })
    .from(threadPrincipalReadState)
    .where(
      and(
        eq(threadPrincipalReadState.threadId, args.threadId),
        eq(threadPrincipalReadState.principalId, args.principalId),
      ),
    )
    .get();

  return row?.lastReadAt ?? null;
}

/**
 * Batch overlay of principal-scoped `lastReadAt` for list/search projections.
 * Returns a Map covering every requested thread id (missing signed rows => null).
 */
export function listThreadLastReadAtByThreadIdsForPrincipal(
  db: DbQueryConnection,
  args: ListThreadLastReadAtByThreadIdsForPrincipalArgs,
): Map<string, number | null> {
  assertNonEmptyPrincipalId(args.principalId);

  const result = new Map<string, number | null>();
  if (args.threadIds.length === 0) {
    return result;
  }

  if (isLocalOwnerThreadReadPrincipal(args.principalId)) {
    for (const threadId of args.threadIds) {
      result.set(
        threadId,
        args.globalLastReadAtByThreadId.get(threadId) ?? null,
      );
    }
    return result;
  }

  for (const threadId of args.threadIds) {
    result.set(threadId, null);
  }

  const rows = db
    .select({
      threadId: threadPrincipalReadState.threadId,
      lastReadAt: threadPrincipalReadState.lastReadAt,
    })
    .from(threadPrincipalReadState)
    .where(
      and(
        inArray(threadPrincipalReadState.threadId, [...args.threadIds]),
        eq(threadPrincipalReadState.principalId, args.principalId),
      ),
    )
    .all();

  for (const row of rows) {
    result.set(row.threadId, row.lastReadAt);
  }
  return result;
}

/**
 * Keep the local-owner compatibility row aligned with `threads.last_read_at`
 * without emitting notifications (the caller already owns change signaling).
 */
export function syncLocalOwnerReadStateCompatibilityRow(
  db: ThreadWriteConnection,
  args: {
    lastReadAt: number | null;
    threadId: string;
    updatedAt: number;
  },
): void {
  assertNonEmptyThreadId(args.threadId);
  db.insert(threadPrincipalReadState)
    .values({
      threadId: args.threadId,
      principalId: THREAD_READ_STATE_LOCAL_OWNER_PRINCIPAL_ID,
      lastReadAt: args.lastReadAt,
      readCursor: null,
      updatedAt: args.updatedAt,
    })
    .onConflictDoUpdate({
      target: [
        threadPrincipalReadState.threadId,
        threadPrincipalReadState.principalId,
      ],
      set: {
        lastReadAt: args.lastReadAt,
        updatedAt: args.updatedAt,
      },
    })
    .run();
}

export function getThreadPrincipalReadStateRow(
  db: DbQueryConnection,
  args: { principalId: string; threadId: string },
): ThreadPrincipalReadStateRow | null {
  assertNonEmptyPrincipalId(args.principalId);
  assertNonEmptyThreadId(args.threadId);

  const row = db
    .select()
    .from(threadPrincipalReadState)
    .where(
      and(
        eq(threadPrincipalReadState.threadId, args.threadId),
        eq(threadPrincipalReadState.principalId, args.principalId),
      ),
    )
    .get();

  return row ?? null;
}

/**
 * Update durable read state for one Principal on one thread.
 *
 * - local-owner: writes `threads.last_read_at` (compatibility authority) and
 *   keeps the local-owner compatibility row synchronized.
 * - signed Principal: upserts only this Principal's row; never mutates the
 *   global column.
 */
export function setThreadReadStateForPrincipal(
  db: ThreadWriteConnection,
  notifier: DbNotifier,
  args: SetThreadReadStateForPrincipalArgs,
): SetThreadReadStateForPrincipalResult | null {
  assertNonEmptyPrincipalId(args.principalId);
  assertNonEmptyThreadId(args.threadId);

  const existing = db
    .select({
      id: threads.id,
      projectId: threads.projectId,
      lastReadAt: threads.lastReadAt,
    })
    .from(threads)
    .where(eq(threads.id, args.threadId))
    .get();
  if (!existing) {
    return null;
  }

  const now = Date.now();
  const readCursor =
    "readCursor" in args ? (args.readCursor ?? null) : undefined;

  if (isLocalOwnerThreadReadPrincipal(args.principalId)) {
    const previousLastReadAt = existing.lastReadAt;
    const updated = db
      .update(threads)
      .set({
        lastReadAt: args.lastReadAt,
        updatedAt: now,
      })
      .where(eq(threads.id, args.threadId))
      .returning({
        id: threads.id,
        projectId: threads.projectId,
        lastReadAt: threads.lastReadAt,
      })
      .get();
    if (!updated) {
      return null;
    }

    const existingRow = getThreadPrincipalReadStateRow(db, {
      threadId: args.threadId,
      principalId: args.principalId,
    });
    const nextCursor =
      readCursor !== undefined ? readCursor : (existingRow?.readCursor ?? null);

    db.insert(threadPrincipalReadState)
      .values({
        threadId: args.threadId,
        principalId: args.principalId,
        lastReadAt: args.lastReadAt,
        readCursor: nextCursor,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          threadPrincipalReadState.threadId,
          threadPrincipalReadState.principalId,
        ],
        set: {
          lastReadAt: args.lastReadAt,
          ...(readCursor !== undefined ? { readCursor } : {}),
          updatedAt: now,
        },
      })
      .run();

    const changed = previousLastReadAt !== updated.lastReadAt;
    if (changed) {
      const changes: ThreadChangeKind[] = ["read-state-changed"];
      notifier.notifyThread(args.threadId, changes, {
        projectId: updated.projectId,
      });
    }

    return {
      changed,
      lastReadAt: updated.lastReadAt,
      projectId: updated.projectId,
      threadId: updated.id,
    };
  }

  const previousRow = getThreadPrincipalReadStateRow(db, {
    threadId: args.threadId,
    principalId: args.principalId,
  });
  const previousLastReadAt = previousRow?.lastReadAt ?? null;
  const nextCursor =
    readCursor !== undefined ? readCursor : (previousRow?.readCursor ?? null);

  db.insert(threadPrincipalReadState)
    .values({
      threadId: args.threadId,
      principalId: args.principalId,
      lastReadAt: args.lastReadAt,
      readCursor: nextCursor,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        threadPrincipalReadState.threadId,
        threadPrincipalReadState.principalId,
      ],
      set: {
        lastReadAt: args.lastReadAt,
        ...(readCursor !== undefined ? { readCursor } : {}),
        updatedAt: now,
      },
    })
    .run();

  const changed = previousLastReadAt !== args.lastReadAt;
  if (changed) {
    const changes: ThreadChangeKind[] = ["read-state-changed"];
    notifier.notifyThread(args.threadId, changes, {
      projectId: existing.projectId,
    });
  }

  return {
    changed,
    lastReadAt: args.lastReadAt,
    projectId: existing.projectId,
    threadId: existing.id,
  };
}
