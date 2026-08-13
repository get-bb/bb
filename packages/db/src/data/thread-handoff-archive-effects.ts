import { and, asc, eq, isNull, lte, notInArray, or } from "drizzle-orm";
import type { DbConnection, DbTransaction } from "../connection.js";
import { createThreadHandoffArchiveEffectClaimToken } from "../ids.js";
import {
  threadHandoffArchiveEffects,
  type ThreadHandoffArchiveEffectType,
} from "../schema.js";

type ThreadHandoffArchiveEffectConnection = DbConnection | DbTransaction;

export type ThreadHandoffArchiveEffectRow =
  typeof threadHandoffArchiveEffects.$inferSelect;

export interface CreateThreadHandoffArchiveEffectInput {
  effectKey: string;
  effectType: ThreadHandoffArchiveEffectType;
  payload: string;
}

export function createThreadHandoffArchiveEffects(
  db: ThreadHandoffArchiveEffectConnection,
  args: {
    effects: CreateThreadHandoffArchiveEffectInput[];
    handoffId: string;
    now?: number;
  },
): void {
  if (args.effects.length === 0) return;
  const now = args.now ?? Date.now();
  db.insert(threadHandoffArchiveEffects)
    .values(
      args.effects.map((effect) => ({
        ...effect,
        handoffId: args.handoffId,
        claimToken: null,
        claimExpiresAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing()
    .run();
}

export function listThreadHandoffArchiveEffects(
  db: ThreadHandoffArchiveEffectConnection,
  handoffId: string,
): ThreadHandoffArchiveEffectRow[] {
  return db
    .select()
    .from(threadHandoffArchiveEffects)
    .where(eq(threadHandoffArchiveEffects.handoffId, handoffId))
    .orderBy(asc(threadHandoffArchiveEffects.effectKey))
    .all();
}

export function claimNextThreadHandoffArchiveEffect(
  db: DbConnection,
  args: {
    excludeEffectKeys?: string[];
    handoffId: string;
    leaseMs: number;
    now?: number;
  },
): ThreadHandoffArchiveEffectRow | null {
  const now = args.now ?? Date.now();
  const claimable = or(
    isNull(threadHandoffArchiveEffects.claimExpiresAt),
    lte(threadHandoffArchiveEffects.claimExpiresAt, now),
  );
  return db.transaction(
    (tx) => {
      const candidate = tx
        .select()
        .from(threadHandoffArchiveEffects)
        .where(
          and(
            eq(threadHandoffArchiveEffects.handoffId, args.handoffId),
            isNull(threadHandoffArchiveEffects.completedAt),
            claimable,
            args.excludeEffectKeys?.length
              ? notInArray(
                  threadHandoffArchiveEffects.effectKey,
                  args.excludeEffectKeys,
                )
              : undefined,
          ),
        )
        .orderBy(asc(threadHandoffArchiveEffects.effectKey))
        .limit(1)
        .get();
      if (!candidate) return null;
      const claimToken = createThreadHandoffArchiveEffectClaimToken();
      return (
        tx
          .update(threadHandoffArchiveEffects)
          .set({
            claimToken,
            claimExpiresAt: now + args.leaseMs,
            updatedAt: now,
          })
          .where(
            and(
              eq(threadHandoffArchiveEffects.handoffId, candidate.handoffId),
              eq(threadHandoffArchiveEffects.effectKey, candidate.effectKey),
              isNull(threadHandoffArchiveEffects.completedAt),
              claimable,
              args.excludeEffectKeys?.length
                ? notInArray(
                    threadHandoffArchiveEffects.effectKey,
                    args.excludeEffectKeys,
                  )
                : undefined,
            ),
          )
          .returning()
          .get() ?? null
      );
    },
    { behavior: "immediate" },
  );
}

export function completeClaimedThreadHandoffArchiveEffect(
  db: ThreadHandoffArchiveEffectConnection,
  args: {
    claimToken: string;
    completedAt?: number;
    effectKey: string;
    handoffId: string;
  },
): boolean {
  const completedAt = args.completedAt ?? Date.now();
  return (
    db
      .update(threadHandoffArchiveEffects)
      .set({
        claimToken: null,
        claimExpiresAt: null,
        completedAt,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(threadHandoffArchiveEffects.handoffId, args.handoffId),
          eq(threadHandoffArchiveEffects.effectKey, args.effectKey),
          eq(threadHandoffArchiveEffects.claimToken, args.claimToken),
          isNull(threadHandoffArchiveEffects.completedAt),
        ),
      )
      .run().changes === 1
  );
}

export function releaseClaimedThreadHandoffArchiveEffect(
  db: ThreadHandoffArchiveEffectConnection,
  args: { claimToken: string; effectKey: string; handoffId: string; now?: number },
): boolean {
  const now = args.now ?? Date.now();
  return (
    db
      .update(threadHandoffArchiveEffects)
      .set({ claimToken: null, claimExpiresAt: null, updatedAt: now })
      .where(
        and(
          eq(threadHandoffArchiveEffects.handoffId, args.handoffId),
          eq(threadHandoffArchiveEffects.effectKey, args.effectKey),
          eq(threadHandoffArchiveEffects.claimToken, args.claimToken),
          isNull(threadHandoffArchiveEffects.completedAt),
        ),
      )
      .run().changes === 1
  );
}

export function areThreadHandoffArchiveEffectsCompleted(
  db: ThreadHandoffArchiveEffectConnection,
  handoffId: string,
): boolean {
  return (
    db
      .select({ effectKey: threadHandoffArchiveEffects.effectKey })
      .from(threadHandoffArchiveEffects)
      .where(
        and(
          eq(threadHandoffArchiveEffects.handoffId, handoffId),
          isNull(threadHandoffArchiveEffects.completedAt),
        ),
      )
      .limit(1)
      .get() === undefined
  );
}
