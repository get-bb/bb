// Label availability across the single public namespace shared by account
// handles (`profile.handle`), server subdomains (`server.subdomain`), and machine
// subdomains (`machine.subdomain`). `label_claim.label` is the atomic
// globally-unique allocation point. Migration-owned triggers attach and release
// claims in the same SQLite statement as every source-table mutation, including
// writes from claim-ignorant old workers.

import { eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { type HandleValidationError, validateSubdomain } from "./constants.js";
import { labelClaim } from "./schema.js";

export type LabelClaim = typeof labelClaim.$inferSelect;

/**
 * The minimal Drizzle SQLite database shape this helper needs. Satisfied by both
 * the D1 driver (`drizzle-orm/d1`, async) used in the worker/dashboard and the
 * better-sqlite3 driver (sync) used in tests — the `"sync" | "async"` result
 * kind accepts either, and callers just `await` the result.
 */
// The relational-query schema generics are irrelevant here — this helper only
// uses the core `.select()` surface — so they are widened to accept any Drizzle
// SQLite database (D1 or better-sqlite3, with or without a bound schema).
// oxlint-disable-next-line typescript/no-explicit-any
export type ConnectDb = BaseSQLiteDatabase<
  "sync" | "async",
  unknown,
  Record<string, unknown>,
  any
>;

/**
 * Result of a label-availability check.
 *   - `available: true` — well-formed and free in every routing namespace.
 *   - `reason: "invalid"` — failed the shared handle/subdomain grammar
 *     (`error` carries the specific reason, incl. reserved words and `--`).
 *   - `reason: "taken"` — already claimed; `namespace` says which table holds
 *     it.
 */
export type LabelAvailability =
  | { available: true; label: string }
  | { available: false; reason: "invalid"; error: HandleValidationError }
  | {
      available: false;
      reason: "taken";
      namespace: "handle" | "subdomain" | "machine";
    };

/**
 * Check whether `rawLabel` can be claimed as an account, server, or machine
 * label. Normalizes (trim + lowercase), validates the shared grammar, then
 * checks the trigger-maintained global claim row.
 */
export async function checkLabelAvailability(
  db: ConnectDb,
  rawLabel: string,
): Promise<LabelAvailability> {
  const label = rawLabel.trim().toLowerCase();

  const invalid = validateSubdomain(label);
  if (invalid) return { available: false, reason: "invalid", error: invalid };

  const claim = await db
    .select({ kind: labelClaim.kind })
    .from(labelClaim)
    .where(eq(labelClaim.label, label))
    .get();
  if (claim) {
    return {
      available: false,
      reason: "taken",
      namespace: claim.kind === "server" ? "subdomain" : claim.kind,
    };
  }

  return { available: true, label };
}

/** Machine routing key, isolated across label ownership generations. */
export function machineRoutingKey(label: string, generation: string): string {
  return `${label}:${generation}`;
}
