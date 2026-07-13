// Label availability across the single public namespace shared by account
// handles (`profile.handle`), server subdomains (`server.subdomain`), and machine
// subdomains (`machine.subdomain`). A label is claimable only when it is
// well-formed AND unused in all three tables. The
// dashboard (apps/web) and the gate reuse this so the two claim paths cannot
// disagree about what is free.

import { eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { type HandleValidationError, validateSubdomain } from "./constants.js";
import { machine, profile, server } from "./schema.js";

/**
 * The minimal Drizzle SQLite database shape this helper needs. Satisfied by both
 * the D1 driver (`drizzle-orm/d1`, async) used in the worker/dashboard and the
 * better-sqlite3 driver (sync) used in tests — the `"sync" | "async"` result
 * kind accepts either, and callers just `await` the result.
 */
// The relational-query schema generics are irrelevant here — this helper only
// uses the core `.select()` surface — so they are widened to accept any Drizzle
// SQLite database (D1 or better-sqlite3, with or without a bound schema).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 * queries all three unique columns, so a single `.get()` per table suffices.
 * Handles then servers are checked first to preserve stable precedence for
 * legacy claim paths; any hit means unavailable.
 */
export async function checkLabelAvailability(
  db: ConnectDb,
  rawLabel: string,
): Promise<LabelAvailability> {
  const label = rawLabel.trim().toLowerCase();

  const invalid = validateSubdomain(label);
  if (invalid) return { available: false, reason: "invalid", error: invalid };

  const handleRow = await db
    .select({ handle: profile.handle })
    .from(profile)
    .where(eq(profile.handle, label))
    .get();
  if (handleRow)
    return { available: false, reason: "taken", namespace: "handle" };

  const serverRow = await db
    .select({ subdomain: server.subdomain })
    .from(server)
    .where(eq(server.subdomain, label))
    .get();
  if (serverRow)
    return { available: false, reason: "taken", namespace: "subdomain" };

  const machineRow = await db
    .select({ subdomain: machine.subdomain })
    .from(machine)
    .where(eq(machine.subdomain, label))
    .get();
  if (machineRow)
    return { available: false, reason: "taken", namespace: "machine" };

  return { available: true, label };
}
