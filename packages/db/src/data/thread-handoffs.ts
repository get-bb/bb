import { and, asc, eq, gt, or } from "drizzle-orm";
import type { PermissionMode, ReasoningLevel, ServiceTier } from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import { createThreadHandoffId } from "../ids.js";
import { threadHandoffs } from "../schema.js";

type ThreadHandoffConnection = DbConnection | DbTransaction;

export type ThreadHandoffRow = typeof threadHandoffs.$inferSelect;

export interface CreateThreadHandoffInput {
  archiveSource: boolean;
  environmentId: string;
  idempotencyKey: string;
  model: string;
  now?: number;
  permissionMode: PermissionMode;
  projectId: string;
  providerId: string;
  reasoningLevel: ReasoningLevel;
  replacementThreadId: string;
  serviceTier: ServiceTier | null;
  sourceThreadId: string;
}

export type CreateThreadHandoffResult =
  | { created: true; handoff: ThreadHandoffRow }
  | { created: false; handoff: ThreadHandoffRow };

export interface ThreadHandoffIdempotencyKey {
  idempotencyKey: string;
  sourceThreadId: string;
}

export interface ThreadHandoffPageCursor {
  createdAt: number;
  id: string;
}

export interface ListProvisioningThreadHandoffsArgs {
  after?: ThreadHandoffPageCursor;
  limit: number;
}

export interface ProvisioningThreadHandoffPage {
  handoffs: ThreadHandoffRow[];
  nextCursor: ThreadHandoffPageCursor | null;
}

export type SettleThreadHandoffResult =
  | { applied: true; handoff: ThreadHandoffRow }
  | {
      applied: false;
      handoff: null;
      reason: "not-found";
    }
  | {
      applied: false;
      handoff: ThreadHandoffRow;
      reason: "already-settled";
    };

export interface MarkThreadHandoffStartedArgs {
  replacementThreadId: string;
  settledAt?: number;
}

export interface MarkThreadHandoffFailedArgs {
  failure: {
    code: string;
    message: string;
  };
  replacementThreadId: string;
  settledAt?: number;
}

export function getThreadHandoffByReplacementThreadId(
  db: ThreadHandoffConnection,
  replacementThreadId: string,
): ThreadHandoffRow | null {
  return (
    db
      .select()
      .from(threadHandoffs)
      .where(eq(threadHandoffs.replacementThreadId, replacementThreadId))
      .get() ?? null
  );
}

export function getThreadHandoffBySourceAndIdempotencyKey(
  db: ThreadHandoffConnection,
  key: ThreadHandoffIdempotencyKey,
): ThreadHandoffRow | null {
  return (
    db
      .select()
      .from(threadHandoffs)
      .where(
        and(
          eq(threadHandoffs.sourceThreadId, key.sourceThreadId),
          eq(threadHandoffs.idempotencyKey, key.idempotencyKey),
        ),
      )
      .get() ?? null
  );
}

export function createThreadHandoff(
  db: ThreadHandoffConnection,
  input: CreateThreadHandoffInput,
): CreateThreadHandoffResult {
  const now = input.now ?? Date.now();
  const inserted = db
    .insert(threadHandoffs)
    .values({
      id: createThreadHandoffId(),
      sourceThreadId: input.sourceThreadId,
      replacementThreadId: input.replacementThreadId,
      projectId: input.projectId,
      environmentId: input.environmentId,
      providerId: input.providerId,
      model: input.model,
      reasoningLevel: input.reasoningLevel,
      serviceTier: input.serviceTier,
      permissionMode: input.permissionMode,
      archiveSource: input.archiveSource,
      idempotencyKey: input.idempotencyKey,
      status: "provisioning",
      failureCode: null,
      failureMessage: null,
      createdAt: now,
      updatedAt: now,
      settledAt: null,
    })
    .onConflictDoNothing({
      target: [threadHandoffs.sourceThreadId, threadHandoffs.idempotencyKey],
    })
    .returning()
    .get();

  if (inserted) {
    return { created: true, handoff: inserted };
  }

  const existing = getThreadHandoffBySourceAndIdempotencyKey(db, input);
  if (!existing) {
    throw new Error("thread handoff idempotency conflict did not resolve");
  }
  return { created: false, handoff: existing };
}

export function listProvisioningThreadHandoffs(
  db: ThreadHandoffConnection,
  args: ListProvisioningThreadHandoffsArgs,
): ProvisioningThreadHandoffPage {
  if (args.limit <= 0) {
    return { handoffs: [], nextCursor: null };
  }

  const rows = db
    .select()
    .from(threadHandoffs)
    .where(
      and(
        eq(threadHandoffs.status, "provisioning"),
        args.after
          ? or(
              gt(threadHandoffs.createdAt, args.after.createdAt),
              and(
                eq(threadHandoffs.createdAt, args.after.createdAt),
                gt(threadHandoffs.id, args.after.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(asc(threadHandoffs.createdAt), asc(threadHandoffs.id))
    .limit(args.limit + 1)
    .all();
  const hasMore = rows.length > args.limit;
  const handoffs = hasMore ? rows.slice(0, args.limit) : rows;
  const last = handoffs.at(-1);

  return {
    handoffs,
    nextCursor:
      hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

function settleThreadHandoff(
  db: ThreadHandoffConnection,
  args: {
    failureCode: string | null;
    failureMessage: string | null;
    replacementThreadId: string;
    settledAt: number;
    status: "failed" | "started";
  },
): SettleThreadHandoffResult {
  const updated = db
    .update(threadHandoffs)
    .set({
      status: args.status,
      failureCode: args.failureCode,
      failureMessage: args.failureMessage,
      settledAt: args.settledAt,
      updatedAt: args.settledAt,
    })
    .where(
      and(
        eq(threadHandoffs.replacementThreadId, args.replacementThreadId),
        eq(threadHandoffs.status, "provisioning"),
      ),
    )
    .returning()
    .get();
  if (updated) {
    return { applied: true, handoff: updated };
  }

  const existing = getThreadHandoffByReplacementThreadId(
    db,
    args.replacementThreadId,
  );
  return existing
    ? { applied: false, reason: "already-settled", handoff: existing }
    : { applied: false, reason: "not-found", handoff: null };
}

export function markThreadHandoffStarted(
  db: ThreadHandoffConnection,
  args: MarkThreadHandoffStartedArgs,
): SettleThreadHandoffResult {
  return settleThreadHandoff(db, {
    replacementThreadId: args.replacementThreadId,
    status: "started",
    failureCode: null,
    failureMessage: null,
    settledAt: args.settledAt ?? Date.now(),
  });
}

export function markThreadHandoffFailed(
  db: ThreadHandoffConnection,
  args: MarkThreadHandoffFailedArgs,
): SettleThreadHandoffResult {
  return settleThreadHandoff(db, {
    replacementThreadId: args.replacementThreadId,
    status: "failed",
    failureCode: args.failure.code,
    failureMessage: args.failure.message,
    settledAt: args.settledAt ?? Date.now(),
  });
}
