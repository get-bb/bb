// Label availability across the single public namespace shared by account
// handles (`profile.handle`), server subdomains (`server.subdomain`), and machine
// subdomains (`machine.subdomain`). `label_claim.label` is the atomic
// globally-unique allocation point. During a dual-worker rollout, source-table
// reads repair claims omitted by the old web worker; stale orphan claims are
// likewise verified before reuse.

import { and, eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { type HandleValidationError, validateSubdomain } from "./constants.js";
import {
  labelClaim,
  machine,
  profile,
  server,
  type LabelClaimKind,
} from "./schema.js";

export const LABEL_CLAIM_ATTACH_GRACE_MS = 60_000;
export const LEGACY_LABEL_CLAIM_GENERATION = "legacy";
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
 * checks the global claim row, repairing it from legacy source rows if needed.
 */
export async function checkLabelAvailability(
  db: ConnectDb,
  rawLabel: string,
): Promise<LabelAvailability> {
  const label = rawLabel.trim().toLowerCase();

  const invalid = validateSubdomain(label);
  if (invalid) return { available: false, reason: "invalid", error: invalid };

  const claim = await findOrRepairLabelClaim(db, label);
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

async function claimHasLiveSource(
  db: ConnectDb,
  claim: LabelClaim,
): Promise<boolean> {
  if (claim.kind === "handle") {
    return Boolean(
      await db
        .select({ userId: profile.userId })
        .from(profile)
        .where(
          and(
            eq(profile.userId, claim.ownerId),
            eq(profile.handle, claim.label),
          ),
        )
        .get(),
    );
  }
  if (claim.kind === "server") {
    return Boolean(
      await db
        .select({ id: server.id })
        .from(server)
        .where(
          and(
            eq(server.id, claim.ownerId),
            eq(server.userId, claim.userId),
            eq(server.subdomain, claim.label),
          ),
        )
        .get(),
    );
  }
  return Boolean(
    await db
      .select({ id: machine.id })
      .from(machine)
      .where(
        and(
          eq(machine.id, claim.ownerId),
          eq(machine.userId, claim.userId),
          eq(machine.subdomain, claim.label),
        ),
      )
      .get(),
  );
}

async function findLegacyLabelSource(
  db: ConnectDb,
  label: string,
): Promise<Omit<NewLabelClaim, "generation" | "createdAt"> | null> {
  const handleRow = await db
    .select({ userId: profile.userId })
    .from(profile)
    .where(eq(profile.handle, label))
    .get();
  if (handleRow) {
    return {
      label,
      kind: "handle",
      ownerId: handleRow.userId,
      userId: handleRow.userId,
    };
  }

  const serverRow = await db
    .select({ id: server.id, userId: server.userId })
    .from(server)
    .where(eq(server.subdomain, label))
    .get();
  if (serverRow) {
    return {
      label,
      kind: "server",
      ownerId: serverRow.id,
      userId: serverRow.userId,
    };
  }

  const machineRow = await db
    .select({ id: machine.id, userId: machine.userId })
    .from(machine)
    .where(eq(machine.subdomain, label))
    .get();
  return machineRow
    ? {
        label,
        kind: "machine",
        ownerId: machineRow.id,
        userId: machineRow.userId,
      }
    : null;
}

/**
 * Return the live claim for a label, repairing either side of the rollout:
 * old workers can still write source rows without claims, while interrupted
 * new-worker mutations can leave claims without source rows. A short grace
 * keeps an in-flight claim from being reclaimed between its claim/source writes.
 */
export async function findOrRepairLabelClaim(
  db: ConnectDb,
  label: string,
  now = Date.now(),
): Promise<LabelClaim | null> {
  const existing = await db
    .select()
    .from(labelClaim)
    .where(eq(labelClaim.label, label))
    .get();
  if (existing) {
    if (await claimHasLiveSource(db, existing)) return existing;
    if (now - existing.createdAt.getTime() < LABEL_CLAIM_ATTACH_GRACE_MS) {
      return existing;
    }
    await releaseLabelClaim(db, existing);
  }

  const source = await findLegacyLabelSource(db, label);
  if (!source) return null;

  const repaired: NewLabelClaim = {
    ...source,
    generation:
      source.kind === "server"
        ? LEGACY_LABEL_CLAIM_GENERATION
        : crypto.randomUUID(),
    createdAt: new Date(now),
  };
  try {
    await db.insert(labelClaim).values(repaired).run();
    return repaired;
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return (
      (await db
        .select()
        .from(labelClaim)
        .where(eq(labelClaim.label, label))
        .get()) ?? null
    );
  }
}

/** Atomically win the one global routing-label namespace. */
export async function tryClaimLabel(
  db: ConnectDb,
  claim: NewLabelClaim,
): Promise<boolean> {
  if (validateSubdomain(claim.label) !== null) return false;
  if (await findOrRepairLabelClaim(db, claim.label)) return false;
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

/** Preserve primary/legacy keys; isolate newly reusable server/machine claims. */
export function routingKeyForLabelClaim(
  label: string,
  kind: LabelClaimKind,
  generation: string,
): string {
  return kind === "handle" ||
    (kind === "server" && generation === LEGACY_LABEL_CLAIM_GENERATION)
    ? label
    : `${label}:${generation}`;
}
