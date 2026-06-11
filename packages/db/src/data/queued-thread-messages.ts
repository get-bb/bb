import { and, asc, desc, eq, isNotNull, isNull, lt, min } from "drizzle-orm";
import type { PermissionMode, PromptInput } from "@bb/domain";
import type {
  DbConnection,
  DbQueryConnection,
  DbTransaction,
} from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { queuedThreadMessages, threads } from "../schema.js";
import { createQueuedThreadMessageClaimToken, createQueuedThreadMessageId } from "../ids.js";
import {
  createOrderKeyAfter,
  createOrderKeyBetween,
} from "./order-keys.js";

export interface CreateQueuedThreadMessageInput {
  threadId: string;
  content: PromptInput[];
  senderThreadId?: string | null;
  model: string;
  reasoningLevel: string;
  permissionMode: PermissionMode;
  serviceTier: string;
}

export type QueuedThreadMessageRow = typeof queuedThreadMessages.$inferSelect;

export interface ClaimedQueuedThreadMessageRow extends QueuedThreadMessageRow {
  claimedAt: number;
  claimToken: string;
}

export interface QueuedMessageThreadRow {
  oldestQueuedMessageCreatedAt: number | null;
  threadId: string;
}

export interface ReorderQueuedThreadMessageArgs {
  db: DbConnection;
  nextQueuedMessageId: string | null;
  notifier: DbNotifier;
  previousQueuedMessageId: string | null;
  queuedMessageId: string;
  threadId: string;
}

interface ResolveQueuedThreadMessageNeighborArgs {
  movedQueuedMessageId: string;
  neighborQueuedMessageId: string | null;
  threadId: string;
}

export interface ClaimedQueuedThreadMessageMutationArgs {
  claimToken: string;
  id: string;
}

export type DeleteClaimedQueuedThreadMessageInTransactionArgs = ClaimedQueuedThreadMessageMutationArgs;

export type DeleteClaimedQueuedThreadMessageArgs = ClaimedQueuedThreadMessageMutationArgs;

export interface ReleaseStaleQueuedMessageClaimsArgs {
  claimedBefore: number;
}

export interface ReorderQueuedThreadMessageSuccess {
  kind: "reordered";
  queuedMessages: QueuedThreadMessageRow[];
}

export interface ReorderQueuedThreadMessageUnchanged {
  kind: "unchanged";
  queuedMessages: QueuedThreadMessageRow[];
}

export interface ReorderQueuedThreadMessageNotFound {
  kind: "not_found";
}

export interface ReorderQueuedThreadMessageClaimed {
  kind: "claimed";
}

export interface ReorderQueuedThreadMessageStaleNeighbor {
  kind: "stale_neighbor";
}

export interface ReorderQueuedThreadMessageInvalidNeighborOrder {
  kind: "invalid_neighbor_order";
}

export type ReorderQueuedThreadMessageResult =
  | ReorderQueuedThreadMessageSuccess
  | ReorderQueuedThreadMessageUnchanged
  | ReorderQueuedThreadMessageNotFound
  | ReorderQueuedThreadMessageClaimed
  | ReorderQueuedThreadMessageStaleNeighbor
  | ReorderQueuedThreadMessageInvalidNeighborOrder;

export type ReleaseQueuedMessageClaimArgs = ClaimedQueuedThreadMessageMutationArgs;

function isQueuedThreadMessageClaimed(row: QueuedThreadMessageRow): boolean {
  return row.claimedAt !== null || row.claimToken !== null;
}

function requireClaimedQueuedThreadMessage(row: QueuedThreadMessageRow | null): ClaimedQueuedThreadMessageRow | null {
  if (!row || row.claimedAt === null || row.claimToken === null) {
    return null;
  }
  return {
    ...row,
    claimedAt: row.claimedAt,
    claimToken: row.claimToken,
  };
}

function listUnclaimedQueuedThreadMessages(
  db: DbQueryConnection,
  threadId: string,
): QueuedThreadMessageRow[] {
  return db
    .select()
    .from(queuedThreadMessages)
    .where(
      and(
        eq(queuedThreadMessages.threadId, threadId),
        isNull(queuedThreadMessages.claimedAt),
        isNull(queuedThreadMessages.claimToken),
      ),
    )
    .orderBy(asc(queuedThreadMessages.sortKey), asc(queuedThreadMessages.id))
    .all();
}

function getQueuedThreadMessageForMutation(
  db: DbQueryConnection,
  id: string,
): QueuedThreadMessageRow | null {
  return (
    db
      .select()
      .from(queuedThreadMessages)
      .where(eq(queuedThreadMessages.id, id))
      .get() ?? null
  );
}

function getLastQueuedThreadMessage(
  db: DbQueryConnection,
  threadId: string,
): QueuedThreadMessageRow | null {
  return (
    db
      .select()
      .from(queuedThreadMessages)
      .where(eq(queuedThreadMessages.threadId, threadId))
      .orderBy(desc(queuedThreadMessages.sortKey), desc(queuedThreadMessages.id))
      .limit(1)
      .get() ?? null
  );
}

function resolveQueuedThreadMessageNeighbor(
  db: DbQueryConnection,
  args: ResolveQueuedThreadMessageNeighborArgs,
): QueuedThreadMessageRow | null | false {
  if (args.neighborQueuedMessageId === null) {
    return null;
  }
  if (args.neighborQueuedMessageId === args.movedQueuedMessageId) {
    return false;
  }

  const neighbor = getQueuedThreadMessageForMutation(
    db,
    args.neighborQueuedMessageId,
  );
  if (
    !neighbor ||
    neighbor.threadId !== args.threadId ||
    isQueuedThreadMessageClaimed(neighbor)
  ) {
    return false;
  }
  return neighbor;
}

export function createQueuedThreadMessage(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateQueuedThreadMessageInput,
) {
  const now = Date.now();
  const id = createQueuedThreadMessageId();
  const row = db.transaction(
    (tx) => {
      const lastQueuedMessage = getLastQueuedThreadMessage(tx, input.threadId);
      const sortKey = lastQueuedMessage
        ? createOrderKeyAfter({ previousKey: lastQueuedMessage.sortKey })
        : createOrderKeyBetween({ previousKey: null, nextKey: null });
      return tx
        .insert(queuedThreadMessages)
        .values({
          id,
          threadId: input.threadId,
          content: JSON.stringify(input.content),
          senderThreadId: input.senderThreadId ?? null,
          model: input.model,
          reasoningLevel: input.reasoningLevel,
          permissionMode: input.permissionMode,
          serviceTier: input.serviceTier,
          claimedAt: null,
          claimToken: null,
          sortKey,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
    },
    { behavior: "immediate" },
  );
  notifier.notifyThread(input.threadId, ["queue-changed"]);
  return row;
}

export function getQueuedThreadMessage(db: DbConnection, id: string) {
  return (
    db
      .select()
      .from(queuedThreadMessages)
      .where(eq(queuedThreadMessages.id, id))
      .get() ?? null
  );
}

export function listQueuedThreadMessages(db: DbConnection, threadId: string) {
  return listUnclaimedQueuedThreadMessages(db, threadId);
}

export function listIdleThreadsWithQueuedMessages(
  db: DbConnection,
): QueuedMessageThreadRow[] {
  return db
    .select({
      threadId: threads.id,
      oldestQueuedMessageCreatedAt: min(queuedThreadMessages.createdAt),
    })
    .from(queuedThreadMessages)
    .innerJoin(threads, eq(threads.id, queuedThreadMessages.threadId))
    .where(
      and(
        eq(threads.status, "idle"),
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
        isNull(threads.stopRequestedAt),
        isNotNull(threads.environmentId),
        isNull(queuedThreadMessages.claimedAt),
        isNull(queuedThreadMessages.claimToken),
      ),
    )
    .groupBy(threads.id)
    .orderBy(asc(min(queuedThreadMessages.createdAt)), asc(threads.id))
    .all();
}

export function claimQueuedThreadMessage(
  db: DbConnection,
  notifier: DbNotifier,
  id: string,
): ClaimedQueuedThreadMessageRow | null {
  const claimedQueuedMessage = db.transaction(
    (tx) => {
      const existing = tx
        .select()
        .from(queuedThreadMessages)
        .where(eq(queuedThreadMessages.id, id))
        .get();
      if (!existing || existing.claimedAt !== null || existing.claimToken !== null) {
        return null;
      }

      const now = Date.now();
      const claimToken = createQueuedThreadMessageClaimToken();
      const updated = tx
        .update(queuedThreadMessages)
        .set({ claimedAt: now, claimToken, updatedAt: now })
        .where(
          and(
            eq(queuedThreadMessages.id, id),
            isNull(queuedThreadMessages.claimedAt),
            isNull(queuedThreadMessages.claimToken),
          ),
        )
        .returning()
        .get();

      return requireClaimedQueuedThreadMessage(updated ?? null);
    },
    { behavior: "immediate" },
  );

  if (claimedQueuedMessage) {
    notifier.notifyThread(claimedQueuedMessage.threadId, ["queue-changed"]);
  }
  return claimedQueuedMessage;
}

export function claimNextQueuedThreadMessage(
  db: DbConnection,
  notifier: DbNotifier,
  threadId: string,
): ClaimedQueuedThreadMessageRow | null {
  const claimedQueuedMessage = db.transaction(
    (tx) => {
      const nextQueuedMessage = tx
        .select()
        .from(queuedThreadMessages)
        .where(
          and(
            eq(queuedThreadMessages.threadId, threadId),
            isNull(queuedThreadMessages.claimedAt),
            isNull(queuedThreadMessages.claimToken),
          ),
        )
        .orderBy(asc(queuedThreadMessages.sortKey), asc(queuedThreadMessages.id))
        .limit(1)
        .get();
      if (!nextQueuedMessage) {
        return null;
      }

      const now = Date.now();
      const claimToken = createQueuedThreadMessageClaimToken();
      const updated = tx
        .update(queuedThreadMessages)
        .set({ claimedAt: now, claimToken, updatedAt: now })
        .where(
          and(
            eq(queuedThreadMessages.id, nextQueuedMessage.id),
            isNull(queuedThreadMessages.claimedAt),
            isNull(queuedThreadMessages.claimToken),
          ),
        )
        .returning()
        .get();

      return requireClaimedQueuedThreadMessage(updated ?? null);
    },
    { behavior: "immediate" },
  );

  if (claimedQueuedMessage) {
    notifier.notifyThread(claimedQueuedMessage.threadId, ["queue-changed"]);
  }
  return claimedQueuedMessage;
}

export function reorderQueuedThreadMessage({
  db,
  nextQueuedMessageId,
  notifier,
  previousQueuedMessageId,
  queuedMessageId,
  threadId,
}: ReorderQueuedThreadMessageArgs): ReorderQueuedThreadMessageResult {
  const result = db.transaction(
    (tx): ReorderQueuedThreadMessageResult => {
      const movedQueuedMessage = getQueuedThreadMessageForMutation(
        tx,
        queuedMessageId,
      );
      if (!movedQueuedMessage || movedQueuedMessage.threadId !== threadId) {
        return { kind: "not_found" };
      }
      if (isQueuedThreadMessageClaimed(movedQueuedMessage)) {
        return { kind: "claimed" };
      }

      const previousQueuedMessage = resolveQueuedThreadMessageNeighbor(tx, {
        movedQueuedMessageId: queuedMessageId,
        neighborQueuedMessageId: previousQueuedMessageId,
        threadId,
      });
      const nextQueuedMessage = resolveQueuedThreadMessageNeighbor(tx, {
        movedQueuedMessageId: queuedMessageId,
        neighborQueuedMessageId: nextQueuedMessageId,
        threadId,
      });
      if (
        previousQueuedMessage === false ||
        nextQueuedMessage === false
      ) {
        return { kind: "stale_neighbor" };
      }
      if (
        previousQueuedMessage !== null &&
        nextQueuedMessage !== null &&
        previousQueuedMessage.sortKey >= nextQueuedMessage.sortKey
      ) {
        return { kind: "invalid_neighbor_order" };
      }

      const currentQueuedMessages = listUnclaimedQueuedThreadMessages(
        tx,
        threadId,
      );
      const currentIndex = currentQueuedMessages.findIndex(
        (queuedMessage) => queuedMessage.id === queuedMessageId,
      );
      const currentPreviousQueuedMessageId =
        currentQueuedMessages[currentIndex - 1]?.id ?? null;
      const currentNextQueuedMessageId =
        currentQueuedMessages[currentIndex + 1]?.id ?? null;
      if (
        currentPreviousQueuedMessageId === previousQueuedMessageId &&
        currentNextQueuedMessageId === nextQueuedMessageId
      ) {
        return {
          kind: "unchanged",
          queuedMessages: currentQueuedMessages,
        };
      }

      const sortKey = createOrderKeyBetween({
        previousKey: previousQueuedMessage?.sortKey ?? null,
        nextKey: nextQueuedMessage?.sortKey ?? null,
      });
      const updated = tx
        .update(queuedThreadMessages)
        .set({ sortKey, updatedAt: Date.now() })
        .where(
          and(
            eq(queuedThreadMessages.id, queuedMessageId),
            isNull(queuedThreadMessages.claimedAt),
            isNull(queuedThreadMessages.claimToken),
          ),
        )
        .returning({ id: queuedThreadMessages.id })
        .get();
      if (!updated) {
        return { kind: "stale_neighbor" };
      }

      return {
        kind: "reordered",
        queuedMessages: listUnclaimedQueuedThreadMessages(tx, threadId),
      };
    },
    { behavior: "immediate" },
  );

  if (result.kind === "reordered") {
    notifier.notifyThread(threadId, ["queue-changed"]);
  }
  return result;
}

export function releaseQueuedMessageClaim(
  db: DbConnection,
  notifier: DbNotifier,
  args: ReleaseQueuedMessageClaimArgs,
): boolean {
  const existing = db
    .select()
    .from(queuedThreadMessages)
    .where(eq(queuedThreadMessages.id, args.id))
    .get();
  if (
    !existing ||
    existing.claimedAt === null ||
    existing.claimToken !== args.claimToken
  ) {
    return false;
  }

  const now = Date.now();
  const result = db
    .update(queuedThreadMessages)
    .set({ claimedAt: null, claimToken: null, updatedAt: now })
    .where(
      and(
        eq(queuedThreadMessages.id, args.id),
        isNotNull(queuedThreadMessages.claimedAt),
        eq(queuedThreadMessages.claimToken, args.claimToken),
      ),
    )
    .run();
  if (result.changes === 0) {
    return false;
  }

  notifier.notifyThread(existing.threadId, ["queue-changed"]);
  return true;
}

export function releaseStaleQueuedMessageClaims(
  db: DbConnection,
  notifier: DbNotifier,
  args: ReleaseStaleQueuedMessageClaimsArgs,
): number {
  const staleRows = db
    .select({
      id: queuedThreadMessages.id,
      threadId: queuedThreadMessages.threadId,
    })
    .from(queuedThreadMessages)
    .where(
      and(
        isNotNull(queuedThreadMessages.claimedAt),
        lt(queuedThreadMessages.claimedAt, args.claimedBefore),
      ),
    )
    .all();
  if (staleRows.length === 0) {
    return 0;
  }

  const now = Date.now();
  const result = db
    .update(queuedThreadMessages)
    .set({ claimedAt: null, claimToken: null, updatedAt: now })
    .where(
      and(
        isNotNull(queuedThreadMessages.claimedAt),
        lt(queuedThreadMessages.claimedAt, args.claimedBefore),
      ),
    )
    .run();

  for (const threadId of new Set(staleRows.map((row) => row.threadId))) {
    notifier.notifyThread(threadId, ["queue-changed"]);
  }

  return result.changes;
}

export function deleteClaimedQueuedThreadMessageInTransaction(
  db: DbTransaction,
  args: DeleteClaimedQueuedThreadMessageInTransactionArgs,
): boolean {
  const deleted =
    db
      .delete(queuedThreadMessages)
      .where(
        and(
          eq(queuedThreadMessages.id, args.id),
          eq(queuedThreadMessages.claimToken, args.claimToken),
        ),
      )
      .returning({ id: queuedThreadMessages.id })
      .get() ?? null;
  return deleted !== null;
}

export function deleteClaimedQueuedThreadMessage(
  db: DbConnection,
  notifier: DbNotifier,
  args: DeleteClaimedQueuedThreadMessageArgs,
): boolean {
  const existing = db
    .select()
    .from(queuedThreadMessages)
    .where(eq(queuedThreadMessages.id, args.id))
    .get();
  if (!existing || existing.claimToken !== args.claimToken) {
    return false;
  }

  const deleted =
    db
      .delete(queuedThreadMessages)
      .where(
        and(
          eq(queuedThreadMessages.id, args.id),
          eq(queuedThreadMessages.claimToken, args.claimToken),
        ),
      )
      .returning({ id: queuedThreadMessages.id })
      .get() ?? null;
  if (!deleted) {
    return false;
  }

  notifier.notifyThread(existing.threadId, ["queue-changed"]);
  return true;
}

export function deleteQueuedThreadMessage(
  db: DbConnection,
  notifier: DbNotifier,
  id: string,
) {
  const existing = db
    .select()
    .from(queuedThreadMessages)
    .where(eq(queuedThreadMessages.id, id))
    .get();
  if (!existing) return false;
  db.delete(queuedThreadMessages).where(eq(queuedThreadMessages.id, id)).run();
  notifier.notifyThread(existing.threadId, ["queue-changed"]);
  return true;
}
