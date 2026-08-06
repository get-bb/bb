import { count, eq, lte } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { principalAssertionReplays } from "../schema.js";

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const MIN_MAX_ENTRIES = 1;
const MAX_MAX_ENTRIES = 100_000;

export type ConsumePrincipalAssertionReplayResult =
  | "consumed"
  | "replayed"
  | "capacity_exhausted";

export interface ConsumePrincipalAssertionReplayArgs {
  db: DbConnection;
  expiresAtMs: number;
  jti: string;
  maxEntries: number;
  nowMs: number;
}

function isFiniteSafeNonnegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function assertConsumePrincipalAssertionReplayArgs(
  args: ConsumePrincipalAssertionReplayArgs,
): void {
  if (typeof args.jti !== "string" || !CANONICAL_UUID_PATTERN.test(args.jti)) {
    throw new Error("Invalid principal assertion replay jti");
  }

  if (
    !isFiniteSafeNonnegativeInteger(args.nowMs) ||
    !isFiniteSafeNonnegativeInteger(args.expiresAtMs) ||
    !(args.expiresAtMs > args.nowMs)
  ) {
    throw new Error("Invalid principal assertion replay timestamps");
  }

  if (
    typeof args.maxEntries !== "number" ||
    !Number.isSafeInteger(args.maxEntries) ||
    args.maxEntries < MIN_MAX_ENTRIES ||
    args.maxEntries > MAX_MAX_ENTRIES
  ) {
    throw new Error("Invalid principal assertion replay maxEntries");
  }
}

/**
 * Atomically records a principal assertion jti for replay detection.
 * Prunes expired rows opportunistically, then fail-closes at capacity
 * without evicting unexpired entries.
 */
export function consumePrincipalAssertionReplay(
  args: ConsumePrincipalAssertionReplayArgs,
): ConsumePrincipalAssertionReplayResult {
  assertConsumePrincipalAssertionReplayArgs(args);

  const { db, expiresAtMs, jti, maxEntries, nowMs } = args;

  return db.transaction((tx) => {
    tx.delete(principalAssertionReplays)
      .where(lte(principalAssertionReplays.expiresAt, nowMs))
      .run();

    const existing = tx
      .select({ jti: principalAssertionReplays.jti })
      .from(principalAssertionReplays)
      .where(eq(principalAssertionReplays.jti, jti))
      .get();
    if (existing !== undefined) {
      return "replayed";
    }

    const rowCount =
      tx
        .select({ value: count() })
        .from(principalAssertionReplays)
        .get()?.value ?? 0;
    if (rowCount >= maxEntries) {
      return "capacity_exhausted";
    }

    const inserted = tx
      .insert(principalAssertionReplays)
      .values({
        consumedAt: nowMs,
        expiresAt: expiresAtMs,
        jti,
      })
      .onConflictDoNothing({ target: principalAssertionReplays.jti })
      .run();
    if (inserted.changes !== 1) {
      return "replayed";
    }

    return "consumed";
  });
}
