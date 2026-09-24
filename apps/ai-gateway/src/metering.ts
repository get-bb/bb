import { and, eq, lt, sql } from "drizzle-orm";
import {
  type ConnectDb,
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

export interface BudgetKey {
  userId: string;
  day: string;
}

export async function reserveBudget(
  db: ConnectDb,
  key: BudgetKey,
  limitMicros: number,
  reserveMicros: number = RESERVE_MICROS,
): Promise<boolean> {
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
        sql`${aiUsageDay.spentMicros} + ${aiUsageDay.reservedMicros} + ${reserveMicros} <= ${limitMicros}`,
      ),
    )
    .run();
  return rowsChanged(userReserved) > 0;
}

export async function settleBudget(
  db: ConnectDb,
  key: BudgetKey,
  costMicros: number,
  reserveMicros: number = RESERVE_MICROS,
): Promise<{ spentTodayMicros: number }> {
  const charged = Math.max(0, Math.round(costMicros));
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
