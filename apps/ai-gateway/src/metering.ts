import { and, eq, lt, sql } from "drizzle-orm";
import {
  type ConnectDb,
  aiGlobalUsageDay,
  aiRequestLog,
  aiUsageDay,
  rowsChanged,
} from "@bb/connect-db";

export const RESERVE_MICROS = 5_000;
export const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
  );
}

export type ReserveOutcome = "reserved" | "user_exhausted" | "global_exhausted";

export interface BudgetKey {
  userId: string;
  day: string;
}

export async function reserveBudget(
  db: ConnectDb,
  key: BudgetKey,
  limits: { userLimitMicros: number; globalLimitMicros: number },
  reserveMicros: number = RESERVE_MICROS,
): Promise<ReserveOutcome> {
  await db
    .insert(aiUsageDay)
    .values({ userId: key.userId, day: key.day })
    .onConflictDoNothing()
    .run();
  const userReserved = await db
    .update(aiUsageDay)
    .set({
      reservedMicros: sql`${aiUsageDay.reservedMicros} + ${reserveMicros}`,
      requests: sql`${aiUsageDay.requests} + 1`,
    })
    .where(
      and(
        eq(aiUsageDay.userId, key.userId),
        eq(aiUsageDay.day, key.day),
        sql`${aiUsageDay.spentMicros} + ${aiUsageDay.reservedMicros} + ${reserveMicros} <= ${limits.userLimitMicros}`,
      ),
    )
    .run();
  if (rowsChanged(userReserved) === 0) return "user_exhausted";

  await db
    .insert(aiGlobalUsageDay)
    .values({ day: key.day })
    .onConflictDoNothing()
    .run();
  const globalReserved = await db
    .update(aiGlobalUsageDay)
    .set({
      reservedMicros: sql`${aiGlobalUsageDay.reservedMicros} + ${reserveMicros}`,
    })
    .where(
      and(
        eq(aiGlobalUsageDay.day, key.day),
        sql`${aiGlobalUsageDay.spentMicros} + ${aiGlobalUsageDay.reservedMicros} + ${reserveMicros} <= ${limits.globalLimitMicros}`,
      ),
    )
    .run();
  if (rowsChanged(globalReserved) === 0) {
    await db
      .update(aiUsageDay)
      .set({
        reservedMicros: sql`max(${aiUsageDay.reservedMicros} - ${reserveMicros}, 0)`,
        requests: sql`max(${aiUsageDay.requests} - 1, 0)`,
      })
      .where(
        and(eq(aiUsageDay.userId, key.userId), eq(aiUsageDay.day, key.day)),
      )
      .run();
    return "global_exhausted";
  }
  return "reserved";
}

export async function settleBudget(
  db: ConnectDb,
  key: BudgetKey,
  costMicros: number,
  reserveMicros: number = RESERVE_MICROS,
): Promise<{ spentTodayMicros: number }> {
  const charged = Math.max(0, Math.round(costMicros));
  await db
    .update(aiGlobalUsageDay)
    .set({
      reservedMicros: sql`max(${aiGlobalUsageDay.reservedMicros} - ${reserveMicros}, 0)`,
      spentMicros: sql`${aiGlobalUsageDay.spentMicros} + ${charged}`,
    })
    .where(eq(aiGlobalUsageDay.day, key.day))
    .run();
  const settled = await db
    .update(aiUsageDay)
    .set({
      reservedMicros: sql`max(${aiUsageDay.reservedMicros} - ${reserveMicros}, 0)`,
      spentMicros: sql`${aiUsageDay.spentMicros} + ${charged}`,
    })
    .where(and(eq(aiUsageDay.userId, key.userId), eq(aiUsageDay.day, key.day)))
    .returning({ spentMicros: aiUsageDay.spentMicros })
    .get();
  return { spentTodayMicros: settled?.spentMicros ?? charged };
}

export async function spentMicros(
  db: ConnectDb,
  key: BudgetKey,
): Promise<number> {
  const row = await db
    .select({ spentMicros: aiUsageDay.spentMicros })
    .from(aiUsageDay)
    .where(and(eq(aiUsageDay.userId, key.userId), eq(aiUsageDay.day, key.day)))
    .get();
  return row?.spentMicros ?? 0;
}

export async function pruneAiUsage(db: ConnectDb, now: number): Promise<void> {
  const cutoff = now - RETENTION_DAYS * DAY_MS;
  await db
    .delete(aiRequestLog)
    .where(lt(aiRequestLog.createdAt, new Date(cutoff)))
    .run();
  await db
    .delete(aiUsageDay)
    .where(lt(aiUsageDay.day, utcDay(cutoff)))
    .run();
}
