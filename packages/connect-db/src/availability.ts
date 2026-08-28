import { eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { TablesRelationalConfig } from "drizzle-orm/relations";
import { type HandleValidationError, validateSubdomain } from "./constants.js";
import { labelClaim } from "./schema.js";

export type LabelClaim = typeof labelClaim.$inferSelect;

interface ConnectDbFullSchema extends Record<string, unknown> {}

export type ConnectDb = BaseSQLiteDatabase<
  "sync" | "async",
  unknown,
  ConnectDbFullSchema,
  TablesRelationalConfig
>;

export type LabelAvailability =
  | { available: true; label: string }
  | { available: false; reason: "invalid"; error: HandleValidationError }
  | {
      available: false;
      reason: "taken";
      namespace: "handle" | "subdomain" | "machine";
    };

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

export function machineRoutingKey(label: string, generation: string): string {
  return `${label}:${generation}`;
}
