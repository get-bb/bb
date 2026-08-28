import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  min,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { QUEUED_MESSAGE_PLUGIN_WAIT_HOLDER_PREFIX } from "@bb/domain";
import type {
  PermissionMode,
  PluginInputs,
  PromptInput,
  QueuedMessageWaitHolder,
  QueuedMessageWaitingOn,
  QueuedMessageWaitingOnKind,
} from "@bb/domain";
import type {
  DbConnection,
  DbQueryConnection,
  DbTransaction,
} from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { environments, queuedThreadMessages, threads } from "../schema.js";
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
  /**
   * The send's `pluginInputs`. Null when the sender addressed no plugin —
   * which is not the same as an empty map, so the column is nullable rather
   * than defaulting to `{}`.
   */
  pluginInputs: PluginInputs | null;
}

export interface UpdateQueuedThreadMessageInput {
  content: PromptInput[];
  expectedUpdatedAt: number;
  id: string;
  threadId: string;
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

export interface DeleteClaimedQueuedThreadMessageBatchInTransactionArgs {
  queuedMessages: readonly ClaimedQueuedThreadMessageMutationArgs[];
}

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

export type UpdateQueuedThreadMessageResult =
  | { kind: "updated"; queuedMessage: QueuedThreadMessageRow }
  | { kind: "not_found" }
  | { kind: "claimed" }
  | { kind: "stale" };

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

export function listQueuedThreadMessages(
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
  const queuedMessages = listQueuedThreadMessages(db, threadId);
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
    queuedMessages: listQueuedThreadMessages(db, threadId),
  };
}

function applyPreservedLeadGroupAfterReorder(
  db: DbTransaction,
  threadId: string,
  originalLeadGroupIds: readonly string[],
): QueuedThreadMessageRow[] {
  const queuedMessages = listQueuedThreadMessages(db, threadId);
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
    ? listQueuedThreadMessages(db, threadId)
    : queuedMessages;
}

export function createQueuedThreadMessageInTransaction(
  tx: DbTransaction,
  input: CreateQueuedThreadMessageInput,
) {
  const now = Date.now();
  const id = createQueuedThreadMessageId();
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
      pluginInputs:
        input.pluginInputs === null ? null : JSON.stringify(input.pluginInputs),
      groupWithNext: false,
      claimedAt: null,
      claimToken: null,
      sortKey,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export function createQueuedThreadMessage(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateQueuedThreadMessageInput,
) {
  const row = db.transaction(
    (tx) => createQueuedThreadMessageInTransaction(tx, input),
    { behavior: "immediate" },
  );
  notifier.notifyThread(input.threadId, ["queue-changed"]);
  return row;
}

export function updateQueuedThreadMessage(
  db: DbConnection,
  notifier: DbNotifier,
  input: UpdateQueuedThreadMessageInput,
): UpdateQueuedThreadMessageResult {
  const result = db.transaction(
    (tx): UpdateQueuedThreadMessageResult => {
      const existing = getQueuedThreadMessageForMutation(tx, input.id);
      if (!existing || existing.threadId !== input.threadId) {
        return { kind: "not_found" };
      }
      if (isQueuedThreadMessageClaimed(existing)) {
        return { kind: "claimed" };
      }
      if (existing.updatedAt !== input.expectedUpdatedAt) {
        return { kind: "stale" };
      }

      const queuedMessage = tx
        .update(queuedThreadMessages)
        .set({
          content: JSON.stringify(input.content),
          updatedAt: Math.max(Date.now(), existing.updatedAt + 1),
        })
        .where(eq(queuedThreadMessages.id, input.id))
        .returning()
        .get();
      if (!queuedMessage) {
        return { kind: "not_found" };
      }
      return { kind: "updated", queuedMessage };
    },
    { behavior: "immediate" },
  );

  if (result.kind === "updated") {
    notifier.notifyThread(input.threadId, ["queue-changed"]);
  }
  return result;
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

export function hasQueuedThreadMessages(
  db: DbQueryConnection,
  threadId: string,
): boolean {
  return (
    db
      .select({ id: queuedThreadMessages.id })
      .from(queuedThreadMessages)
      .where(eq(queuedThreadMessages.threadId, threadId))
      .limit(1)
      .get() !== undefined
  );
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
    .innerJoin(environments, eq(environments.id, threads.environmentId))
    .where(
      and(
        eq(threads.status, "idle"),
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
        notInArray(environments.status, ["destroying", "destroyed"]),
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

      const queuedMessages = listQueuedThreadMessages(
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

export function claimNextQueuedThreadMessageGroup(
  db: DbConnection,
  notifier: DbNotifier,
  threadId: string,
): ClaimedQueuedThreadMessageRow[] | null {
  const claimedQueuedMessages = db.transaction(
    (tx) => {
      const queuedMessages = listQueuedThreadMessages(tx, threadId);
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

        const currentQueuedMessages = listQueuedThreadMessages(
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
          queuedMessages: listQueuedThreadMessages(tx, threadId),
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

/**
 * A row is live while no drain worker holds it. Parking, re-parking and
 * clearing a wait are all lost updates against a row that is already being
 * dispatched, so every wait mutation is gated on liveness in the same
 * statement that performs it.
 */
function liveQueuedThreadMessage() {
  return and(
    isNull(queuedThreadMessages.claimedAt),
    isNull(queuedThreadMessages.claimToken),
  );
}

/**
 * The single place `wait_holder` is derived from `waiting_on`. Keeping it here
 * — rather than letting callers pass a holder — is what makes the
 * denormalization safe: the two columns are always written together, from the
 * same value.
 */
function waitHolderFor(
  waitingOn: QueuedMessageWaitingOn,
): QueuedMessageWaitHolder | null {
  return waitingOn.kind === "plugin"
    ? `${QUEUED_MESSAGE_PLUGIN_WAIT_HOLDER_PREFIX}${waitingOn.pluginId}`
    : null;
}

export interface SetQueuedThreadMessageWaitingOnArgs {
  id: string;
  threadId: string;
  waitingOn: QueuedMessageWaitingOn;
  /**
   * The row's scheduled instant. Passed on every call rather than left alone,
   * because a re-park is a fresh statement of when this row may run: a
   * `time` wait sets it, and every other wait kind clears it by passing null.
   */
  sendAt: number | null;
}

export interface ClearQueuedThreadMessageWaitingOnArgs {
  id: string;
  threadId: string;
}

export interface ListQueuedThreadMessagesWaitingOnKindArgs {
  kind: QueuedMessageWaitingOnKind;
  threadId: string;
}

/**
 * Park a live row on a typed wait. Returns the updated row, or null when the
 * row is gone, belongs to another thread, or has already been claimed.
 */
export function setQueuedThreadMessageWaitingOn(
  db: DbConnection,
  notifier: DbNotifier,
  args: SetQueuedThreadMessageWaitingOnArgs,
): QueuedThreadMessageRow | null {
  const updated =
    db
      .update(queuedThreadMessages)
      .set({
        waitingOn: JSON.stringify(args.waitingOn),
        waitHolder: waitHolderFor(args.waitingOn),
        sendAt: args.sendAt,
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(queuedThreadMessages.id, args.id),
          eq(queuedThreadMessages.threadId, args.threadId),
          liveQueuedThreadMessage(),
        ),
      )
      .returning()
      .get() ?? null;

  if (updated) {
    notifier.notifyThread(args.threadId, ["queue-changed"]);
  }
  return updated;
}

/**
 * Drop a live row's wait, leaving it an ordinary queued row eligible at the
 * next drain. `sendAt` is cleared with it: a row with no wait is not waiting
 * for a clock either.
 */
export function clearQueuedThreadMessageWaitingOn(
  db: DbConnection,
  notifier: DbNotifier,
  args: ClearQueuedThreadMessageWaitingOnArgs,
): QueuedThreadMessageRow | null {
  const updated =
    db
      .update(queuedThreadMessages)
      .set({
        waitingOn: null,
        waitHolder: null,
        sendAt: null,
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(queuedThreadMessages.id, args.id),
          eq(queuedThreadMessages.threadId, args.threadId),
          liveQueuedThreadMessage(),
        ),
      )
      .returning()
      .get() ?? null;

  if (updated) {
    notifier.notifyThread(args.threadId, ["queue-changed"]);
  }
  return updated;
}

/**
 * Rows whose scheduled instant has arrived and that a drain may act on now,
 * oldest-due first. Threads that are archived or deleted are excluded here
 * rather than by the caller, so a scheduled send into a thread the user threw
 * away never wakes the sweep every cycle (the #1789 shape).
 *
 * The thread check is a correlated EXISTS rather than a join on purpose. A
 * join lets SQLite drive from `threads` — scanning every live thread to find
 * the few with a due row — which throws away the partial due index entirely.
 * EXISTS forces the queue table to be the outer loop, so the sweep costs one
 * index range scan plus a primary-key probe per hit.
 */
export function listDueScheduledQueuedThreadMessages(
  db: DbQueryConnection,
  now: number,
): QueuedThreadMessageRow[] {
  return db
    .select()
    .from(queuedThreadMessages)
    .where(
      and(
        isNotNull(queuedThreadMessages.sendAt),
        lte(queuedThreadMessages.sendAt, now),
        liveQueuedThreadMessage(),
        exists(
          db
            .select({ live: sql`1` })
            .from(threads)
            .where(
              and(
                eq(threads.id, queuedThreadMessages.threadId),
                isNull(threads.archivedAt),
                isNull(threads.deletedAt),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(queuedThreadMessages.sendAt), asc(queuedThreadMessages.id))
    .all();
}

/**
 * Every live row a given wait owner holds. This is the query `wait_holder`
 * exists for: the orphan sweep asks it per uninstalled plugin, and a plugin
 * clearing its wait asks it for its own id.
 */
export function listQueuedThreadMessagesByWaitHolder(
  db: DbQueryConnection,
  waitHolder: QueuedMessageWaitHolder,
): QueuedThreadMessageRow[] {
  return db
    .select()
    .from(queuedThreadMessages)
    .where(
      and(
        eq(queuedThreadMessages.waitHolder, waitHolder),
        liveQueuedThreadMessage(),
      ),
    )
    .orderBy(asc(queuedThreadMessages.id))
    .all();
}

/**
 * A thread's live rows parked on one kind of wait, in queue order. Read
 * straight out of the stored JSON so the kind has exactly one home; the
 * thread predicate is what makes this selective, so no index on the extracted
 * kind is warranted.
 */
export function listQueuedThreadMessagesWaitingOnKind(
  db: DbQueryConnection,
  args: ListQueuedThreadMessagesWaitingOnKindArgs,
): QueuedThreadMessageRow[] {
  return db
    .select()
    .from(queuedThreadMessages)
    .where(
      and(
        eq(queuedThreadMessages.threadId, args.threadId),
        sql`json_extract(${queuedThreadMessages.waitingOn}, '$.kind') = ${args.kind}`,
        liveQueuedThreadMessage(),
      ),
    )
    .orderBy(asc(queuedThreadMessages.sortKey), asc(queuedThreadMessages.id))
    .all();
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
