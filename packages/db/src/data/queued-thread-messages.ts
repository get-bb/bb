import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  min,
  notInArray,
  or,
} from "drizzle-orm";
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
  groupBoundaryQueuedMessageId?: string;
  nextQueuedMessageId: string | null;
  notifier: DbNotifier;
  previousQueuedMessageId: string | null;
  queuedMessageId: string;
  threadId: string;
}

export interface SetQueuedThreadMessageGroupBoundaryArgs {
  db: DbConnection;
  expectedGroupedPrefixQueuedMessageIds: readonly string[];
  groupBoundaryQueuedMessageId: string;
  notifier: DbNotifier;
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

export interface DeleteClaimedQueuedThreadMessageBatchInTransactionArgs {
  queuedMessages: readonly ClaimedQueuedThreadMessageMutationArgs[];
}

export type DeleteClaimedQueuedThreadMessageArgs = ClaimedQueuedThreadMessageMutationArgs;

export interface ReleaseStaleQueuedMessageClaimsArgs {
  claimedBefore: number;
  protectedClaimTokens: readonly string[];
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

export interface QueuedThreadMessageGroupBoundarySuccess {
  kind: "updated";
  queuedMessages: QueuedThreadMessageRow[];
}

export interface QueuedThreadMessageGroupBoundaryUnchanged {
  kind: "unchanged";
  queuedMessages: QueuedThreadMessageRow[];
}

export interface QueuedThreadMessageGroupBoundaryNotFound {
  kind: "not_found";
}

export interface QueuedThreadMessageGroupBoundaryInvalidSender {
  kind: "invalid_sender";
}

export interface QueuedThreadMessageGroupBoundaryInvalidExecutionOptions {
  kind: "invalid_execution_options";
}

export interface QueuedThreadMessageGroupBoundaryStaleOrder {
  kind: "stale_neighbor";
}

export type ReorderQueuedThreadMessageResult =
  | ReorderQueuedThreadMessageSuccess
  | ReorderQueuedThreadMessageUnchanged
  | ReorderQueuedThreadMessageNotFound
  | ReorderQueuedThreadMessageClaimed
  | ReorderQueuedThreadMessageStaleNeighbor
  | ReorderQueuedThreadMessageInvalidNeighborOrder
  | QueuedThreadMessageGroupBoundaryInvalidSender
  | QueuedThreadMessageGroupBoundaryInvalidExecutionOptions;

export type SetQueuedThreadMessageGroupBoundaryResult =
  | QueuedThreadMessageGroupBoundarySuccess
  | QueuedThreadMessageGroupBoundaryUnchanged
  | QueuedThreadMessageGroupBoundaryNotFound
  | QueuedThreadMessageGroupBoundaryInvalidSender
  | QueuedThreadMessageGroupBoundaryInvalidExecutionOptions
  | QueuedThreadMessageGroupBoundaryStaleOrder
  | ReorderQueuedThreadMessageClaimed;

export type ReleaseQueuedMessageClaimArgs = ClaimedQueuedThreadMessageMutationArgs;

class ReorderQueuedThreadMessageRollback extends Error {
  constructor(readonly result: ReorderQueuedThreadMessageResult) {
    super("Queued message reorder rolled back");
  }
}

function collectLeadGroupIds(
  queuedMessages: readonly QueuedThreadMessageRow[],
): string[] {
  const ids: string[] = [];
  const firstQueuedMessage = queuedMessages[0] ?? null;
  for (const [index, queuedMessage] of queuedMessages.entries()) {
    ids.push(queuedMessage.id);
    if (!queuedMessage.groupWithNext) break;
    const nextQueuedMessage = queuedMessages[index + 1];
    if (
      !nextQueuedMessage ||
      !queuedMessageGroupingEnvelopeMatches(firstQueuedMessage, nextQueuedMessage)
    ) {
      break;
    }
  }
  return ids;
}

function stringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function queuedMessageGroupingEnvelopeMatches(
  firstQueuedMessage: QueuedThreadMessageRow | null,
  queuedMessage: QueuedThreadMessageRow,
): boolean {
  return (
    firstQueuedMessage !== null &&
    queuedMessage.senderThreadId === firstQueuedMessage.senderThreadId &&
    queuedMessage.model === firstQueuedMessage.model &&
    queuedMessage.reasoningLevel === firstQueuedMessage.reasoningLevel &&
    queuedMessage.permissionMode === firstQueuedMessage.permissionMode &&
    queuedMessage.serviceTier === firstQueuedMessage.serviceTier
  );
}

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

function getPreviousUnclaimedQueuedThreadMessage(
  db: DbQueryConnection,
  queuedMessage: QueuedThreadMessageRow,
): QueuedThreadMessageRow | null {
  return (
    db
      .select()
      .from(queuedThreadMessages)
      .where(
        and(
          eq(queuedThreadMessages.threadId, queuedMessage.threadId),
          isNull(queuedThreadMessages.claimedAt),
          isNull(queuedThreadMessages.claimToken),
          or(
            lt(queuedThreadMessages.sortKey, queuedMessage.sortKey),
            and(
              eq(queuedThreadMessages.sortKey, queuedMessage.sortKey),
              lt(queuedThreadMessages.id, queuedMessage.id),
            ),
          ),
        ),
      )
      .orderBy(desc(queuedThreadMessages.sortKey), desc(queuedThreadMessages.id))
      .limit(1)
      .get() ?? null
  );
}

function clearPreviousQueuedMessageGroupEdgeInTransaction(
  db: DbTransaction,
  queuedMessage: QueuedThreadMessageRow,
  now = Date.now(),
): void {
  const previousQueuedMessage = getPreviousUnclaimedQueuedThreadMessage(
    db,
    queuedMessage,
  );
  if (!previousQueuedMessage?.groupWithNext) return;
  db.update(queuedThreadMessages)
    .set({ groupWithNext: false, updatedAt: now })
    .where(eq(queuedThreadMessages.id, previousQueuedMessage.id))
    .run();
}

function clearQueuedMessageGroupEdgeInTransaction(
  db: DbTransaction,
  queuedMessage: QueuedThreadMessageRow,
  now = Date.now(),
): void {
  if (!queuedMessage.groupWithNext) return;
  db.update(queuedThreadMessages)
    .set({ groupWithNext: false, updatedAt: now })
    .where(eq(queuedThreadMessages.id, queuedMessage.id))
    .run();
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

function applyQueuedThreadMessageGroupBoundary(
  db: DbTransaction,
  expectedGroupedPrefixQueuedMessageIds: readonly string[] | null,
  threadId: string,
  groupBoundaryQueuedMessageId: string,
): SetQueuedThreadMessageGroupBoundaryResult {
  const queuedMessages = listUnclaimedQueuedThreadMessages(db, threadId);
  const boundaryIndex = queuedMessages.findIndex(
    (queuedMessage) => queuedMessage.id === groupBoundaryQueuedMessageId,
  );
  if (boundaryIndex === -1) {
    const claimedBoundary = getQueuedThreadMessageForMutation(
      db,
      groupBoundaryQueuedMessageId,
    );
    return claimedBoundary?.threadId === threadId &&
      isQueuedThreadMessageClaimed(claimedBoundary)
      ? { kind: "claimed" }
      : { kind: "not_found" };
  }
  if (expectedGroupedPrefixQueuedMessageIds !== null) {
    const currentGroupedPrefixIds = queuedMessages
      .slice(0, boundaryIndex + 1)
      .map((queuedMessage) => queuedMessage.id);
    if (
      !stringArraysEqual(
        currentGroupedPrefixIds,
        expectedGroupedPrefixQueuedMessageIds,
      )
    ) {
      return { kind: "stale_neighbor" };
    }
  }
  if (boundaryIndex > 0) {
    const firstQueuedMessage = queuedMessages[0] ?? null;
    const groupedMessages = queuedMessages.slice(0, boundaryIndex + 1);
    const hasMixedSender = groupedMessages.some(
      (queuedMessage) =>
        queuedMessage.senderThreadId !== firstQueuedMessage?.senderThreadId,
    );
    if (hasMixedSender) {
      return { kind: "invalid_sender" };
    }
    const hasMixedExecutionOptions = groupedMessages.some(
      (queuedMessage) =>
        !queuedMessageGroupingEnvelopeMatches(firstQueuedMessage, queuedMessage),
    );
    if (hasMixedExecutionOptions) {
      return { kind: "invalid_execution_options" };
    }
  }

  let changed = false;
  const now = Date.now();
  for (const [index, queuedMessage] of queuedMessages.entries()) {
    const groupWithNext = index < boundaryIndex;
    if (queuedMessage.groupWithNext === groupWithNext) continue;
    changed = true;
    db.update(queuedThreadMessages)
      .set({ groupWithNext, updatedAt: now })
      .where(eq(queuedThreadMessages.id, queuedMessage.id))
      .run();
  }

  if (!changed) {
    return { kind: "unchanged", queuedMessages };
  }
  return {
    kind: "updated",
    queuedMessages: listUnclaimedQueuedThreadMessages(db, threadId),
  };
}

function applyPreservedLeadGroupAfterReorder(
  db: DbTransaction,
  threadId: string,
  originalLeadGroupIds: readonly string[],
): QueuedThreadMessageRow[] {
  const queuedMessages = listUnclaimedQueuedThreadMessages(db, threadId);
  if (originalLeadGroupIds.length <= 1) {
    return queuedMessages;
  }

  const originalLeadGroupIdSet = new Set(originalLeadGroupIds);
  const preservesLeadGroup = queuedMessages
    .slice(0, originalLeadGroupIds.length)
    .every((queuedMessage) => originalLeadGroupIdSet.has(queuedMessage.id));
  let changed = false;
  const now = Date.now();
  for (const [index, queuedMessage] of queuedMessages.entries()) {
    const groupWithNext =
      preservesLeadGroup && index < originalLeadGroupIds.length - 1;
    if (queuedMessage.groupWithNext === groupWithNext) continue;
    changed = true;
    db.update(queuedThreadMessages)
      .set({ groupWithNext, updatedAt: now })
      .where(eq(queuedThreadMessages.id, queuedMessage.id))
      .run();
  }

  return changed
    ? listUnclaimedQueuedThreadMessages(db, threadId)
    : queuedMessages;
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
          groupWithNext: false,
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
      clearPreviousQueuedMessageGroupEdgeInTransaction(tx, existing, now);
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

function claimQueuedThreadMessageIdsInTransaction(
  tx: DbTransaction,
  ids: readonly string[],
): ClaimedQueuedThreadMessageRow[] | null {
  if (ids.length === 0) return null;

  const now = Date.now();
  const claimToken = createQueuedThreadMessageClaimToken();
  const updated = tx
    .update(queuedThreadMessages)
    .set({ claimedAt: now, claimToken, updatedAt: now })
    .where(
      and(
        inArray(queuedThreadMessages.id, [...ids]),
        isNull(queuedThreadMessages.claimedAt),
        isNull(queuedThreadMessages.claimToken),
      ),
    )
    .returning()
    .all();

  if (updated.length !== ids.length) {
    return null;
  }

  const byId = new Map(
    updated.map((row) => [row.id, requireClaimedQueuedThreadMessage(row)]),
  );
  const claimedRows: ClaimedQueuedThreadMessageRow[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) return null;
    claimedRows.push(row);
  }
  return claimedRows;
}

export function claimQueuedThreadMessageGroup(
  db: DbConnection,
  notifier: DbNotifier,
  id: string,
): ClaimedQueuedThreadMessageRow[] | null {
  const claimedQueuedMessages = db.transaction(
    (tx) => {
      const existing = getQueuedThreadMessageForMutation(tx, id);
      if (!existing || isQueuedThreadMessageClaimed(existing)) {
        return null;
      }

      const queuedMessages = listUnclaimedQueuedThreadMessages(
        tx,
        existing.threadId,
      );
      const existingIndex = queuedMessages.findIndex(
        (queuedMessage) => queuedMessage.id === id,
      );
      if (existingIndex === -1) return null;

      const ids =
        existingIndex === 0
          ? collectLeadGroupIds(queuedMessages)
          : [existing.id];
      if (existingIndex !== 0) {
        const now = Date.now();
        clearPreviousQueuedMessageGroupEdgeInTransaction(tx, existing, now);
        clearQueuedMessageGroupEdgeInTransaction(tx, existing, now);
      }
      return claimQueuedThreadMessageIdsInTransaction(tx, ids);
    },
    { behavior: "immediate" },
  );

  if (claimedQueuedMessages && claimedQueuedMessages.length > 0) {
    notifier.notifyThread(claimedQueuedMessages[0]!.threadId, [
      "queue-changed",
    ]);
  }
  return claimedQueuedMessages;
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

export function claimNextQueuedThreadMessageGroup(
  db: DbConnection,
  notifier: DbNotifier,
  threadId: string,
): ClaimedQueuedThreadMessageRow[] | null {
  const claimedQueuedMessages = db.transaction(
    (tx) => {
      const queuedMessages = listUnclaimedQueuedThreadMessages(tx, threadId);
      if (queuedMessages.length === 0) {
        return null;
      }
      return claimQueuedThreadMessageIdsInTransaction(
        tx,
        collectLeadGroupIds(queuedMessages),
      );
    },
    { behavior: "immediate" },
  );

  if (claimedQueuedMessages && claimedQueuedMessages.length > 0) {
    notifier.notifyThread(threadId, ["queue-changed"]);
  }
  return claimedQueuedMessages;
}

export function reorderQueuedThreadMessage({
  db,
  groupBoundaryQueuedMessageId,
  nextQueuedMessageId,
  notifier,
  previousQueuedMessageId,
  queuedMessageId,
  threadId,
}: ReorderQueuedThreadMessageArgs): ReorderQueuedThreadMessageResult {
  let result: ReorderQueuedThreadMessageResult;
  try {
    result = db.transaction(
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
        if (previousQueuedMessage === false || nextQueuedMessage === false) {
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
        const originalLeadGroupIds = collectLeadGroupIds(currentQueuedMessages);
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
          if (groupBoundaryQueuedMessageId !== undefined) {
            const groupResult = applyQueuedThreadMessageGroupBoundary(
              tx,
              null,
              threadId,
              groupBoundaryQueuedMessageId,
            );
            if (groupResult.kind === "not_found") {
              return { kind: "stale_neighbor" };
            }
            if (groupResult.kind === "claimed") {
              return { kind: "claimed" };
            }
            if (groupResult.kind === "stale_neighbor") {
              return { kind: "stale_neighbor" };
            }
            if (groupResult.kind === "invalid_sender") {
              return { kind: "invalid_sender" };
            }
            if (groupResult.kind === "invalid_execution_options") {
              return { kind: "invalid_execution_options" };
            }
            if (groupResult.kind === "updated") {
              return {
                kind: "reordered",
                queuedMessages: groupResult.queuedMessages,
              };
            }
          }
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

        if (groupBoundaryQueuedMessageId !== undefined) {
          const groupResult = applyQueuedThreadMessageGroupBoundary(
            tx,
            null,
            threadId,
            groupBoundaryQueuedMessageId,
          );
          if (groupResult.kind === "not_found") {
            throw new ReorderQueuedThreadMessageRollback({
              kind: "stale_neighbor",
            });
          }
          if (groupResult.kind === "claimed") {
            throw new ReorderQueuedThreadMessageRollback({ kind: "claimed" });
          }
          if (groupResult.kind === "stale_neighbor") {
            throw new ReorderQueuedThreadMessageRollback({
              kind: "stale_neighbor",
            });
          }
          if (groupResult.kind === "invalid_sender") {
            throw new ReorderQueuedThreadMessageRollback({
              kind: "invalid_sender",
            });
          }
          if (groupResult.kind === "invalid_execution_options") {
            throw new ReorderQueuedThreadMessageRollback({
              kind: "invalid_execution_options",
            });
          }
          if (groupResult.kind === "updated") {
            return {
              kind: "reordered",
              queuedMessages: groupResult.queuedMessages,
            };
          }
        } else {
          return {
            kind: "reordered",
            queuedMessages: applyPreservedLeadGroupAfterReorder(
              tx,
              threadId,
              originalLeadGroupIds,
            ),
          };
        }

        return {
          kind: "reordered",
          queuedMessages: listUnclaimedQueuedThreadMessages(tx, threadId),
        };
      },
      { behavior: "immediate" },
    );
  } catch (error) {
    if (error instanceof ReorderQueuedThreadMessageRollback) {
      result = error.result;
    } else {
      throw error;
    }
  }

  if (result.kind === "reordered") {
    notifier.notifyThread(threadId, ["queue-changed"]);
  }
  return result;
}

export function setQueuedThreadMessageGroupBoundary({
  db,
  expectedGroupedPrefixQueuedMessageIds,
  groupBoundaryQueuedMessageId,
  notifier,
  threadId,
}: SetQueuedThreadMessageGroupBoundaryArgs): SetQueuedThreadMessageGroupBoundaryResult {
  const result = db.transaction(
    (tx) =>
      applyQueuedThreadMessageGroupBoundary(
        tx,
        expectedGroupedPrefixQueuedMessageIds,
        threadId,
        groupBoundaryQueuedMessageId,
      ),
    { behavior: "immediate" },
  );

  if (result.kind === "updated") {
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
  const protectedClaimTokens = [...args.protectedClaimTokens];
  const staleClaimWhere = and(
    isNotNull(queuedThreadMessages.claimedAt),
    lt(queuedThreadMessages.claimedAt, args.claimedBefore),
    ...(protectedClaimTokens.length > 0
      ? [
          or(
            isNull(queuedThreadMessages.claimToken),
            notInArray(queuedThreadMessages.claimToken, protectedClaimTokens),
          )!,
        ]
      : []),
  );
  const staleRows = db
    .select({
      id: queuedThreadMessages.id,
      threadId: queuedThreadMessages.threadId,
    })
    .from(queuedThreadMessages)
    .where(staleClaimWhere)
    .all();
  if (staleRows.length === 0) {
    return 0;
  }

  const now = Date.now();
  const result = db
    .update(queuedThreadMessages)
    .set({ claimedAt: null, claimToken: null, updatedAt: now })
    .where(staleClaimWhere)
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
  const existing = getQueuedThreadMessageForMutation(db, args.id);
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
  if (deleted) {
    clearPreviousQueuedMessageGroupEdgeInTransaction(db, existing);
  }
  return deleted !== null;
}

export function deleteClaimedQueuedThreadMessageBatchInTransaction(
  db: DbTransaction,
  args: DeleteClaimedQueuedThreadMessageBatchInTransactionArgs,
): boolean {
  if (args.queuedMessages.length === 0) return false;
  const claimToken = args.queuedMessages[0]!.claimToken;
  if (
    args.queuedMessages.some(
      (queuedMessage) => queuedMessage.claimToken !== claimToken,
    )
  ) {
    return false;
  }

  const ids = args.queuedMessages.map((queuedMessage) => queuedMessage.id);
  const existingRows = db
    .select()
    .from(queuedThreadMessages)
    .where(
      and(
        inArray(queuedThreadMessages.id, ids),
        eq(queuedThreadMessages.claimToken, claimToken),
      ),
    )
    .all();
  if (existingRows.length !== ids.length) {
    return false;
  }

  const deletedRows = db
    .delete(queuedThreadMessages)
    .where(
      and(
        inArray(queuedThreadMessages.id, ids),
        eq(queuedThreadMessages.claimToken, claimToken),
      ),
    )
    .returning({ id: queuedThreadMessages.id })
    .all();
  if (deletedRows.length !== ids.length) {
    return false;
  }

  const removingIds = new Set(ids);
  const now = Date.now();
  for (const existing of existingRows) {
    const previousQueuedMessage = getPreviousUnclaimedQueuedThreadMessage(
      db,
      existing,
    );
    if (
      previousQueuedMessage &&
      !removingIds.has(previousQueuedMessage.id) &&
      previousQueuedMessage.groupWithNext
    ) {
      db.update(queuedThreadMessages)
        .set({ groupWithNext: false, updatedAt: now })
        .where(eq(queuedThreadMessages.id, previousQueuedMessage.id))
        .run();
    }
  }
  return true;
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

  const deleted = db.transaction(
    (tx) => deleteClaimedQueuedThreadMessageInTransaction(tx, args),
    { behavior: "immediate" },
  );
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
  const existing = db.transaction(
    (tx) => {
      const existing = getQueuedThreadMessageForMutation(tx, id);
      if (!existing) return null;
      clearPreviousQueuedMessageGroupEdgeInTransaction(tx, existing);
      tx.delete(queuedThreadMessages).where(eq(queuedThreadMessages.id, id)).run();
      return existing;
    },
    { behavior: "immediate" },
  );
  if (!existing) return false;
  notifier.notifyThread(existing.threadId, ["queue-changed"]);
  return true;
}
