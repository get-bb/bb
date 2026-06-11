import { and, desc, eq, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PendingInteractionStatus } from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import { createPendingInteractionId } from "../ids.js";
import { pendingInteractions } from "../schema.js";

type PendingInteractionWriteConnection = DbConnection | DbTransaction;
type PendingInteractionReadConnection = DbConnection | DbTransaction;

export type PendingInteractionRow = typeof pendingInteractions.$inferSelect;

export interface CreatePendingInteractionInput {
  payload: string;
  providerId: string;
  providerRequestId: string;
  providerThreadId: string;
  threadId: string;
  turnId: string;
}

export interface PendingInteractionProviderRequestIdentity {
  providerId: string;
  providerRequestId: string;
  providerThreadId: string;
}

export interface ListPendingInteractionsArgs {
  limit?: number;
  statuses?: readonly PendingInteractionStatus[];
  threadId: string;
}

export interface SetPendingInteractionTerminalStateArgs {
  allowedCurrentStatuses?: readonly PendingInteractionStatus[];
  id: string;
  resolution: string | null;
  resolvedAt?: number;
  status: "interrupted" | "resolved";
  statusReason: string | null;
}

export interface SetPendingInteractionResolvingArgs {
  id: string;
  resolution: string;
}

export interface InterruptPendingInteractionsForThreadsArgs {
  providerId: string;
  resolvedAt?: number;
  statusReason: string;
  threadIds: readonly string[];
}

export interface InterruptPendingInteractionsForThreadIdsArgs {
  resolvedAt?: number;
  statusReason: string;
  threadIds: readonly string[];
}

const SQLITE_IN_CLAUSE_BATCH_SIZE = 900;

function sliceInClauseBatches<T>(values: readonly T[]): T[][] {
  const batches: T[][] = [];

  for (
    let offset = 0;
    offset < values.length;
    offset += SQLITE_IN_CLAUSE_BATCH_SIZE
  ) {
    batches.push(values.slice(offset, offset + SQLITE_IN_CLAUSE_BATCH_SIZE));
  }

  return batches;
}

function getPendingInteractionRecord(
  db: PendingInteractionReadConnection,
  id: string,
): PendingInteractionRow | null {
  return (
    db
      .select()
      .from(pendingInteractions)
      .where(eq(pendingInteractions.id, id))
      .get() ?? null
  );
}

function updatePendingInteractionTerminalState(
  db: PendingInteractionWriteConnection,
  args: SetPendingInteractionTerminalStateArgs,
): PendingInteractionRow | null {
  const now = Date.now();

  return (
    db
      .update(pendingInteractions)
      .set({
        status: args.status,
        resolution: args.resolution,
        statusReason: args.statusReason,
        resolvedAt: args.resolvedAt ?? now,
        updatedAt: now,
      })
      .where(
        and(
          eq(pendingInteractions.id, args.id),
          args.allowedCurrentStatuses
            ? inArray(pendingInteractions.status, [
                ...args.allowedCurrentStatuses,
              ])
            : undefined,
        ),
      )
      .returning()
      .get() ?? null
  );
}

export function createPendingInteraction(
  db: PendingInteractionWriteConnection,
  input: CreatePendingInteractionInput,
): PendingInteractionRow {
  const now = Date.now();

  return db
    .insert(pendingInteractions)
    .values({
      id: createPendingInteractionId(),
      threadId: input.threadId,
      turnId: input.turnId,
      providerId: input.providerId,
      providerThreadId: input.providerThreadId,
      providerRequestId: input.providerRequestId,
      status: "pending",
      payload: input.payload,
      resolution: null,
      statusReason: null,
      createdAt: now,
      resolvedAt: null,
      updatedAt: now,
    })
    .returning()
    .get();
}

export function getPendingInteraction(
  db: PendingInteractionReadConnection,
  id: string,
): PendingInteractionRow | null {
  return getPendingInteractionRecord(db, id);
}

export function getPendingInteractionByProviderRequest(
  db: PendingInteractionReadConnection,
  args: PendingInteractionProviderRequestIdentity,
): PendingInteractionRow | null {
  return (
    db
      .select()
      .from(pendingInteractions)
      .where(
        and(
          eq(pendingInteractions.providerId, args.providerId),
          eq(pendingInteractions.providerThreadId, args.providerThreadId),
          eq(pendingInteractions.providerRequestId, args.providerRequestId),
        ),
      )
      .get() ?? null
  );
}

export function getActivePendingInteractionForThread(
  db: PendingInteractionReadConnection,
  threadId: string,
): PendingInteractionRow | null {
  return (
    db
      .select()
      .from(pendingInteractions)
      .where(
        and(
          eq(pendingInteractions.threadId, threadId),
          inArray(pendingInteractions.status, ["pending", "resolving"]),
        ),
      )
      .orderBy(desc(pendingInteractions.createdAt))
      .get() ?? null
  );
}

export function listPendingInteractionsByThread(
  db: PendingInteractionReadConnection,
  args: ListPendingInteractionsArgs,
): PendingInteractionRow[] {
  const query = db
    .select()
    .from(pendingInteractions)
    .where(
      and(
        eq(pendingInteractions.threadId, args.threadId),
        args.statuses && args.statuses.length > 0
          ? inArray(pendingInteractions.status, [...args.statuses])
          : undefined,
      ),
    )
    .orderBy(desc(pendingInteractions.createdAt));

  return args.limit ? query.limit(args.limit).all() : query.all();
}

export function setPendingInteractionResolved(
  db: PendingInteractionWriteConnection,
  args: {
    id: string;
    resolution: string;
  },
): PendingInteractionRow | null {
  return updatePendingInteractionTerminalState(db, {
    id: args.id,
    allowedCurrentStatuses: ["pending", "resolving"],
    resolution: args.resolution,
    status: "resolved",
    statusReason: null,
  });
}

export function setPendingInteractionResolving(
  db: PendingInteractionWriteConnection,
  args: SetPendingInteractionResolvingArgs,
): PendingInteractionRow | null {
  const now = Date.now();

  return (
    db
      .update(pendingInteractions)
      .set({
        status: "resolving",
        resolution: args.resolution,
        statusReason: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(pendingInteractions.id, args.id),
          eq(pendingInteractions.status, "pending"),
        ),
      )
      .returning()
      .get() ?? null
  );
}

export function setPendingInteractionInterrupted(
  db: PendingInteractionWriteConnection,
  args: {
    id: string;
    statusReason: string;
  },
): PendingInteractionRow | null {
  return updatePendingInteractionTerminalState(db, {
    id: args.id,
    allowedCurrentStatuses: ["pending", "resolving"],
    resolution: null,
    status: "interrupted",
    statusReason: args.statusReason,
  });
}

function interruptPendingInteractionsBatched(
  db: PendingInteractionWriteConnection,
  args: {
    extraConditions: SQL[];
    resolvedAt?: number;
    statusReason: string;
    threadIds: readonly string[];
  },
): PendingInteractionRow[] {
  if (args.threadIds.length === 0) {
    return [];
  }

  const now = Date.now();
  const interruptedRows: PendingInteractionRow[] = [];

  for (const threadIdsBatch of sliceInClauseBatches(args.threadIds)) {
    interruptedRows.push(
      ...db
        .update(pendingInteractions)
        .set({
          status: "interrupted",
          statusReason: args.statusReason,
          resolvedAt: args.resolvedAt ?? now,
          updatedAt: now,
        })
        .where(
          and(
            ...args.extraConditions,
            inArray(pendingInteractions.threadId, threadIdsBatch),
            inArray(pendingInteractions.status, ["pending", "resolving"]),
          ),
        )
        .returning()
        .all(),
    );
  }

  return interruptedRows;
}

export function interruptPendingInteractionsForThreads(
  db: PendingInteractionWriteConnection,
  args: InterruptPendingInteractionsForThreadsArgs,
): PendingInteractionRow[] {
  return interruptPendingInteractionsBatched(db, {
    extraConditions: [eq(pendingInteractions.providerId, args.providerId)],
    resolvedAt: args.resolvedAt,
    statusReason: args.statusReason,
    threadIds: args.threadIds,
  });
}

export function interruptPendingInteractionsForThreadIds(
  db: PendingInteractionWriteConnection,
  args: InterruptPendingInteractionsForThreadIdsArgs,
): PendingInteractionRow[] {
  return interruptPendingInteractionsBatched(db, {
    extraConditions: [],
    resolvedAt: args.resolvedAt,
    statusReason: args.statusReason,
    threadIds: args.threadIds,
  });
}
