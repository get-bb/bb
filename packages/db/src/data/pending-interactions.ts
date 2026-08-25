import { and, desc, eq, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PendingInteractionStatus } from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import { createPendingInteractionId } from "../ids.js";
import { pendingInteractions } from "../schema.js";

type PendingInteractionWriteConnection = DbConnection | DbTransaction;
type PendingInteractionReadConnection = DbConnection | DbTransaction;

export type PendingInteractionRow = typeof pendingInteractions.$inferSelect;

interface CreatePendingInteractionInputBase {
  expiresAt?: number | null;
  payload: string;
  threadId: string;
}

export type CreatePendingInteractionInput =
  | (CreatePendingInteractionInputBase & {
      originKind?: "provider";
      providerId: string;
      providerRequestId: string;
      providerThreadId: string;
      turnId: string;
    })
  | (CreatePendingInteractionInputBase & {
      originKind: "plugin";
      pluginId: string;
      rendererId: string;
      turnId: string | null;
    });

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

export interface InterruptPendingInteractionsForPluginArgs {
  pluginId: string;
  resolvedAt?: number;
  statusReason: string;
}

export interface PruneSettledPendingInteractionsArgs {
  createdBefore: number;
  limit: number;
}

export interface PruneSettledPendingInteractionsResult {
  deleted: number;
}

const SQLITE_IN_CLAUSE_BATCH_SIZE = 900;

/**
 * Settled interaction rows stay inspectable for a month, then their payloads
 * (full approval diffs and command text) are reclaimed. Retention policy —
 * revisit deliberately, not incidentally.
 */
export const SETTLED_PENDING_INTERACTION_RETENTION_MS = 30 * 24 * 60 * 60_000;
export const DEFAULT_SETTLED_PENDING_INTERACTION_PRUNE_BATCH_SIZE = 1_000;

/** Terminal statuses; rows in these statuses are never read for live work. */
const SETTLED_PENDING_INTERACTION_STATUSES = [
  "resolved",
  "interrupted",
] as const satisfies readonly PendingInteractionStatus[];

type SettledPendingInteractionDeleteParameters = [
  PendingInteractionStatus,
  number,
  number,
];

/**
 * Deletes settled (resolved or interrupted) interaction rows created before
 * the cutoff. Their payloads hold full approval prompts (diffs, command
 * text), so without a prune they accumulate forever. Retention keys on
 * `created_at` rather than `resolved_at` because the covering
 * `pending_interactions_status_created_idx` exists for `(status, created_at)`
 * and a settled row's resolution follows its creation within the same
 * approval flow, so a creation-time cutoff is equivalent at retention
 * horizons. Pending/resolving rows are never touched.
 */
export function pruneSettledPendingInteractions(
  db: DbConnection,
  args: PruneSettledPendingInteractionsArgs,
): PruneSettledPendingInteractionsResult {
  let deleted = 0;
  for (const status of SETTLED_PENDING_INTERACTION_STATUSES) {
    const remainingLimit = args.limit - deleted;
    if (remainingLimit <= 0) {
      break;
    }
    // Keep the prune plan pinned to the retention index; this path runs
    // periodically and can otherwise regress into a scan plus temp sort.
    const result = db.$client
      .prepare<SettledPendingInteractionDeleteParameters>(
        `
          DELETE FROM pending_interactions
          WHERE id IN (
            SELECT id
            FROM pending_interactions INDEXED BY pending_interactions_status_created_idx
            WHERE status = ?
              AND created_at < ?
            ORDER BY created_at
            LIMIT ?
          )
        `,
      )
      .run(status, args.createdBefore, remainingLimit);
    deleted += result.changes;
  }

  return { deleted };
}

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
      originKind: input.originKind ?? "provider",
      turnId: input.turnId,
      providerId: input.originKind !== "plugin" ? input.providerId : null,
      providerThreadId:
        input.originKind !== "plugin" ? input.providerThreadId : null,
      providerRequestId:
        input.originKind !== "plugin" ? input.providerRequestId : null,
      pluginId: input.originKind === "plugin" ? input.pluginId : null,
      rendererId: input.originKind === "plugin" ? input.rendererId : null,
      status: "pending",
      payload: input.payload,
      resolution: null,
      statusReason: null,
      createdAt: now,
      expiresAt: input.expiresAt ?? null,
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
  return (
    db
      .select()
      .from(pendingInteractions)
      .where(eq(pendingInteractions.id, id))
      .get() ?? null
  );
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
          eq(pendingInteractions.originKind, "provider"),
          eq(pendingInteractions.providerId, args.providerId),
          eq(pendingInteractions.providerThreadId, args.providerThreadId),
          eq(pendingInteractions.providerRequestId, args.providerRequestId),
        ),
      )
      .get() ?? null
  );
}

export function listActivePluginPendingInteractions(
  db: PendingInteractionReadConnection,
): PendingInteractionRow[] {
  return db
    .select()
    .from(pendingInteractions)
    .where(
      and(
        eq(pendingInteractions.originKind, "plugin"),
        inArray(pendingInteractions.status, ["pending", "resolving"]),
      ),
    )
    .orderBy(desc(pendingInteractions.createdAt))
    .all();
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
    extraConditions: [
      eq(pendingInteractions.originKind, "provider"),
      eq(pendingInteractions.providerId, args.providerId),
    ],
    resolvedAt: args.resolvedAt,
    statusReason: args.statusReason,
    threadIds: args.threadIds,
  });
}

export function interruptPendingInteractionsForPlugin(
  db: PendingInteractionWriteConnection,
  args: InterruptPendingInteractionsForPluginArgs,
): PendingInteractionRow[] {
  const now = Date.now();
  return db
    .update(pendingInteractions)
    .set({
      status: "interrupted",
      statusReason: args.statusReason,
      resolvedAt: args.resolvedAt ?? now,
      updatedAt: now,
    })
    .where(
      and(
        eq(pendingInteractions.originKind, "plugin"),
        eq(pendingInteractions.pluginId, args.pluginId),
        inArray(pendingInteractions.status, ["pending", "resolving"]),
      ),
    )
    .returning()
    .all();
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
