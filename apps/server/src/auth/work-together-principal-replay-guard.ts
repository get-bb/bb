import { consumePrincipalAssertionReplay, type DbConnection } from "@bb/db";
import { rejectWorkTogetherPrincipalAssertion } from "./work-together-principal-assertion-error.js";

export type PrincipalAssertionReplayConsumeResult =
  | "consumed"
  | "replayed"
  | "capacity_exhausted";

export type PrincipalAssertionReplayConsumeArgs = {
  readonly jti: string;
  readonly expiresAtMs: number;
  readonly nowMs: number;
};

/**
 * Async port for exact-jti assertion replay detection.
 * Production uses the SQLite ledger adapter; tests may supply fakes.
 */
export interface PrincipalAssertionReplayGuard {
  consume(
    args: PrincipalAssertionReplayConsumeArgs,
  ): Promise<PrincipalAssertionReplayConsumeResult>;
}

const DEFAULT_MAX_ENTRIES = 50_000;
const MIN_MAX_ENTRIES = 1;
const MAX_MAX_ENTRIES = 100_000;

export type SqlitePrincipalAssertionReplayGuardOptions = {
  readonly db: DbConnection;
  /** Maximum unexpired replay rows. Integer 1..100000; default 50000. */
  readonly maxEntries?: number;
};

/**
 * SQLite replay-guard adapter over `@bb/db.consumePrincipalAssertionReplay`.
 * There is no in-memory production adapter.
 */
export function createSqlitePrincipalAssertionReplayGuard(
  options: SqlitePrincipalAssertionReplayGuardOptions,
): PrincipalAssertionReplayGuard {
  if (options === null || typeof options !== "object") {
    rejectWorkTogetherPrincipalAssertion();
  }
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  if (
    typeof maxEntries !== "number" ||
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < MIN_MAX_ENTRIES ||
    maxEntries > MAX_MAX_ENTRIES
  ) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (options.db === null || typeof options.db !== "object") {
    rejectWorkTogetherPrincipalAssertion();
  }

  const db = options.db;
  return {
    async consume(
      args: PrincipalAssertionReplayConsumeArgs,
    ): Promise<PrincipalAssertionReplayConsumeResult> {
      try {
        return consumePrincipalAssertionReplay({
          db,
          expiresAtMs: args.expiresAtMs,
          jti: args.jti,
          maxEntries,
          nowMs: args.nowMs,
        });
      } catch {
        rejectWorkTogetherPrincipalAssertion();
      }
    },
  };
}
