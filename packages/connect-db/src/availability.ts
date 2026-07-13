// Label availability across the single public namespace shared by account
// handles (`profile.handle`), server subdomains (`server.subdomain`), and machine
// subdomains (`machine.subdomain`). `label_claim.label` is the authoritative
// globally-unique allocation point; product tables denormalize the label only
// after winning that row.

import { and, eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { type HandleValidationError, validateSubdomain } from "./constants.js";
import { labelClaim, type LabelClaimKind } from "./schema.js";

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
 * queries the authoritative global claim row in one exact lookup.
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

export interface NewLabelClaim {
  label: string;
  kind: LabelClaimKind;
  ownerId: string;
  userId: string;
  generation: string;
  createdAt: Date;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /unique constraint/iu.test(error.message);
}

/** Atomically win the one global routing-label namespace. */
export async function tryClaimLabel(
  db: ConnectDb,
  claim: NewLabelClaim,
): Promise<boolean> {
  if (validateSubdomain(claim.label) !== null) return false;
  try {
    await db.insert(labelClaim).values(claim).run();
    return true;
  } catch (error) {
    if (isUniqueConstraintError(error)) return false;
    throw error;
  }
}

/** Release only the exact ownership generation the caller previously won. */
export async function releaseLabelClaim(
  db: ConnectDb,
  claim: Pick<NewLabelClaim, "label" | "kind" | "ownerId" | "generation">,
): Promise<void> {
  await db
    .delete(labelClaim)
    .where(
      and(
        eq(labelClaim.label, claim.label),
        eq(labelClaim.kind, claim.kind),
        eq(labelClaim.ownerId, claim.ownerId),
        eq(labelClaim.generation, claim.generation),
      ),
    )
    .run();
}

/** Preserve legacy server DO/cache keys; isolate reusable machine generations. */
export function routingKeyForLabelClaim(
  label: string,
  kind: LabelClaimKind,
  generation: string,
): string {
  return kind === "machine" ? `${label}:${generation}` : label;
}
